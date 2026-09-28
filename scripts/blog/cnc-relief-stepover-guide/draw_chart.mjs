// Diagram 3: finishing time against ridge height for three ball sizes, from
// results.json (300 mm bass). Palette validated with the dataviz checker on
// #faf6ef: rust #a0521d (1.5 mm), teal #0a8bb0 (3 mm), olive #6f8a1a (6 mm).
// Every series direct-labelled; stars mark each bit's fastest stepover whose
// ridges 220 grit still removes (<= 0.05 mm).
import fs from 'node:fs';
import sharp from 'sharp';
const OUT = 'D:/000 DIGITAL CHISEL WEBSITE/.mockups/blog-cnc-relief-stepover-guide/timeridge.jpg';
const R = JSON.parse(fs.readFileSync(new URL('./results.json', import.meta.url)));
const rows = R.sizes['300'].rows.filter((r) => r.so >= 8);
const SER = [{ dia: 1.5, c: '#a0521d' }, { dia: 3, c: '#0a8bb0' }, { dia: 6, c: '#6f8a1a' }];
const W = 1600, H = 1080, X0 = 170, X1 = 1250, Y0 = 930, Y1 = 250, XMAX = 14, YMAX = 0.14, SAND = 0.05;
const xs = (h) => X0 + (h / XMAX) * (X1 - X0), ys = (z) => Y0 - (z / YMAX) * (Y0 - Y1);
const INK = '#2e1d10', INK2 = '#6d5540', MUTED = '#9c8670';
let g = '';
// sanding band
g += `<rect x="${X0}" y="${ys(SAND)}" width="${X1 - X0}" height="${Y0 - ys(SAND)}" fill="#e9dcc6" fill-opacity=".55"/>`;
g += `<line x1="${X0}" y1="${ys(SAND)}" x2="${X1}" y2="${ys(SAND)}" stroke="${INK2}" stroke-width="2" stroke-dasharray="9 7"/>`;
g += `<text x="${X1 - 12}" y="${ys(SAND) + 32}" text-anchor="end" font-family="Arial, sans-serif" font-size="22" fill="${INK2}">below this line, 220 grit takes the ridges off</text>`;
// grid + axes
for (let t = 0; t <= XMAX; t += 2) { g += `<line x1="${xs(t)}" y1="${Y1}" x2="${xs(t)}" y2="${Y0}" stroke="#e6dccb" stroke-width="1"/><text x="${xs(t)}" y="${Y0 + 36}" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" fill="${MUTED}">${t} h</text>`; }
for (let z = 0; z <= YMAX + 1e-9; z += 0.02) { g += `<line x1="${X0}" y1="${ys(z)}" x2="${X1}" y2="${ys(z)}" stroke="#e6dccb" stroke-width="1"/><text x="${X0 - 14}" y="${ys(z) + 7}" text-anchor="end" font-family="Arial, sans-serif" font-size="22" fill="${MUTED}">${z.toFixed(2)}</text>`; }
g += `<text x="${(X0 + X1) / 2}" y="${Y0 + 80}" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" fill="${INK2}">Finishing time, 300 mm panel (hours)</text>`;
g += `<text transform="translate(52 ${(Y0 + Y1) / 2}) rotate(-90)" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" fill="${INK2}">Ridge height left (mm)</text>`;
const stars = [];
for (const sr of SER) {
  const pts = rows.filter((r) => r.dia === sr.dia && r.scallopMm <= YMAX).sort((a, b) => b.finishH - a.finishH);
  g += `<polyline points="${pts.map((p) => `${xs(p.finishH)},${ys(p.scallopMm)}`).join(' ')}" fill="none" stroke="${sr.c}" stroke-width="3" stroke-linejoin="round"/>`;
  for (const p of pts) {
    g += `<circle cx="${xs(p.finishH)}" cy="${ys(p.scallopMm)}" r="9" fill="${sr.c}" stroke="#faf6ef" stroke-width="2.5"/>`;
    const below = sr.dia === 3;   // the 3 mm labels sit under their dots, clear of the 1.5 mm line
    if ([10, 25, 40, 8].includes(p.so) || (sr.dia === 6 && p.so === 30)) g += `<text x="${xs(p.finishH) + 13}" y="${ys(p.scallopMm) + (below ? 30 : -12)}" font-family="Arial, sans-serif" font-size="19" fill="${INK2}">${p.so}%</text>`;
  }
  const best = pts.filter((p) => p.scallopMm <= SAND).sort((a, b) => a.finishH - b.finishH)[0];
  stars.push({ ...best, c: sr.c });
  const last = pts[pts.length - 1];
  g += `<text x="${xs(last.finishH) + 16}" y="${ys(last.scallopMm) + 8}" font-family="Arial, sans-serif" font-size="25" font-weight="bold" fill="${INK}">${sr.dia} mm</text>`;
}
const star = (x, y, r, c) => { let d = ''; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; d += `${i ? 'L' : 'M'}${(x + rr * Math.cos(a)).toFixed(1)},${(y + rr * Math.sin(a)).toFixed(1)}`; } return `<path d="${d}Z" fill="${c}" stroke="${INK}" stroke-width="2"/>`; };
for (const s of stars) g += star(xs(s.finishH), ys(s.scallopMm), 20, s.c);
// side panel: the three fastest sand-free settings
let panel = `<text x="1290" y="300" font-family="Georgia, serif" font-size="28" fill="${INK}">Fastest setting that</text><text x="1290" y="334" font-family="Georgia, serif" font-size="28" fill="${INK}">still sands off</text>`;
stars.forEach((s, i) => {
  const y = 400 + i * 118;
  panel += star(1308, y - 8, 16, s.c);
  panel += `<text x="1336" y="${y}" font-family="Arial, sans-serif" font-size="25" font-weight="bold" fill="${INK}">${s.dia} mm at ${s.so}%</text>`;
  panel += `<text x="1336" y="${y + 32}" font-family="Arial, sans-serif" font-size="22" fill="${INK2}">${s.finishH.toFixed(1)} h · ${s.scallopMm.toFixed(3)} mm</text>`;
});
panel += `<text x="1290" y="770" font-family="Arial, sans-serif" font-size="20" fill="${INK2}">A bigger ball is faster</text><text x="1290" y="798" font-family="Arial, sans-serif" font-size="20" fill="${INK2}">for the same ridges, but</text><text x="1290" y="826" font-family="Arial, sans-serif" font-size="20" fill="${INK2}">it cannot reach fine detail.</text>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbf7f0"/><stop offset="1" stop-color="#f4ece0"/></linearGradient></defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <text x="70" y="92" font-family="Georgia, serif" font-size="52" fill="${INK}">Stepover buys time with ridges</text>
  <text x="70" y="138" font-family="Arial, sans-serif" font-size="24" fill="${INK2}">Each dot is one stepover for one ball size, on the leaping bass at 300 mm. Further left is faster, higher is rougher.</text>
  <text x="70" y="172" font-family="Arial, sans-serif" font-size="24" fill="${INK2}">Stars: the fastest stepover whose ridges 220 grit still removes.</text>
  ${g}${panel}
  <text x="70" y="${H - 30}" font-family="Arial, sans-serif" font-size="20" fill="${MUTED}">Ridge heights are exact geometry; times from the DigitalChiselCo Will it cut? model for a mid-size hobby CNC. Estimates, not stopwatch times.</text>
</svg>`;
await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toFile(OUT);
console.log('wrote timeridge.jpg', stars.map((s) => `${s.dia}@${s.so}% ${s.finishH}h ${s.scallopMm}`).join(' | '));
