// Migrate product images from Etsy CDN → Supabase Storage.
// Usage: node scripts/migrate_images.mjs [--dry-run] [--limit N]
//
// What it does:
//   1. Fetches all products (image_url + gallery) from Supabase
//   2. Downloads each Etsy-hosted image/video
//   3. Uploads to Supabase Storage bucket 'site-media' under products/
//   4. Updates the product record with the new URL
//
// Requirements: .env with PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Videos: files under 50 MB are uploaded; larger ones are logged and skipped.

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { basename, extname } from 'node:path';

// ── Config ──────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Set PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const BUCKET       = 'site-media';
const FOLDER       = 'products';
const DRY_RUN      = process.argv.includes('--dry-run');
const LIMIT        = (() => { const i = process.argv.indexOf('--limit'); return i > -1 ? parseInt(process.argv[i + 1], 10) : Infinity; })();
const CONCURRENCY  = 3;   // parallel downloads/uploads — gentle on Etsy + Supabase
const MAX_VIDEO_MB = 50;  // Supabase Storage free tier limit

// Known Etsy CDN patterns
const ETSY_PATTERN  = /i\.etsystatic\.com|img\.etsystatic\.com|v\.etsystatic\.com/i;
const VIDEO_EXTS    = new Set(['.mp4', '.mov', '.webm', '.avi']);
const IMAGE_EXTS    = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.svg']);

// ── Helpers ─────────────────────────────────────────────────────────

function isEtsyUrl(url) {
  return typeof url === 'string' && ETSY_PATTERN.test(url);
}

function guessExt(url, contentType) {
  // Try from content-type header first
  const ctMap = {
    'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif',
    'image/webp': '.webp', 'image/avif': '.avif', 'image/svg+xml': '.svg',
    'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm',
  };
  if (contentType && ctMap[contentType]) return ctMap[contentType];

  // Fallback: parse URL path
  try {
    const pathname = new URL(url).pathname;
    const ext = extname(pathname).split('?')[0].toLowerCase();
    if (ext && (IMAGE_EXTS.has(ext) || VIDEO_EXTS.has(ext))) return ext;
  } catch {}
  return '.jpg'; // safe default
}

function isVideo(ext) {
  return VIDEO_EXTS.has(ext);
}

async function downloadFile(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const ct = res.headers.get('content-type') || '';
  const buf = Buffer.from(await res.arrayBuffer());
  return { buf, contentType: ct };
}

async function uploadToStorage(buf, storagePath, contentType) {
  const { error } = await db.storage
    .from(BUCKET)
    .upload(storagePath, buf, { upsert: true, contentType });
  if (error) throw error;
  const { data } = db.storage.from(BUCKET).getPublicUrl(storagePath);
  return data.publicUrl;
}

function uniqueName(slug, index, ext) {
  const ts = Date.now().toString(36);
  const suffix = index > 0 ? `-g${index}` : '';
  return `${FOLDER}/${slug}${suffix}-${ts}${ext}`;
}

