// One-off product photography for /laser-studio.
//
// The CNC Match section led with a raw app screenshot: a brown fill, a ragged
// cyan alignment outline and a flat synthetic surface. It shows a real feature
// and it reads as a rendering glitch, which is the worst combination for the
// one image meant to make a visitor believe the software works.
//
// This generates the OUTCOME instead: a photograph of the finished panel, the
// background burned dark and the family name under the relief.
//
// Honesty line that must not be crossed: the customer's own photographs sit
// directly above this on the page and are labelled as real. This one is a
// product photograph of what the software produces, captioned as such, and it
// must never be captioned as a customer's piece or as a screenshot.
//
//   node scripts/gen_laser_shot.mjs                # generate, write to .mockups
//   node scripts/gen_laser_shot.mjs --only burned  # one frame
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const OUT = path.join(ROOT, '.mockups', 'laser-studio');
fs.mkdirSync(OUT, { recursive: true });

const brs = JSON.parse(fs.readFileSync('D:/000 BUNDLE RELIEF STUDIO/_config/config.json', 'utf8').replace(/^\uFEFF/, ''));
const KEY = brs.gemini_api_key;
if (!KEY) { console.error('no gemini_api_key in the BRS config'); process.exit(1); }
const MODEL = 'gemini-3-pro-image';

const REF = 'D:/000 LASER ENGRAVING/MANUAL/assets/cnc/check.jpg';

// ── the six-part brief the house standard requires ──────────────────────
const FIDELITY = `FIDELITY, THIS OUTRANKS EVERYTHING ELSE: image 1 is the design. Reproduce THAT EXACT carved alligator and no other: the same head turned to the right with the long snout and the visible row of teeth, the same heavy brow and eye, the same ridged scutes running along the back, the same raised foreleg and clawed foot at the lower left, the same body proportions and the same position on the panel. The handwritten script words "The Carters" and the numerals "2026" appear burned into the wood in the lower area exactly as in image 1, same wording, same script style, same placement. Do not redesign the animal, do not change its pose, do not add a second animal, do not alter the text.`;

const SUBJECT = `THE OBJECT: one finished portrait panel of solid American black walnut, about 30 cm tall and 21 cm wide and 20 mm thick, with a plain square edge. The alligator is a genuine three dimensional carved relief standing proud of the panel, cut by a CNC router, with real carved depth of about 8 mm at the highest point. The background field AROUND the alligator has been LASER DARKENED to a deep roasted espresso brown, almost black in the deepest part, which is what makes the pale carved animal jump forward. The burn has a soft edge where it meets the carving, not a cut-out line. The name beneath is a fine laser burn, dark brown, slightly sunk into the surface.`;

const LIGHT = `LIGHT, AS A PLAN: a warm 3000K key from the upper left, RAKING low across the panel at about 25 degrees off the surface, so it skims every carved scute and throws a real shadow out of every recess. This is the single most important thing: flat frontal light kills a relief. A quarter power fill from the right, just enough to keep the shadow side readable. Negative fill below. The burned background must HOLD DETAIL and never clip to flat black; the brightest walnut highlight on the snout must not blow out. Cooler 6000K daylight ambient in the room behind, so the panel reads warm against a cool surround.`;

const CAMERA = `CAMERA: full frame, 65 mm, f/5.6, ISO 100, on a tripod. Camera slightly above the panel and about 20 degrees off perpendicular, so the relief shows its depth. Focus locked on the alligator's eye and jaw. DO NOT shoot dead on square to the panel and DO NOT shoot from directly overhead: both flatten the carving, which is the only thing worth showing.`;

const COMPOSITION = `COMPOSITION: the panel sits on the third, leaning back slightly against a pale lime-plastered wall, standing on a worn walnut bench. Diagonal, never square to frame. A soft out of focus near foreground edge of the bench. Background receding and quiet.`;

const STYLING = `STYLING, AS AN INTERIORS STYLIST WOULD: a workshop somebody actually works in, not a showroom holding one object. A small open tin of wax with a fingerprint in it, a soft cloth folded once, a single thin offcut of the same walnut. Placed with intent and slightly imperfect. Nothing symmetrical, nothing cluttered, no more than three props.`;

const GRADE = `GRADE: filmic, gentle highlight rolloff, open blacks, fine natural grain, restrained saturation. A real photograph taken on a real camera.`;

const NEGATIVE = `ABSOLUTELY NOT: no cyan or blue outline, no coloured overlay, no alignment line, no software interface, no screen, no monitor, no cursor, no dotted machine bed, no perforated honeycomb, no watermark, no logo, no brand mark, no added lettering of any kind beyond the burned "The Carters 2026" itself. No CGI sheen, no plastic-looking wood, no perfect symmetry, no lens flare, no bokeh balls, no HDR halos, no oversharpening.`;

const FRAMES = [
  ['burned', '16:9', `${SUBJECT}\n\n${LIGHT}\n\n${CAMERA}\n\n${COMPOSITION}\n\n${STYLING}\n\n${GRADE}`],
];

const only = (() => { const i = process.argv.indexOf('--only'); return i > -1 ? process.argv[i + 1] : null; })();

const refB64 = (await sharp(fs.readFileSync(REF)).resize(1024, 1024, { fit: 'inside' }).jpeg({ quality: 92 }).toBuffer()).toString('base64');

for (const [key, aspect, scene] of FRAMES) {
  if (only && only !== key) continue;
  const prompt = `${FIDELITY}\n\n${scene}\n\n${NEGATIVE}\n\n${FIDELITY}`;
  process.stdout.write(`. ${key} ... `);
  const body = {
    contents: [{ parts: [{ inlineData: { mimeType: 'image/jpeg', data: refB64 } }, { text: prompt }] }],
    generationConfig: { imageConfig: { imageSize: '2K', aspectRatio: aspect } },
  };
  let done = false;
  for (let attempt = 1; attempt <= 3 && !done; attempt++) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = await r.json();
      const img = (j?.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData?.data || p.inline_data?.data);
      if (!img) { console.log(`attempt ${attempt}: ${(j?.error?.message || 'no image').slice(0, 120)}`); await new Promise((x) => setTimeout(x, 4000 * attempt)); continue; }
      const buf = Buffer.from(img.inlineData?.data || img.inline_data.data, 'base64');
      const file = path.join(OUT, `${key}.jpg`);
      fs.writeFileSync(file, await sharp(buf).jpeg({ quality: 90, mozjpeg: true }).toBuffer());
      console.log(`ok -> ${file}`);
      done = true;
    } catch (e) { console.log(`attempt ${attempt}: ${e.message.slice(0, 100)}`); await new Promise((x) => setTimeout(x, 4000 * attempt)); }
  }
  if (!done) console.log(`  FAILED ${key}`);
}
