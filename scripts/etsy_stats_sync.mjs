// Feature 1 — LIVE Etsy shop stats onto the website.
// Pulls sales / rating / reviews / active-listing counts from the Etsy shop and
// (with OAuth) sums admirers across active listings, then writes them into the
// single site_settings row that the homepage stats bar already reads.
//
// Public shop fields are enough for sales/rating/reviews/designs; admirers needs
// OAuth (to page every active listing and sum num_favorers). It degrades
// gracefully to the existing admirers_count if OAuth isn't set up.
//
// Usage:
//   node scripts/etsy_stats_sync.mjs                 # sync now
//   node scripts/etsy_stats_sync.mjs --shop DigitalChiselCo
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { etsy, getAccessToken } from './etsy_client.mjs';

if (!process.env.ETSY_API_KEY) { console.error('ETSY_API_KEY missing from .env'); process.exit(1); }

const args = process.argv.slice(2);
const argVal = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const SHOP_NAME = argVal('--shop', process.env.ETSY_SHOP_NAME || 'DigitalChiselCo');

const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } });

// --- resolve the shop ------------------------------------------------------
const found = await etsy(`/shops?shop_name=${encodeURIComponent(SHOP_NAME)}`);
const shop = (found.results || []).find((s) => s.shop_name?.toLowerCase() === SHOP_NAME.toLowerCase())
  || found.results?.[0];
if (!shop) { console.error(`No Etsy shop matching "${SHOP_NAME}"`); process.exit(1); }
console.log(`Shop: ${shop.shop_name} (id ${shop.shop_id})`);

// --- headline numbers straight off the shop resource -----------------------
const sales_count = Number(shop.transaction_sold_count) || 0;
const products_count = Number(shop.listing_active_count) || 0;
const reviews_count = Number(shop.review_count ?? shop.num_favorers ?? 0) || 0;
const rating = shop.review_average != null
  ? Math.round(Number(shop.review_average) * 10) / 10 : null;

// --- admirers: sum num_favorers across active listings (OAuth) -------------
let admirers_count = null;
const token = await getAccessToken().catch(() => null);
if (token) {
  try {
    let sum = 0, seen = 0;
    for (let offset = 0; ; offset += 100) {
      const page = await etsy(
        `/shops/${shop.shop_id}/listings?state=active&limit=100&offset=${offset}`, { oauth: true });
      const rows = page.results || [];
      for (const l of rows) sum += Number(l.num_favorers) || 0;
      seen += rows.length;
      process.stdout.write(`\r  admirers: scanned ${seen}/${page.count} listings…`);
      if (seen >= page.count || !rows.length) break;
    }
    console.log('');
    admirers_count = sum;
  } catch (e) {
    console.log(`\n  (admirers skipped: ${String(e.message).slice(0, 100)})`);
  }
} else {
  console.log('  (no OAuth token — admirers_count left unchanged; run scripts/etsy_oauth.mjs to enable)');
}

// --- write into site_settings (row id = 1) ---------------------------------
const patch = { sales_count, products_count, etsy_synced_at: new Date().toISOString() };
if (reviews_count) patch.reviews_count = reviews_count;
if (rating != null) patch.rating = rating;
if (admirers_count != null) patch.admirers_count = admirers_count;

const { error } = await db.from('site_settings').update(patch).eq('id', 1);
if (error) { console.error('Supabase update failed:', error.message); process.exit(1); }

console.log('\nLIVE stats written to site_settings:');
console.log(`  sales_count     ${sales_count.toLocaleString()}`);
console.log(`  rating          ${rating ?? '(unchanged)'}`);
console.log(`  reviews_count   ${reviews_count || '(unchanged)'}`);
console.log(`  products_count  ${products_count.toLocaleString()}`);
console.log(`  admirers_count  ${admirers_count ?? '(unchanged)'}`);
console.log('The homepage stats bar now shows these on the next page load.');
