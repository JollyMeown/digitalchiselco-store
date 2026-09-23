// Turn the RIGHT-HAND cutter in bits.jpg into a tapered ball nose.
//
// Describing a tapered ball nose from scratch failed four times: the model
// either drew two identical rods, or dragged the carved panel back into a
// frame that was supposed to be tools only. What worked for the ridge
// comparison works here too. Hand it the photograph it already made and change
// ONE thing, rather than asking for a new photograph that happens to match.
//
//   node scripts/blog/why-3d-carves-take-hours/pair_taper.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = 'D:/000 DIGITAL CHISEL WEBSITE/.mockups/blog-why-3d-carves-take-hours';
const SRC = path.join(OUT, 'bits.jpg');
if (!fs.existsSync(SRC)) { console.error('bits.jpg must exist first'); process.exit(1); }

const brs = JSON.parse(fs.readFileSync('D:/000 BUNDLE RELIEF STUDIO/_config/config.json', 'utf8').replace(/^\uFEFF/, ''));
const KEY = brs.gemini_api_key;
const MODEL = 'gemini-3-pro-image';

const PROMPT = `Image 1 is a photograph of two carbide CNC router cutters lying on a workbench. Reproduce THIS EXACT PHOTOGRAPH again: the same bench, the same wood grain and dust, the same blurred workshop behind, the same low raking light from the left, the same shadows, the same camera height and angle. Keep BOTH existing cutters exactly as they are and in the same places: the straight silver ball nose at the front, and the bronze tapered ball nose behind it.

ADD ONE MORE CUTTER, a FLAT END MILL, laid alongside the other two in the same orientation, nearest the camera at the front so all three are visible in a row.

A FLAT END MILL looks like this and the description is precise:
- Solid carbide, BRIGHT BARE POLISHED SILVER along its whole length, uncoated, no bronze or gold colour anywhere.
- A plain parallel cylindrical shank at one end.
- The cutting body is ALSO a parallel cylinder of the SAME diameter as the shank: no cone, no taper, no narrowing at all.
- FOUR deep spiral flutes twist along the cutting body, more flutes and tighter twist than the other two tools.
- The working end is cut off SQUARE and FLAT, a blunt flat disc face with sharp corners. It is emphatically NOT rounded, NOT hemispherical, NOT pointed. That flat square end is the whole point.

So the three tools read as three different jobs at a glance: a fat silver cylinder ending in a flat square face, a bronze cone ending in a tiny ball, and a slim silver cylinder ending in a rounded ball.

Keep everything else identical. ABSOLUTELY NO wooden panel, NO carving, NO text, letters, numbers, labels, arrows or annotation anywhere. Photographic: no CGI sheen, no lens flare, no white studio background.`

const ref = (await sharp(fs.readFileSync(SRC)).resize(1024, 1024, { fit: 'inside' }).jpeg({ quality: 92 }).toBuffer()).toString('base64');

const body = {
  contents: [{ parts: [{ inlineData: { mimeType: 'image/jpeg', data: ref } }, { text: PROMPT }] }],
  generationConfig: { imageConfig: { imageSize: '2K', aspectRatio: '16:9' } },
};

for (let attempt = 1; attempt <= 3; attempt++) {
  process.stdout.write(`. taper (paired to bits) attempt ${attempt} ... `);
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const j = await r.json();
    const img = (j?.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData?.data || p.inline_data?.data);
    if (!img) { console.log((j?.error?.message || 'no image').slice(0, 120)); await new Promise((x) => setTimeout(x, 5000 * attempt)); continue; }
    const buf = Buffer.from(img.inlineData?.data || img.inline_data.data, 'base64');
    fs.writeFileSync(path.join(OUT, 'bits.jpg'), await sharp(buf).jpeg({ quality: 90, mozjpeg: true }).toBuffer());
    console.log('ok -> bits.jpg');
    process.exit(0);
  } catch (e) { console.log(e.message.slice(0, 100)); await new Promise((x) => setTimeout(x, 5000 * attempt)); }
}
console.error('failed');
process.exit(1);
