// Generate the photographs for one blog article from its frames.json.
//
//   scripts/blog/<slug>/frames.json
//   [
//     { "key": "hero", "aspect": "16:9", "alt": "...", "ref": "<product slug>", "scene": "...",
//       "hands": false, "bench": true, "extraRefs": ["<product slug>", ...] },
//     ...
//   ]
//
// Every frame gets TWO or more reference images: the real product hero(s) as
// image 1.., and the frozen style reference (_style-reference.jpg) LAST, so the
// carving is the shop's real design and the finish is the owner's chosen look.
// `ref: null` means no product (a pure style frame).
//
// Usage:
//   node scripts/gen_blog_frames.mjs <slug> --preview          # local only
//   node scripts/gen_blog_frames.mjs <slug> --only hero,fish   # some frames
//   node scripts/gen_blog_frames.mjs <slug> --upload-existing  # push reviewed frames
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { framePrompt } from './blog/_style.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BUCKET = 'site-media';
const BRS_CFG = 'D:/000 BUNDLE RELIEF STUDIO/_config/config.json';
// Material swatch, not the full reference panel: see the note in blog/_style.mjs.
const STYLE_REF = path.join(HERE, 'blog', '_style-swatch.jpg');

const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
const cfg = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim();
const URL_BASE = cfg('PUBLIC_SUPABASE_URL');
const SERVICE = cfg('SUPABASE_SERVICE_ROLE_KEY');
const H = { apikey: SERVICE, authorization: `Bearer ${SERVICE}` };

const brs = JSON.parse(fs.readFileSync(BRS_CFG, 'utf8').replace(/^\uFEFF/, ''));
const GKEY = brs.gemini_api_key;
const GMODEL = brs.gemini_image_model || 'gemini-3-pro-image';
if (!GKEY) { console.error('no gemini_api_key in the BRS config'); process.exit(1); }

const args = process.argv.slice(2);
const SLUG = args.find((a) => !a.startsWith('--'));
if (!SLUG) { console.error('usage: gen_blog_frames.mjs <slug> [--preview] [--only a,b] [--force] [--upload-existing]'); process.exit(1); }
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? (args[i + 1] ?? true) : d; };
const PREVIEW = args.includes('--preview');
const FORCE = args.includes('--force');
const ONLY = String(flag('only', '') || '').split(',').filter(Boolean);

const DIR = path.join(HERE, 'blog', SLUG);
const OUT_DIR = path.join(ROOT, '.mockups', 'blog-' + SLUG);
const FRAMES = JSON.parse(fs.readFileSync(path.join(DIR, 'frames.json'), 'utf8'));
fs.mkdirSync(OUT_DIR, { recursive: true });

// ── references ─────────────────────────────────────────────────────────────
const heroCache = new Map();
async function heroFor(slug) {
  if (heroCache.has(slug)) return heroCache.get(slug);
  // Prefix match, best seller first: frames.json may carry a slug that was
  // copied from a truncated listing, and an exact match would silently fail.
  const r = await fetch(`${URL_BASE}/rest/v1/products?select=image_url,title,slug&active=eq.true&slug=like.${encodeURIComponent(slug + '*')}&order=etsy_sales_365.desc&limit=1`, { headers: H }).then((x) => x.json());
  const url = r?.[0]?.image_url;
  if (!url) throw new Error(`no hero image for product "${slug}"`);
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  heroCache.set(slug, buf);
  return buf;
}
const toRef = async (buf) =>
  (await sharp(buf).resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer()).toString('base64');

