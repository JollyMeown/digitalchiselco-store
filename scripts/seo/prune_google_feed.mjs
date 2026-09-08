// Pull dead weight out of the Google Shopping feed.
//
// Why: on 2026-09-08 the feed showed 5,123 impressions in 28 days for 10 clicks
// (0.20% CTR) and zero conversions. Eleven offers took 1,479 impressions between
// them and were never clicked once. Google reads a feed's own click-through as a
// quality signal, so those offers are not merely idle, they hold down every
// other offer in the account.
//
// The rule: an offer with at least MIN_IMPRESSIONS in the reporting window and
// ZERO clicks is set google_feed_excluded = true. That is one boolean, the feed
// rebuilds on the next crawl, and --restore puts any of them straight back.
// Nothing about the product page, the price or the listing changes.
//
//   node scripts/seo/prune_google_feed.mjs                 # dry run
//   node scripts/seo/prune_google_feed.mjs --apply         # exclude them
//   node scripts/seo/prune_google_feed.mjs --restore       # put every one back
//   node scripts/seo/prune_google_feed.mjs --min=100 --apply
import 'dotenv/config';
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const APPLY = process.argv.includes('--apply');
const RESTORE = process.argv.includes('--restore');
const MIN = Number((process.argv.find((a) => a.startsWith('--min=')) || '').split('=')[1]) || 60;
const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const LOG = new URL('./.google_feed_pruned.json', import.meta.url);

if (RESTORE) {
  const { data, error } = await db.from('products').update({ google_feed_excluded: false })
    .eq('google_feed_excluded', true).select('slug, title');
  if (error) { console.error(error.message); process.exit(1); }
  console.log(`restored ${data?.length || 0} offers to the Google feed:`);
  for (const r of data || []) console.log('  ' + String(r.title).split('|')[0].trim().slice(0, 60));
  process.exit(0);
}

const { data: stats } = await db.from('merchant_product_stats').select('offer_id, title, impressions, clicks, window_days, fetched_at');
if (!stats?.length) { console.error('no merchant_product_stats rows: run the nightly sync first'); process.exit(1); }
console.log(`Google Shopping data: ${stats.length} offers, ${stats[0].window_days}-day window, fetched ${String(stats[0].fetched_at).slice(0, 10)}\n`);

const losers = stats.filter((s) => Number(s.clicks || 0) === 0 && Number(s.impressions || 0) >= MIN)
  .sort((a, b) => b.impressions - a.impressions);
if (!losers.length) { console.log(`no offer has ${MIN}+ impressions and zero clicks. Nothing to prune.`); process.exit(0); }

// resolve each offer to its product, and note whether it is proven elsewhere
const ids = losers.map((l) => String(l.offer_id));
const { data: prods } = await db.from('products').select('id, slug, title, price_usd, etsy_sales_365, google_feed_excluded').in('id', ids);
const byId = new Map((prods || []).map((p) => [String(p.id), p]));

let wasted = 0, proven = 0;
const picked = [];
console.log(`ZERO-CLICK OFFERS with ${MIN}+ impressions:\n`);
for (const l of losers) {
  const p = byId.get(String(l.offer_id));
  if (!p) { console.log(`  ${String(l.impressions).padStart(4)}i  (offer not matched to a product, skipped)  ${String(l.title || '').slice(0, 45)}`); continue; }
  wasted += Number(l.impressions);
  const etsy = Number(p.etsy_sales_365 || 0);
  if (etsy >= 5) proven++;
  picked.push({ id: p.id, slug: p.slug, title: p.title, impressions: l.impressions, etsy });
  console.log(`  ${String(l.impressions).padStart(4)}i 0c  $${String(p.price_usd).padEnd(5)} Etsy ${String(etsy).padStart(2)}/yr  ${String(p.title).split('|')[0].trim().slice(0, 48)}${etsy >= 5 ? '   <- sells on Etsy' : ''}`);
}
console.log(`\n  ${picked.length} offers, ${wasted} impressions a month that produce nothing.`);
if (proven) {
  console.log(`  ${proven} of them DO sell on Etsy, so the design is fine and the problem is how it`);
  console.log(`  reads in a shopping grid. Pulling them stops the bleeding now; give them a`);
  console.log(`  better product title and use --restore to put them back.`);
}

if (!APPLY) { console.log('\nDry run only. Re-run with --apply to exclude these from the feed.'); process.exit(0); }

let done = 0;
for (const p of picked) {
  const { error } = await db.from('products').update({ google_feed_excluded: true }).eq('id', p.id);
  if (error) console.error(`  ! ${p.slug}: ${error.message}`); else done++;
}
fs.writeFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), min: MIN, excluded: picked }, null, 1));
console.log(`\n✅ ${done} offers excluded from the Google feed. Saved to ${LOG.pathname.replace(/^\//, '')}`);
console.log(`   Reverse at any time: node scripts/seo/prune_google_feed.mjs --restore`);
