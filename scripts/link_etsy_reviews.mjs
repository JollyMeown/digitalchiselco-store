// Pull real Etsy shop reviews (each carries the listing_id) and attach them to
// the matching website product, so genuine per-product ratings power the
// aggregateRating star snippet in Google. Re-runnable (deduped by transaction).
//
//   node scripts/link_etsy_reviews.mjs            # dry run
//   node scripts/link_etsy_reviews.mjs --apply    # write
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { etsy, getAccessToken } from './etsy_client.mjs';

const APPLY = process.argv.includes('--apply');
// The reviews endpoint refuses offsets past 100 for anonymous calls, and the
// client only sends the OAuth token once it has been loaded. Without this line
// the importer silently stopped at 100 of 726 reviews, which is why only 145
// were ever attached to products (found 2026-09-15).
if (!(await getAccessToken())) { console.error('no Etsy token on this machine'); process.exit(1); }
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

// existing linked reviews (avoid re-inserting). Two keys: the transaction id
// when the endpoint gives one, and a content key (product + date + text),
// because the per-listing endpoint does not always carry the transaction id
// the shop-wide one did, and the 145 reviews imported earlier must not come
// back a second time under a different key.
const { data: existing } = await db.from('reviews').select('etsy_review_id, product_id, text, rating, etsy_created_at').eq('source', 'etsy').limit(20000);
const have = new Set((existing || []).map((r) => r.etsy_review_id));
const contentKey = (pid, ts, text, rating) => `${pid}|${ts ? String(ts).slice(0, 10) : ''}|${String(text || '').trim().slice(0, 80).toLowerCase()}|${rating}`;
const haveContent = new Set((existing || []).map((r) => contentKey(r.product_id, r.etsy_created_at, r.text, r.rating)));

// Per LISTING, not per shop. The shop-wide reviews endpoint is public and
// ignores the OAuth token, so Etsy applies its anonymous cap and refuses any
// offset past 100: the importer stopped at 100 of 726 reviews every time it
// ran, and only 145 ever reached products. A listing rarely has more than 100
// reviews, so walking the listings that have sold sidesteps the cap entirely.
let fetched = 0, mapped = 0, noListing = 0, noText = 0, dup = 0;
const toInsert = [];
const { data: sold } = await db.from('products').select('etsy_listing_id').eq('active', true).gt('etsy_sales_365', 0).not('etsy_listing_id', 'is', null).limit(5000);
const listingIds = [...new Set((sold || []).map((p) => String(p.etsy_listing_id)))];
console.log(`walking ${listingIds.length} listings that have sold`);
let n = 0;
for (const lid of listingIds) {
  let page;
  try { page = await etsy(`/listings/${lid}/reviews?limit=100`, { oauth: true }); }
  catch (e) { if (!/404/.test(e.message)) console.error(`listing ${lid}:`, e.message.slice(0, 80)); continue; }
  finally { await new Promise((res) => setTimeout(res, 120)); if (++n % 100 === 0) console.log(`  ${n}/${listingIds.length} listings, ${toInsert.length} new so far`); }
  const rows = page?.results || [];
  for (const r of rows) {
    fetched++;
    const text = String(r.review || '').trim();
    const listing = r.listing_id != null ? String(r.listing_id) : lid;
    const pid = byListing.get(listing);
    if (!pid) { noListing++; continue; }
    // a star-only review is still a real rating; it is shown as stars with no
    // quote rather than thrown away
    if (text.length < 3 && !(Number(r.rating) >= 1)) { noText++; continue; }
    const ts = Number(r.create_timestamp || r.created_timestamp || 0);
    const key = `etsy:txn:${r.transaction_id || (listing + ':' + (ts || Math.random()))}`;
    const ck = contentKey(pid, ts ? new Date(ts * 1000).toISOString() : '', text, Math.max(1, Math.min(5, Number(r.rating) || 5)));
    if (have.has(key) || haveContent.has(ck)) { dup++; continue; }
    have.add(key); haveContent.add(ck);
    mapped++;
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
