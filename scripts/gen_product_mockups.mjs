// Gemini lifestyle mockups and macro close-ups for the shop's products.
//
// The hero image is SENT to Gemini as a reference and the prompt orders a
// composite, not an illustration: same carving, same element counts, same
// proportions, only the surroundings change. This is the wording already proven
// in Bundle Relief Studio, kept verbatim so the two systems behave the same.
//
// The environment is chosen from the product's own category, so a hunting
// relief lands in a lodge and a nursery piece lands in a nursery.
//
// Usage:
//   node scripts/gen_product_mockups.mjs --preview 3            # local samples
//   node scripts/gen_product_mockups.mjs --preview 3 --kind macro
//   node scripts/gen_product_mockups.mjs --limit 50             # generate + upload
//   node scripts/gen_product_mockups.mjs --slug <slug> --force
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { mockupPrompt, macroPrompt, styleForProduct, isFlatProduct, STYLES } from '../src/lib/marketing-prompts.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const OUT_DIR = path.join(ROOT, '.mockups');
const BUCKET = 'site-media';
const BRS_CFG = 'D:/000 BUNDLE RELIEF STUDIO/_config/config.json';

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
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? (args[i + 1] ?? true) : d; };
const PREVIEW = Number(flag('preview', 0));
const LIMIT = Number(flag('limit', 0));
const ONLY_SLUG = flag('slug', '');
const KIND = String(flag('kind', 'mockup'));            // mockup | macro
const SLOT = String(flag('slot', 'a')).toLowerCase();   // a | b (staging variant)
const FORCE = args.includes('--force');
const COLUMN = KIND === 'macro' ? 'macro_url' : (SLOT === 'b' ? 'mockup_b_url' : 'mockup_url');
const STYLE_COL = SLOT === 'b' ? 'mockup_b_style' : 'mockup_style';
// Variant A = gift box for everything. Variant B = golden stand for panels, food
// styling for trays, because a tray on a stand is not a real use.
const variantStyle = (title) => (SLOT === 'b' ? (isFlatProduct(title) ? 'food' : 'stand') : 'gift_box');

// ── prompts (verbatim from BRS marketing prompts) ──────────────────────────




// ── Gemini ─────────────────────────────────────────────────────────────────
async function gemini(prompt, refBuf, aspect) {
  // Downscale the reference: a 4K master costs many times the input tokens of a
  // 1K copy and adds nothing the model needs.
  const ref = await sharp(refBuf).resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
  const body = {
    contents: [{
      parts: [
        { inlineData: { mimeType: 'image/jpeg', data: ref.toString('base64') } },
        { text: prompt },
      ],
    }],
    generationConfig: { imageConfig: { imageSize: '2K', ...(aspect ? { aspectRatio: aspect } : {}) } },
  };
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GMODEL}:generateContent?key=${GKEY}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = await r.json();
      const parts = j?.candidates?.[0]?.content?.parts || [];
      const img = parts.find((p) => p.inlineData?.data || p.inline_data?.data);
      if (img) return Buffer.from(img.inlineData?.data || img.inline_data.data, 'base64');
      const err = j?.error?.message || parts.map((p) => p.text).join(' ').slice(0, 160) || 'no image in reply';
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

async function upload(kind, slug, buf) {
  const key = `${kind === 'macro' ? 'macros' : 'mockups'}/${slug}${kind === 'macro' || SLOT === 'a' ? '' : '-b'}.jpg`;
  const r = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}/${key}`, {
    method: 'POST', headers: { ...H, 'content-type': 'image/jpeg', 'x-upsert': 'true' }, body: buf,
  });
  if (!r.ok) throw new Error(`upload ${r.status}: ${(await r.text()).slice(0, 120)}`);
  return `${URL_BASE}/storage/v1/object/public/${BUCKET}/${key}`;
}

// ── run ────────────────────────────────────────────────────────────────────
let q = `${URL_BASE}/rest/v1/products?select=id,slug,title,image_url,${COLUMN},product_categories(categories(slug))`
  + '&active=eq.true&image_url=not.is.null&order=etsy_sales_365.desc';
if (ONLY_SLUG && ONLY_SLUG !== true) q += `&slug=eq.${encodeURIComponent(ONLY_SLUG)}`;
else if (!FORCE) q += `&${COLUMN}=is.null`;
const take = PREVIEW || LIMIT;
if (take) q += `&limit=${take}`;

const products = await fetch(q, { headers: H }).then((r) => r.json());
if (!Array.isArray(products)) { console.error('query failed:', products); process.exit(1); }
console.log(`${KIND}: ${products.length} product(s)${PREVIEW ? ' · PREVIEW (no upload)' : ''} · model ${GMODEL}`);
if (PREVIEW) fs.mkdirSync(OUT_DIR, { recursive: true });

let ok = 0, failed = 0;
for (const p of products) {
  // Style comes from the product itself: trays are staged on the CNC bed or
  // filled with food, panels in a gift box or on a golden stand.
  const styleKey = String(flag('style', '')) || variantStyle(p.title);
  process.stdout.write(`. ${p.slug.slice(0, 42)} [${STYLES[styleKey]?.label || styleKey}] … `);
  try {
    const hero = Buffer.from(await (await fetch(p.image_url)).arrayBuffer());
    const prompt = KIND === 'macro' ? macroPrompt() : mockupPrompt(styleKey, { flat: isFlatProduct(p.title), seed: String(flag('satin', '')) || p.slug });
    // Let the model keep the hero's own shape: forcing an aspect is what crops
    // a landscape carving into a square.
    const raw = await gemini(prompt, hero, undefined);
    if (!raw) { console.log('FAILED'); failed++; continue; }
    const out = await sharp(raw).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
    if (PREVIEW) {
      const f = path.join(OUT_DIR, `${KIND}_${p.slug.slice(0, 44)}.jpg`);
      fs.writeFileSync(f, out);
      console.log(`ok → ${path.basename(f)}`);
    } else {
      const url = await upload(KIND, p.slug, out);
      const r = await fetch(`${URL_BASE}/rest/v1/products?id=eq.${p.id}`, {
        method: 'PATCH', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ [COLUMN]: url, [STYLE_COL]: styleKey }),
      });
      if (!r.ok) throw new Error(`patch ${r.status}`);
      console.log('ok');
    }
    ok++;
  } catch (e) {
    failed++;
    console.log(`FAILED ${e.message.slice(0, 100)}`);
    if (/^QUOTA/.test(e.message)) { console.error('stopping: Gemini quota/billing'); break; }
  }
}
console.log(`\ndone: ${ok} built, ${failed} failed${PREVIEW ? ` → ${OUT_DIR}` : ''}`);
