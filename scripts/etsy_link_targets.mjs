// Builds the target list for Etsy-authoritative download-link verification:
//   - the newly-imported products that have no download link yet
//   - the products flagged by the Drive-filename audit (audit-flagged.csv)
// For each, resolves the Etsy listing's DownloadLinkGoogleDrive.txt file id
// (from etsy_listing_files.json) plus the website's current Drive file id, so
// after extraction we can compare Etsy (authority) vs website and fix mismatches.
//
// Output: etsy_link_targets.json = [{ listing_id, listing_file_id, txt_name,
//         slug, product_id, website_drive_id, reason }]
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import { createClient } from '@supabase/supabase-js';

const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const idOf = (url) => (url ? (url.match(/[?&]id=([A-Za-z0-9_-]{20,})/) || url.match(/\/file\/d\/([A-Za-z0-9_-]{20,})/) || [])[1] || null : null);

// listing_id -> txt file {id,name}
const listingFiles = JSON.parse(readFileSync('etsy_listing_files.json', 'utf8'));
const txtFileOf = (lid) => {
  const files = listingFiles[String(lid)] || [];
  const txt = files.find((f) => f.filetype === 'text/plain') || files.find((f) => /\.txt$/i.test(f.filename));
  return txt ? { id: txt.listing_file_id, name: txt.filename } : null;
};

// --- gather products of interest --------------------------------------------
// 1) newly-imported (inactive, review, has etsy_listing_id, no download row)
const { data: newProds } = await db.from('products')
  .select('id, slug, etsy_listing_id, active, link_status')
  .eq('active', false).eq('link_status', 'review').not('etsy_listing_id', 'is', null);

// download rows per product (to know current website link + which lack one)
const productIds = (newProds || []).map((p) => p.id);
const { data: newDls } = productIds.length
  ? await db.from('product_downloads').select('product_id, download_link').in('product_id', productIds)
  : { data: [] };
const hasDl = new Set((newDls || []).map((d) => d.product_id));

// 2) flagged products from the audit CSV
const flaggedRows = parse(readFileSync('audit-flagged.csv'), { columns: true, skip_empty_lines: true });
const flaggedSlugs = [...new Set(flaggedRows.filter((r) => !r.verified_at).map((r) => r.slug))].filter(Boolean);

// resolve flagged slugs -> product rows (paginate the IN query in chunks)
const flaggedProds = [];
for (let i = 0; i < flaggedSlugs.length; i += 200) {
  const chunk = flaggedSlugs.slice(i, i + 200);
  const { data } = await db.from('products').select('id, slug, etsy_listing_id').in('slug', chunk);
  flaggedProds.push(...(data || []));
}
const flaggedDrive = new Map(flaggedRows.map((r) => [r.slug, idOf(r.drive_url)]));

// --- assemble targets (dedup by listing_id) ---------------------------------
const targets = new Map();
function add(p, reason, websiteDriveId) {
  if (!p.etsy_listing_id) return;
  const txt = txtFileOf(p.etsy_listing_id);
  if (!txt) return; // listing not in active-shop file inventory (inactive/expired on Etsy)
  const key = String(p.etsy_listing_id);
  if (targets.has(key)) return;
  targets.set(key, {
    listing_id: key,
    listing_file_id: txt.id,
    txt_name: txt.name,
    slug: p.slug,
    product_id: p.id,
    website_drive_id: websiteDriveId ?? null,
    reason,
  });
}

for (const p of newProds || []) if (!hasDl.has(p.id)) add(p, 'new-no-link', null);
for (const p of flaggedProds) add(p, 'flagged', flaggedDrive.get(p.slug) || null);

const out = [...targets.values()];
// group by txt filename so downloads form clean per-name suffix sequences
out.sort((a, b) => (a.txt_name === b.txt_name ? 0 : a.txt_name < b.txt_name ? -1 : 1));
writeFileSync('etsy_link_targets.json', JSON.stringify(out, null, 2));

const byName = {};
for (const t of out) byName[t.txt_name] = (byName[t.txt_name] || 0) + 1;
const byReason = {};
for (const t of out) byReason[t.reason] = (byReason[t.reason] || 0) + 1;
const missingTxt = (newProds || []).filter((p) => !hasDl.has(p.id) && p.etsy_listing_id && !txtFileOf(p.etsy_listing_id)).length;
console.log(`Targets: ${out.length}`);
console.log('  by reason:', byReason);
console.log('  by txt filename:', byName);
console.log(`  (new products whose Etsy listing has no txt in inventory: ${missingTxt})`);
console.log('Wrote etsy_link_targets.json');
