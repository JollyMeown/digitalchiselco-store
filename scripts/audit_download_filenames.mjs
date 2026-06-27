// Cross-check every product's download link against the actual STL filename
// living in your Google Drive. Catches:
//   - cowboy.stl / short-name links that are likely wrong
//   - one Drive file shared by multiple products
//   - links whose Drive file ID isn't in your enumeration anymore
//   - filename tokens that don't overlap the product title
//
// Writes two CSVs to the project root:
//   audit-ok.csv       — clean matches (just for spot-checking)
//   audit-flagged.csv  — needs your eyes, with flag reasons + clickable URL
import 'dotenv/config';
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ---------- helpers ----------
const NOISE = new Set([
  'stl', 'file', 'files', 'cnc', 'router', '3d', 'digital', 'download', 'model',
  'design', 'final', 'wall', 'decor', 'art', 'and', 'the', 'for', 'with', 'of',
  'a', 'an', 'in', 'on', 'to', 'or', 'by',
]);

function tokenize(s) {
  return (s || '')
    .toLowerCase()
    .replace(/\.stl$/i, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !NOISE.has(w));
}

function extractFileId(url) {
  if (!url) return null;
  let m = url.match(/[?&]id=([A-Za-z0-9_-]{20,})/);
  if (m) return m[1];
  m = url.match(/\/file\/d\/([A-Za-z0-9_-]{20,})/);
  if (m) return m[1];
  m = url.match(/\/folders\/([A-Za-z0-9_-]{20,})/);
  if (m) return { folderId: m[1] };
  return null;
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function csvRow(cells) {
  return cells.map(csvCell).join(',') + '\n';
}

// ---------- load Drive index ----------
console.log('Loading drive_stls.json…');
const driveRows = JSON.parse(fs.readFileSync('drive_stls.json', 'utf8'));
const driveById = new Map(driveRows.map((d) => [d.id, d.name]));
console.log(`  ${driveById.size} Drive STL files indexed`);

// ---------- load product_downloads paginated ----------
console.log('Loading product_downloads from Supabase (paginated)…');
let downloads = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db
    .from('product_downloads')
    .select('id, product_id, download_link, products(title, slug, image_url, is_bundle, active)')
    .range(from, from + 999);
  if (error) throw error;
  if (!data?.length) break;
  downloads.push(...data);
  if (data.length < 1000) break;
}
console.log(`  ${downloads.length} download rows loaded`);

// ---------- pre-count file IDs to detect duplicates ----------
const idUseCount = new Map();
for (const r of downloads) {
  const fid = extractFileId(r.download_link);
  const key = typeof fid === 'string' ? fid : fid?.folderId ? `folder:${fid.folderId}` : null;
  if (key) idUseCount.set(key, (idUseCount.get(key) || 0) + 1);
}

// ---------- audit ----------
const ok = [];
const flagged = [];

for (const r of downloads) {
  const title = r.products?.title || '';
  const slug = r.products?.slug || '';
  const url = r.download_link || '';
  const fid = extractFileId(url);

  let flags = [];
  let driveName = '';
  let overlap = 0;
  let filenameTokens = 0;

  if (!fid) {
    flags.push('malformed_url');
  } else if (typeof fid === 'object' && fid.folderId) {
    flags.push('drive_folder_not_file');
    if ((idUseCount.get(`folder:${fid.folderId}`) || 0) > 1) flags.push('duplicate_file');
  } else {
    driveName = driveById.get(fid) || '';
    if (!driveName) {
      flags.push('missing_from_drive');
    } else {
      const titleTokens = new Set(tokenize(title));
      const fnTokens = tokenize(driveName);
      filenameTokens = fnTokens.length;
      const hits = fnTokens.filter((t) => titleTokens.has(t)).length;
      overlap = fnTokens.length ? hits / fnTokens.length : 0;
      if (filenameTokens <= 3) flags.push('short_filename');
      if (overlap < 0.3 && filenameTokens > 0) flags.push('low_overlap');
    }
    if ((idUseCount.get(fid) || 0) > 1) flags.push('duplicate_file');
  }

  const row = {
    download_id: r.id,
    slug,
    title,
    image_url: r.products?.image_url || '',
    storefront_url: slug ? `https://digitalchiselco.com/product/${slug}` : '',
    drive_filename: driveName,
    filename_tokens: filenameTokens,
    overlap_pct: Math.round(overlap * 100),
    times_file_used: typeof fid === 'string' ? (idUseCount.get(fid) || 0) : '',
    flag_reasons: flags.join('|'),
    drive_url: url,
    is_bundle: r.products?.is_bundle ? 'yes' : '',
    active: r.products?.active ? 'yes' : '',
  };
  (flags.length ? flagged : ok).push(row);
}

