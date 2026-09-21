// Listing posters for Etsy and Cults3D.
//
// The photograph is generated (gen_lamp_shots.mjs, from the real STL renders),
// but the TYPE is composited here in code, because generated text is never
// reliably crisp and a listing's first image has to be legible as a thumbnail.
//
// The hook is functional, not decorative: what this file DOES that other
// lampshade files do not. One piece, holder included, no supports, no glue.
//
//   node scripts/make_lamp_poster.mjs --design ogee-bell --variant etsy
//   node scripts/make_lamp_poster.mjs --all --variant etsy
//   node scripts/make_lamp_poster.mjs --design bamboo --variant cults --scene lit
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const SHOTS = path.join(ROOT, '.mockups', 'lamp-shots');
const OUT_DIR = path.join(ROOT, '.mockups', 'lamp-posters');
const REPORT = JSON.parse(fs.readFileSync('D:/LAMP SHADE OGEE/studio/_pack/_report.json', 'utf8'));

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? (args[i + 1] ?? true) : d; };
const VARIANT = String(flag('variant', 'etsy'));
const SCENE = String(flag('scene', 'pendant'));
const ONE = flag('design', null);

// Square for Etsy's grid, 4:3 for Cults3D's card.
const SIZE = VARIANT === 'cults' ? { w: 1600, h: 1200 } : { w: 2000, h: 2000 };

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The functional hooks, in the order they earn attention. */
function chips(d) {
  return [
    'PRINTS IN ONE PIECE',
    'E27 HOLDER BUILT IN',
    'NO SUPPORTS, NO GLUE',
    `FITS A 220 mm BED`,
  ];
}

function overlaySvg(d) {
  const { w, h } = SIZE;
  const pad = Math.round(w * 0.055);
  const big = Math.round(w * (VARIANT === 'cults' ? 0.072 : 0.062));
  const sub = Math.round(w * (VARIANT === 'cults' ? 0.030 : 0.026));
  const chip = Math.round(w * (VARIANT === 'cults' ? 0.021 : 0.019));
  const eyebrow = Math.round(w * 0.016);

  // Lay the chips out into rows that actually fit the canvas, measuring each
  // pill from its text rather than hoping. Built bottom-up so nothing overlaps:
  // chips sit on the floor, the subtitle above them, the headline above that.
  const items = chips(d);
  const pillH = Math.round(chip * 2.2);
  const gap = Math.round(chip * 0.6);
  const maxW = w - pad * 2;
  const widthOf = (t) => Math.round(t.length * chip * 0.66) + chip * 2;
  const rows = [[]];
  let used = 0;
  for (const t of items) {
    const tw = widthOf(t);
    if (used && used + gap + tw > maxW) { rows.push([]); used = 0; }
    rows[rows.length - 1].push({ t, tw });
    used += (used ? gap : 0) + tw;
  }
  const chipsH = rows.length * pillH + (rows.length - 1) * gap;
  const chipsTop = h - pad - chipsH;
  let ry = chipsTop;
  const pills = rows.map((row) => {
    let rx = pad;
    const out = row.map(({ t, tw }) => {
      const el = `
      <rect x="${rx}" y="${ry}" rx="${pillH / 2}" ry="${pillH / 2}" width="${tw}" height="${pillH}"
            fill="#000000" fill-opacity="0.46" stroke="#E8C489" stroke-opacity="0.60" stroke-width="1.6"/>
      <text x="${rx + tw / 2}" y="${ry + pillH * 0.66}" font-family="Segoe UI, Arial, sans-serif" font-size="${chip}"
            font-weight="700" letter-spacing="${chip * 0.07}" fill="#F2DCB6" text-anchor="middle">${esc(t)}</text>`;
      rx += tw + gap;
      return el;
    }).join('');
    ry += pillH + gap;
    return out;
  }).join('');

  // Stack upward with real clearance: the serif headline has deep descenders
  // (the g in "one go") and they were landing on the subtitle's cap height.
  const subY = chipsTop - Math.round(sub * 1.25);
  const headY = subY - Math.round(sub * 0.95 + big * 1.42);

  return Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="#000" stop-opacity="0.55"/>
        <stop offset="26%"  stop-color="#000" stop-opacity="0.06"/>
        <stop offset="52%"  stop-color="#000" stop-opacity="0.10"/>
        <stop offset="100%" stop-color="#000" stop-opacity="0.86"/>
      </linearGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#scrim)"/>

    <text x="${pad}" y="${pad + eyebrow}" font-family="Segoe UI, Arial, sans-serif" font-size="${eyebrow}"
          font-weight="700" letter-spacing="${eyebrow * 0.32}" fill="#E8C489" fill-opacity="0.95">DIGITALCHISELCO</text>
    <text x="${w - pad}" y="${pad + eyebrow}" font-family="Segoe UI, Arial, sans-serif" font-size="${eyebrow}"
          font-weight="700" letter-spacing="${eyebrow * 0.22}" fill="#FFFFFF" fill-opacity="0.72"
          text-anchor="end">${esc(d.name.toUpperCase())} &#183; ${d.h} &#215; ${d.dia} mm</text>

    <text x="${pad}" y="${headY}" font-family="Georgia, Segoe UI, serif" font-size="${big}"
          font-weight="700" fill="#FFFFFF">The whole lamp,</text>
    <text x="${pad}" y="${headY + big * 1.04}" font-family="Georgia, Segoe UI, serif" font-size="${big}"
          font-weight="700" fill="#FFCF8F">printed in one go.</text>
    <text x="${pad}" y="${subY}" font-family="Segoe UI, Arial, sans-serif" font-size="${sub}"
          fill="#FFFFFF" fill-opacity="0.92">Vase mode STL, bulb holder already part of it.</text>
    ${pills}
  </svg>`);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const queue = ONE ? REPORT.filter((d) => d.key === ONE) : (args.includes('--all') ? REPORT : []);
if (!queue.length) { console.error('use --design <key> or --all'); process.exit(1); }

let n = 0;
for (const d of queue) {
  const src = path.join(SHOTS, `${d.key}_${SCENE}.jpg`);
  if (!fs.existsSync(src)) { console.error(`no ${SCENE} shot for ${d.key}`); continue; }
  const out = path.join(OUT_DIR, `${d.key}_${VARIANT}.jpg`);
  await sharp(src)
    .resize(SIZE.w, SIZE.h, { fit: 'cover', position: 'attention' })
    .composite([{ input: overlaySvg(d), top: 0, left: 0 }])
    .jpeg({ quality: 92 })
    .toFile(out);
  console.log(`${d.key} -> ${path.basename(out)}  ${Math.round(fs.statSync(out).size / 1024)}KB`);
  n++;
}
console.log(`\n${n} posters -> ${OUT_DIR}`);
