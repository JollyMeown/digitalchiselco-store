// Backfills order_items.product_id where it's null, by matching order_items.title
// against products.title. Useful when historical orders went through the cart
// as ad-hoc Paddle items and never got linked to our catalog. Once linked, the
// /account dashboard renders download buttons for those items.
//
// Usage:
//   node scripts/backfill_order_item_products.mjs          # dry run
//   node scripts/backfill_order_item_products.mjs --apply  # write changes

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const APPLY = process.argv.includes('--apply');
const url = process.env.PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Set PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env'); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });

console.log(APPLY ? '🚀 APPLY mode — will UPDATE rows.' : '🔍 DRY RUN — no DB writes. Re-run with --apply.');

async function fetchAll(table, select, build = (q) => q) {
  const PAGE = 1000;
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(db.from(table).select(select)).range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...data);
    if (data.length < PAGE) return out;
  }
}

const orphans = await fetchAll('order_items', 'id, order_id, title, product_id', (q) => q.is('product_id', null));
console.log(`Found ${orphans.length} order_items with NULL product_id.`);

const productByTitle = new Map();
const products = await fetchAll('products', 'id, title');
for (const p of products) productByTitle.set(p.title, p.id);

const toFix = [];
const noMatch = [];
for (const o of orphans) {
  const pid = productByTitle.get(o.title);
  if (pid) toFix.push({ id: o.id, product_id: pid, title: o.title });
  else noMatch.push(o);
}

console.log(`  ${toFix.length} can be backfilled by title match`);
console.log(`  ${noMatch.length} have no matching product title`);
if (noMatch.length) {
  console.log('  Unmatched titles (first 10):');
  for (const o of noMatch.slice(0, 10)) console.log(`    • ${o.title.slice(0, 80)}`);
}

if (!APPLY) {
  console.log('\nDry run complete. Re-run with `--apply` to update.');
  process.exit(0);
}

let ok = 0, fail = 0;
for (const row of toFix) {
  const { error } = await db.from('order_items').update({ product_id: row.product_id }).eq('id', row.id);
  if (error) { console.error('  ✗', row.title.slice(0, 40), error.message); fail++; }
  else { ok++; }
}
console.log(`\nDone. Updated ${ok}, failed ${fail}.`);