// Run N tasks with limited concurrency
async function pool(tasks, concurrency) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < tasks.length) {
      const idx = i++;
      results[idx] = await tasks[idx]().catch((e) => ({ __error: e }));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n=== Etsy → Supabase Image Migration ===`);
  if (DRY_RUN) console.log('  (DRY RUN — no changes will be made)\n');

  // 1. Fetch all products
  let allProducts = [];
  let from = 0;
  const PAGE = 500;
  while (true) {
    const { data, error } = await db
      .from('products')
      .select('id, slug, title, image_url, gallery')
      .order('title')
      .range(from, from + PAGE - 1);
    if (error) { console.error('Fetch error:', error.message); process.exit(1); }
    if (!data || data.length === 0) break;
    allProducts.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  console.log(`Fetched ${allProducts.length} products from Supabase.\n`);

  // 2. Collect all Etsy URLs that need migration
  const jobs = []; // { productId, slug, field, galleryIndex, url }
  for (const p of allProducts) {
    if (isEtsyUrl(p.image_url)) {
      jobs.push({ productId: p.id, slug: p.slug, field: 'image_url', galleryIndex: -1, url: p.image_url });
    }
    const gallery = Array.isArray(p.gallery) ? p.gallery : [];
    gallery.forEach((url, gi) => {
      if (isEtsyUrl(url)) {
        jobs.push({ productId: p.id, slug: p.slug, field: 'gallery', galleryIndex: gi, url });
      }
    });
  }

  const total = Math.min(jobs.length, LIMIT);
  console.log(`Found ${jobs.length} Etsy-hosted URLs. Processing ${total}.\n`);
  if (total === 0) { console.log('Nothing to migrate!'); return; }

  // 3. Process in batches
  const stats = { ok: 0, skipped: 0, failed: 0, videos: 0 };
  const errors = [];
  const skippedVideos = [];

  // Group jobs by product so we can batch-update
  const updates = new Map(); // productId → { image_url?, gallery? }

  const limitedJobs = jobs.slice(0, total);

  const tasks = limitedJobs.map((job, ji) => async () => {
    const label = `[${ji + 1}/${total}] ${job.slug} (${job.field}${job.galleryIndex >= 0 ? `[${job.galleryIndex}]` : ''})`;
    try {
      // Download
      const { buf, contentType } = await downloadFile(job.url);
      const ext = guessExt(job.url, contentType);

      // Video size check
      if (isVideo(ext)) {
        stats.videos++;
        const sizeMB = buf.length / (1024 * 1024);
        if (sizeMB > MAX_VIDEO_MB) {
          console.log(`  SKIP ${label} — video ${sizeMB.toFixed(1)} MB > ${MAX_VIDEO_MB} MB limit`);
          skippedVideos.push({ ...job, sizeMB: sizeMB.toFixed(1) });
          stats.skipped++;
          return;
        }
        console.log(`  VIDEO ${label} — ${sizeMB.toFixed(1)} MB, uploading…`);
      }

      const storagePath = uniqueName(job.slug, job.galleryIndex >= 0 ? job.galleryIndex + 1 : 0, ext);

      if (DRY_RUN) {
        console.log(`  DRY  ${label} → ${storagePath} (${(buf.length / 1024).toFixed(0)} KB)`);
        stats.ok++;
        return;
      }

      // Upload
      const newUrl = await uploadToStorage(buf, storagePath, contentType);
      console.log(`  OK   ${label} → ${(buf.length / 1024).toFixed(0)} KB`);

      // Track update
      if (!updates.has(job.productId)) {
        const p = allProducts.find((x) => x.id === job.productId);
        updates.set(job.productId, {
          image_url: p.image_url,
          gallery: Array.isArray(p.gallery) ? [...p.gallery] : [],
        });
      }
      const u = updates.get(job.productId);
      if (job.field === 'image_url') {
        u.image_url = newUrl;
      } else {
        u.gallery[job.galleryIndex] = newUrl;
      }
      stats.ok++;
    } catch (e) {
      console.error(`  FAIL ${label}: ${e.message}`);
      errors.push({ ...job, error: e.message });
      stats.failed++;
    }
  });

  await pool(tasks, CONCURRENCY);

  // 4. Batch update products in DB
  if (!DRY_RUN && updates.size > 0) {
    console.log(`\nUpdating ${updates.size} product records…`);
    let updated = 0;
    for (const [id, fields] of updates) {
      const { error } = await db.from('products').update({
        image_url: fields.image_url,
        gallery: fields.gallery,
      }).eq('id', id);
      if (error) {
        console.error(`  DB update failed for ${id}: ${error.message}`);
      } else {
        updated++;
      }
    }
    console.log(`  Updated ${updated}/${updates.size} products.`);
  }

  // 5. Summary
  console.log('\n=== Summary ===');
  console.log(`  Migrated:   ${stats.ok}`);
  console.log(`  Failed:     ${stats.failed}`);
  console.log(`  Skipped:    ${stats.skipped}`);
  console.log(`  Videos:     ${stats.videos}`);

  // Write error log
  if (errors.length) {
    const logPath = 'migration_errors.json';
    writeFileSync(logPath, JSON.stringify(errors, null, 2));
    console.log(`\n  Error details → ${logPath}`);
  }
  if (skippedVideos.length) {
    const logPath = 'migration_skipped_videos.json';
    writeFileSync(logPath, JSON.stringify(skippedVideos, null, 2));
    console.log(`  Skipped videos → ${logPath}`);
    console.log('  (For large videos, upload to YouTube/Vimeo and embed the link instead.)');
  }

  console.log('\nDone.\n');
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
