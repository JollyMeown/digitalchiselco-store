// A photographic hero for the 14 Stations of the Cross bundle (2026-09-26),
// for Google Shopping / ads, made with the high-end Gemini image model.
// Images 1 to 14 are the REAL station renders, in station order, and the
// photograph must show exactly those 14 carvings (house fidelity rule). The
// exact alternative, .mockups/stations/grid.jpg, is built from the renders
// themselves by make_stations_grid.mjs. Nothing here goes live on its own:
// the owner picks.
//   node scripts/gen_stations_hero.mjs [--aspect 1:1|4:3|16:9] [--take N]
import 'dotenv/config';
import fs from 'node:fs';
import sharp from 'sharp';

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > -1 ? process.argv[i + 1] : d; };
const ASPECT = arg('aspect', '1:1'), TAKE = arg('take', '1');
const brs = JSON.parse(fs.readFileSync('D:/000 BUNDLE RELIEF STUDIO/_config/config.json', 'utf8').replace(/^\uFEFF/, ''));
const KEY = brs.gemini_api_key, MODEL = 'gemini-3-pro-image';
if (!KEY) { console.error('no gemini_api_key in the BRS config'); process.exit(1); }
const U = process.env.PUBLIC_SUPABASE_URL, K = process.env.SUPABASE_SERVICE_ROLE_KEY, H = { apikey: K, authorization: `Bearer ${K}` };
const bundle = (await fetch(`${U}/rest/v1/products?select=id&slug=like.14-stations-of-the-cross*`, { headers: H }).then((r) => r.json()))[0];
const rows = await fetch(`${U}/rest/v1/bundle_items?select=sort_order,products:source_product_id(title,image_url)&bundle_product_id=eq.${bundle.id}&order=sort_order`, { headers: H }).then((r) => r.json());
const refs = await Promise.all(rows.map(async (r) => {
  const u = r.products.image_url.replace('/object/public/', '/render/image/public/') + '?width=768&height=768&resize=contain&quality=90';
  return (await sharp(Buffer.from(await (await fetch(u)).arrayBuffer())).jpeg({ quality: 90 }).toBuffer()).toString('base64');
}));
const names = rows.map((r, i) => `image ${i + 1} = Station ${r.sort_order}: ${String(r.products.title).split('|')[0].replace(/\s*STL\s*$/i, '').trim()}`).join('; ');

const FIDELITY = `FIDELITY, THIS OUTRANKS EVERYTHING ELSE: images 1 to 14 are the EXACT fourteen carved panels this photograph must show, one each, and no others: ${names}. Every panel keeps its own scene, figures, poses, cross angle, arch shape and its own ornamental border of vines, grapes and small crosses exactly as in its reference. Do not redesign, merge, repeat or swap any panel, do not invent a fifteenth, do not change a figure. They hang in station order, reading left to right, top row first. COUNT THEM: EXACTLY FOURTEEN PANELS, TWO ROWS OF SEVEN. Top row, left to right: images 1, 2, 3, 4, 5, 6, 7. Bottom row, left to right: images 8, 9, 10, 11, 12, 13, 14. Twelve is wrong, thirteen is wrong, fifteen is wrong. Each reference appears exactly once, and no two panels show the same scene.`;
const SUBJECT = `THE OBJECTS, PHOTOGRAPHED NOT RENDERED: fourteen square carved panels of solid walnut, each about 40 cm square and 3 cm thick, with deep CNC-carved relief standing proud of the background, finished in a warm hand-rubbed oil. They are installed as a set on one plain wall.`;
const LIGHT = `LIGHT, AS A PLAN: soft warm daylight from a tall window at the upper left, RAKING across the wall at about 25 degrees so every carved figure, fold and vine throws a real shadow and the depth of the relief reads clearly. This is the single most important thing: flat frontal light kills a relief. Gentle bounce from the right keeps the shadow side readable. No blown highlights on the walnut, no crushed blacks in the recesses.`;
const CAMERA = `CAMERA: full frame, 50 mm, f/8, ISO 100, tripod. Camera at the height of the set's centre, turned about 12 degrees off square to the wall, so the relief shows depth while every panel stays fully visible and sharp from the first to the last.`;
const COMPOSITION = `COMPOSITION: all fourteen panels fill most of the frame in two neat rows of seven with even gaps, on a pale warm limestone wall of a quiet chapel. A sliver of a simple oak pew or a stone window reveal at one edge, out of focus, gives scale. The set is the subject; nothing overlaps any panel.`;
const STYLING = `STYLING: calm and reverent, uncluttered. At most one soft element outside the set (the edge of a pew or window light on the floor). No candles or flowers in front of any panel.`;
const GRADE = `GRADE: natural, filmic, gentle highlight rolloff, restrained saturation, true walnut browns. A real photograph taken on a real camera.`;
const NEGATIVE = `ABSOLUTELY NOT: no text, no letters, no Roman numerals, no numbers, no captions, no labels, no watermark, no logo, no border or frame around the photograph, no people, no hands, no CGI sheen, no plastic-looking wood, no repeated or duplicated panels, no extra panels, no missing panels, no distorted faces, no lens flare, no HDR halos.`;
const prompt = `${FIDELITY}\n\n${SUBJECT}\n\n${LIGHT}\n\n${CAMERA}\n\n${COMPOSITION}\n\n${STYLING}\n\n${GRADE}\n\n${NEGATIVE}\n\n${FIDELITY}`;

const body = {
  contents: [{ parts: [...refs.map((d) => ({ inlineData: { mimeType: 'image/jpeg', data: d } })), { text: prompt }] }],
  generationConfig: { imageConfig: { imageSize: '2K', aspectRatio: ASPECT } },
};
for (let attempt = 1; attempt <= 3; attempt++) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  const img = (j?.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData?.data || p.inline_data?.data);
  if (!img) { console.log(`attempt ${attempt}: ${(j?.error?.message || j?.candidates?.[0]?.finishReason || 'no image').slice(0, 160)}`); await new Promise((x) => setTimeout(x, 5000 * attempt)); continue; }
  const file = `.mockups/stations/hero-${ASPECT.replace(':', 'x')}-${TAKE}.jpg`;
  await sharp(Buffer.from(img.inlineData?.data || img.inline_data.data, 'base64')).jpeg({ quality: 92 }).toFile(file);
  console.log('wrote', file);
  process.exit(0);
}
process.exit(1);
