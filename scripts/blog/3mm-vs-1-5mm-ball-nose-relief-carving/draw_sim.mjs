// DRAWN diagrams for the 3 mm vs 1.5 mm guide, from the real dragon STL and the
// same engine as /tools/will-it-cut (fixed 2026-09-28, see test_engine.mjs).
// Nothing here is generated art: every pixel is a height the engine computed.
//   node --import tsx draw_sim.mjs preview          full top view, to pick the crop
//   node --import tsx draw_sim.mjs reach X Y S      head crop at (X,Y) mm, S mm square
import fs from 'node:fs';
import sharp from 'sharp';
import { parseSTL, analyse, _closeWithTool } from '../../../src/lib/stl-analyse.ts';
import { restZone, VIS, MIN_MM2 } from './restzone.mjs';

const HERE = new URL('.', import.meta.url);
const OUT = 'D:/000 DIGITAL CHISEL WEBSITE/.mockups/blog-3mm-vs-1-5mm-ball-nose-relief-carving/';
const STL = 'D:/BUNDLES/bass-fishing-largemouth-bass-leaping-with-lure-l/132/Coiled Medieval Dragon Medallion CNC Relief STL.stl';
const SIZE = 300;

function scaleTo(pos, longSide) {
  let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;
  for (let i = 0; i < pos.length; i += 3) { mnx = Math.min(mnx, pos[i]); mxx = Math.max(mxx, pos[i]); mny = Math.min(mny, pos[i + 1]); mxy = Math.max(mxy, pos[i + 1]); }
  const k = longSide / Math.max(mxx - mnx, mxy - mny);
  const out = new Float32Array(pos.length); for (let i = 0; i < pos.length; i++) out[i] = pos[i] * k; return out;
}

// Warm clay hillshade: light from the upper left, low, like the photographs.
function shade(z, w, h, cell, { flipY = true } = {}) {
  // Light from the UPPER LEFT of the finished picture. The grid's +Y is up in
  // the picture (rows are flipped on output), so the light points to -X, +Y.
  // Owner, 2026-09-28: the first render was lit from below and read "inverse".
  const alt = (38 * Math.PI) / 180, c = Math.cos(alt) / Math.SQRT2;
  const L = [-c, c, Math.sin(alt)];
  const img = Buffer.alloc(w * h * 3);
  const at = (x, y) => { const v = z[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))]; return Number.isNaN(v) ? 0 : v; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dzdx = (at(x + 1, y) - at(x - 1, y)) / (2 * cell), dzdy = (at(x, y + 1) - at(x, y - 1)) / (2 * cell);
    // grid y grows with model +Y; the image is drawn with +Y up
    const n = [-dzdx, -dzdy, 1], nl = Math.hypot(...n);
    let s = Math.max(0, (n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) / nl);
    s = 0.18 + 0.82 * s;
    const oy = flipY ? h - 1 - y : y, o = (oy * w + x) * 3;
    const empty = Number.isNaN(z[y * w + x]);
    img[o] = empty ? 244 : Math.min(255, 70 + 185 * s);
    img[o + 1] = empty ? 240 : Math.min(255, 48 + 150 * s);
    img[o + 2] = empty ? 232 : Math.min(255, 30 + 105 * s);
  }
  return img;
}

const raw = parseSTL(fs.readFileSync(STL).buffer.slice(0));
const a = analyse(scaleTo(raw, SIZE), undefined, { target: 1800 });
const { w, h, cell } = a.grid;
console.log(`grid ${w} x ${h}, cell ${cell.toFixed(3)} mm, size ${a.size.x.toFixed(0)} x ${a.size.y.toFixed(0)} mm`);

const mode = process.argv[2];
if (mode === 'preview') {
  const img = shade(a.height, w, h, cell);
  await sharp(img, { raw: { width: w, height: h, channels: 3 } }).resize(900).jpeg({ quality: 85 }).toFile(OUT + 'sim_preview.jpg');
  console.log('wrote sim_preview.jpg (x right, y up, mm from the lower-left corner = pixel * ' + (w / 900 * cell).toFixed(3) + ')');
}

