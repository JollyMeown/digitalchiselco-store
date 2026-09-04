// Step photographs for the "how to finish a relief carving" guide.
//
// A finishing guide only teaches if every step shows THE SAME PANEL changing.
// Ten handsome but unrelated carvings would show ten woods, ten lighting setups
// and no progression, which is exactly the failure of most finishing articles.
//
// So this runs in two passes:
//   1. MASTER  - one panel, raw off the machine, generated from the description
//                below (the owner's reference carving: a letter R with an
//                echinacea, chip-carved ground, integral border).
//   2. STEPS   - every later frame is generated WITH THE MASTER ATTACHED as the
//                reference, so the carving stays identical and only the surface
//                state, the hands and the light change.
//
// The fidelity wording is the one already proven in the product mockups. It is
// copied rather than imported because src/lib/marketing-prompts.mjs is frozen
// for the shop's marketing images and must not gain editorial variants.
//
// Usage:
//   node scripts/gen_blog_finish_steps.mjs --master --preview   # build panel 1
//   node scripts/gen_blog_finish_steps.mjs --preview            # all steps, local
//   node scripts/gen_blog_finish_steps.mjs                      # generate + upload
//   node scripts/gen_blog_finish_steps.mjs --only glaze-wipe --force
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const OUT_DIR = path.join(ROOT, '.mockups', 'blog-finishing');
const MASTER_FILE = path.join(OUT_DIR, '_master.jpg');
const BUCKET = 'site-media';
const PREFIX = 'blog/finishing';
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
const PREVIEW = args.includes('--preview');
const MASTER_ONLY = args.includes('--master');
const FORCE = args.includes('--force');
const ONLY = String(flag('only', ''));

// ── the panel itself ───────────────────────────────────────────────────────
// Described from the owner's reference photograph so every frame in the guide
// shows one recognisable piece.
const PANEL =
  'A square carved wooden relief panel with an integral raised flat border cut from the same board '
  + '(not an applied picture frame). Inside the recessed field, a large ornate capital letter R fills '
  + 'the panel: a bold serif letterform with a rounded bowl, a sweeping leg, a tight carved spiral '
  + 'scroll at the top left of its stem and a second spiral curling off the foot of the leg at bottom '
  + 'right. Laid over the letter, one large echinacea coneflower with a high domed seed cone covered in '
  + 'fine raised pin-point texture, and about twelve long petals drooping outward. Two smaller closed '
  + 'coneflower buds on their own stems, one at middle left, one at middle right. Deeply lobed serrated '
  + 'leaves sweep from the lower left and lower right across the base of the letter, with smaller leaves '
  + 'and stems filling the corners. The entire background field behind the letter is covered in a hand '
  + 'chip-carved stippled gouge texture, cut deeper and darker than the letter. Relief depth is roughly '
  + '12 mm, the letter and flower standing proud, the ground dropped well below them. The panel is about '
  + '30 cm square in solid cherry.';

const FIDELITY =
  'THIS IS COMPOSITING, NOT ILLUSTRATION: the attached image shows an actual physical carved wooden '
  + 'panel. Photograph THIS EXACT object again in the new situation described below. Do NOT redraw, '
  + 'reinterpret, restyle, simplify or "improve" it. The letterform, the flower, the bud count, the leaf '
  + 'shapes, the chip-carved ground, the border, the outline and the proportions must match the '
  + 'reference 1:1. Only the surface finish, the light, the hands and the surroundings may change.\n';

const SHOT =
  'PHOTOGRAPHY: real photograph, professional woodworking magazine quality, shot on a full frame camera '
  + 'with a 50mm lens at f5.6. Raking side light from the left so the relief casts real shadows and the '
  + 'carving depth reads. Shallow but honest depth of field, the carving tack sharp. Natural colour, no '
  + 'HDR, no over-saturation, no vignette, no text, no watermark, no logos.\n';

