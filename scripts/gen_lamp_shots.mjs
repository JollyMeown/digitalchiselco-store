// Realistic photographs of the Vase Lampshade Studio models, from the models.
//
// The reference is NOT a mood board, it is the actual software output: the
// headless generator in D:/LAMP SHADE OGEE/studio writes the real STLs, the
// contact-sheet page renders each one, and those renders go to Gemini as image
// 1 with a hard instruction to reproduce the silhouette exactly. Owner, 2026-09-21:
// "The images must comply the software generated and should be realistic."
//
// So every picture here is the same object the buyer downloads, photographed,
// rather than a lamp Gemini invented.
//
//   node scripts/gen_lamp_shots.mjs --list
//   node scripts/gen_lamp_shots.mjs --only ogee-bell,tulip-flare
//   node scripts/gen_lamp_shots.mjs --scene lit --aspect 1:1
//   node scripts/gen_lamp_shots.mjs --all                 # every design, hero scene
//
// Output goes to .mockups/lamp-shots/ for review. Nothing is uploaded and
// nothing is published: the owner approves first.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const SHOTS = 'D:/LAMP SHADE OGEE/studio/_pack/shots';
const REPORT = 'D:/LAMP SHADE OGEE/studio/_pack/_report.json';
const OUT_DIR = path.join(ROOT, '.mockups', 'lamp-shots');
const BRS_CFG = 'D:/000 BUNDLE RELIEF STUDIO/_config/config.json';

const brs = JSON.parse(fs.readFileSync(BRS_CFG, 'utf8').replace(/^\uFEFF/, ''));
const GKEY = brs.gemini_api_key;
if (!GKEY) { console.error('no gemini_api_key in the BRS config'); process.exit(1); }

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? (args[i + 1] ?? true) : d; };
const GMODEL = String(flag('model', brs.gemini_image_model || 'gemini-3-pro-image'));
const ONLY = String(flag('only', '') || '').split(',').filter(Boolean);
const SCENES = String(flag('scene', 'lit') || '').split(',').filter(Boolean);
const ASPECT = String(flag('aspect', '1:1'));
const report = JSON.parse(fs.readFileSync(REPORT, 'utf8'));

// ── the look ───────────────────────────────────────────────────────────────
// Two things make a 3D-printed vase-mode shade recognisable to the people we
// are trying to reach, and both must be in every prompt or the picture reads
// as a generic ceramic lamp: the fine spiral layer lines, and the way light
// comes THROUGH a single 0.4 mm wall rather than off it.
const FIDELITY = `Image 1 is the EXACT product, a 3D render of the real model the customer downloads.
Reproduce its silhouette EXACTLY: the same profile curve, the same number of flutes or ribs,
the same proportions of height to width, the same rim shape, the same twist. Do not restyle it,
do not simplify it, do not add or remove flutes, do not change the opening. Treat image 1 as a
technical drawing you are photographing, not as inspiration.`;

// Vase mode raises Z continuously, so the nozzle never stops or restarts and
// there is NO Z-seam at all. An earlier version of this prompt asked for "a
// faint spiral seam" and every picture came back with a scar up the side; the
// owner caught it (2026-09-21). A vase-mode print is the smoothest thing an
// FDM printer makes, and saying so is the whole point of the product.
const MATERIAL = `The object is 3D printed in ONE continuous spiral (vase mode) from warm white PLA.

ABSOLUTELY NO SEAM. In vase mode the Z axis rises continuously and the nozzle never stops, lifts or
restarts, so there is no Z-seam, no vertical scar, no diagonal join line, no start or stop blob, and
no stringing anywhere on the surface. The wall is unbroken all the way around and all the way up.
Do not draw a seam, a join, a split line or a visible spiral ramp.

The truthful signature is only this: extremely fine, even, continuous horizontal striations about
0.2 mm apart running the full height, delicate rather than coarse, like fine turned grooves in
porcelain. The surface is smooth satin and flawless.

The wall is a single skin only 0.4 mm thick, so the shade is thin, light and delicate, and when the
lamp is on the light passes THROUGH the wall: the whole shade glows warm amber from within, brightest
between the flutes, with those fine striations reading as soft bands of light rather than ridges.
No gloss, no ceramic, no glass, no fabric, no visible print defects.`;