if (mode === 'reach') {
  // crop centre (mm from the lower-left of the panel) and side, from sim_preview.jpg
  const [cxMm, cyMm, side] = process.argv.slice(3).map(Number);
  const pad = Math.ceil(3.5 / cell);                  // room for the biggest ball
  const n = Math.round(side / cell);
  const x0 = Math.round(cxMm / cell - n / 2) - pad, y0 = Math.round(cyMm / cell - n / 2) - pad, N = n + 2 * pad;
  const src = new Float32Array(N * N);
  let floor = Infinity;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const gx = x0 + x, gy = y0 + y;
    const v = gx >= 0 && gy >= 0 && gx < w && gy < h ? a.height[gy * w + gx] : NaN;
    src[y * N + x] = v; if (!Number.isNaN(v) && v < floor) floor = v;
  }
  const inner = (z) => { const o = new Float32Array(n * n); for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) o[y * n + x] = z[(y + pad) * N + x + pad]; return o; };
  const panels = [{ label: 'The model', sub: 'what the design asks for', z: inner(src) }];
  const stats = {};
  for (const dia of [6, 3, 1.5]) {
    const t0 = Date.now();
    const closed = _closeWithTool(src, N, N, (dia / 2) / cell, 'ball', floor, cell);
    const z = inner(closed), m = inner(src);
    const loss = []; let vis = 0, cnt = 0;
    for (let i = 0; i < z.length; i++) { if (Number.isNaN(m[i])) continue; const d = Math.max(0, z[i] - m[i]); loss.push(d); cnt++; if (d > 0.25) vis++; }
    loss.sort((p, q) => p - q);
    const p99 = loss[Math.floor(loss.length * 0.99)];
    stats[dia] = { p99: +p99.toFixed(2), visiblePct: +(100 * vis / cnt).toFixed(1) };
    panels.push({ label: `${dia} mm ball nose`, sub: `misses up to ${p99.toFixed(1)} mm · ${stats[dia].visiblePct}% of this area`, z });
    console.log(`${dia} mm: ${(Date.now() - t0) / 1000}s, p99 loss ${p99.toFixed(2)} mm, visible on ${stats[dia].visiblePct}%`);
  }
  // 2 x 2 grid with labels, drawn as SVG over the shaded tiles
  const T = 640, G = 36, TOP = 92, W2 = 2 * T + 3 * G, H2 = 2 * (T + TOP) + 2 * G + 70;
  const tiles = [];
  for (let i = 0; i < 4; i++) {
    const img = shade(panels[i].z, n, n, cell);
    const buf = await sharp(img, { raw: { width: n, height: n, channels: 3 } }).resize(T, T).png().toBuffer();
    tiles.push({ input: buf, left: G + (i % 2) * (T + G), top: G + Math.floor(i / 2) * (T + TOP + G) + TOP });
  }
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const txt = panels.map((p, i) => {
    const x = G + (i % 2) * (T + G), y = G + Math.floor(i / 2) * (T + TOP + G);
    return `<text x="${x}" y="${y + 40}" font-family="Georgia, serif" font-size="36" fill="#3b2412">${esc(p.label)}</text>
            <text x="${x}" y="${y + 74}" font-family="Arial, sans-serif" font-size="23" fill="#7a5a3a">${esc(p.sub)}</text>`;
  }).join('\n');
  const foot = `<text x="${G}" y="${H2 - 26}" font-family="Arial, sans-serif" font-size="21" fill="#8a7560">Simulated from the real STL of the Coiled Dragon Medallion at 300 mm, the dragon's head (${side} mm square). DigitalChiselCo Will it cut? engine.</text>`;
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W2}" height="${H2}"><rect width="100%" height="100%" fill="#faf6ef"/>${txt}${foot}</svg>`);
  await sharp(svg).composite(tiles).jpeg({ quality: 88 }).toFile(OUT + 'reach.jpg');
  fs.writeFileSync(new URL('./reach_stats.json', HERE), JSON.stringify({ cxMm, cyMm, side, cell, stats }, null, 1));
  console.log('wrote reach.jpg');
}

