// The three-toolpath plan, drawn: board, model outline, the fine-pass boundary
// around the subject, and which cutter runs where. No software UI is imitated.
//   node scripts/blog/first-cnc-relief-carving-step-by-step/toolpath_diagram.mjs
import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(HERE, '..', '..', '..', '.mockups', 'blog-first-cnc-relief-carving-step-by-step');
fs.mkdirSync(DIR, { recursive: true });
const W = 2400, H = 1800;
const CREAM = '#FAEEDA', BRONZE = '#854F0B', DARK = '#633806', INK = '#412402', WOOD = '#E8C79A';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="${CREAM}"/>
<defs><pattern id="g" width="26" height="26" patternUnits="userSpaceOnUse"><path d="M0 26 L26 0" stroke="#dcc39a" stroke-width="1"/></pattern></defs>
<text x="1200" y="130" font-family="Georgia, serif" font-size="60" text-anchor="middle" font-weight="bold" fill="${INK}">The three toolpaths, seen from above</text>
<!-- board 300 x 350 mm at 3 px/mm -> 900 x 1050, origin bottom-left -->
<g transform="translate(300,260)">
  <rect x="0" y="0" width="900" height="1050" fill="${WOOD}" stroke="${DARK}" stroke-width="6"/>
  <rect x="0" y="0" width="900" height="1050" fill="url(#g)"/>
  <!-- model outline: arched panel inset -->
  <path d="M110 1000 L110 260 A340 340 0 0 1 790 260 L790 1000 Z" fill="none" stroke="${BRONZE}" stroke-width="10"/>
  <!-- fine-pass boundary around the wolf (rough wolf silhouette) -->
  <path d="M430 560 C400 520 420 470 470 455 C500 445 520 470 540 430 C560 400 600 400 610 430 C630 470 600 500 640 520 C700 550 700 640 690 720 C685 800 700 860 690 900 L470 905 C440 850 430 790 420 730 C410 660 400 600 430 560 Z" fill="rgba(133,79,11,0.12)" stroke="${BRONZE}" stroke-width="8" stroke-dasharray="26 16"/>
  <!-- origin -->
  <circle cx="0" cy="1050" r="16" fill="${BRONZE}"/>
  <!-- clamps -->
  <g fill="#9a9a9a" stroke="#555" stroke-width="4">
    <rect x="-60" y="20" width="120" height="40" rx="6"/><rect x="840" y="20" width="120" height="40" rx="6"/>
    <rect x="-60" y="990" width="120" height="40" rx="6"/><rect x="840" y="990" width="120" height="40" rx="6"/>
  </g>
</g>
<g font-family="Georgia, serif" fill="${INK}">
  <text x="1330" y="420" font-size="44" font-weight="bold">1. Roughing</text>
  <text x="1330" y="475" font-size="36" fill="${DARK}">1/4 inch flat end mill, 45% stepover</text>
  <text x="1330" y="525" font-size="36" fill="${DARK}">boundary: the model outline (solid line)</text>
  <text x="1330" y="575" font-size="36" fill="${DARK}">leave 0.8 mm of stock</text>

  <text x="1330" y="700" font-size="44" font-weight="bold">2. Semi-finish</text>
  <text x="1330" y="755" font-size="36" fill="${DARK}">1/16 inch tapered ball nose, 15% stepover</text>
  <text x="1330" y="805" font-size="36" fill="${DARK}">boundary: the model outline, raster at 45 degrees</text>

  <text x="1330" y="930" font-size="44" font-weight="bold">3. Fine pass</text>
  <text x="1330" y="985" font-size="36" fill="${DARK}">1/32 inch tapered ball nose, 8% stepover</text>
  <text x="1330" y="1035" font-size="36" fill="${DARK}">boundary: the vector around the wolf only (dashed)</text>
  <text x="1330" y="1085" font-size="36" fill="${DARK}">raster at 90 degrees to pass 2</text>

  <text x="1330" y="1210" font-size="36" fill="${DARK}">Origin: front-left corner, Z zero on the top face</text>
  <text x="1330" y="1260" font-size="36" fill="${DARK}">Clamps (grey) stay outside every boundary</text>
  <text x="300" y="1400" font-size="34" fill="#8a7a68">Board 300 by 350 mm, 25 mm thick. Post each pass as its own file: 01-rough, 02-semi, 03-fine.</text>
  <text x="1200" y="1700" font-size="30" text-anchor="middle" fill="#8a7a68">DigitalChiselCo · your first relief carving</text>
</g>
</svg>`;
await sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toFile(path.join(DIR, 'plan.jpg'));
console.log('toolpath plan →', path.join(DIR, 'plan.jpg'));
