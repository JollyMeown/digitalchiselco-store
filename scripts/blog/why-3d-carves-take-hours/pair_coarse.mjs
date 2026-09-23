// Generate the COARSE half of the comparison pair FROM the fine half.
//
// The two comparison frames are the article's entire argument: identical
// carving, identical crop, identical light, and the only difference is the
// surface left by the stepover. The normal pipeline generates every frame
// independently, so it has no memory of the first one and produced a wide
// shot of the whole panel with no ridges at all. As a pair that proves
// nothing, and a reader would rightly conclude the difference is invented.
//
// So this one takes the ALREADY GENERATED fine.jpg as image 1 and asks for the
// same photograph with one thing changed. Reference-driven, not described.
//
//   node scripts/blog/why-3d-carves-take-hours/pair_coarse.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = 'D:/000 DIGITAL CHISEL WEBSITE/.mockups/blog-why-3d-carves-take-hours';
const FINE = path.join(OUT, 'fine.jpg');
if (!fs.existsSync(FINE)) { console.error('fine.jpg must exist first'); process.exit(1); }

const brs = JSON.parse(fs.readFileSync('D:/000 BUNDLE RELIEF STUDIO/_config/config.json', 'utf8').replace(/^\uFEFF/, ''));
const KEY = brs.gemini_api_key;
const MODEL = 'gemini-3-pro-image';

const PROMPT = `Image 1 is a photograph of a carved walnut deer relief on a workbench. Reproduce THIS EXACT PHOTOGRAPH again: the same carving, the same deer, the same antlers, the same crop, the same camera distance and angle, the same workbench, the same raking light and the same shadows. It must read as the same photograph taken moments later, of the same object, from the same tripod.

CHANGE EXACTLY ONE THING, THE SURFACE FINISH. In image 1 the carved surface is smooth, because it was cut at a fine stepover. In the new photograph the same carving was cut at a COARSE stepover, so the curved surfaces carry clearly visible PARALLEL RIDGES, like the grooves of a vinyl record, following the path the cutter took. They run in even, regularly spaced lines across the deer's neck, shoulder and the rounded ground behind it, wrapping over the curves. Each crest catches the raking light and each trough holds a thin shadow, which is what makes them visible. The ridges are shallow, well under a millimetre, but unmistakable to the eye.

Keep the ridges physically plausible: they follow one consistent sweep direction across the whole surface, they are evenly spaced, they fade out on flat areas facing the light straight on, and they are strongest where the surface curves away. Fine detail such as the eye and the nose stays sharp; the ridges are a texture ON the form, not a distortion of it.

DO NOT change the crop, DO NOT zoom out, DO NOT show more of the bench, DO NOT move the light, DO NOT change the deer. ABSOLUTELY NO text, letters, numbers, labels, logos, arrows or annotation of any kind. No CGI sheen, no plastic wood, no lens flare.`;

const ref = (await sharp(fs.readFileSync(FINE)).resize(1024, 1024, { fit: 'inside' }).jpeg({ quality: 92 }).toBuffer()).toString('base64');

const body = {
  contents: [{ parts: [{ inlineData: { mimeType: 'image/jpeg', data: ref } }, { text: PROMPT }] }],
  generationConfig: { imageConfig: { imageSize: '2K', aspectRatio: '4:5' } },
};

for (let attempt = 1; attempt <= 3; attempt++) {
  process.stdout.write(`. coarse (paired to fine) attempt ${attempt} ... `);
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const j = await r.json();
    const img = (j?.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData?.data || p.inline_data?.data);
    if (!img) { console.log((j?.error?.message || 'no image').slice(0, 120)); await new Promise((x) => setTimeout(x, 5000 * attempt)); continue; }
    const buf = Buffer.from(img.inlineData?.data || img.inline_data.data, 'base64');
    fs.writeFileSync(path.join(OUT, 'coarse.jpg'), await sharp(buf).jpeg({ quality: 90, mozjpeg: true }).toBuffer());
    console.log('ok -> coarse.jpg');
    process.exit(0);
  } catch (e) { console.log(e.message.slice(0, 100)); await new Promise((x) => setTimeout(x, 5000 * attempt)); }
}
console.error('failed');
process.exit(1);