// ── Gemini ─────────────────────────────────────────────────────────────────
async function gemini(prompt, refs, aspect) {
  const parts = [];
  for (const b of refs) parts.push({ inlineData: { mimeType: 'image/jpeg', data: await toRef(b) } });
  parts.push({ text: prompt });
  const body = {
    contents: [{ parts }],
    generationConfig: { imageConfig: { imageSize: '2K', ...(aspect ? { aspectRatio: aspect } : {}) } },
  };
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GMODEL}:generateContent?key=${GKEY}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = await r.json();
      const got = j?.candidates?.[0]?.content?.parts || [];
      const img = got.find((p) => p.inlineData?.data || p.inline_data?.data);
      if (img) return Buffer.from(img.inlineData?.data || img.inline_data.data, 'base64');
      const err = j?.error?.message || got.map((p) => p.text).join(' ').slice(0, 160) || 'no image in reply';
      if (/quota|billing|exhausted|RESOURCE_EXHAUSTED/i.test(err)) throw new Error(`QUOTA: ${err.slice(0, 120)}`);
      console.error(`    attempt ${attempt}: ${err.slice(0, 140)}`);
    } catch (e) {
      if (/^QUOTA/.test(e.message)) throw e;
      console.error(`    attempt ${attempt}: ${e.message.slice(0, 120)}`);
    }
    await new Promise((res) => setTimeout(res, 5000 * attempt));
  }
  return null;
}

async function upload(key, buf) {
  const objectKey = `blog/${SLUG}/${key}.jpg`;
  const r = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}/${objectKey}`, {
    method: 'POST', headers: { ...H, 'content-type': 'image/jpeg', 'x-upsert': 'true' }, body: buf,
  });
  if (!r.ok) throw new Error(`upload ${r.status}: ${(await r.text()).slice(0, 120)}`);
  return `${URL_BASE}/storage/v1/object/public/${BUCKET}/${objectKey}`;
}

// ── run ────────────────────────────────────────────────────────────────────
const queue = FRAMES.filter((f) => !ONLY.length || ONLY.includes(f.key));
const styleRef = fs.readFileSync(STYLE_REF);

if (args.includes('--upload-existing')) {
  const out = [];
  for (const f of queue) {
    const local = path.join(OUT_DIR, `${f.key}.jpg`);
    if (!fs.existsSync(local)) { console.log(`. ${f.key} … missing, skipped`); continue; }
    out.push({ key: f.key, alt: f.alt, url: await upload(f.key, fs.readFileSync(local)) });
    console.log(`. ${f.key} … uploaded`);
  }
  fs.writeFileSync(path.join(DIR, 'manifest.json'), JSON.stringify(out, null, 2));
  console.log(`\n${out.length} uploaded → ${path.join(DIR, 'manifest.json')}`);
  process.exit(0);
}

console.log(`${SLUG}: ${queue.length} frame(s)${PREVIEW ? ' · PREVIEW' : ''} · model ${GMODEL}`);
let ok = 0, failed = 0;
for (const f of queue) {
  const local = path.join(OUT_DIR, `${f.key}.jpg`);
  if (!FORCE && fs.existsSync(local)) { console.log(`. ${f.key} … cached`); continue; }
  process.stdout.write(`. ${f.key} … `);
  try {
    const refs = [];
    for (const s of [f.ref, ...(f.extraRefs || [])].filter(Boolean)) refs.push(await heroFor(s));
    refs.push(styleRef);                                  // style reference always LAST
    const n = refs.length;
    const which = `ATTACHED IMAGES: image 1${n > 2 ? ` to ${n - 1}` : ''} = the real product(s), THE SUBJECT of the photograph. `
      + `Image ${n} = a material swatch of wood and finish only; it is NOT an object and must not appear as one.\n`;
    const scene = which + f.scene.replace(/image 2/g, `image ${n}`);
    const raw = await gemini(framePrompt(scene, { hands: !!f.hands, bench: f.bench !== false }), refs, f.aspect);
    if (!raw) { console.log('FAILED'); failed++; continue; }
    fs.writeFileSync(local, await sharp(raw).jpeg({ quality: 88, mozjpeg: true }).toBuffer());
    console.log(`ok → ${path.basename(local)}`);
    ok++;
  } catch (e) {
    failed++;
    console.log(`FAILED ${e.message.slice(0, 100)}`);
    if (/^QUOTA/.test(e.message)) { console.error('stopping: Gemini quota/billing'); break; }
  }
}
console.log(`\ndone: ${ok} built, ${failed} failed → ${OUT_DIR}\nReview, then: node scripts/gen_blog_frames.mjs ${SLUG} --upload-existing`);
