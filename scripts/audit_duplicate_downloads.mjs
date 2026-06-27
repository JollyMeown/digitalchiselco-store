// Build a "duplicates workbench" HTML: every Drive URL shared by 2+ products,
// grouped so the user can see at a glance which products collide and fix them.
//
// Each product card has the same prefix-prefilled URL input as the main
// workbench; "Download fixes CSV" emits the same 3-column format the apply
// script understands (download_id, slug, new_drive_url).
import 'dotenv/config';
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ---------- Drive index for filename lookup ----------
const driveById = (() => {
  if (!fs.existsSync('drive_stls.json')) return new Map();
  const arr = JSON.parse(fs.readFileSync('drive_stls.json', 'utf8'));
  return new Map(arr.map((d) => [d.id, d.name]));
})();
function extractFileId(url) {
  if (!url) return null;
  const m = url.match(/[?&]id=([A-Za-z0-9_-]{20,})/) || url.match(/\/file\/d\/([A-Za-z0-9_-]{20,})/);
  return m ? m[1] : null;
}

// ---------- Load downloads (paginated) ----------
console.log('Loading product_downloads…');
const all = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db
    .from('product_downloads')
    .select('id, download_link, verified_at, audit_status, products(title, slug, image_url, is_bundle)')
    .range(from, from + 999);
  if (error) throw error;
  if (!data?.length) break;
  all.push(...data);
  if (data.length < 1000) break;
}
console.log(`  ${all.length} download rows`);

// ---------- Group by URL, keep groups with size >= 2 ----------
const groups = new Map();
for (const r of all) {
  const url = (r.download_link || '').trim();
  if (!url) continue;
  if (!groups.has(url)) groups.set(url, []);
  groups.get(url).push(r);
}
const dupGroups = [...groups.entries()]
  .filter(([, rows]) => rows.length >= 2)
  .sort((a, b) => b[1].length - a[1].length); // biggest groups first

const dupProductCount = dupGroups.reduce((s, [, r]) => s + r.length, 0);
console.log(`  ${dupGroups.length} URLs shared by ${dupProductCount} products`);

// ---------- HTML ----------
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
  );
}

function statusPill(r) {
  if (r.verified_at) return '<span style="background:#dcfce7;color:#15803d;padding:1px 6px;border-radius:8px;font-size:10px;font-weight:600">✓ verified</span>';
  if (r.audit_status === 'auto_ok') return '<span style="background:#dbeafe;color:#1d4ed8;padding:1px 6px;border-radius:8px;font-size:10px;font-weight:600">? auto-ok</span>';
  if (r.audit_status === 'flagged') return '<span style="background:#fee2e2;color:#b91c1c;padding:1px 6px;border-radius:8px;font-size:10px;font-weight:600">🚩 flagged</span>';
  return '';
}

function productCard(r) {
  const p = r.products || {};
  const img = p.image_url || '';
  const slug = p.slug || '';
  const title = p.title || '(no title)';
  return `
    <tr data-row data-id="${escapeHtml(r.id)}">
      <td style="width:110px"><img src="${escapeHtml(img)}" style="width:100px;height:100px;object-fit:cover;border-radius:6px;display:block" loading="lazy" referrerpolicy="no-referrer"/></td>
      <td>
        <div style="font-weight:600;font-size:13px;line-height:1.3;margin-bottom:4px">${escapeHtml(title)}</div>
        <div style="font-size:11px;color:#666;margin-bottom:6px">
          <span style="font-family:monospace">${escapeHtml(slug)}</span>
          ${p.is_bundle ? '<span style="background:#fbbf24;color:#78350f;padding:1px 6px;border-radius:8px;margin-left:6px;font-size:10px">BUNDLE</span>' : ''}
          <span style="margin-left:6px">${statusPill(r)}</span>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
          <a href="https://digitalchiselco.com/product/${encodeURIComponent(slug)}" target="_blank" style="background:#7a3f10;color:white;padding:4px 9px;border-radius:5px;text-decoration:none;font-size:11px">View on site ↗</a>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <input type="url" data-fix data-id="${escapeHtml(r.id)}" data-slug="${escapeHtml(slug)}" placeholder="Paste corrected Drive URL…" style="flex:1;padding:6px 8px;border:1px solid #ccc;border-radius:5px;font-family:monospace;font-size:11px" />
          <span data-status style="font-size:10px;color:#999;min-width:60px;text-align:right"></span>
        </div>
      </td>
    </tr>`;
}