// ── the photographer ───────────────────────────────────────────────────────
// Owner, 2026-09-21: "Act as a product display and best photographer,
// cinematic, camera angles, lightings keep all in your considerations."
// A scene description alone gives a competent catalogue shot. What makes lamp
// photography beautiful is specific and physical: shoot at blue hour so a
// 2700 K lamp sits against 6000 K skylight and the frame carries real colour
// contrast; expose for the glow so the brightest flutes keep detail instead of
// blowing to white; let the shadows fall away rather than filling them.
const CRAFT = `You are a leading interiors and product photographer shooting a lighting catalogue cover.

LIGHT. The lamp is the only warm source in the frame, roughly 2700 K, and it must be the brightest
thing in the picture without clipping: the brightest flutes keep their texture, they never burn to
flat white. The ambient is cool, about 6000 K dusk light from a window off frame, so warm object
sits against cool room and the colour contrast does the work. A large soft source camera-left at
low power lifts the unlit side just enough to keep the form readable, and a black card opposite
keeps the shadow side rich. Motivated light only, nothing looks studio-lit. Let the fluting throw
real fanned shadows onto the wall and ceiling; those shadows are half the product.

CAMERA. Full-frame, 85 mm prime at f/2.2, ISO 200, tripod, shot at the shade's own mid-height so
the silhouette is true and not distorted. Focus locked on the near edge of the fluting, so the rim
is crisp and the background falls into soft honest bokeh, never a wall of blurred circles.

COMPOSITION. Off-centre, the lamp on a third, with breathing room above it. Layer the frame:
something soft and out of focus in the near foreground, the lamp sharp in the middle, a quiet
background with real depth. Nothing symmetrical, nothing that looks staged for a catalogue.

STYLING. This is a real room that somebody lives in and cares about, not a showroom with one object
in it. Dress it the way an interiors stylist would for a magazine: layered, tactile, and warm.
Build the frame from soft materials that catch the lamplight, a linen or bouclé cushion, a throw
folded over an arm, a wool rug, a sheer curtain glowing at the window. Add life at the edges,
dried stems or eucalyptus in a stoneware jug, a low bowl, a stack of two or three books with worn
spines, a small tray, a trailing plant, a half-burnt candle. Let the background hold something to
look into: an open doorway with warm light beyond it, a shelf with a few considered things on it,
the corner of a framed picture. Keep the palette harmonious and quiet, warm neutrals with oatmeal,
clay, sage and walnut, one small note of aged brass. Everything should look chosen and placed with
care, slightly imperfect, lived in. Rich and layered, never cluttered, and never competing with the
lamp: the lamp is the brightest and sharpest thing in the frame, and everything else is there to
make the room feel like somewhere you would want to sit.

GRADE. Filmic. Gentle highlight rolloff, slightly cool shadows against the warm glow, deep but
open blacks, a whisper of grain. Rich and quiet, not saturated, not HDR, not glossy.`;

const NO_BRAND = `No text, no logo, no watermark, no packaging, no brand marks, no faces, no hands
unless asked. It must read as a photograph: no CGI sheen, no plastic-looking render, no perfect
symmetry, no lens flare, no bokeh balls, no over-sharpening, no HDR halos.`;

