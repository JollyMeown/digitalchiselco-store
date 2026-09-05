// Compose the eight species tiles into one labelled 4x2 grid.
//
// Gemini will not letter a picture reliably and must not invent text, so the
// labels are drawn here, exactly, after the tiles are reviewed. Run after
// gen_blog_frames.mjs --preview has produced the eight tiles.
//
//   node scripts/blog/best-wood-for-cnc-relief-carving/compose_grid.mjs
import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(HERE, '..', '..', '..', '.mockups', 'blog-best-wood-for-cnc-relief-carving');
const TILES = [
  ['cherry', 'Cherry'], ['walnut', 'Black walnut'], ['maple', 'Hard maple'], ['basswood', 'Basswood'],
  ['oak', 'White oak'], ['poplar', 'Poplar'], ['sapele', 'Sapele'], ['pine', 'Pine'],
];
const T = 560, GAP = 24, LABEL = 64, PAD = 32;
const W = PAD * 2 + 4 * T + 3 * GAP, H = PAD * 2 + 2 * (T + LABEL) + GAP;

const composites = [];
for (let i = 0; i < TILES.length; i++) {
  const [key, name] = TILES[i];
  const file = path.join(DIR, `${key}.jpg`);
  if (!fs.existsSync(file)) { console.error('missing tile', key); process.exit(1); }
  const col = i % 4, row = Math.floor(i / 4);
  const x = PAD + col * (T + GAP), y = PAD + row * (T + LABEL + GAP);
  composites.push({ input: await sharp(file).resize(T, T, { fit: 'cover' }).jpeg({ quality: 90 }).toBuffer(), left: x, top: y });
  const label = `<svg width="${T}" height="${LABEL}"><text x="${T / 2}" y="42" font-family="Georgia, serif" font-size="30" font-weight="bold" fill="#412402" text-anchor="middle">${name}</text></svg>`;
  composites.push({ input: Buffer.from(label), left: x, top: y + T });
}
await sharp({ create: { width: W, height: H, channels: 3, background: '#FAEEDA' } })
  .composite(composites).jpeg({ quality: 90, mozjpeg: true }).toFile(path.join(DIR, 'grid.jpg'));
console.log(`grid → ${path.join(DIR, 'grid.jpg')} (${W}x${H})`);