function groupBlock([url, rows]) {
  const fid = extractFileId(url);
  const driveName = (fid && driveById.get(fid)) || '(filename unknown — file not in cached Drive index)';
  return `
    <section style="border:1px solid #e5e7eb;border-radius:10px;margin-bottom:24px;background:#fafafa">
      <header style="padding:14px 16px;border-bottom:1px solid #e5e7eb;background:#fff;border-radius:10px 10px 0 0">
        <div style="display:flex;justify-content:space-between;align-items:start;gap:12px;flex-wrap:wrap">
          <div>
            <div style="font-weight:700;font-size:14px;color:#222">${rows.length} products share this Drive file</div>
            <div style="font-size:12px;color:#666;margin-top:4px"><b>File:</b> <span style="font-family:monospace;background:#f3f4f6;padding:2px 6px;border-radius:4px">${escapeHtml(driveName)}</span></div>
          </div>
          <a href="${escapeHtml(url)}" target="_blank" style="background:#1f5fea;color:white;padding:6px 12px;border-radius:6px;text-decoration:none;font-size:12px;white-space:nowrap;flex-shrink:0">⬇ Open shared link</a>
        </div>
      </header>
      <table style="width:100%;border-collapse:collapse">
        <tbody>
          ${rows.map(productCard).join('')}
        </tbody>
      </table>
    </section>`;
}

const SCRIPT = `<script>
const LS_KEY = 'dcc_audit_fixes_v1';  // shared with main workbench so progress carries over
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
document.querySelectorAll('input[data-fix]').forEach((input) => {
  const id = input.dataset.id;
  input.value = store[id] || PREFIX;
  markRow(input);
  input.addEventListener('focus', () => {
    const len = input.value.length;
    setTimeout(() => input.setSelectionRange(len, len), 0);
  });
  input.addEventListener('input', () => {
    let v = input.value;
    if (v.startsWith(PREFIX + 'http')) { v = v.slice(PREFIX.length); input.value = v; }
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
    status.textContent = v.startsWith(PREFIX) ? '… add ID' : '✗ not Drive';
    status.style.color = v.startsWith(PREFIX) ? '#999' : '#c00';
    input.style.borderColor = v.startsWith(PREFIX) ? '#fbbf24' : '#c00';
    return;
  }
  status.textContent = '✓ saved'; status.style.color = '#15803d'; input.style.borderColor = '#15803d';
}
function updateProgress() {
  const s = load();
  const total = document.querySelectorAll('input[data-fix]').length;
  const filled = [...document.querySelectorAll('input[data-fix]')].filter((i) => s[i.dataset.id] && isCompleteDriveUrl(s[i.dataset.id])).length;
  document.getElementById('progress-count').textContent = filled + ' / ' + total + ' fixed';
  document.getElementById('dl-btn').disabled = filled === 0;
}
document.getElementById('dl-btn').addEventListener('click', () => {
  const s = load();
  let out = 'download_id,slug,new_drive_url\\n';
  document.querySelectorAll('input[data-fix]').forEach((input) => {
    const id = input.dataset.id;
    const v = (s[id] || '').trim();
    if (v && isCompleteDriveUrl(v)) out += [csvEsc(id), csvEsc(input.dataset.slug), csvEsc(v)].join(',') + '\\n';
  });
  const blob = new Blob([out], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'download-link-fixes.csv';
  a.click();
});
document.getElementById('hide-done').addEventListener('change', (e) => {
  const hide = e.target.checked;
  const s = load();
  document.querySelectorAll('tr[data-row]').forEach((tr) => {
    const id = tr.dataset.id;
    const filled = !!(s[id] && isCompleteDriveUrl(s[id]));
    tr.style.display = hide && filled ? 'none' : '';
  });
});
updateProgress();
</script>`;

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Duplicate Drive files — workbench</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:1100px;margin:0 auto;padding:0 16px 40px;color:#222}
  table{border-collapse:collapse;width:100%}
  td{border-top:1px solid #eee;padding:10px;vertical-align:top}
  td:first-child{border-top:1px solid #eee}
  section table tr:first-child td{border-top:none}
  .toolbar{position:sticky;top:0;background:#fff;border-bottom:1px solid #ddd;padding:12px 0;margin-bottom:20px;z-index:10;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
  .toolbar button{padding:8px 14px;border-radius:6px;border:0;font-weight:600;cursor:pointer}
  .toolbar button[disabled]{opacity:.4;cursor:not-allowed}
  #dl-btn{background:#15803d;color:#fff}
  #progress-count{font-weight:600;color:#15803d}
  input[type="url"]:focus{outline:none;border-color:#1f5fea}
  h1{margin:8px 0 4px;font-size:20px}
  .intro{color:#666;margin-bottom:16px;font-size:14px;line-height:1.5}
</style>
</head><body>
<div class="toolbar">
  <h1 style="margin:0">Duplicate Drive files</h1>
  <span id="progress-count" style="margin-left:auto">0 / 0</span>
  <label style="font-size:13px;display:flex;align-items:center;gap:6px"><input type="checkbox" id="hide-done"/> Hide done</label>
  <button id="dl-btn" disabled>⬇ Download fixes CSV</button>
</div>
<p class="intro"><b>${dupGroups.length} groups · ${dupProductCount} products</b> share a Drive URL with at least one other product. Each card shows the current verification status; paste the corrected URL into the input and progress auto-saves (shared storage with the main workbench, so any in-progress fixes you've already started will appear).</p>
${dupGroups.map(groupBlock).join('')}
${SCRIPT}
</body></html>`;

fs.writeFileSync('audit-duplicates.html', html);
console.log('\nWrote audit-duplicates.html');
