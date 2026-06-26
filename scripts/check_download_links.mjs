// Audit every row in product_downloads by HTTP-checking its download_link.
//
// Usage:
//   npm run check:links                     # check everything (slow but thorough)
//   npm run check:links -- --limit 50       # quick smoke test
//   npm run check:links -- --only-broken    # CSV contains only problem rows
//   npm run check:links -- --concurrency 16 # tune parallel requests
//   npm run check:links -- --out report.csv # custom output path
//
// Notes:
//   * Google Drive serves a share page (HTTP 200) even when the underlying
//     file is missing or private. Those land in the `drive_unknown` bucket —
//     reachable, but the script can't tell if the file itself is fine. Use
//     `not_found / forbidden / timeout / network_error` as the reliable
//     "definitely broken" set.
//   * Defaults to HEAD; falls back to GET (Range 0-1023) for servers that
//     reject HEAD.

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const SUPABASE_URL = process.env.PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('✗ Missing PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// --- minimal CLI parsing ----------------------------------------------------
const argv = process.argv.slice(2);
function flag(name) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return null;
  const next = argv[i + 1];
  if (!next || next.startsWith('--')) return true;
  return next;
}
const LIMIT = flag('limit') ? Number(flag('limit')) : null;
const CONCURRENCY = flag('concurrency') ? Number(flag('concurrency')) : 8;
const ONLY_BROKEN = !!flag('only-broken');
const REPORT_PATH = flag('out') || 'download-link-report.csv';
const TIMEOUT_MS = 12_000;
const UA = 'Mozilla/5.0 (compatible; DigitalChiselCo-Linkcheck/1.0)';

// --- pull rows --------------------------------------------------------------
console.log('Fetching product_downloads rows…');
let query = db
  .from('product_downloads')
  .select('id, product_id, file_name, download_link, products(slug, title, active, link_status)')
  .not('download_link', 'is', null)
  .order('product_id');
if (LIMIT) query = query.limit(LIMIT);
const { data: rows, error } = await query;
if (error) { console.error('✗ DB query failed:', error.message); process.exit(1); }
const links = (rows || []).filter((r) => (r.download_link || '').trim());
console.log(`Got ${links.length} links. Concurrency=${CONCURRENCY}, timeout=${TIMEOUT_MS}ms`);

// --- check one --------------------------------------------------------------
const counts = { ok: 0, redirect: 0, not_found: 0, forbidden: 0, timeout: 0, network_error: 0, drive_unknown: 0, other: 0 };

async function check(url) {
  let res, httpCode = 0, finalUrl = url, note = '';
  const fetchWith = async (method, extraHeaders = {}) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      return await fetch(url, {
        method,
        redirect: 'follow',
        signal: ctrl.signal,
        headers: { 'user-agent': UA, ...extraHeaders },
      });
    } finally { clearTimeout(t); }
  };
  try {
    res = await fetchWith('HEAD');
    httpCode = res.status;
    finalUrl = res.url;
    if ([400, 403, 405, 501].includes(res.status)) {
      // some hosts reject HEAD; retry with a tiny GET
      res = await fetchWith('GET', { range: 'bytes=0-1023' });
      httpCode = res.status;
      finalUrl = res.url;
    }
  } catch (e) {
    if (e.name === 'AbortError') return { status: 'timeout', httpCode: 0, finalUrl: url, note: `>${TIMEOUT_MS}ms` };
    return { status: 'network_error', httpCode: 0, finalUrl: url, note: e.message || 'fetch error' };
  }
  let status;
  if (httpCode >= 200 && httpCode < 300) status = /drive\.google\.com/.test(url) ? 'drive_unknown' : 'ok';
  else if (httpCode >= 300 && httpCode < 400) status = 'redirect';
  else if (httpCode === 404 || httpCode === 410) status = 'not_found';
  else if (httpCode === 401 || httpCode === 403) status = 'forbidden';
  else status = 'other';
  return { status, httpCode, finalUrl, note };
}

// --- run with bounded concurrency ------------------------------------------
const results = [];
let done = 0;
const t0 = Date.now();

async function worker(queue) {
  while (queue.length) {
    const row = queue.shift();
    if (!row) break;
    const r = await check(row.download_link);
    counts[r.status] = (counts[r.status] || 0) + 1;
    results.push({
      product_id: row.product_id,
      product_slug: row.products?.slug || '',
      product_title: row.products?.title || '',
      product_active: row.products?.active ?? '',
      admin_link_status: row.products?.link_status ?? '',
      file_name: row.file_name || '',
      download_link: row.download_link,
      status: r.status,
      http_code: r.httpCode,
      final_url: r.finalUrl,
      note: r.note,
    });
    done++;
    if (done % 20 === 0 || done === links.length) {
      const pct = ((done / links.length) * 100).toFixed(1);
      process.stdout.write(
        `\r  ${done}/${links.length} (${pct}%)  ok=${counts.ok}  drive?=${counts.drive_unknown}  404=${counts.not_found}  403=${counts.forbidden}  timeout=${counts.timeout}  netErr=${counts.network_error}  other=${counts.other}    `,
      );
    }
  }
}

const queue = links.slice();
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));
process.stdout.write('\n');
console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s.\n`);

console.log('Summary:');
for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(15)} ${v}`);

// --- write CSV --------------------------------------------------------------
const rowsToWrite = ONLY_BROKEN
  ? results.filter((r) => !['ok', 'redirect', 'drive_unknown'].includes(r.status))
  : results;
const headers = ['product_id', 'product_slug', 'product_title', 'product_active', 'admin_link_status', 'file_name', 'status', 'http_code', 'download_link', 'final_url', 'note'];
const esc = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = [headers.join(',')]
  .concat(rowsToWrite.map((r) => headers.map((h) => esc(r[h])).join(',')))
  .join('\n');
fs.writeFileSync(REPORT_PATH, csv);
console.log(`\nReport saved: ${REPORT_PATH}  (${rowsToWrite.length} rows)`);

const brokenTotal = counts.not_found + counts.forbidden + counts.network_error + counts.timeout + counts.other;
if (brokenTotal) {
  console.log(`\n⚠️  ${brokenTotal} link${brokenTotal === 1 ? '' : 's'} look definitively broken (404/403/timeout/network). See CSV.`);
} else {
  console.log('\n✓ No definitively-broken links found.');
}
if (counts.drive_unknown) {
  console.log(`ℹ️  ${counts.drive_unknown} Google Drive links returned 200 — they're reachable, but Drive serves a share page even for missing/private files. Spot-check those manually if you need certainty.`);
}
