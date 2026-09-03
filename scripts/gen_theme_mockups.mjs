// One staged group photo per collection, for the themed Pinterest board.
//
// Sends the four best ON-THEME designs to Gemini TOGETHER and asks for a single
// interior scene containing those exact pieces, arranged as a gallery wall (or
// on a table for trays and boards). A staged room beats a 2x2 contact sheet in a
// Pinterest feed, which is the whole point of the themed board.
//
// Same fidelity rule as every other marketing image: the prompt forbids
// redrawing, and the references are the real product photos.
//
// Usage:
//   node scripts/gen_theme_mockups.mjs --preview vintage-wwii-planes
//   node scripts/gen_theme_mockups.mjs --limit 5
//   node scripts/gen_theme_mockups.mjs --slug hunting-lodge-decor --force
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { groupPrompt, sceneForCategory, isFlatProduct, THEME_ROOM, DEFAULT_ROOM } from '../src/lib/marketing-prompts.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, '.mockups');
const BUCKET = 'site-media';
const BRS_CFG = 'D:/000 BUNDLE RELIEF STUDIO/_config/config.json';

const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
const cfg = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim();
const U = cfg('PUBLIC_SUPABASE_URL');
const H = { apikey: cfg('SUPABASE_SERVICE_ROLE_KEY'), authorization: `Bearer ${cfg('SUPABASE_SERVICE_ROLE_KEY')}` };
const brs = JSON.parse(fs.readFileSync(BRS_CFG, 'utf8').replace(/^\uFEFF/, ''));
const GKEY = brs.gemini_api_key;
const GMODEL = brs.gemini_image_model || 'gemini-3-pro-image';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? (args[i + 1] ?? true) : d; };
const PREVIEW = flag('preview', '');
const ONLY = flag('slug', '');
const LIMIT = Number(flag('limit', 0));
const FORCE = args.includes('--force');

// Trays, boards and coasters are used flat. Hanging one on a wall would show the
// buyer a use the product does not have.

async function gemini(prompt, refs) {
  const parts = [];
  for (const b of refs) {
    const small = await sharp(b).resize(900, 900, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: small.toString('base64') } });
  }
  parts.push({ text: prompt });
  const body = { contents: [{ parts }], generationConfig: { imageConfig: { imageSize: '2K', aspectRatio: '2:3' } } };
  for (let a = 1; a <= 3; a++) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GMODEL}:generateContent?key=${GKEY}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = await r.json();
      const ps = j?.candidates?.[0]?.content?.parts || [];
      const img = ps.find((p) => p.inlineData?.data || p.inline_data?.data);
      if (img) return Buffer.from(img.inlineData?.data || img.inline_data.data, 'base64');
      const err = j?.error?.message || ps.map((p) => p.text).join(' ').slice(0, 160) || 'no image';
      if (/quota|billing|exhausted/i.test(err)) throw new Error(`QUOTA: ${err.slice(0, 120)}`);
      console.error(`    attempt ${a}: ${err.slice(0, 140)}`);
    } catch (e) {
      if (/^QUOTA/.test(e.message)) throw e;
      console.error(`    attempt ${a}: ${e.message.slice(0, 120)}`);
    }
    await new Promise((r) => setTimeout(r, 5000 * a));
  }
  return null;
}

// Same on-theme scoring the Pin uses, so the group photo shows what the Pin claims.
function pickOnTheme(name, rows) {
  const stop = new Set(['and', 'the', 'stl', '3d', 'art', 'wall', 'decor', 'files', 'file', 'series', 'carvings', 'carving']);
  const words = String(name).toLowerCase().replace(/\b(stl|3d|files?)\b/g, '').split(/[^a-z]+/).filter((w) => w.length > 2 && !stop.has(w));
  const key = words[words.length - 1] || '';
  const sing = (w) => (w.endsWith('s') ? w.slice(0, -1) : w);
  const scored = rows.map((p) => {
    const t = String(p.title || '').toLowerCase();
    let hits = words.filter((w) => t.includes(sing(w))).length;
    if (key && t.includes(sing(key))) hits += 3;
    return { p, hits, sales: Number(p.etsy_sales_365) || 0 };
  }).sort((a, b) => (b.hits - a.hits) || (b.sales - a.sales));
  return scored.slice(0, 4).map((x) => x.p);
}

let cats = await fetch(`${U}/rest/v1/categories?select=id,name,slug,mockup_url&order=name`, { headers: H }).then((r) => r.json());
if (PREVIEW && PREVIEW !== true) cats = cats.filter((c) => c.slug === PREVIEW);
else if (ONLY && ONLY !== true) cats = cats.filter((c) => c.slug === ONLY);
else if (!FORCE) cats = cats.filter((c) => !c.mockup_url);
if (LIMIT) cats = cats.slice(0, LIMIT);
console.log(`${cats.length} collection(s)${PREVIEW ? ' · PREVIEW (no upload)' : ''} · ${GMODEL}`);
if (PREVIEW) fs.mkdirSync(OUT_DIR, { recursive: true });

let ok = 0, failed = 0;
for (const c of cats) {
  process.stdout.write(`. ${c.slug.slice(0, 40)} … `);
  try {
    const rows = await fetch(`${U}/rest/v1/products?select=title,image_url,etsy_sales_365,product_categories!inner(category_id)`
      + `&active=eq.true&image_url=not.is.null&product_categories.category_id=eq.${c.id}`
      + '&order=etsy_sales_365.desc&limit=60', { headers: H }).then((r) => r.json());
    if (!Array.isArray(rows) || rows.length < 4) { console.log('skipped (fewer than 4 designs)'); continue; }
    const chosen = pickOnTheme(c.name, rows);
    const flat = chosen.filter((p) => isFlatProduct(p.title)).length >= 2;
    const room = THEME_ROOM[c.slug] || DEFAULT_ROOM;
    const refs = [];
    for (const p of chosen) refs.push(Buffer.from(await (await fetch(p.image_url)).arrayBuffer()));
    const raw = await gemini(groupPrompt(refs.length, room, flat), refs);
    if (!raw) { console.log('FAILED'); failed++; continue; }
    const out = await sharp(raw).resize(1000, 1500, { fit: 'cover', position: 'attention' }).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
    if (PREVIEW) {
      fs.writeFileSync(path.join(OUT_DIR, `theme_${c.slug}.jpg`), out);
      console.log(`ok → .mockups/theme_${c.slug}.jpg${flat ? ' (flat-lay)' : ''}`);
    } else {
      const key = `themes/${c.slug}.jpg`;
      const up = await fetch(`${U}/storage/v1/object/${BUCKET}/${key}`, {
        method: 'POST', headers: { ...H, 'content-type': 'image/jpeg', 'x-upsert': 'true' }, body: out,
      });
      if (!up.ok) throw new Error(`upload ${up.status}`);
      const url = `${U}/storage/v1/object/public/${BUCKET}/${key}`;
      const patch = await fetch(`${U}/rest/v1/categories?id=eq.${c.id}`, {
        method: 'PATCH', headers: { ...H, 'content-type': 'application/json' },
        body: JSON.stringify({ mockup_url: url, mockup_at: new Date().toISOString() }),
      });
      if (!patch.ok) throw new Error(`patch ${patch.status}`);
      console.log(`ok${flat ? ' (flat-lay)' : ''}`);
    }
    ok++;
  } catch (e) {
    failed++;
    console.log(`FAILED ${e.message.slice(0, 100)}`);
    if (/^QUOTA/.test(e.message)) { console.error('stopping: Gemini quota'); break; }
  }
}
console.log(`\ndone: ${ok} built, ${failed} failed`);