const SCENE = {
  lit: `SET: a calm modern living room at blue hour. The shade sits on a slim matte black table-lamp base
on a walnut side table against a plastered wall.
LIGHT: the lamp is on and is the only warm source; cool dusk light falls through a window off frame
left. The warm pool spills across the walnut grain and climbs the wall behind in a soft fan.
CAMERA: 85 mm at f/2.2, tripod at the shade's mid-height, three-quarter view so one row of flutes
catches the highlight and the rest rolls into shadow.
FRAME: lamp on the right third, generous space above, the corner of a linen armchair soft in the
near foreground bottom-left.`,
  styled: `SET: the same shade switched OFF, mid-morning, on a walnut side table beside a linen armchair.
LIGHT: soft north daylight through a large window camera-left, a scrim softening it further, black
card camera-right so the unlit side stays rich. No lamp glow at all; this shot sells the object as
an object, the matte printed surface, the crisp flute edges, the fine layer lines raking in the
side light.
CAMERA: 85 mm at f/2.8, slightly above mid-height, near-front three-quarter.
FRAME: lamp left of centre, two stacked hardbacks and a stoneware cup well back and soft.`,
  bed: `SET: the finished print still standing on the textured PEI plate of a desktop 3D printer, seconds
after the job ended, the nozzle parked aside and the plate still faintly warm.
LIGHT: the printer's own cool LED strip rakes across the spiral wall from above, one warm practical
out of frame on the right gives the scene a second colour, workshop beyond falls dark.
CAMERA: 50 mm at f/2.8, low, almost at plate level, looking slightly up so the shade towers.
FRAME: the print left of centre, the gantry and nozzle softly out of focus behind it, the textured
plate filling the bottom of the frame.`,
  pair: `SET: two prints of the same design on a pale oak shelf, one lit and glowing, one unlit and matte,
so the difference reads in a single frame.
LIGHT: only the lit one is on, at blue hour; it spills warm light onto the unlit twin beside it,
which picks up the glow along one edge while staying cool and matte elsewhere.
CAMERA: 85 mm at f/2.5, dead level with the shelf.
FRAME: the pair slightly right of centre with the plastered wall taking the left two fifths, empty
and quiet.`,
  detail: `SET: macro on the lower third of the shade where the wall meets the integrated E27 holder, lamp on.
The printed spoked holder sits inside the opening, part of the same continuous spiral.
LIGHT: the bulb itself is the key, from inside and below, so the wall glows and the spokes go to
silhouette; a weak cool fill from camera-left keeps the outer surface texture readable.
CAMERA: 100 mm macro at f/4, level with the holder, focus on the nearest spoke where it meets the wall.
FRAME: tight, the shade wall sweeping diagonally out of the top of the frame, the layer lines
running as fine parallel striations through the glow.`,
  // Owner, 2026-09-21: "Also want hanging lamp pictures". The same shade reads
  // as a pendant when it hangs mouth-down, which is how the E27 holder sits
  // anyway, so this is an honest second use rather than a different product.
  pendant: `SET: the same shade hung as a PENDANT, mouth downward, on a black fabric-covered flex from a
matte black ceiling rose, about 700 mm above a pale oak dining table in a warm, lived-in dining
room at blue hour. Dress the table properly: a rumpled linen runner, two stoneware bowls, a small
jug of dried stems, a folded napkin, a glass half full. Chairs pulled slightly out of place.
Beyond the table let the room continue, a sideboard with a few considered things, an open doorway
with warm light spilling from the next room.
LIGHT: the pendant is the only warm source. It throws a bright pool onto the oak below and a wide
fan of shadow rays up across the ceiling, which is the signature of a fluted single-wall shade and
must be clearly visible. Cool dusk fills the room behind at a much lower level.
CAMERA: 85 mm at f/2.5, tripod, lens raised to the shade's own height so the shade is seen straight
on with no keystone, table surface visible below.
FRAME: portrait. Shade in the upper middle with clear ceiling above it, the lit table and two
stoneware bowls anchoring the bottom third, the room falling away soft and dim behind.`,
  cluster: `SET: THREE prints of the same design hung as a cluster at three different heights over a stone
kitchen island, all mouth-downward on black flexes, all lit. Night, the rest of the kitchen dark.
LIGHT: the three pendants are the only sources, overlapping warm pools on the stone below, layered
fans of shadow on the ceiling above.
CAMERA: 50 mm at f/2.8, low, looking slightly UP so the undersides and the printed holders read.
FRAME: landscape, the three staggered across the frame on a diagonal, deepest one nearest camera
and soft, the middle one sharp.`,
  hall: `SET: a single PENDANT over a stairwell, mouth downward on a long black flex against plain plaster.
Night.
LIGHT: the shade alone, throwing a tall fan of light and shadow up the wall behind it; a weak cool
spill from a landing window keeps the plaster from going black.
CAMERA: 85 mm at f/2.2, low, looking up so the opening and the spoked printed holder inside are
just visible.
FRAME: portrait, the shade high on a third, the wall's fanned shadows filling the rest, the
stair rail soft and dark across the bottom corner.`,
};