// ---------- write CSVs ----------
const HEADER = [
  'download_id', 'slug', 'title', 'image_url', 'storefront_url', 'drive_filename',
  'filename_tokens', 'overlap_pct', 'times_file_used', 'flag_reasons', 'drive_url',
  'is_bundle', 'active', 'new_drive_url',
];
function writeCsv(file, rows) {
  let out = csvRow(HEADER);
  for (const r of rows) out += csvRow(HEADER.map((k) => r[k]));
  fs.writeFileSync(file, out);
}
writeCsv('audit-ok.csv', ok);
writeCsv('audit-flagged.csv', flagged);

// ---------- HTML report (thumbnails inline) ----------
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
  );
}
function badge(reason) {
  const colors = {
    duplicate_file: '#fde68a',
    short_filename: '#fecaca',
    low_overlap: '#bfdbfe',
    missing_from_drive: '#e5e7eb',
    malformed_url: '#e5e7eb',
    drive_folder_not_file: '#ddd6fe',
  };
  return `<span style="background:${colors[reason] || '#eee'};padding:2px 8px;border-radius:10px;font-size:11px;margin-right:4px">${reason}</span>`;
}
function rowHtml(r, editable) {
  const inputHtml = editable
    ? `<div style="margin-top:10px;display:flex;gap:8px;align-items:center">
         <input type="url" data-fix data-id="${escapeHtml(r.download_id)}" data-slug="${escapeHtml(r.slug)}" placeholder="Paste corrected Drive URL here…" style="flex:1;padding:8px 10px;border:1px solid #ccc;border-radius:6px;font-family:monospace;font-size:12px" />
         <span data-status style="font-size:11px;color:#999;min-width:60px"></span>
       </div>`
    : '';
  return `
    <tr data-row data-id="${escapeHtml(r.download_id)}">
      <td style="width:140px"><img src="${escapeHtml(r.image_url)}" style="width:130px;height:130px;object-fit:cover;border-radius:8px;display:block" loading="lazy" referrerpolicy="no-referrer"/></td>
      <td>
        <div style="font-weight:600;margin-bottom:6px;line-height:1.3">${escapeHtml(r.title)}</div>
        <div style="font-size:12px;color:#666;margin-bottom:8px">
          <span style="font-family:monospace">${escapeHtml(r.slug)}</span>
          ${r.is_bundle === 'yes' ? '<span style="background:#fbbf24;color:#78350f;padding:1px 6px;border-radius:8px;margin-left:6px;font-size:10px">BUNDLE</span>' : ''}
        </div>
        <div style="font-size:13px;margin-bottom:6px"><b>Drive file:</b> <span style="font-family:monospace;background:#f3f4f6;padding:2px 6px;border-radius:4px">${escapeHtml(r.drive_filename || '(not found)')}</span> &middot; tokens=${r.filename_tokens} &middot; overlap=${r.overlap_pct}% &middot; used by ${r.times_file_used || 0} products</div>
        <div style="margin-bottom:8px">${r.flag_reasons.split('|').filter(Boolean).map(badge).join('')}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <a href="${escapeHtml(r.drive_url)}" target="_blank" style="background:#1f5fea;color:white;padding:6px 12px;border-radius:6px;text-decoration:none;font-size:12px">⬇ Open current Drive link</a>
          <a href="${escapeHtml(r.storefront_url)}" target="_blank" style="background:#7a3f10;color:white;padding:6px 12px;border-radius:6px;text-decoration:none;font-size:12px">View on site</a>
        </div>
        ${inputHtml}
      </td>
    </tr>`;
}

