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
const FORCE = args.includes('--force');
const COLUMN = KIND === 'macro' ? 'macro_url' : 'mockup_url';

// ── prompts (verbatim from BRS marketing prompts) ──────────────────────────
const MOCKUP_PROMPT = (envLine) =>
  'You are a world-top product photographer and advertising art director creating a photorealistic '
  + 'PRODUCT DISPLAY shot for a premium marketplace listing.\n'
  + 'THIS IS COMPOSITING, NOT ILLUSTRATION: the attached image shows the actual physical product, a '
  + 'wooden CNC-carved piece. Place THIS EXACT object into a new scene. Do NOT redraw, reinterpret, '
  + 'restyle, simplify or "improve" it in any way. The carving\'s composition, every individual element '
  + 'AND its count (figures, motifs, screws, hinges, weave rows, border repeats), the frame shape, '
  + 'proportions, aspect ratio, relief depth, wood tone and grain must match the reference 1:1, as if the '
  + 'product were cut out of the reference photo and photographed again in the new environment. Only the '
  + 'surroundings, lighting and shadows may change.\n'
  + `SCENE: ${envLine}\n`
  + 'FRAMING (hard rules): the ENTIRE product is fully visible, no edge may be cropped or touch the frame '
  + 'border. Keep at least 10-12% of the frame as environment margin on EVERY side. The product occupies '
  + 'roughly 55-70% of the frame height, tack sharp, the unmistakable hero of the shot. Respect the '
  + "reference's own orientation: if it is landscape keep it landscape, if it is square keep it square.\n"
  + 'TRUE SCALE: render the product at its believable real-world size (a wall plaque is roughly 40-60 cm) '
  + 'relative to every prop, wall and surface. Props must never dwarf or exaggerate it, and perspective '
  + 'must keep its true proportions.\n'
  + 'CAMERA: full-frame, 50mm at f/4, ISO 100, natural directional light with soft realistic shadows.\n'
  + 'No people, no text, no watermark, no logos.';

const MACRO_PROMPT =
  'You are a world-class macro product photographer shooting a premium advertising campaign. Analyze the '
  + 'attached image of a carved wooden product, then create an extreme close-up macro photograph of ITS OWN '
  + 'surface: same carving, same details, nothing invented.\n'
  + 'CAMERA & OPTICS: full-frame body with a 100mm f/2.8 macro lens at 1:1 magnification, f/5.6 for a '
  + 'razor-thin but usable depth of field, ISO 100, tripod-locked, focus stacked on the most beautiful '
  + 'carved detail so the tool marks and wood grain are tack sharp while the background melts into creamy '
  + 'bokeh.\n'
  + 'LIGHTING: dramatic and moody, one low raking key light skimming across the relief at about 15 degrees '
  + 'to carve deep micro-shadows into every chisel mark, a very soft warm fill from the opposite side, and '
  + 'a faint cool rim to separate the piece from the darkness. Dark, minimalist background with a slight '
  + 'atmospheric haze and gentle vignette.\n'
  + 'MOOD: luxurious, tactile, heirloom quality, the viewer should almost feel the wood. Professional '
  + 'advertising finish, physically accurate grain, zero plastic look, no text, no watermark.';

// Environment per theme, so the mockup sells the room the buyer imagines.
const THEME_SCENE = {
  'hunting-lodge-decor': 'a warm log hunting lodge with a stone fireplace, antler details and firelight, the piece hung on the log wall',
  'fish-fly-fishing-stl': 'a lakeside cabin porch with fly rods, a landing net and morning light on the water beyond',
  'flying-ducks-owl-birds': 'a rustic country study with a leather chair, brass lamp and a duck decoy on the shelf',
  'pet-lover-carvings': 'a bright family living room with a dog bed, soft throw and plants, the piece on the wall above',
  'cowboy-western': 'a western ranch room with worn leather, a saddle blanket and warm late-afternoon light',
  'bald-eagle-patriotic': 'a patriotic den with dark wood panelling, a folded flag in a case and warm lamp light',
  'religious-christian': 'a serene chapel-like corner with a candle, linen and soft daylight through a window',
  'wildlife-wall-art-stl': 'a modern mountain lodge living room with big windows, pine and soft daylight',
  'farmhouse-country': 'a farmhouse kitchen with open shelving, enamelware and white shiplap',
  'native-american': 'a southwestern room with woven textiles, terracotta pottery and warm desert light',
  'gothic-skull-art': 'a moody dark study with candles, old books and deep shadow',
  'floral-botanical': 'a light-filled sunroom with trailing plants, rattan and pale linen',
  'coastal-nautical': 'a coastal cottage hallway with rope, driftwood and cool sea light',
  'memorial-tribute': 'a quiet hallway with a console table, fresh flowers and soft window light',
  'vintage-wwii-planes': 'an aviation-themed office with a propeller, vintage maps and warm lamp light',
  'funny-animal-series': 'a cheerful family kitchen nook with bright colour and morning light',
  'pet-lover': 'a bright family living room with a dog bed and soft throw',
};
const DEFAULT_SCENE = 'a warm modern living room with a sofa, plants and soft natural light, the piece hung on the wall above';

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
  const key = `${kind === 'macro' ? 'macros' : 'mockups'}/${slug}.jpg`;
  const r = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}/${key}`, {
    method: 'POST', headers: { ...H, 'content-type': 'image/jpeg', 'x-upsert': 'true' }, body: buf,
  });
  if (!r.ok) throw new Error(`upload ${r.status}: ${(await r.text()).slice(0, 120)}`);
  return `${URL_BASE}/storage/v1/object/public/${BUCKET}/${key}`;
}

// ── run ────────────────────────────────────────────────────────────────────
let q = `${URL_BASE}/rest/v1/products?select=id,slug,title,image_url,${COLUMN},product_categories(categories(slug))`
  + '&active=eq.true&image_url=not.is.null&order=created_at.desc';
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
  const catSlug = p.product_categories?.[0]?.categories?.slug || '';
  const scene = THEME_SCENE[catSlug] || DEFAULT_SCENE;
  process.stdout.write(`. ${p.slug.slice(0, 46)} [${catSlug || 'no category'}] … `);
  try {
    const hero = Buffer.from(await (await fetch(p.image_url)).arrayBuffer());
    const prompt = KIND === 'macro' ? MACRO_PROMPT : MOCKUP_PROMPT(scene);
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
        method: 'PATCH', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ [COLUMN]: url }),
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
