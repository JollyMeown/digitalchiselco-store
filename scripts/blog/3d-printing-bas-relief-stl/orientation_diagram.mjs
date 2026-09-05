// Flat-on-the-bed versus upright, drawn. Exact, no invented UI.
//   node scripts/blog/3d-printing-bas-relief-stl/orientation_diagram.mjs
import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(HERE, '..', '..', '..', '.mockups', 'blog-3d-printing-bas-relief-stl');
fs.mkdirSync(DIR, { recursive: true });
const W = 2400, H = 1800;
const CREAM = '#FAEEDA', BRONZE = '#854F0B', DARK = '#633806', INK = '#412402', PLA = '#B9B6B0', PLA_D = '#7f7c76', BED = '#3a3a3a';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="${CREAM}"/>
<g font-family="Georgia, 'Times New Roman', serif" fill="${INK}">
  <text x="640" y="150" font-size="58" text-anchor="middle" font-weight="bold">Flat on the bed</text>
  <text x="1760" y="150" font-size="58" text-anchor="middle" font-weight="bold">Standing upright</text>
</g>
<!-- LEFT: bed line, relief lying flat: wavy top, flat back on bed, horizontal layer lines -->
<g transform="translate(140,300)">
  <rect x="0" y="720" width="1000" height="40" fill="${BED}"/>
  <path d="M100 720 L100 560 C170 560 190 430 260 440 C330 450 350 560 420 550 C490 540 500 400 570 390 C640 380 660 500 730 500 C800 500 820 440 900 440 L900 720 Z" fill="${PLA}" stroke="${PLA_D}" stroke-width="5"/>
  <g stroke="${PLA_D}" stroke-width="2" opacity="0.7">
    ${Array.from({ length: 13 }, (_, i) => `<line x1="100" y1="${720 - i * 24}" x2="900" y2="${720 - i * 24}"/>`).join('')}
  </g>
  <text x="500" y="820" font-size="36" text-anchor="middle" fill="${DARK}" font-family="Georgia, serif">layers stack up through the relief; the curved surface shows stepping</text>
  <text x="500" y="880" font-size="36" text-anchor="middle" fill="${DARK}" font-family="Georgia, serif">no supports, the back is the first layer, prints fast</text>
  <text x="500" y="960" font-size="40" text-anchor="middle" fill="${BRONZE}" font-family="Georgia, serif" font-weight="bold">use 0.08 to 0.12 mm layers, or the stepping shows</text>
</g>
<!-- RIGHT: bed line, relief standing on its long edge: profile faces sideways, vertical layer lines -->
<g transform="translate(1260,300)">
  <rect x="0" y="720" width="1000" height="40" fill="${BED}"/>
  <path d="M300 720 L300 100 L700 100 C700 170 640 190 630 260 C620 330 700 350 700 420 C700 490 620 520 620 590 C620 660 700 660 700 720 Z" fill="${PLA}" stroke="${PLA_D}" stroke-width="5"/>
  <g stroke="${PLA_D}" stroke-width="2" opacity="0.7">
    ${Array.from({ length: 16 }, (_, i) => `<line x1="${300 + i * 24}" y1="100" x2="${300 + i * 24}" y2="720"/>`).join('')}
  </g>
  <!-- supports under the overhangs -->
  <g fill="#e0b070" stroke="#a87830" stroke-width="3">
    <rect x="705" y="170" width="60" height="90" opacity="0.8"/>
    <rect x="705" y="430" width="60" height="160" opacity="0.8"/>
  </g>
  <text x="500" y="820" font-size="36" text-anchor="middle" fill="${DARK}" font-family="Georgia, serif">layers run across the relief; overhangs need supports (gold)</text>
  <text x="500" y="880" font-size="36" text-anchor="middle" fill="${DARK}" font-family="Georgia, serif">supports scar the face they touch; slower; larger footprint on the bed</text>
  <text x="500" y="960" font-size="40" text-anchor="middle" fill="${BRONZE}" font-family="Georgia, serif" font-weight="bold">only for lithophanes and very tall reliefs</text>
</g>
<text x="1200" y="1420" font-size="46" text-anchor="middle" fill="${INK}" font-family="Georgia, serif" font-weight="bold">Relief plaques print flat, carved face up, no supports, fine layers.</text>
<text x="1200" y="1500" font-size="38" text-anchor="middle" fill="${DARK}" font-family="Georgia, serif">The flat back becomes the first layer and the bed makes it perfectly smooth.</text>
<text x="1200" y="1700" font-size="30" text-anchor="middle" fill="#8a7a68" font-family="Georgia, serif">DigitalChiselCo · 3D printing a bas-relief STL</text>
</svg>`;
await sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toFile(path.join(DIR, 'orientation.jpg'));
console.log('orientation diagram →', path.join(DIR, 'orientation.jpg'));
