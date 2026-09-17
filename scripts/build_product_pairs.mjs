// Build "frequently bought together" from real orders.
//
// Etsy receipts (every line item carries its listing_id) + paid website
// orders. Two designs count as a pair once per order that held both. Only
// pairs seen in at least MIN_TOGETHER separate orders are kept, top
// KEEP_PER_PRODUCT per design, so one odd order never becomes a suggestion.
//
// Runs on the owner's PC (the Etsy token lives there), like finance_refresh.
//   node scripts/build_product_pairs.mjs            # dry run: coverage + samples
//   node scripts/build_product_pairs.mjs --apply    # replace product_pairs
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { etsy } from './etsy_client.mjs';

const APPLY = process.argv.includes('--apply');
const SHOP = 61524055;
const YEARS = 2;
const MIN_TOGETHER = 2;
const KEEP_PER_PRODUCT = 8;
const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function all(table, select, apply = (q) => q) {
  const out = []; let from = 0;
  for (;;) {
    const { data, error } = await apply(db.from(table).select(select)).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if ((data || []).length < 1000) break;
    from += 1000;
  }
  return out;
}
async function etsyRetry(path) {
  let last;
  for (let i = 1; i <= 3; i++) {
    try { return await etsy(path, { oauth: true }); }
    catch (e) { last = e; if (i < 3) await new Promise((r) => setTimeout(r, i * 3000)); }
  }
  throw last;
}
const norm = (s) => String(s || '').toLowerCase().split('|')[0].replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

// ── map Etsy listings to products ───────────────────────────────────────
const products = await all('products', 'id, title, etsy_listing_id, active, is_bundle, is_subscription, price_usd');
const byListing = new Map(products.filter((p) => p.etsy_listing_id).map((p) => [String(p.etsy_listing_id), p]));
const stats = await all('etsy_listing_stats', 'listing_id, title');
const byTitle = new Map();
for (const s of stats) { const p = byListing.get(String(s.listing_id)); if (p) byTitle.set(norm(s.title), p); }
for (const p of products) if (!byTitle.has(norm(p.title))) byTitle.set(norm(p.title), p);
const eligible = (p) => p && p.active && !p.is_subscription && Number(p.price_usd) > 0;

// ── collect baskets ─────────────────────────────────────────────────────
const baskets = [];
let receipts = 0, lines = 0, matched = 0;
const cutoff = Date.now() - YEARS * 365 * 86400e3;
for (let offset = 0; offset < 30000; offset += 100) {
  const page = await etsyRetry(`/shops/${SHOP}/receipts?limit=100&offset=${offset}`);
  const rows = page.results || [];
  if (!rows.length) break;
  let oldest = Infinity;
  for (const r of rows) {
    const ts = (r.created_timestamp || r.create_timestamp) * 1000;
    oldest = Math.min(oldest, ts);
    if (ts < cutoff) continue;
    receipts++;
    const ids = new Set();
    for (const t of r.transactions || []) {
      lines++;
      const p = byListing.get(String(t.listing_id)) || byTitle.get(norm(t.title));
      if (eligible(p)) { ids.add(p.id); matched++; }
    }
    if (ids.size >= 2) baskets.push([...ids]);
  }
  if (rows.length < 100 || oldest < cutoff) break;
  if (offset % 1000 === 0) process.stdout.write(`  ${receipts} receipts read…\r`);
}
const webOrders = await all('orders', 'id, order_items(product_id)', (q) => q.eq('status', 'paid'));
const pById = new Map(products.map((p) => [p.id, p]));
let webBaskets = 0;
for (const o of webOrders) {
  const ids = [...new Set((o.order_items || []).map((i) => i.product_id).filter((id) => eligible(pById.get(id))))];
  if (ids.length >= 2) { baskets.push(ids); webBaskets++; }
}

// ── count pairs ─────────────────────────────────────────────────────────
const count = new Map();
for (const b of baskets) {
  if (b.length > 12) continue;              // a bulk order says little about taste
  for (const a of b) for (const c of b) if (a !== c) {
    const k = a + '|' + c;
    count.set(k, (count.get(k) || 0) + 1);
  }
}
const perProduct = new Map();
for (const [k, n] of count) {
  if (n < MIN_TOGETHER) continue;
  const [a, c] = k.split('|');
  (perProduct.get(a) || perProduct.set(a, []).get(a)).push({ pair_id: c, together: n });
}
const rows = [];
for (const [a, list] of perProduct) {
  list.sort((x, y) => y.together - x.together);
  for (const x of list.slice(0, KEEP_PER_PRODUCT)) rows.push({ product_id: a, pair_id: x.pair_id, together: x.together });
}

console.log(`\netsy receipts (last ${YEARS}y): ${receipts} · line items ${lines} · matched to products ${matched} (${(matched / Math.max(1, lines) * 100).toFixed(0)}%)`);
console.log(`multi-design baskets: ${baskets.length} (website ${webBaskets})`);
console.log(`pairs seen ${MIN_TOGETHER}+ times: ${rows.length} rows across ${perProduct.size} designs`);
const top = [...perProduct.entries()].map(([a, l]) => [a, l[0]]).sort((x, y) => y[1].together - x[1].together).slice(0, 8);
for (const [a, x] of top) console.log(`  ${x.together}x  ${String(pById.get(a)?.title).split('|')[0].slice(0, 45).padEnd(45)} + ${String(pById.get(x.pair_id)?.title).split('|')[0].slice(0, 40)}`);

if (!APPLY) { console.log('\nDRY RUN. Add --apply to write product_pairs.'); process.exit(0); }
const { error: delErr } = await db.from('product_pairs').delete().neq('together', -1);
if (delErr) throw delErr;
for (let i = 0; i < rows.length; i += 500) {
  const { error } = await db.from('product_pairs').insert(rows.slice(i, i + 500).map((r) => ({ ...r, updated_at: new Date().toISOString() })));
  if (error) throw error;
}
console.log(`wrote ${rows.length} pair rows`);