const WORKBENCH_SCRIPT = `
<script>
const LS_KEY = 'dcc_audit_fixes_v1';
const PREFIX = 'https://drive.google.com/uc?export=download&id=';
function load() { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; } }
function save(o) { localStorage.setItem(LS_KEY, JSON.stringify(o)); }
function isCompleteDriveUrl(u) {
  if (!u) return false;
  const m = u.match(/[?&]id=([A-Za-z0-9_-]+)/) || u.match(/\\/file\\/d\\/([A-Za-z0-9_-]+)/) || u.match(/\\/folders\\/([A-Za-z0-9_-]+)/);
  return !!(m && m[1] && m[1].length >= 20);
}
function csvEsc(v) { const s = String(v ?? ''); return /[",\\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s; }

const store = load();

// Hydrate inputs from localStorage (saved value wins; otherwise pre-fill the prefix)
document.querySelectorAll('input[data-fix]').forEach((input) => {
  const id = input.dataset.id;
  input.value = store[id] || PREFIX;
  markRow(input);

  // Cursor jumps to end when focused — user just appends the file ID
  input.addEventListener('focus', () => {
    const len = input.value.length;
    setTimeout(() => input.setSelectionRange(len, len), 0);
  });

  // If user pastes a full Drive URL, strip the duplicate prefix
  input.addEventListener('input', () => {
    let v = input.value;
    if (v.startsWith(PREFIX + 'http')) {
      v = v.slice(PREFIX.length);
      input.value = v;
    }
    v = v.trim();
    const s = load();
    if (v !== PREFIX && isCompleteDriveUrl(v)) s[id] = v; else delete s[id];
    save(s);
    markRow(input);
    updateProgress();
  });
});

function markRow(input) {
  const status = input.parentElement.querySelector('[data-status]');
  const v = input.value.trim();
  if (!v || v === PREFIX) { status.textContent = ''; input.style.borderColor = '#ccc'; return; }
  if (!isCompleteDriveUrl(v)) {
    status.textContent = v.startsWith(PREFIX) ? '… add file ID' : '✗ not Drive';
    status.style.color = v.startsWith(PREFIX) ? '#999' : '#c00';
    input.style.borderColor = v.startsWith(PREFIX) ? '#fbbf24' : '#c00';
    return;
  }
  status.textContent = '✓ saved'; status.style.color = '#15803d'; input.style.borderColor = '#15803d';
}

function updateProgress() {
  const s = load();
  const total = document.querySelectorAll('input[data-fix]').length;
  const filled = Object.values(s).filter((v) => v && isCompleteDriveUrl(v)).length;
  document.getElementById('progress-count').textContent = filled + ' / ' + total + ' fixed';
  document.getElementById('dl-btn').disabled = filled === 0;
}

document.getElementById('dl-btn').addEventListener('click', () => {
  const s = load();
  const header = ['download_id','slug','new_drive_url'];
  let out = header.join(',') + '\\n';
  let count = 0;
  document.querySelectorAll('input[data-fix]').forEach((input) => {
    const id = input.dataset.id;
    const v = (s[id] || '').trim();
    if (v && isCompleteDriveUrl(v)) {
      out += [csvEsc(id), csvEsc(input.dataset.slug), csvEsc(v)].join(',') + '\\n';
      count++;
    }
  });
  const blob = new Blob([out], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'download-link-fixes.csv';
  a.click();
});

document.getElementById('clear-btn').addEventListener('click', () => {
  if (!confirm('Clear all entered fixes? This cannot be undone.')) return;
  localStorage.removeItem(LS_KEY);
  document.querySelectorAll('input[data-fix]').forEach((input) => {
    input.value = PREFIX;
    input.style.borderColor = '#ccc';
    const st = input.parentElement.querySelector('[data-status]');
    if (st) st.textContent = '';
  });
  updateProgress();
});

document.getElementById('filter-pending').addEventListener('change', (e) => {
  const onlyPending = e.target.checked;
  const s = load();
  document.querySelectorAll('tr[data-row]').forEach((tr) => {
    const id = tr.dataset.id;
    const filled = !!(s[id] && isCompleteDriveUrl(s[id]));
    tr.style.display = onlyPending && filled ? 'none' : '';
  });
});

updateProgress();
</script>`;