// The model happily invents a tin that apes a real manufacturer's packaging
// ("Old Masters Wipe-On Glaze", a Watco-style Danish oil can). Publishing a
// fabricated photograph of a real brand's product is not something the shop
// should do, and the article names real products in the TEXT instead, where
// they are honest recommendations rather than invented packaging.
const NO_BRAND =
  'UNBRANDED CONTAINERS, THIS IS A HARD RULE: every tin, can, jar, bottle, tube and tool in the frame is '
  + 'plain and generic. NO brand name, NO logo, NO legible label, NO writing of any kind anywhere in the '
  + 'image. Use bare metal tins, plain glass jars and unlabelled cans. Never imitate or invent a real '
  + 'manufacturer\'s packaging.\n';

const BENCH =
  'SETTING: a working woodworker bench, solid maple top with honest use marks. Props stay in the '
  + 'background and never cover the carving.\n';

const HANDS =
  'HANDS: real adult hands, unmanicured working hands, natural skin, correct anatomy with five fingers, '
  + 'no gloves unless stated. Hands must not hide the letter R or the flower.\n';

// ── the steps ──────────────────────────────────────────────────────────────
const STEPS = [
  {
    key: 'raw',
    aspect: '4:3',
    alt: 'CNC relief carving straight off the machine, pale and fuzzy with visible tool marks',
    prompt:
      'The panel is RAW, straight off the CNC router and never touched: bare pale unfinished cherry, no '
      + 'stain, no oil, completely matte and dusty. Fine pale fuzz stands up along the edges of the '
      + 'letter and the petals. Faint parallel stepover tool marks are visible on the flat border. Fine '
      + 'sawdust lies in the deep chip-carved ground. It lies flat on the bench beside a coil of vacuum '
      + 'hose and a 1/8 inch tapered ball nose bit. Cool even north light, low contrast, so the piece '
      + 'looks deliberately flat and lifeless.',
  },
  {
    key: 'defuzz',
    aspect: '4:3',
    alt: 'Removing machining fuzz from a relief carving with a soft brass brush',
    prompt:
      'Still bare pale unfinished wood. One hand works a small soft brass hand brush across the raised '
      + 'petals of the coneflower, lifting the pale fuzz away. The brushed area reads visibly cleaner and '
      + 'smoother than the untouched half. A nylon abrasive wheel and a stiff bristle brush lie on the '
      + 'bench. Fine dust hangs in the raking light.',
  },
  {
    key: 'sand',
    aspect: '4:3',
    alt: 'Sanding only the high points of a bas relief carving with a fine sanding sponge',
    prompt:
      'Still bare pale wood. A hand presses a fine grey sanding sponge flat against ONLY the raised top '
      + 'surface of the letter R, deliberately not reaching into the deep chip-carved ground, which stays '
      + 'textured and untouched. The sanded top of the letter is visibly smoother and slightly paler. A '
      + 'folded piece of 220 grit paper and a worn 320 grit sheet sit alongside.',
  },
  {
    key: 'seal',
    aspect: '4:3',
    alt: 'Brushing dewaxed shellac sealer onto a carved cherry panel before staining',
    prompt:
      'A hand brushes a thin coat of clear amber dewaxed shellac across the carving with a soft natural '
      + 'bristle brush. The wet sealed area is visibly darker, richer and slightly glossy, and the grain '
      + 'has just come alive; the not yet reached corner is still pale and matte, so the difference is '
      + 'obvious in one frame. A glass jar of amber shellac and a small tin sit behind.',
  },
  {
    key: 'glaze-on',
    aspect: '4:3',
    alt: 'Dark glaze applied over the whole relief carving before it is wiped back',
    prompt:
      'The entire panel is now covered edge to edge in a thick opaque dark brown glaze, wet and even, so '
      + 'the carving is almost lost under it and looks alarmingly ruined. Only the faintest shapes of the '
      + 'letter and flower show through. A gloved hand holds the applicator. An open tin of dark brown '
      + 'glazing stain and a folded blue shop towel sit on the bench.',
  },
  {
    key: 'glaze-wipe',
    aspect: '4:3',
    alt: 'Wiping dark glaze back off the high points so the relief depth reads, half done',
    prompt:
      'THE KEY FRAME, SPLIT DOWN THE MIDDLE. A hand drags a folded cotton rag across the panel, wiping '
      + 'the dark glaze back OFF the raised surfaces. The wiped LEFT half is transformed: the letter and '
      + 'petals are clean warm cherry again while the deep chip-carved ground stays almost black, so the '
      + 'relief suddenly reads with enormous depth and contrast. The unwiped RIGHT half is still flat, '
      + 'muddy and dark brown all over. The difference between the two halves must be dramatic and '
      + 'immediately obvious. The rag is loaded with dark glaze.',
  },
  {
    key: 'recess',
    aspect: '4:3',
    alt: 'Pulling pooled finish out of the deep recesses of a carving with a dry brush',
    prompt:
      'The panel is glazed and wiped back, warm on the high points and dark in the ground. A hand works '
      + 'the tip of a dry soft artist brush into the deepest corner where the leaf meets the letter, '
      + 'lifting a visible glossy bead of pooled finish out of the recess. One or two other recesses still '
      + 'hold a shiny wet pool, clearly different from the surrounding matte shadow. Close three quarter '
      + 'view, tight on that corner but the whole panel still readable.',
  },
  {
    key: 'oil',
    aspect: '4:3',
    alt: 'Wiping Danish oil onto a carved relief panel with a cloth',
    prompt:
      'A hand wipes a penetrating oil finish over the glazed carving with a folded lint free cloth. The '
      + 'oiled area glows deep warm amber red, the cherry grain fully awake, while the area not yet '
      + 'reached is noticeably duller and lighter. The surface is satin and wet looking but NOT thick or '
      + 'plastic, and the chip-carved ground stays dark and open, not filled. A can of Danish oil and a '
      + 'small dish of oil sit behind.',
  },
  {
    key: 'wax',
    aspect: '4:3',
    alt: 'Buffing dark paste wax on a finished relief carving with a shoe brush',
    prompt:
      'The finished carving, deep warm cherry with near black recesses. A hand buffs the raised letter '
      + 'with a horsehair shoe brush, raising a soft low sheen on the high points. A round tin of dark '
      + 'paste wax stands open beside it with a cloth applicator. The sheen is soft and satin, never '
      + 'glossy or mirror like.',
  },
  {
    key: 'final',
    aspect: '4:3',
    alt: 'Finished cherry relief carving with dark antiqued recesses and satin high points',
    prompt:
      'THE FINISHED PIECE, hero shot, no hands. Standing upright at a slight three quarter angle on the '
      + 'bench. Strong low raking light from the left so every carved edge throws a real shadow and the '
      + 'relief depth is unmistakable. The high points of the letter, flower and leaves are warm satin '
      + 'cherry; the chip-carved ground is almost black. Rich, deep, expensive looking. Background falls '
      + 'softly out of focus.',
  },
];