const toRef = async (buf) =>
  (await sharp(buf).resize(1280, 1280, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer()).toString('base64');

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
      const err = j?.error?.message || got.map((p) => p.text).join(' ').slice(0, 200) || 'no image in reply';
      if (/quota|billing|exhausted|RESOURCE_EXHAUSTED/i.test(err)) throw new Error(`QUOTA: ${err.slice(0, 140)}`);
      console.error(`    attempt ${attempt}: ${err.slice(0, 160)}`);
    } catch (e) {
      if (/^QUOTA/.test(e.message)) throw e;
      console.error(`    attempt ${attempt}: ${e.message.slice(0, 140)}`);
    }
    await new Promise((res) => setTimeout(res, 5000 * attempt));
  }
  return null;
}

if (args.includes('--list')) {
  for (const d of report) console.log(`${d.key.padEnd(18)} ${d.name.padEnd(18)} H${d.h} x \u00d8${d.dia}`);
  console.log('\nscenes:', Object.keys(SCENE).join(', '));
  process.exit(0);
}

const queue = report.filter((d) => (ONLY.length ? ONLY.includes(d.key) : args.includes('--all') || false));
if (!queue.length) {
  console.error('nothing selected. use --only <key,key> or --all, and --list to see the keys.');
  process.exit(1);
}
fs.mkdirSync(OUT_DIR, { recursive: true });

let made = 0, failed = 0;
for (const d of queue) {
  for (const scene of SCENES) {
    if (!SCENE[scene]) { console.error(`unknown scene ${scene}`); continue; }
    const outFile = path.join(OUT_DIR, `${d.key}_${scene}.jpg`);
    if (fs.existsSync(outFile) && !args.includes('--force')) { console.log(`skip ${d.key}/${scene} (exists)`); continue; }
    const heroRef = path.join(SHOTS, `${d.key}_hero.png`);
    const frontRef = path.join(SHOTS, `${d.key}_front.png`);
    if (!fs.existsSync(heroRef)) { console.error(`no reference render for ${d.key}`); failed++; continue; }
    const refs = [fs.readFileSync(heroRef)];
    if (fs.existsSync(frontRef)) refs.push(fs.readFileSync(frontRef));
    const prompt = [
      FIDELITY,
      `Image 2 is the same object straight on, use it to get the silhouette right.`,
      `The shade is ${d.h} mm tall and ${d.dia} mm across, so keep the proportions of a real table lamp shade of that size.`,
      MATERIAL,
      SCENE[scene],
      NO_BRAND,
    ].join('\n\n');
    process.stdout.write(`${d.key}/${scene} ... `);
    try {
      const raw = await gemini(prompt, refs, ASPECT);
      if (!raw) { console.log('FAILED'); failed++; continue; }
      await sharp(raw).jpeg({ quality: 90 }).toFile(outFile);
      console.log(`ok  ${Math.round(fs.statSync(outFile).size / 1024)}KB`);
      made++;
    } catch (e) {
      console.log(`ERROR ${e.message.slice(0, 120)}`);
      failed++;
      if (/^QUOTA/.test(e.message)) break;
    }
  }
}
console.log(`\n${made} made, ${failed} failed -> ${OUT_DIR}`);
console.log('Review them before anything is published.');
