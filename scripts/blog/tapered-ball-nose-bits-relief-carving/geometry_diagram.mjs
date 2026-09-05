// Tapered ball nose geometry, drawn: tip diameter, taper angle, cutting length,
// shank, and the wall-angle limit. Numbers are ours, nothing is invented.
//   node scripts/blog/tapered-ball-nose-bits-relief-carving/geometry_diagram.mjs
import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(HERE, '..', '..', '..', '.mockups', 'blog-tapered-ball-nose-bits-relief-carving');
fs.mkdirSync(DIR, { recursive: true });
const W = 2400, H = 1800;
const CREAM = '#FAEEDA', BRONZE = '#854F0B', DARK = '#633806', INK = '#412402', STEEL = '#B8B4AC', STEEL_D = '#7d7973';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="${CREAM}"/>
<defs><marker id="a" markerWidth="12" markerHeight="12" refX="6" refY="6" orient="auto-start-reverse"><path d="M0 1 L11 6 L0 11 z" fill="${BRONZE}"/></marker></defs>
<g font-family="Georgia, 'Times New Roman', serif" fill="${INK}">
  <text x="700" y="160" font-size="60" text-anchor="middle" font-weight="bold">Tapered ball nose</text>
  <text x="1750" y="160" font-size="60" text-anchor="middle" font-weight="bold">Straight ball nose</text>
</g>
<!-- tapered: shank 1/4in (drawn 240 wide) then cone to tip ball -->
<g transform="translate(700,240)">
  <rect x="-120" y="0" width="240" height="420" fill="${STEEL}" stroke="${STEEL_D}" stroke-width="5"/>
  <path d="M-120 420 L-14 1180 A14 14 0 0 0 14 1180 L120 420 Z" fill="${STEEL}" stroke="${STEEL_D}" stroke-width="5"/>
  <circle cx="0" cy="1180" r="14" fill="${STEEL}" stroke="${STEEL_D}" stroke-width="5"/>
</g>
<!-- straight: same shank, thin 1/32in rod (drawn 28 wide) -->
<g transform="translate(1750,240)">
  <rect x="-120" y="0" width="240" height="420" fill="${STEEL}" stroke="${STEEL_D}" stroke-width="5"/>
  <rect x="-14" y="420" width="28" height="760" fill="${STEEL}" stroke="${STEEL_D}" stroke-width="5"/>
  <circle cx="0" cy="1180" r="14" fill="${STEEL}" stroke="${STEEL_D}" stroke-width="5"/>
  <!-- crack -->
  <path d="M-14 760 L-4 772 L-12 784 L2 796 L-8 808 L14 820" fill="none" stroke="#b03a2e" stroke-width="6"/>
</g>
<!-- dimensions on tapered -->
<g stroke="${BRONZE}" stroke-width="5" fill="none">
  <line x1="1000" y1="240" x2="1000" y2="660" marker-start="url(#a)" marker-end="url(#a)"/>
  <line x1="1000" y1="660" x2="1000" y2="1420" marker-start="url(#a)" marker-end="url(#a)"/>
  <line x1="960" y1="660" x2="1040" y2="660"/><line x1="960" y1="1420" x2="1040" y2="1420"/>
  <line x1="380" y1="1440" x2="1020" y2="1440" marker-start="url(#a)" marker-end="url(#a)"/>
  <line x1="686" y1="1520" x2="714" y2="1520" marker-start="url(#a)" marker-end="url(#a)"/>
  <path d="M700 660 L700 1180" stroke-dasharray="14 12" stroke-width="3"/>
  <path d="M700 900 A240 240 0 0 0 646 1130" stroke-width="3"/>
</g>
<g font-family="Georgia, 'Times New Roman', serif" fill="${INK}">
  <text x="1040" y="460" font-size="40" fill="${DARK}">shank, 1/4 inch</text>
  <text x="1040" y="1040" font-size="40" fill="${DARK}">cutting length, 25 to 40 mm</text>
  <text x="560" y="1230" font-size="40" fill="${DARK}">taper angle</text>
  <text x="560" y="1280" font-size="40" fill="${DARK}">5 to 7 degrees per side</text>
  <text x="700" y="1600" font-size="40" text-anchor="middle" fill="${DARK}">tip diameter: 1/16 inch, 1/32 inch, 1 mm, 0.5 mm</text>
  <text x="1750" y="1600" font-size="40" text-anchor="middle" fill="${DARK}">same tip, no support behind it</text>
  <text x="1750" y="1650" font-size="36" text-anchor="middle" fill="#8a3a2e">snaps under side load at depth</text>
  <text x="1200" y="1740" font-size="34" text-anchor="middle" fill="#8a7a68">A tapered cutter cannot follow a wall steeper than 90 degrees minus its taper angle; the roughing pass cuts those first.</text>
</g>
</svg>`;
await sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toFile(path.join(DIR, 'geometry.jpg'));
console.log('geometry diagram →', path.join(DIR, 'geometry.jpg'));
