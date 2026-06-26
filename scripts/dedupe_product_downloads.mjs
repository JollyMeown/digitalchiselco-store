// Removes duplicate rows in product_downloads where the SAME product_id has
// multiple rows pointing at the SAME download_link. Caused by an earlier run
// of import_missing_downloads.mjs that fired before its pagination bug was
// fixed — products whose original row sat past Supabase's 1000-row cap were
// misclassified as "missing" and got a second row inserted.
//
// Rules:
//   * Group by (product_id, normalized download_link).
//   * In each group, prefer the row with a non-null file_name. Tie-break by
//     the newest created_at (richer metadata wins).
//   * Delete every other row in the group.
//
// Usage:
//   node scripts/dedupe_product_downloads.mjs           # dry run
//   node scripts/dedupe_product_downloads.mjs --apply   # actually delete

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const APPLY = process.argv.includes('--apply');
const url = process.env.PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Set PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env'); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });

console.log(APPLY ? '🚀 APPLY mode — will DELETE rows.' : '🔍 DRY RUN — no DB writes. Re-run with --apply.');

async function fetchAll() {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('product_downloads')
      .select('id, product_id, file_name, download_link, created_at')
      .range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

const rows = await fetchAll();
console.log(`Loaded ${rows.length} download rows.`);

// Group by product + normalized link
const groups = new Map();
for (const r of rows) {
  const link = (r.download_link || '').trim().toLowerCase();
  if (!r.product_id || !link) continue;
  const key = `${r.product_id}|${link}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(r);
}

const toDelete = [];
let dupGroups = 0;
for (const rs of groups.values()) {
  if (rs.length < 2) continue;
  dupGroups++;
  // Keep one — prefer non-null file_name, then newest.
  rs.sort((a, b) => {
    const aHas = a.file_name ? 1 : 0;
    const bHas = b.file_name ? 1 : 0;
    if (aHas !== bHas) return bHas - aHas; // file_name first
    return (b.created_at || '').localeCompare(a.created_at || '');
  });
  const keep = rs[0];
  const drop = rs.slice(1);
  for (const d of drop) toDelete.push({ id: d.id, product_id: d.product_id, kept_id: keep.id });
}

console.log(`Duplicate groups: ${dupGroups}`);
console.log(`Rows to delete  : ${toDelete.length}`);

if (!toDelete.length) {
  console.log('\nNothing to do.');
  process.exit(0);
}

console.log('\nSample (first 5):');
for (const t of toDelete.slice(0, 5)) {
  console.log(`  delete ${t.id.slice(0, 8)}  (product ${t.product_id.slice(0, 8)})  — keeping ${t.kept_id.slice(0, 8)}`);
}

if (!APPLY) {
  console.log('\nDry run complete. Re-run with `--apply` to delete.');
  process.exit(0);
}

console.log(`\nDeleting ${toDelete.length} rows in batches of 100…`);
let ok = 0, fail = 0;
for (let i = 0; i < toDelete.length; i += 100) {
  const ids = toDelete.slice(i, i + 100).map((t) => t.id);
  const { error } = await db.from('product_downloads').delete().in('id', ids);
  if (error) {
    console.error(`  ✗ batch ${i}-${i + ids.length}: ${error.message}`);
    fail += ids.length;
  } else {
    ok += ids.length;
    process.stdout.write(`\r  deleted ${ok}/${toDelete.length}`);
  }
}
process.stdout.write('\n');
console.log(`\nDone. Deleted ${ok}, failed ${fail}.`);
