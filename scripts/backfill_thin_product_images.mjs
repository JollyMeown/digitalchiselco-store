// Backfill the main product image for "thin" products (no image_url + no
// gallery) by reconstructing the full-resolution Etsy CDN URL from the
// partial path in products_with_links.csv, downloading it, and uploading
// to Supabase Storage.
//
// The CSV stores image_url as a partial path:
//   {image_id}/il_340x270.{image_id}_{token}.jpg
// Etsy's CDN serves the original at:
//   https://i.etsystatic.com/il/{image_id}/il_fullxfull.{image_id}_{token}.jpg
//
// Usage:
//   node scripts/backfill_thin_product_images.mjs            # dry run
//   node scripts/backfill_thin_product_images.mjs --apply    # download + upload + DB write
//   node scripts/backfill_thin_product_images.mjs --apply --limit 10

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';

const SUPABASE_URL = process.env.PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) { console.error('Set PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const APPLY = process.argv.includes('--apply');
const LIMIT = (() => { const i = process.argv.indexOf('--limit'); return i > -1 ? parseInt(process.argv[i + 1], 10) : Infinity; })();
const CONCURRENCY = 4;
const BUCKET = 'site-media';
const FOLDER = 'products';
const CSV_PATH = 'products_with_links.csv';

console.log(APPLY ? '🚀 APPLY — will download images + write to Storage + DB.' : '🔍 DRY RUN — no writes. Re-run with --apply.');

// Reconstruct the fullxfull Etsy CDN URL from the CSV partial path.
function fullEtsyUrl(partial) {
  const m = String(partial || '').match(/(\d+)\/il_\d+x\d+\.(\d+)_([a-z0-9]+)\.jpg/i);
  if (!m) return null;
  return `https://i.etsystatic.com/il/${m[1]}/il_fullxfull.${m[2]}_${m[3]}.jpg`;
}

async function fetchAllProducts() {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('products')
      .select('id, slug, title, etsy_listing_id, image_url, gallery')
      .eq('active', true).range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

async function uploadToStorage(buf, storagePath, contentType) {
  const { error } = await db.storage.from(BUCKET).upload(storagePath, buf, { upsert: true, contentType });
  if (error) throw error;
  return db.storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl;
}

// ── Build the work list ─────────────────────────────────────────────
const products = await fetchAllProducts();
const thin = products.filter(p => (!p.image_url || !p.image_url.trim()) && (!Array.isArray(p.gallery) || p.gallery.length === 0));

const csv = parse(readFileSync(CSV_PATH), { columns: true, skip_empty_lines: true, relax_column_count: true });
const byId = new Map(csv.map(r => [String(r.etsy_listing_id).trim(), r]));

const jobs = [];
const noUrl = [];
for (const p of thin) {
  const row = byId.get(String(p.etsy_listing_id).trim());
  const url = fullEtsyUrl(row?.image_url);
  if (url) jobs.push({ p, url });
  else noUrl.push(p);
}

console.log(`\nThin products            : ${thin.length}`);
console.log(`...buildable image URL   : ${jobs.length}`);
console.log(`...no usable CSV image    : ${noUrl.length}`);
if (noUrl.length) {
  console.log('   (these get skipped — likely catalogue/bundle pseudo-products):');
  for (const p of noUrl) console.log('     • ' + p.slug);
}

const work = jobs.slice(0, LIMIT === Infinity ? jobs.length : LIMIT);
console.log(`\nProcessing ${work.length}${LIMIT !== Infinity ? ` (limited to ${LIMIT})` : ''}.`);

if (!APPLY) {
  console.log('\nSample of what would happen (first 3):');
  for (const { p, url } of work.slice(0, 3)) {
    console.log(`  ${p.slug.slice(0, 50)}`);
    console.log(`    ← ${url}`);
  }
  console.log('\nDry run complete. Re-run with --apply.');
  process.exit(0);
}

// ── Execute with bounded concurrency ─────────────────────────────────
const stats = { ok: 0, failed: 0 };
const errors = [];
let done = 0;

async function processOne({ p, url }) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 2000) throw new Error(`suspiciously small (${buf.length}b)`);
    const ts = Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
    const storagePath = `${FOLDER}/${p.slug}-${ts}.jpg`;
    const publicUrl = await uploadToStorage(buf, storagePath, 'image/jpeg');
    const { error } = await db.from('products').update({ image_url: publicUrl, gallery: [publicUrl] }).eq('id', p.id);
    if (error) throw error;
    stats.ok++;
  } catch (e) {
    stats.failed++;
    errors.push({ slug: p.slug, error: e.message });
  } finally {
    done++;
    if (done % 10 === 0 || done === work.length) {
      process.stdout.write(`\r  ${done}/${work.length}  ok=${stats.ok}  failed=${stats.failed}   `);
    }
  }
}

const queue = work.slice();
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length) await processOne(queue.shift());
}));
process.stdout.write('\n');

console.log(`\nDone. Uploaded ${stats.ok}, failed ${stats.failed}.`);
if (errors.length) {
  console.log('\nFailures:');
  for (const e of errors.slice(0, 30)) console.log(`  ✗ ${e.slug}: ${e.error}`);
  if (errors.length > 30) console.log(`  … and ${errors.length - 30} more`);
}
