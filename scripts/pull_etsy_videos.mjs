// Pull each product's showcase video from its Etsy listing (Etsy API
// /listings/{id}/videos) and store the CDN URL + poster on the product.
// Re-runnable; only writes when the URL changed. Etsy-throttled.
//
//   node scripts/pull_etsy_videos.mjs            # all products missing a video
//   node scripts/pull_etsy_videos.mjs --all      # refresh every product
//   node scripts/pull_etsy_videos.mjs --limit=50 # cap this run
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { etsy } from './etsy_client.mjs';

const ALL = process.argv.includes('--all');
const limArg = process.argv.find((a) => a.startsWith('--limit='));
const LIMIT = limArg ? Number(limArg.split('=')[1]) : Infinity;
const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let q = db.from('products').select('id, slug, etsy_listing_id, video_url').not('etsy_listing_id', 'is', null).eq('active', true);
if (!ALL) q = q.is('video_url', null);
const { data: rows, error } = await q.limit(5000);
if (error) { console.error('query failed:', error.message); process.exit(1); }
const targets = (rows || []).slice(0, LIMIT === Infinity ? undefined : LIMIT);
console.log(`checking ${targets.length} listings for videos${ALL ? ' (refresh all)' : ''}…`);

let found = 0, none = 0, failed = 0, i = 0;
for (const p of targets) {
  i++;
  try {
    const v = await etsy(`/listings/${p.etsy_listing_id}/videos`, { oauth: true });
    const vid = (v.results || []).find((x) => x.video_state === 'active') || (v.results || [])[0];
    if (vid?.video_url) {
      await db.from('products').update({ video_url: vid.video_url, video_thumb: vid.thumbnail_url || null }).eq('id', p.id);
      found++;
    } else none++;
  } catch (e) {
    failed++;
    if (failed <= 5) console.error(`  ${p.etsy_listing_id}: ${String(e.message).slice(0, 80)}`);
  }
  if (i % 100 === 0) console.log(`  …${i}/${targets.length} (found ${found})`);
  await sleep(120);   // ~8 req/s, well under Etsy's limit
}
console.log(`\n✅ done. videos found ${found} · no video ${none} · failed ${failed}`);
