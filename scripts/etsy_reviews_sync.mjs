// Feature 2 — import the shop's 5-star Etsy reviews onto the website.
// Reads reviews via the Etsy Open API (OAuth, transactions_r scope), keeps only
// genuine 5-star reviews with real text, and upserts them into the existing
// `reviews` table (source='Etsy'), deduped on a stable etsy_review_id. The
// homepage "Loved by makers" marquee (getReviews) then shows them automatically.
//
// Etsy does NOT expose the buyer's display name on reviews (privacy), so imported
// reviews are credited to "Verified Buyer".
//
// Usage:
//   node scripts/etsy_reviews_sync.mjs                 # newest ~500, 5-star only
//   node scripts/etsy_reviews_sync.mjs --min-len 25 --max 1000
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { etsy, getAccessToken } from './etsy_client.mjs';

const args = process.argv.slice(2);
const argVal = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const SHOP_NAME = argVal('--shop', process.env.ETSY_SHOP_NAME || 'DigitalChiselCo');
const MIN_LEN = Number(argVal('--min-len', '30'));
const MAX = Number(argVal('--max', '500'));

if (!(await getAccessToken().catch(() => null))) {
  console.error('No Etsy OAuth token — reviews need it. Run: node scripts/etsy_oauth.mjs');
  process.exit(1);
}

const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } });

// --- resolve the shop ------------------------------------------------------
const found = await etsy(`/shops?shop_name=${encodeURIComponent(SHOP_NAME)}`);
const shop = (found.results || []).find((s) => s.shop_name?.toLowerCase() === SHOP_NAME.toLowerCase())
  || found.results?.[0];
if (!shop) { console.error(`No Etsy shop matching "${SHOP_NAME}"`); process.exit(1); }
console.log(`Shop: ${shop.shop_name} (id ${shop.shop_id})`);

// --- page reviews (newest first) ------------------------------------------
const reviews = [];
for (let offset = 0; offset < MAX; offset += 100) {
  let page;
  try {
    page = await etsy(`/shops/${shop.shop_id}/reviews?limit=100&offset=${offset}`, { oauth: true });
  } catch (e) {
    if (reviews.length) { console.log(`\n(Etsy capped review paging at ${reviews.length})`); break; }
    throw e;
  }
  const rows = page.results || [];
  reviews.push(...rows);
  process.stdout.write(`\r  fetched ${reviews.length}/${page.count} reviews…`);
  if (reviews.length >= page.count || !rows.length) break;
}
console.log('');

// --- keep only 5-star with real text --------------------------------------
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
// Content-based dedup key: the SAME buyer leaving the SAME review text counts
// as ONE (e.g. someone who bought several files and left an identical review on
// each). Also keeps re-runs stable so nothing duplicates over time.
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); };
const idOf = (r) => `etsy:${r.buyer_user_id || 'x'}:${hash(norm(r.review))}`;

const fiveStar = reviews.filter((r) => Number(r.rating) === 5 && clean(r.review).length >= MIN_LEN);
const seen = new Set();
const good = fiveStar
  .filter((r) => { const k = idOf(r); if (seen.has(k)) return false; seen.add(k); return true; })
  .map((r, i) => ({
    etsy_review_id: idOf(r),
    name: 'Verified Buyer',
    text: clean(r.review).slice(0, 600),
    rating: 5,
    source: 'Etsy',
    active: true,
    // keep the 3 hand-picked seed reviews (sort_order 0-2) leading the marquee
    sort_order: 50 + i,
    etsy_created_at: new Date((r.create_timestamp || r.created_timestamp || 0) * 1000).toISOString(),
  }));

console.log(`5-star reviews with text: ${fiveStar.length}; unique after dedup: ${good.length} (${fiveStar.length - good.length} duplicate(s) collapsed)`);
if (!good.length) { console.log('Nothing to import.'); process.exit(0); }

// Clear the previously auto-imported Etsy reviews (older key scheme could hold
// duplicates), then re-insert the content-deduped set. The 3 hand-picked seed
// reviews have a NULL etsy_review_id and are left untouched.
{
  const { error: delErr } = await db.from('reviews').delete().eq('source', 'Etsy').not('etsy_review_id', 'is', null);
  if (delErr) { console.error('cleanup of old imported reviews failed:', delErr.message); process.exit(1); }
}

// --- insert the deduped set -----------------------------------------------
let ok = 0;
for (let i = 0; i < good.length; i += 100) {
  const batch = good.slice(i, i + 100);
  const { error } = await db.from('reviews').upsert(batch, { onConflict: 'etsy_review_id' });
  if (error) { console.error('upsert failed:', error.message); process.exit(1); }
  ok += batch.length;
  process.stdout.write(`\r  upserted ${ok}/${good.length}…`);
}
console.log(`\nDone — ${ok} unique five-star Etsy reviews live (same buyer + same text counted once).`);
console.log('They appear in the homepage "Loved by makers" section on the next load.');
