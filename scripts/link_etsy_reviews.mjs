// Pull real Etsy shop reviews (each carries the listing_id) and attach them to
// the matching website product, so genuine per-product ratings power the
// aggregateRating star snippet in Google. Re-runnable (deduped by transaction).
//
//   node scripts/link_etsy_reviews.mjs            # dry run
//   node scripts/link_etsy_reviews.mjs --apply    # write
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { etsy } from './etsy_client.mjs';

const APPLY = process.argv.includes('--apply');
const SHOP_NAME = process.env.ETSY_SHOP_NAME || 'DigitalChiselCo';
const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// resolve shop id
const found = await etsy(`/shops?shop_name=${encodeURIComponent(SHOP_NAME)}`);
const shop = (found.results || []).find((s) => s.shop_name?.toLowerCase() === SHOP_NAME.toLowerCase()) || found.results?.[0];
if (!shop) { console.error('shop not found'); process.exit(1); }
console.log(`shop ${shop.shop_name} (${shop.shop_id})`);

// listing_id → product_id (only active products with an Etsy listing id)
const byListing = new Map();
for (let from = 0; ; from += 1000) {
  const { data } = await db.from('products').select('id, etsy_listing_id, active').not('etsy_listing_id', 'is', null).range(from, from + 999);
  if (!data?.length) break;
  for (const p of data) if (p.active) byListing.set(String(p.etsy_listing_id), p.id);
  if (data.length < 1000) break;
}
console.log(`products with an Etsy listing id: ${byListing.size}`);

// existing linked reviews (avoid re-inserting)
const { data: existing } = await db.from('reviews').select('etsy_review_id').like('etsy_review_id', 'etsy:txn:%').limit(20000);
const have = new Set((existing || []).map((r) => r.etsy_review_id));

// paginate all shop reviews
let fetched = 0, mapped = 0, noListing = 0, noText = 0, dup = 0;
const toInsert = [];
for (let offset = 0; ; offset += 100) {
  let page;
  try { page = await etsy(`/shops/${shop.shop_id}/reviews?limit=100&offset=${offset}`, { oauth: true }); }
  catch (e) { console.error('reviews fetch stopped:', e.message.slice(0, 120)); break; }
  const rows = page.results || [];
  if (!rows.length) break;
  for (const r of rows) {
    fetched++;
    const text = String(r.review || '').trim();
    const listing = r.listing_id != null ? String(r.listing_id) : '';
    const pid = byListing.get(listing);
    if (!pid) { noListing++; continue; }
    if (text.length < 3) { noText++; continue; }
    const key = `etsy:txn:${r.transaction_id || (listing + ':' + (r.create_timestamp || r.created_timestamp || Math.random()))}`;
    if (have.has(key)) { dup++; continue; }
    have.add(key);
    mapped++;
    const ts = Number(r.create_timestamp || r.created_timestamp || 0);
    toInsert.push({
      product_id: pid,
      name: 'Verified buyer',
      text: text.slice(0, 1000).replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&'),
      rating: Math.max(1, Math.min(5, Number(r.rating) || 5)),
      source: 'etsy', status: 'approved', active: true, generic: false,
      etsy_review_id: key,
      ...(ts ? { etsy_created_at: new Date(ts * 1000).toISOString() } : {}),
    });
  }
  if (rows.length < 100) break;
}

console.log(`\nfetched ${fetched} Etsy reviews · linkable ${mapped} · skipped: ${noListing} no-product, ${noText} no-text, ${dup} already-linked`);
if (!APPLY) { console.log('DRY RUN — re-run with --apply to write.'); process.exit(0); }

let inserted = 0;
for (let i = 0; i < toInsert.length; i += 200) {
  const { error } = await db.from('reviews').upsert(toInsert.slice(i, i + 200), { onConflict: 'etsy_review_id', ignoreDuplicates: true });
  if (error) console.error('insert error:', error.message); else inserted += toInsert.slice(i, i + 200).length;
}
// how many distinct products now have >=1 linked review
const { data: withRev } = await db.from('reviews').select('product_id').eq('source', 'etsy').not('product_id', 'is', null).limit(20000);
const distinct = new Set((withRev || []).map((r) => r.product_id)).size;
console.log(`\n✅ linked ${inserted} reviews · ${distinct} products now have genuine per-product reviews (stars will appear on those).`);
