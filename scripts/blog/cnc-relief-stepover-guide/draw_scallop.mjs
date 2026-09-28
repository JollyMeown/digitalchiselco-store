// Diagram 1: how a ball nose leaves ridges. Passes at true geometry; one ridge
// per row magnified in a lens at the SAME vertical factor in both rows, so the
// 10% and 25% ridges compare honestly against the same 220-grit line.
// h = r - sqrt(r^2 - (s/2)^2). Colours: rust #a0521d cutter, teal #0a8bb0
// dimensions (validated pair), warm wood.
import sharp from 'sharp';

const OUT = 'D:/000 DIGITAL CHISEL WEBSITE/.mockups/blog-cnc-relief-stepover-guide/scallop.jpg';
const W = 1600, H = 1290, INK = '#2e1d10', INK2 = '#6d5540', RUST = '#a0521d', TEAL = '#0a8bb0';
const R_MM = 1.5, SAND = 0.05, PX = 70, LR = 175, ZV = 3200, ZH = 160;   // px per mm: main drawing; lens radius; lens vertical px per mm
const hOf = (s) => R_MM - Math.sqrt(R_MM ** 2 - (s / 2) ** 2);

function row(y0, pct) {
  const s = 3 * pct / 100, h = hOf(s), R = R_MM * PX, sp = s * PX;
  const x0 = 110, x1 = 830, surfY = y0 + 320;
  const n = Math.ceil((x1 - x0) / sp) + 2, centres = Array.from({ length: n }, (_, i) => x0 + i * sp - sp / 2);
  const zAt = (xmm, cs) => { let z = Infinity; for (const c of cs) { const d = xmm - c; if (Math.abs(d) <= R_MM) z = Math.min(z, R_MM - Math.sqrt(R_MM ** 2 - d * d)); } return z; };
  const cmm = centres.map((c) => c / PX);
  let top = ''; for (let x = x0; x <= x1; x++) top += `${x},${(surfY - zAt(x / PX, cmm) * PX).toFixed(2)} `;
  let g = `<text x="${x0}" y="${y0 + 32}" font-family="Georgia, serif" font-size="34" fill="${INK}">3 mm ball nose at ${pct}% stepover</text>`;
  g += `<polygon points="${x0},${surfY + 120} ${top}${x1},${surfY + 120}" fill="url(#wood)"/>`;
  for (let k = 0; k < 5; k++) { let d = `M ${x0} ${surfY + 20 + k * 22}`; for (let x = x0; x <= x1; x += 20) d += ` L ${x} ${(surfY + 20 + k * 22 + 5 * Math.sin(x / 55 + k * 1.3)).toFixed(1)}`; g += `<path d="${d}" stroke="#8a5a30" stroke-opacity=".22" stroke-width="2" fill="none"/>`; }
  const mid = centres.reduce((b, c) => (Math.abs(c - 470) < Math.abs(b - 470) ? c : b), centres[0]);
  for (const c of [mid - sp, mid, mid + sp]) g += `<circle cx="${c}" cy="${surfY - R}" r="${R}" fill="${RUST}" fill-opacity=".05" stroke="${RUST}" stroke-width="2.5" stroke-opacity=".7"/>`;
  const dy = surfY - 2 * R - 20;
  g += `<line x1="${mid}" y1="${dy}" x2="${mid + sp}" y2="${dy}" stroke="${TEAL}" stroke-width="3" marker-start="url(#a)" marker-end="url(#a)"/>`;
  g += `<text x="${mid + sp + 16}" y="${dy + 8}" font-family="Arial, sans-serif" font-size="23" font-weight="bold" fill="${TEAL}">stepover s = ${s.toFixed(2)} mm</text>`;
  // lens
  const rx = mid + sp / 2, cx = 1110, cy = y0 + 215;
  g += `<circle cx="${rx}" cy="${surfY}" r="11" fill="none" stroke="${INK2}" stroke-width="2"/>`;
  g += `<line x1="${rx + 11}" y1="${surfY - 3}" x2="${cx - LR}" y2="${cy}" stroke="${INK2}" stroke-width="1.5" stroke-dasharray="4 5"/>`;
  const zh = ZH;                                           // lens horizontal px per mm, the same in both rows
  const ridgeTopY = cy - 70, L = (xmm, zmm) => [cx + (xmm - rx / PX) * zh, ridgeTopY + (h - zmm) * ZV];
  let lp = ''; for (let xm = rx / PX - (LR + 10) / zh; xm <= rx / PX + (LR + 10) / zh; xm += 1 / (zh * 2)) { const [lx, ly] = L(xm, zAt(xm, cmm)); lp += `${lx.toFixed(1)},${ly.toFixed(1)} `; }
  const sandY = ridgeTopY + SAND * ZV, valleyY = ridgeTopY + h * ZV;
  g += `<clipPath id="c${pct}"><circle cx="${cx}" cy="${cy}" r="${LR}"/></clipPath><g clip-path="url(#c${pct})">`;
  g += `<rect x="${cx - LR}" y="${cy - LR}" width="${2 * LR}" height="${2 * LR}" fill="#fffdf8"/>`;
  g += `<polygon points="${cx - LR - 5},${cy + LR + 5} ${lp}${cx + LR + 5},${cy + LR + 5}" fill="url(#wood)"/>`;
  g += `<line x1="${cx - LR}" y1="${sandY}" x2="${cx + LR}" y2="${sandY}" stroke="${INK}" stroke-width="2.5" stroke-dasharray="10 7"/></g>`;
  g += `<circle cx="${cx}" cy="${cy}" r="${LR}" fill="none" stroke="${INK2}" stroke-width="5"/>`;
  g += `<line x1="${cx + LR + 26}" y1="${ridgeTopY}" x2="${cx + LR + 26}" y2="${valleyY}" stroke="${TEAL}" stroke-width="3" ${h * ZV > 18 ? 'marker-start="url(#a)" marker-end="url(#a)"' : ''}/>`;
  g += `<line x1="${cx + 40}" y1="${ridgeTopY}" x2="${cx + LR + 34}" y2="${ridgeTopY}" stroke="${TEAL}" stroke-width="1.5"/><line x1="${cx + 40}" y1="${valleyY}" x2="${cx + LR + 34}" y2="${valleyY}" stroke="${TEAL}" stroke-width="1.5"/>`;
  g += `<text x="${cx + LR + 40}" y="${(ridgeTopY + valleyY) / 2 + 8}" font-family="Arial, sans-serif" font-size="23" font-weight="bold" fill="${TEAL}">ridge ${h.toFixed(h < 0.01 ? 4 : 3)} mm</text>`;
  g += `<text x="${cx + LR + 40}" y="${sandY + 8}" font-family="Arial, sans-serif" font-size="19" fill="${INK}">220 grit: ~0.05 mm</text>`;
  return g;
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbf7f0"/><stop offset="1" stop-color="#f4ece0"/></linearGradient>
    <linearGradient id="wood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e7c79b"/><stop offset=".5" stop-color="#d8ad78"/><stop offset="1" stop-color="#c49361"/></linearGradient>
    <marker id="a" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,1 L9,5 L0,9 z" fill="${TEAL}"/></marker>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <text x="70" y="88" font-family="Georgia, serif" font-size="52" fill="${INK}">How a ball nose leaves ridges</text>
  <text x="70" y="132" font-family="Arial, sans-serif" font-size="24" fill="${INK2}">Each pass of the round tip cuts a shallow groove, and a ridge is left where two grooves meet.</text>
  <text x="70" y="164" font-family="Arial, sans-serif" font-size="24" fill="${INK2}">The gap between passes is the stepover. Double it and the ridge gets about four times taller.</text>
  ${row(190, 10)}${row(700, 25)}
  <text x="70" y="${H - 58}" font-family="Arial, sans-serif" font-size="20" fill="#8a7560">Passes drawn to true scale. Inside the lenses: ${ZH}x wider and ${ZV.toLocaleString('en-US')}x taller than life, the same in both rows, so the two ridges compare honestly.</text>
  <text x="70" y="${H - 28}" font-family="Arial, sans-serif" font-size="20" fill="#8a7560">Ridge height h = r - &#8730;(r&#178; - (s/2)&#178;) for a ball of radius r at stepover s.</text>
</svg>`;
await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toFile(OUT);
console.log('wrote scallop.jpg', hOf(0.3), hOf(0.75));
