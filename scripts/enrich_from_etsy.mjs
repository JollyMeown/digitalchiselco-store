// Process the Etsy-scraped enrichment JSON: download each gallery image from
// Etsy CDN, upload to Supabase Storage (site-media/products/<slug>-g<N>-<hash>.jpg),
// and write description + gallery + image_url to the DB.
//
// Usage: node scripts/enrich_from_etsy.mjs <enrich.json>   (default: enrich.json)
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const BUCKET = 'site-media', FOLDER = 'products', CONCURRENCY = 3;

const enrich = JSON.parse(readFileSync(process.argv[2] || 'enrich.json', 'utf8'));
const gap = JSON.parse(readFileSync('gap_products.json', 'utf8'));
const meta = new Map(gap.map((g) => [String(g.etsy_listing_id), g]));

const rnd = () => Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
async function upload(buf, path) {
  const { error } = await db.storage.from(BUCKET).upload(path, buf, { upsert: true, contentType: 'image/jpeg' });
  if (error) throw error;
  return db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

const entries = Object.entries(enrich);
const stats = { ok: 0, fail: 0, skip: 0, imgs: 0 };

async function processOne([lid, data]) {
  const m = meta.get(String(lid));
  if (!m) { stats.skip++; return; }
  const gallery = (data.gallery || []).slice(0, 10);
  const desc = (data.desc || '').trim();
  if (!gallery.length && !desc) { stats.skip++; return; }
  try {
    const urls = [];
    for (let i = 0; i < gallery.length; i++) {
      try {
        const src = gallery[i].startsWith('http') ? gallery[i] : 'https://' + gallery[i];
        const res = await fetch(src, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 2000) continue;
        urls.push(await upload(buf, `${FOLDER}/${m.slug}-g${i + 1}-${rnd()}.jpg`));
        stats.imgs++;
      } catch { /* skip a bad image */ }
    }
    const update = {};
    if (urls.length) { update.gallery = urls; update.image_url = urls[0]; }
    if (desc) update.description = desc;
    if (Object.keys(update).length) {
      const { error } = await db.from('products').update(update).eq('id', m.id);
      if (error) throw error;
    }
    stats.ok++;
  } catch (e) {
    stats.fail++;
    console.log('FAIL', m.slug.slice(0, 40), '-', e.message);
  }
  const done = stats.ok + stats.fail + stats.skip;
  if (done % 15 === 0) console.log(`${done}/${entries.length}  ok=${stats.ok} fail=${stats.fail} skip=${stats.skip} imgs=${stats.imgs}`);
}

const queue = entries.slice();
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length) await processOne(queue.shift());
}));
console.log(`\nDONE. enriched ${stats.ok}, failed ${stats.fail}, skipped ${stats.skip}, images uploaded ${stats.imgs}`);