const COVER = {
  key: 'cover',
  aspect: '16:9',
  alt: 'Finished relief carving on a workbench beside the oils, waxes and brushes used to finish it',
  prompt:
    'THE FINISHED PIECE, wide magazine opening shot, no hands. The panel stands upright at a slight '
    + 'angle on the bench, warm satin cherry with near black antiqued recesses. Laid out around it in a '
    + 'deliberate flat lay: an open tin of dark paste wax, a can of Danish oil, a jar of amber shellac, a '
    + 'brass hand brush, a horsehair shoe brush, folded cotton rags, a grey sanding sponge and two soft '
    + 'artist brushes. Warm late afternoon light from the left. The carving remains the clear hero and '
    + 'nothing overlaps it.',
};

// ── Gemini ─────────────────────────────────────────────────────────────────
async function gemini(prompt, refBuf, aspect) {
  const parts = [];
  if (refBuf) {
    const ref = await sharp(refBuf).resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 90 }).toBuffer();
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: ref.toString('base64') } });
  }
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
  const r = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}/${PREFIX}/${key}.jpg`, {
    method: 'POST', headers: { ...H, 'content-type': 'image/jpeg', 'x-upsert': 'true' }, body: buf,
  });
  if (!r.ok) throw new Error(`upload ${r.status}: ${(await r.text()).slice(0, 120)}`);
  return `${URL_BASE}/storage/v1/object/public/${BUCKET}/${PREFIX}/${key}.jpg`;
}

// ── run ────────────────────────────────────────────────────────────────────
fs.mkdirSync(OUT_DIR, { recursive: true });

// Pass 1: the master panel, built from the description, reused by every step.
if (MASTER_ONLY || !fs.existsSync(MASTER_FILE)) {
  console.log(`master panel … (model ${GMODEL})`);
  const raw = await gemini(
    `Create a photorealistic reference photograph of a carved wooden panel.\n\nTHE PANEL: ${PANEL}\n\n`
    + 'The panel is RAW and unfinished: bare pale cherry, matte, no stain or oil, straight off the CNC '
    + 'router. Shot square on, flat against a plain neutral grey background, evenly lit so every carved '
    + 'detail is legible. This is a documentation photograph, not a styled scene.\n' + SHOT,
    null, '1:1',
  );
  if (!raw) { console.error('master failed'); process.exit(1); }
  fs.writeFileSync(MASTER_FILE, await sharp(raw).jpeg({ quality: 92, mozjpeg: true }).toBuffer());
  console.log(`  ok → ${MASTER_FILE}`);
  if (MASTER_ONLY) process.exit(0);
}

const master = fs.readFileSync(MASTER_FILE);
const queue = [COVER, ...STEPS].filter((s) => !ONLY || ONLY === true || String(ONLY).split(',').includes(s.key));
console.log(`${queue.length} frame(s)${PREVIEW ? ' · PREVIEW (no upload)' : ''}`);

// Push the frames already reviewed on disk, without paying Gemini again. This
// is the normal path after a --preview run has been eyeballed and approved.
if (args.includes('--upload-existing')) {
  const out = [];
  for (const s of queue) {
    const local = path.join(OUT_DIR, `${s.key}.jpg`);
    if (!fs.existsSync(local)) { console.log(`. ${s.key} … missing, skipped`); continue; }
    out.push({ key: s.key, alt: s.alt, url: await upload(s.key, fs.readFileSync(local)) });
    console.log(`. ${s.key} … uploaded`);
  }
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(out, null, 2));
  console.log(`\n${out.length} uploaded → manifest.json`);
  process.exit(0);
}

const manifest = [];
let ok = 0, failed = 0;
for (const s of queue) {
  const local = path.join(OUT_DIR, `${s.key}.jpg`);
  if (!FORCE && PREVIEW && fs.existsSync(local)) { console.log(`. ${s.key} … cached`); continue; }
  process.stdout.write(`. ${s.key} … `);
  try {
    const prompt = `${FIDELITY}\n${s.prompt}\n\n${SHOT}${NO_BRAND}${BENCH}${/hand/i.test(s.prompt) ? HANDS : ''}`;
    const raw = await gemini(prompt, master, s.aspect);
    if (!raw) { console.log('FAILED'); failed++; continue; }
    const out = await sharp(raw).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
    fs.writeFileSync(local, out);
    if (PREVIEW) console.log(`ok → ${path.basename(local)}`);
    else { manifest.push({ key: s.key, alt: s.alt, url: await upload(s.key, out) }); console.log('ok'); }
    ok++;
  } catch (e) {
    failed++;
    console.log(`FAILED ${e.message.slice(0, 100)}`);
    if (/^QUOTA/.test(e.message)) { console.error('stopping: Gemini quota/billing'); break; }
  }
}
if (manifest.length) {
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`\nmanifest → ${path.join(OUT_DIR, 'manifest.json')}`);
}
console.log(`\ndone: ${ok} built, ${failed} failed → ${OUT_DIR}`);
