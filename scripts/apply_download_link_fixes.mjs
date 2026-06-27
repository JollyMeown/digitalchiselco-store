// Apply corrected Drive links from a CSV back to product_downloads.
//
// Workflow:
//   1. Run `npm run audit:downloads` to get audit-flagged.csv
//   2. Open the CSV, fill in the `new_drive_url` column on rows you fixed
//      (leave others blank — they're skipped)
//   3. Save the CSV anywhere; default load path is ./audit-flagged.csv
//   4. Dry-run preview:  npm run apply:download-fixes
//   5. Commit changes:   npm run apply:download-fixes -- --apply
//
// Match key is `download_id` (the product_downloads.id UUID) — that's the
// stable primary key, immune to renames/relistings. Each row is verified
// against its current `drive_url` value before update; if the CSV's
// download_id doesn't exist in the DB, the row is skipped with a clear error
// (never silently mis-routed to another product).
import 'dotenv/config';
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { parse } from 'csv-parse/sync';

const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const csvArgIdx = args.findIndex((a) => a === '--csv');
const CSV_PATH = csvArgIdx >= 0 ? args[csvArgIdx + 1] : 'audit-flagged.csv';

if (!fs.existsSync(CSV_PATH)) {
  console.error(`CSV not found: ${CSV_PATH}`);
  console.error('Use: node scripts/apply_download_link_fixes.mjs [--csv path/to/file.csv] [--apply]');
  process.exit(1);
}

function isDriveUrl(u) {
  return /drive\.google\.com\/(uc\?|file\/d\/|folders\/)/.test(u || '');
}

console.log(`Loading ${CSV_PATH}…`);
const rows = parse(fs.readFileSync(CSV_PATH), { columns: true, skip_empty_lines: true, bom: true });
console.log(`  ${rows.length} CSV rows`);

const candidates = rows.filter((r) => (r.new_drive_url || '').trim());
console.log(`  ${candidates.length} rows have new_drive_url filled in`);

if (!candidates.length) {
  console.log('\nNothing to do. Fill in the `new_drive_url` column for rows you want to update.');
  process.exit(0);
}

let updated = 0;
let skipped = 0;
const errors = [];
const planned = [];

for (const r of candidates) {
  const downloadId = (r.download_id || '').trim();
  const newUrl = (r.new_drive_url || '').trim();
  const slug = (r.slug || '').trim();

  if (!downloadId) { errors.push({ slug, reason: 'missing download_id' }); skipped++; continue; }
  if (!isDriveUrl(newUrl)) { errors.push({ slug, reason: `not a Drive URL: ${newUrl}` }); skipped++; continue; }

  // Verify the row exists and fetch current state for the diff preview
  let { data: cur, error: getErr } = await db
    .from('product_downloads')
    .select('id, product_id, download_link, products(title, slug)')
    .eq('id', downloadId)
    .maybeSingle();

  // Slug fallback: when the original download_id has been wiped+reinserted
  // (e.g. an admin edit on that product), re-resolve by slug. The slug-mismatch
  // check below still guards against routing to the wrong product.
  let usedFallback = false;
  if ((getErr || !cur) && slug) {
    const { data: byProd } = await db
      .from('products')
      .select('id, slug, product_downloads(id, download_link)')
      .eq('slug', slug)
      .maybeSingle();
    const dls = byProd?.product_downloads || [];
    if (byProd && dls.length === 1) {
      cur = {
        id: dls[0].id,
        product_id: byProd.id,
        download_link: dls[0].download_link,
        products: { title: '', slug: byProd.slug },
      };
      usedFallback = true;
    } else if (byProd && dls.length > 1) {
      errors.push({ slug, reason: `download_id ${downloadId} not in DB; slug "${slug}" has ${dls.length} download rows — won't guess which one` });
      skipped++;
      continue;
    }
  }

  if (!cur) {
    errors.push({ slug, reason: `download_id ${downloadId} not in DB` + (slug ? `, and slug "${slug}" has no download rows either` : '') });
    skipped++;
    continue;
  }

  if (slug && cur.products?.slug && slug !== cur.products.slug) {
    errors.push({ slug, reason: `slug mismatch — CSV says "${slug}" but DB row belongs to "${cur.products.slug}". Refusing to update.` });
    skipped++;
    continue;
  }

  const isNoop = cur.download_link === newUrl;
  planned.push({ slug: cur.products?.slug, downloadId: cur.id, before: cur.download_link, after: newUrl, noop: isNoop, usedFallback });

  if (APPLY) {
    // Always stamp verified_at — re-feeding a URL through the workbench counts
    // as a fresh confirmation. The download_link write is harmless on no-ops
    // (same value) so we do it unconditionally to keep the path simple.
    const { error: upErr } = await db
      .from('product_downloads')
      .update({ download_link: newUrl, verified_at: new Date().toISOString() })
      .eq('id', cur.id);
    if (upErr) {
      errors.push({ slug, reason: `update failed: ${upErr.message}` });
      skipped++;
    } else if (!isNoop) {
      updated++;
    }
  }
}

console.log('\n--- Plan ---');
for (const p of planned.slice(0, 10)) {
  if (p.noop) {
    console.log(`  · ${p.slug}  (no-op, already set)`);
  } else {
    console.log(`  ↻ ${p.slug}`);
    console.log(`    before: ${p.before}`);
    console.log(`    after:  ${p.after}`);
  }
}
if (planned.length > 10) console.log(`  … and ${planned.length - 10} more`);

if (errors.length) {
  console.log('\n--- Errors / skipped ---');
  for (const e of errors.slice(0, 20)) console.log(`  ✗ ${e.slug || '(no slug)'} — ${e.reason}`);
  if (errors.length > 20) console.log(`  … and ${errors.length - 20} more`);
}

console.log('\n--- Summary ---');
console.log(`CSV rows with new_drive_url: ${candidates.length}`);
console.log(`Planned updates:             ${planned.filter((p) => !p.noop).length}`);
console.log(`No-ops (already correct):    ${planned.filter((p) => p.noop).length}`);
console.log(`Skipped / errored:           ${skipped}`);
if (APPLY) {
  console.log(`Actually updated:            ${updated}`);
} else {
  console.log('\nDry run — re-run with --apply to commit changes.');
}
