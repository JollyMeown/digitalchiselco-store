// Generate the room backdrops used by the Pinterest "mockup" Pin art.
//
// WHY SCENES, NOT PER-PRODUCT AI IMAGES: asking an image model to redraw each
// carving in a room would change the carving, so the Pin would advertise a
// design the buyer cannot actually download. Instead we generate a handful of
// EMPTY rooms once, then composite the real product photo onto the wall at
// render time. The buyer always sees the real design, the cost is a dozen
// images instead of 1,466, and every future product gets a mockup for free.
//
// Scene prompts are the ones already proven in Bundle Relief Studio.
// Run: node scripts/gen_pin_scenes.mjs [--only living_room,cabin] [--force]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'public', 'scenes');
const BRS_CFG = 'D:/000 BUNDLE RELIEF STUDIO/_config/config.json';

const cfg = JSON.parse(fs.readFileSync(BRS_CFG, 'utf8').replace(/^\uFEFF/, ''));
const KEY = cfg.gemini_api_key;
const MODEL = cfg.gemini_image_model || 'gemini-3-pro-image';
if (!KEY) { console.error('no gemini_api_key in BRS config'); process.exit(1); }

// Rooms our buyers actually decorate. Each must leave a big empty wall for the
// carving; the composite lands in the upper-middle of the frame.
const SCENES = {
  living_room: 'a cozy modern living room with a large comfortable sofa, cushions, side plants and a wide EMPTY blank wall above the sofa',
  cabin: 'a warm log cabin interior with a stone fireplace and mantel, and an EMPTY log wall above the mantel',
  farmhouse: 'a rustic farmhouse dining room with a wooden table, chairs and an EMPTY white shiplap wall',
  man_cave: 'a moody man-cave den with a leather armchair, whiskey shelf, warm lamp light and a dark EMPTY accent wall',
  workshop: 'a woodworking workshop with a workbench and hanging hand tools to one side, and a large EMPTY plywood wall space',
  office: 'a tidy home office with a wooden desk, laptop and shelf, and an EMPTY wall above the desk',
  bedroom: 'a calm neutral bedroom with an upholstered headboard and bedside lamps, and an EMPTY wall above the bed',
  entryway: 'a welcoming entryway with a console table, a bowl for keys and a small lamp, and an EMPTY wall above the table',
};
const SUFFIX = ' - professional interior photograph, realistic materials and natural light, '
  + 'absolutely NO wall art, NO picture frames, NO mirrors, NO decorations on the wall itself: '
  + 'the wall must be completely EMPTY and smooth (a carved wooden plaque will be composited onto '
  + 'it later). Shot vertically for a 2:3 portrait crop, with the empty wall filling the upper half '
  + 'of the frame. No people, no text, no watermark.';

const args = process.argv.slice(2);
const only = (args.find((a) => a.startsWith('--only')) || '').split('=')[1]?.split(',').map((s) => s.trim());
const force = args.includes('--force');

fs.mkdirSync(OUT, { recursive: true });

async function generate(key, prompt) {
  const body = {
    contents: [{ parts: [{ text: prompt + SUFFIX }] }],
    generationConfig: { imageConfig: { aspectRatio: '2:3', imageSize: '2K' } },
  };
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = await r.json();
      const parts = j?.candidates?.[0]?.content?.parts || [];
      const img = parts.find((p) => p.inlineData?.data || p.inline_data?.data);
      if (img) return Buffer.from(img.inlineData?.data || img.inline_data.data, 'base64');
      const err = j?.error?.message || parts.map((p) => p.text).join(' ').slice(0, 200) || 'no image in reply';
      console.error(`  attempt ${attempt}: ${err}`);
      if (/quota|billing|exhausted/i.test(err)) return null;
    } catch (e) { console.error(`  attempt ${attempt}: ${e.message}`); }
    await new Promise((res) => setTimeout(res, 4000 * attempt));
  }
  return null;
}

let made = 0;
for (const [key, prompt] of Object.entries(SCENES)) {
  if (only && !only.includes(key)) continue;
  const dest = path.join(OUT, `${key}.jpg`);
  if (fs.existsSync(dest) && !force) { console.log(`= ${key} (exists)`); continue; }
  process.stdout.write(`. ${key} … `);
  const buf = await generate(key, prompt);
  if (!buf) { console.log('FAILED'); continue; }
  // Store as JPEG at Pin size: these are backdrops, not masters.
  const sharp = (await import('sharp')).default;
  await sharp(buf).resize(1000, 1500, { fit: 'cover', position: 'attention' }).jpeg({ quality: 82, mozjpeg: true }).toFile(dest);
  console.log(`ok (${Math.round(fs.statSync(dest).size / 1024)} KB)`);
  made++;
}
console.log(`\ndone: ${made} scene(s) written to public/scenes`);
