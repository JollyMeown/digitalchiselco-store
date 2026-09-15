// The palette chart, drawn: ten natural wash colours for carved subjects with
// the pigments that mix each one. Drawn locally because Gemini cannot be
// trusted with labels, and a colour chart is only useful if it is exact.
//   node scripts/blog/how-to-color-a-cnc-relief-carving/palette_chart.mjs
import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(HERE, '..', '..', '..', '.mockups', 'blog-how-to-color-a-cnc-relief-carving');
fs.mkdirSync(DIR, { recursive: true });
const W = 2400, H = 1600;
const CREAM = '#FAEEDA', BRONZE = '#854F0B', DARK = '#633806', INK = '#412402', WOOD = '#E8C79A';

// name, wash colour as it reads on pale wood, recipe (artists' acrylic names)
const ROWS = [
  ['Cardinal red', '#B3271E', 'Cadmium Red Medium + a touch of Burnt Sienna'],
  ['Dusty rose', '#C98A80', 'Burnt Sienna + Titanium White + a touch of Quinacridone Red'],
  ['Blossom white', '#F1E6CE', 'Titanium White + a touch of Yellow Ochre'],
  ['Sage leaf', '#8A9A6B', 'Sap Green + Raw Umber + Titanium White'],
  ['Deep leaf', '#5E7443', 'Hooker\'s Green + Yellow Ochre'],
  ['Branch and bark', '#6B4F32', 'Raw Umber, straight'],
  ['Berry and bud', '#9A3A2E', 'Burnt Sienna + Alizarin Crimson'],
  ['Sunflower gold', '#D9A83A', 'Yellow Ochre + Cadmium Yellow Medium'],
  ['Sky and water', '#8FAFC4', 'Cerulean Blue + Titanium White + a touch of Raw Umber'],
  ['Fur and skin warmth', '#C9A06A', 'Raw Sienna + Titanium White'],
];

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/'/g, '&#39;');
const top = 250, rowH = 118, left = 140, swW = 300, swH = 84;
let rows = '';
ROWS.forEach(([name, hex, recipe], i) => {
  const y = top + i * rowH;
  // swatch: the wash over "wood", so the chart shows what a thin coat reads as
  rows += `<rect x="${left}" y="${y}" width="${swW}" height="${swH}" rx="10" fill="${WOOD}"/>`
    + `<rect x="${left}" y="${y}" width="${swW}" height="${swH}" rx="10" fill="${hex}" fill-opacity="0.78"/>`
    + `<rect x="${left}" y="${y}" width="${swW}" height="${swH}" rx="10" fill="none" stroke="${DARK}" stroke-opacity="0.35" stroke-width="3"/>`
    + `<text x="${left + swW + 50}" y="${y + 40}" font-family="Georgia, serif" font-size="44" font-weight="bold" fill="${INK}">${esc(name)}</text>`
    + `<text x="${left + swW + 50}" y="${y + 78}" font-family="Georgia, serif" font-size="32" fill="${DARK}">${esc(recipe)}</text>`;
});

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="${CREAM}"/>
<text x="${left}" y="120" font-family="Georgia, serif" font-size="64" font-weight="bold" fill="${INK}">Ten washes that look natural on wood</text>
<text x="${left}" y="180" font-family="Georgia, serif" font-size="34" fill="${DARK}">Each swatch is the thinned colour over pale wood. Thin every mix with water to the consistency of skimmed milk.</text>
<rect x="${left}" y="205" width="${W - 2 * left}" height="3" fill="${BRONZE}"/>
${rows}
<text x="${left}" y="${H - 60}" font-family="Georgia, serif" font-size="30" fill="${DARK}">The rule behind every recipe: one earth pigment for the wood to agree with, one strong colour for the subject, white only to soften. Never a colour straight from the tube.</text>
</svg>`;

const out = path.join(DIR, 'palette.jpg');
await sharp(Buffer.from(svg)).jpeg({ quality: 90, mozjpeg: true }).toFile(out);
console.log('drawn →', out);