function buildWorkbench(title, rows) {
  const body = rows.map((r) => rowHtml(r, true)).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
    <style>
      body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:1100px;margin:0 auto;padding:0 16px 40px;color:#222}
      table{border-collapse:collapse;width:100%}
      td{border-top:1px solid #eee;padding:14px 10px;vertical-align:top}
      h1{margin:8px 0 4px}
      .stats{color:#666;margin-bottom:16px}
      .toolbar{position:sticky;top:0;background:#fff;border-bottom:1px solid #ddd;padding:12px 0;margin-bottom:8px;z-index:10;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
      .toolbar button{padding:8px 14px;border-radius:6px;border:0;font-weight:600;cursor:pointer}
      .toolbar button[disabled]{opacity:.4;cursor:not-allowed}
      #dl-btn{background:#15803d;color:#fff}
      #clear-btn{background:#e5e7eb;color:#333}
      #progress-count{font-weight:600;color:#15803d}
      input[type="url"]:focus{outline:none;border-color:#1f5fea}
    </style>
    </head><body>
    <div class="toolbar">
      <h1 style="margin:0;font-size:18px">${title}</h1>
      <span id="progress-count" style="margin-left:auto">0 / 0</span>
      <label style="font-size:13px;display:flex;align-items:center;gap:6px"><input type="checkbox" id="filter-pending"/> Hide done</label>
      <button id="dl-btn" disabled>⬇ Download fixes CSV</button>
      <button id="clear-btn">Clear progress</button>
    </div>
    <p class="stats">${rows.length} rows. Click <b>⬇ Open current Drive link</b> to verify, paste the corrected URL into the input, and the page auto-saves to your browser. When done with a batch, click <b>Download fixes CSV</b> and send it back to apply via <code>npm run apply:download-fixes</code>.</p>
    <table>${body}</table>${WORKBENCH_SCRIPT}</body></html>`;
}

function buildHtml(title, rows) {
  const body = rows.map((r) => rowHtml(r, false)).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
    <style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:1100px;margin:24px auto;padding:0 16px;color:#222} table{border-collapse:collapse;width:100%} td{border-top:1px solid #eee;padding:14px 10px;vertical-align:top} h1{margin:8px 0 4px} .stats{color:#666;margin-bottom:16px}</style>
    </head><body>
    <h1>${title}</h1>
    <p class="stats">${rows.length} rows. Click ⬇ Open Drive link to verify.</p>
    <table>${body}</table></body></html>`;
}
fs.writeFileSync('audit-flagged.html', buildWorkbench('Flagged downloads — fix workbench', flagged));
fs.writeFileSync('audit-ok.html', buildHtml('OK downloads (spot-check only)', ok));

// ---------- summary ----------
const reasonCounts = {};
for (const r of flagged) for (const f of r.flag_reasons.split('|')) reasonCounts[f] = (reasonCounts[f] || 0) + 1;

console.log('\n--- Summary ---');
console.log(`Total downloads:    ${downloads.length}`);
console.log(`OK (no flags):      ${ok.length}`);
console.log(`Flagged for review: ${flagged.length}`);
console.log('\nFlag breakdown:');
for (const [k, v] of Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(24)} ${v}`);
}
console.log('\nWrote:');
console.log('  audit-ok.csv');
console.log('  audit-flagged.csv');
console.log('  audit-ok.html  (visual, thumbnails inline)');
console.log('  audit-flagged.html  (visual, thumbnails inline)');