if (mode === 'restmap') {
  // Where the 3 mm leaves visible loss, and the rest-machining boundary a
  // carver would draw around it (CLEAR mm of clearance), over the whole panel.
  const { DW, DH, dc, vis, zone, visiblePct, zonePct: zp } = restZone(a);
  let nVis = 0, nZone = 0; for (let q = 0; q < vis.length; q++) { nVis += vis[q]; nZone += zone[q]; }
  const k = w / DW;
  // ONE hand-drawn vector around the head (ellipse, mm from the lower-left)
  const HEAD = { cx: 100, cy: 232, rx: 48, ry: 36 };
  const inHead = (x, y) => { const mx = x * dc, my = y * dc; return ((mx - HEAD.cx) / HEAD.rx) ** 2 + ((my - HEAD.cy) / HEAD.ry) ** 2 <= 1; };
  let nHead = 0, visInHead = 0;
  for (let y = 0; y < DH; y++) for (let x = 0; x < DW; x++) if (inHead(x, y)) { nHead++; if (vis[y * DW + x]) visInHead++; }
  const total = DW * DH;
  // the shaded panel at display size
  const small = new Float32Array(DW * DH);
  for (let y = 0; y < DH; y++) for (let x = 0; x < DW; x++) small[y * DW + x] = a.height[Math.min(h - 1, Math.floor(y * k)) * w + Math.min(w - 1, Math.floor(x * k))];
  const img = shade(small, DW, DH, dc);
  for (let y = 0; y < DH; y++) for (let x = 0; x < DW; x++) {
    const src = y * DW + x, o = ((DH - 1 - y) * DW + x) * 3;
    if (zone[src]) { img[o] = 205; img[o + 1] = 45; img[o + 2] = 35; continue; }
    // head vector: a 4 px line, dashed every 14 px along the angle
    const mx = x * dc, my = y * dc, e = ((mx - HEAD.cx) / HEAD.rx) ** 2 + ((my - HEAD.cy) / HEAD.ry) ** 2;
    const band = 4 * dc / Math.min(HEAD.rx, HEAD.ry);
    if (Math.abs(e - 1) < band) { const ang = Math.atan2((my - HEAD.cy) / HEAD.ry, (mx - HEAD.cx) / HEAD.rx); if (Math.floor((ang + Math.PI) * Math.min(HEAD.rx, HEAD.ry) / (14 * dc)) % 2 === 0) { img[o] = 18; img[o + 1] = 110; img[o + 2] = 160; } }
  }
  const visPct = 100 * nVis / total, zonePct = 100 * nZone / total, headPct = 100 * nHead / total, headShare = 100 * visInHead / Math.max(1, nVis);
  const panel = await sharp(img, { raw: { width: DW, height: DH, channels: 3 } }).png().toBuffer();
  const M = 40, TOP = 170, BOT = 90, WW = DW + 2 * M, HH = DH + TOP + BOT;
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${WW}" height="${HH}"><rect width="100%" height="100%" fill="#faf6ef"/>
    <text x="${M}" y="56" font-family="Georgia, serif" font-size="40" fill="#3b2412">Where the 1.5 mm bit is actually needed</text>
    <rect x="${M}" y="86" width="26" height="26" fill="rgb(205,45,35)"/><text x="${M + 38}" y="107" font-family="Arial, sans-serif" font-size="23" fill="#4a3322">Automatic rest machining cuts only here: ${zonePct.toFixed(1)}% of the panel (Aspire, VCarve Pro, Fusion)</text>
    <line x1="${M}" y1="140" x2="${M + 26}" y2="140" stroke="rgb(18,110,160)" stroke-width="5" stroke-dasharray="7 5"/><text x="${M + 38}" y="148" font-family="Arial, sans-serif" font-size="23" fill="#4a3322">Or one vector around the head: ${headPct.toFixed(1)}% of the panel, ${headShare.toFixed(0)}% of the misses (Carveco, Carbide Create)</text>
    <text x="${M}" y="${HH - 34}" font-family="Arial, sans-serif" font-size="21" fill="#8a7560">Red: where a 3 mm ball leaves more than 0.25 mm. Coiled Dragon Medallion, 300 mm, from its real STL.</text></svg>`);
  await sharp(svg).composite([{ input: panel, left: M, top: TOP }]).jpeg({ quality: 88 }).toFile(OUT + 'restmap.jpg');
  const out = { visibleLossPct: +visPct.toFixed(2), autoRestZonePct: +zonePct.toFixed(2), headVectorPct: +headPct.toFixed(2), headVectorCatchesPctOfMisses: +headShare.toFixed(1), thresholdMm: VIS, minSpeckMm2: MIN_MM2 };
  fs.writeFileSync(new URL('./restmap_stats.json', HERE), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out));
}
