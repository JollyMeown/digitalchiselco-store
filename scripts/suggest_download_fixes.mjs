// Propose the right Drive file for every product that shares its download with
// a different design (owner 2026-09-10).
//
// Runs LOCALLY, because both authorities live on this machine: the full Drive
// index (drive_all_files.json, 4 MB) and the Etsy OAuth token. It writes
// proposals into download_link_suggestions and changes NOTHING live: the owner
// compares the two products side by side in Admin > Products and presses Save.
//
// Matching is by distinctive words. A word that appears in hundreds of file
// names ("relief", "wall", "tray") says nothing about which design a file is;
// a word that appears in a handful ("tortoise", "budgie", "teal") says almost
// everything. So each shared word is weighted by how rare it is across the
// whole Drive library, which is the difference between "these are both bird
// carvings" and "this is the budgie one".
//
//   node scripts/suggest_download_fixes.mjs            report only
//   node scripts/suggest_download_fixes.mjs --write    store the proposals
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const WRITE = process.argv.includes('--write');
const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const NOISE = new Set(['stl', 'file', 'files', 'cnc', 'router', '3d', 'digital', 'download', 'model', 'design', 'designs', 'final', 'wall', 'decor', 'art', 'and', 'the', 'for', 'with', 'of', 'in', 'on', 'to', 'or', 'by', 'relief', 'wood', 'wooden', 'carving', 'panel', 'home', 'gift', 'gifts', 'instant', 'commercial', 'use', 'included', 'bas', 'woodworking', 'pattern', 'vcarve', 'aspire', 'artcam', 'carveco', 'usa', 'cut', 'ready', 'print', 'custom', 'pro']);
const tok = (s) => [...new Set(String(s || '').toLowerCase().replace(/\.(stl|zip)$/i, '').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !NOISE.has(w)))];
const idOf = (u) => (u ? (u.match(/[?&]id=([A-Za-z0-9_-]{20,})/) || u.match(/\/file\/d\/([A-Za-z0-9_-]{20,})/) || [])[1] || null : null);

const page = async (t, sel) => { const o = []; for (let a = 0; a < 60000; a += 1000) { const { data, error } = await db.from(t).select(sel).order('id').range(a, a + 999); if (error) throw new Error(`${t}: ${error.message}`); o.push(...(data || [])); if (!data || data.length < 1000) break; } return o; };

const drive = JSON.parse(readFileSync('drive_all_files.json', 'utf8')).filter((f) => /\.stl$/i.test(f.name));
console.log(`drive index: ${drive.length} STL files`);

// how many file names each word appears in — rare words carry the meaning
const df = new Map();
const driveDocs = drive.map((f) => { const t = tok(f.name); for (const w of t) df.set(w, (df.get(w) || 0) + 1); return { id: f.id, name: f.name, toks: new Set(t) }; });
const idf = (w) => Math.log(drive.length / (1 + (df.get(w) || 0)));

function bestFile(title) {
  const t = tok(title);
  if (!t.length) return null;
  const total = t.reduce((s, w) => s + idf(w), 0) || 1;
  let best = null, second = 0;
  for (const d of driveDocs) {
    let hit = 0;
    for (const w of t) if (d.toks.has(w)) hit += idf(w);
    const score = hit / total;
    if (!best || score > best.score) { second = best ? best.score : 0; best = { id: d.id, name: d.name, score }; }
    else if (score > second) second = score;
  }
  return best ? { ...best, margin: best.score - second } : null;
}

const products = await page('products', 'id, slug, title, is_bundle');
const dls = await page('product_downloads', 'id, product_id, download_link');
const byId = new Map(products.map((p) => [p.id, p]));
const byLink = new Map();
for (const d of dls) { const u = String(d.download_link || '').trim(); if (!u) continue; if (!byLink.has(u)) byLink.set(u, new Set()); byLink.get(u).add(d.product_id); }

// only groups where two DIFFERENT designs share a file, bundles excluded
const groups = [...byLink.entries()]
  .filter(([, s]) => s.size > 1)
  .map(([url, s]) => ({ url, ps: [...s].map((i) => byId.get(i)).filter(Boolean) }))
  .filter((g) => !g.ps.some((p) => p.is_bundle));

const rows = [];
for (const g of groups) {
  // whichever product the shared file fits best keeps it; the others need one
  const scored = g.ps.map((p) => {
    const t = tok(p.title);
    const shared = driveDocs.find((d) => d.id === idOf(g.url));
    let fit = 0;
    if (shared && t.length) {
      const total = t.reduce((s, w) => s + idf(w), 0) || 1;
      let hit = 0; for (const w of t) if (shared.toks.has(w)) hit += idf(w);
      fit = hit / total;
    }
    return { p, fit };
  }).sort((a, b) => b.fit - a.fit);

  console.log(`\nSHARED ${String(g.url).slice(0, 62)}`);
  for (const { p, fit } of scored) {
    const keeps = p.id === scored[0].p.id;
    const sug = keeps ? null : bestFile(p.title);
    console.log(`  ${keeps ? 'KEEPS  ' : 'NEEDS  '} fit ${fit.toFixed(2)}  ${p.title.slice(0, 58)}`);
    if (sug) {
      console.log(`           -> ${sug.name.slice(0, 70)}`);
      console.log(`              score ${sug.score.toFixed(2)} margin ${sug.margin.toFixed(2)}${idOf(g.url) === sug.id ? '  (same file it already has, no better candidate found)' : ''}`);
      if (idOf(g.url) !== sug.id && sug.score >= 0.35) {
        rows.push({
          product_id: p.id,
          suggested_link: `https://drive.google.com/uc?export=download&id=${sug.id}`,
          suggested_name: sug.name,
          current_link: g.url,
          source: 'drive',
          score: Number(sug.score.toFixed(2)),
          note: `shares its file with "${scored[0].p.title.slice(0, 60)}"`,
        });
      }
    }
  }
}

console.log(`\n${rows.length} proposals`);
if (!WRITE) { console.log('dry run, nothing stored. Re-run with --write'); process.exit(0); }
if (rows.length) {
  const { error } = await db.from('download_link_suggestions').upsert(rows, { onConflict: 'product_id' });
  console.log(error ? `store FAILED: ${error.message}` : `stored ${rows.length} proposals for review in Admin > Products`);
}
