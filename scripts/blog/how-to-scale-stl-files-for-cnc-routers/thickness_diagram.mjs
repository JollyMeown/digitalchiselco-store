// The "floor" figure for the scaling guide, drawn rather than rendered.
//
// Two photographic attempts failed: a caliper Gemini would not clamp on the
// board, then a sawn-through panel that read as damage (owner, 2026-09-05).
// A dimensioned drawing says exactly what the section says, with numbers that
// are ours. Brand colours, no invented objects.
//
//   node scripts/blog/how-to-scale-stl-files-for-cnc-routers/thickness_diagram.mjs
import sharp from 'sharp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', '..', '..', '.mockups', 'blog-how-to-scale-stl-files-for-cnc-routers', 'thickness.jpg');
const W = 2400, H = 1800;
const CREAM = '#FAEEDA', BRONZE = '#854F0B', DARK = '#633806', INK = '#412402', WOOD = '#D9A86C';

// Board: 25 mm tall drawn at 20 px per mm (500 px), 1400 px wide, origin (500, 520).
// Relief profile: deepest point 12 mm = 240 px below the top face.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="${CREAM}"/>
<defs>
  <pattern id="g" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M0 24 L24 0" stroke="#e9d9bf" stroke-width="1"/></pattern>
  <marker id="a" markerWidth="12" markerHeight="12" refX="6" refY="6" orient="auto-start-reverse"><path d="M0 1 L11 6 L0 11 z" fill="${BRONZE}"/></marker>
</defs>
<g transform="translate(500,520)">
  <rect x="0" y="0" width="1400" height="500" fill="${WOOD}" stroke="${DARK}" stroke-width="6"/>
  <rect x="0" y="0" width="1400" height="500" fill="url(#g)"/>
  <rect x="0" y="240" width="1400" height="260" fill="#C98F4E" opacity="0.35"/>
  <path d="M0 0 L180 0 C260 0 290 150 360 160 C430 170 450 40 520 30 C600 20 620 90 700 100 C780 110 800 230 880 240 C960 250 980 120 1060 110 C1130 100 1150 190 1220 200 C1280 208 1310 30 1400 0 L0 0 Z" fill="${CREAM}" stroke="${DARK}" stroke-width="6"/>
</g>
<g stroke="${BRONZE}" stroke-width="5" fill="none">
  <line x1="2000" y1="520" x2="2000" y2="1020" marker-start="url(#a)" marker-end="url(#a)"/>
  <line x1="1905" y1="520" x2="2040" y2="520"/><line x1="1905" y1="1020" x2="2040" y2="1020"/>
  <line x1="400" y1="520" x2="400" y2="760" marker-start="url(#a)" marker-end="url(#a)"/>
  <line x1="400" y1="760" x2="400" y2="1020" marker-start="url(#a)" marker-end="url(#a)"/>
  <line x1="360" y1="520" x2="495" y2="520"/><line x1="360" y1="1020" x2="495" y2="1020"/>
  <line x1="360" y1="760" x2="1380" y2="760" stroke-dasharray="18 14" stroke-width="3"/>
</g>
<g font-family="Georgia, 'Times New Roman', serif" fill="${INK}">
  <text x="1200" y="420" font-size="64" text-anchor="middle" font-weight="bold">The board, edge-on</text>
  <text x="2080" y="785" font-size="54" font-weight="bold">25 mm</text>
  <text x="2080" y="845" font-size="36" fill="${DARK}">board, 1 inch stock</text>
  <text x="60" y="630" font-size="54" font-weight="bold">12 mm</text>
  <text x="60" y="690" font-size="36" fill="${DARK}">relief depth</text>
  <text x="60" y="880" font-size="54" font-weight="bold">13 mm</text>
  <text x="60" y="940" font-size="36" fill="${DARK}">floor, never under 8</text>
  <text x="1200" y="1110" font-size="40" text-anchor="middle" fill="${DARK}">carved surface on top, uncarved floor beneath the deepest cut</text>
  <text x="1200" y="1300" font-size="44" text-anchor="middle" font-weight="bold">Floor rule: board thickness minus relief depth must be 8 mm or more</text>
  <text x="1200" y="1380" font-size="40" text-anchor="middle" fill="${DARK}">3/4 inch (19 mm) board holds up to 11 mm of relief</text>
  <text x="1200" y="1440" font-size="40" text-anchor="middle" fill="${DARK}">1 inch (25 mm) board holds up to 17 mm of relief</text>
  <text x="1200" y="1500" font-size="40" text-anchor="middle" fill="${DARK}">trays with pockets: 30 mm or more</text>
  <text x="1200" y="1700" font-size="30" text-anchor="middle" fill="#8a7a68">DigitalChiselCo · how to scale STL files for CNC routers</text>
</g>
</svg>`;

await sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toFile(OUT);
console.log('diagram →', OUT);
