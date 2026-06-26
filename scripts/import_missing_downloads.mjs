// One-off: fill product_downloads for any active product that has zero
// download rows, by matching the product's slug against master_products.csv.
//
// Usage:
//   node scripts/import_missing_downloads.mjs           # dry run (no writes)
//   node scripts/import_missing_downloads.mjs --apply   # actually insert
//
// Skips products with NO matching CSV row, or where the CSV download_link is
// blank (the 8 bundles fall into the latter — they need manual setup).

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import { createClient } from '@supabase/supabase-js';

const APPLY = process.argv.includes('--apply');
const CSV_PATH = 'master_products.csv';

const url = process.env.PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

console.log(APPLY ? '🚀 APPLY mode — will INSERT rows.' : '🔍 DRY RUN — no DB writes. Re-run with --apply.');

// --- load CSV ---------------------------------------------------------------
const rows = parse(readFileSync(CSV_PATH), { columns: true, skip_empty_lines: true });
const bySlug = new Map(rows.map((r) => [r.slug, r]));
console.log(`Loaded ${rows.length} rows from ${CSV_PATH}.`);

// --- find missing products --------------------------------------------------
// Supabase caps a single SELECT at 1000 rows, so paginate via range().
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
const products = await fetchAll('products', 'id, slug, title, active, link_status', (q) => q.eq('active', true));
const existingDls = await fetchAll('product_downloads', 'product_id, download_link');

const haveDownloads = new Set(
  existingDls.filter((d) => (d.download_link || '').trim()).map((d) => d.product_id),
);
const missing = products.filter((p) => !haveDownloads.has(p.id));
console.log(`${missing.length} active products are missing all downloads.\n`);

// --- categorize -------------------------------------------------------------
const toInsert = [];
const skipped_no_csv_row = [];
const skipped_blank_link = [];

for (const p of missing) {
  const r = bySlug.get(p.slug);
  if (!r) { skipped_no_csv_row.push(p); continue; }
  const link = (r.download_link || '').trim();
  if (!link) { skipped_blank_link.push({ p, csvStatus: r.link_status }); continue; }
  toInsert.push({
    product_id: p.id,
    file_name: (r.matched_stl_name || r.title || '').trim() || null,
    drive_file_id: (r.drive_file_id || '').trim() || null,
    download_link: link,
    sort_order: 0,
  });
}

console.log('Categorized:');
console.log(`  ${toInsert.length.toString().padStart(3)}  WILL insert (CSV had usable link)`);
console.log(`  ${skipped_blank_link.length.toString().padStart(3)}  SKIP — CSV link blank (mostly bundles needing manual setup):`);
for (const { p, csvStatus } of skipped_blank_link) {
  console.log(`        • [${csvStatus}] ${p.slug}`);
}
console.log(`  ${skipped_no_csv_row.length.toString().padStart(3)}  SKIP — no row in master_products.csv:`);
for (const p of skipped_no_csv_row.slice(0, 20)) console.log(`        • ${p.slug}`);
if (skipped_no_csv_row.length > 20) console.log(`        … and ${skipped_no_csv_row.length - 20} more`);

// --- apply ------------------------------------------------------------------
if (!APPLY) {
  console.log('\nDry run complete. Re-run with `--apply` to insert.');
  process.exit(0);
}

console.log(`\nInserting ${toInsert.length} rows in batches of 100…`);
const BATCH = 100;
let ok = 0, fail = 0;
for (let i = 0; i < toInsert.length; i += BATCH) {
  const slice = toInsert.slice(i, i + BATCH);
  const { error } = await db.from('product_downloads').insert(slice);
  if (error) {
    console.error(`  ✗ batch ${i}-${i + slice.length}: ${error.message}`);
    fail += slice.length;
  } else {
    ok += slice.length;
    process.stdout.write(`\r  inserted ${ok}/${toInsert.length}`);
  }
}
process.stdout.write('\n');
console.log(`\nDone. Inserted ${ok}, failed ${fail}.`);

if (skipped_blank_link.length || skipped_no_csv_row.length) {
  console.log('\nNext steps:');
  if (skipped_blank_link.length) console.log(`  • Manually add download links for the ${skipped_blank_link.length} bundles via admin → Products.`);
  if (skipped_no_csv_row.length) console.log(`  • Investigate the ${skipped_no_csv_row.length} active products with no CSV row (may have been added after the Etsy import).`);
}
