// Diagram 2 source renders: a patch of the real leaping-bass STL at 300 mm,
// finished with a 3 mm ball at several stepovers. Reach from the engine's
// fixed ball closing (cell 0.167 mm); the pass ridges added analytically at
// fine resolution: z += r - sqrt(r^2 - d^2), d = distance to the nearest pass
// centre (passes run along X, stepping in Y). Exact on flats, close on slopes.
//   node --import tsx draw_surface.mjs preview
//   node --import tsx draw_surface.mjs patch X Y SIDE     (mm from the lower-left)
import fs from 'node:fs';
import sharp from 'sharp';
import { parseSTL, analyse, _closeWithTool } from '../../../src/lib/stl-analyse.ts';

const OUT = 'D:/000 DIGITAL CHISEL WEBSITE/.mockups/blog-cnc-relief-stepover-guide/';
const STL = 'D:/BUNDLES/bass-fishing-largemouth-bass-leaping-with-lure-l/1/Leaping Largemouth Bass Fishing CNC Relief STL.stl';
const raw = parseSTL(fs.readFileSync(STL).buffer.slice(0));
let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;
for (let i = 0; i < raw.length; i += 3) { mnx = Math.min(mnx, raw[i]); mxx = Math.max(mxx, raw[i]); mny = Math.min(mny, raw[i + 1]); mxy = Math.max(mxy, raw[i + 1]); }
const k = 300 / Math.max(mxx - mnx, mxy - mny), pos = new Float32Array(raw.length); for (let i = 0; i < raw.length; i++) pos[i] = raw[i] * k;
const a = analyse(pos, undefined, { target: 1800 });
const { w, h, cell } = a.grid;

// light from the upper left of the finished picture (grid +Y is up)
function shade(z, W, H, c, lowAlt = 32) {
  const alt = (lowAlt * Math.PI) / 180, q = Math.cos(alt) / Math.SQRT2, L = [-q, q, Math.sin(alt)];
  const img = Buffer.alloc(W * H * 3);
  const at = (x, y) => z[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) / (2 * c), dy = (at(x, y + 1) - at(x, y - 1)) / (2 * c);
    const n = [-dx, -dy, 1], nl = Math.hypot(...n);
    const s = 0.16 + 0.84 * Math.max(0, (n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) / nl);
    const o = ((H - 1 - y) * W + x) * 3;
    img[o] = Math.min(255, 60 + 190 * s); img[o + 1] = Math.min(255, 50 + 165 * s); img[o + 2] = Math.min(255, 38 + 128 * s);
  }
  return img;
}

const mode = process.argv[2];
if (mode === 'preview') {
  await sharp(shade(a.height, w, h, cell), { raw: { width: w, height: h, channels: 3 } }).resize(900).jpeg({ quality: 85 }).toFile(OUT + 'bass_preview.jpg');
  console.log(`bass_preview.jpg: ${w}x${h} cells of ${cell.toFixed(3)} mm; preview px = ${(w / 900 * cell).toFixed(3)} mm`);
}
if (mode === 'patch') {
  const [cx, cy, side] = process.argv.slice(3).map(Number);
  const pad = Math.ceil(2 / cell), n = Math.round(side / cell);
  const x0 = Math.round(cx / cell - n / 2) - pad, y0 = Math.round(cy / cell - n / 2) - pad, N = n + 2 * pad;
  const src = new Float32Array(N * N); let floor = Infinity;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const v = a.height[(y0 + y) * w + (x0 + x)]; src[y * N + x] = v; if (!Number.isNaN(v) && v < floor) floor = v; }
  const closed = _closeWithTool(src, N, N, 1.5 / cell, 'ball', floor, cell);
  const FINE = 0.03, M = Math.round(side / FINE), r = 1.5;
  for (const pct of [8, 15, 25, 40]) {
    const s = 3 * pct / 100, z = new Float32Array(M * M);
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
      // bilinear sample of the closed surface
      const gx = pad + (i * FINE) / cell, gy = pad + (j * FINE) / cell, ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
      const v = (xx, yy) => closed[yy * N + xx];
      const base = v(ix, iy) * (1 - fx) * (1 - fy) + v(ix + 1, iy) * fx * (1 - fy) + v(ix, iy + 1) * (1 - fx) * fy + v(ix + 1, iy + 1) * fx * fy;
      const ym = (y0 + gy) * cell, d = Math.abs(((ym % s) + s) % s - s / 2);   // distance to the nearest pass centre
      z[j * M + i] = base + (r - Math.sqrt(r * r - d * d));
    }
    await sharp(shade(z, M, M, FINE, 24), { raw: { width: M, height: M, channels: 3 } }).resize(1024, 1024).jpeg({ quality: 92 }).toFile(OUT + `surf_${pct}.jpg`);
    // RIDGE LIGHT MAP: how much the ridges alone brighten or darken each point,
    // shade(with ridges) / shade(same surface without ridges), stored as
    // 128 * ratio. compose_surfaces.mjs multiplies a photograph by it, so the
    // photo carries exactly the simulated ridges and nothing invented.
    const z0 = new Float32Array(M * M);
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
      const gx = pad + (i * FINE) / cell, gy = pad + (j * FINE) / cell, ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
      const v = (xx, yy) => closed[yy * N + xx];
      z0[j * M + i] = v(ix, iy) * (1 - fx) * (1 - fy) + v(ix + 1, iy) * fx * (1 - fy) + v(ix, iy + 1) * (1 - fx) * fy + v(ix + 1, iy + 1) * fx * fy;
    }
    const sr = shade(z, M, M, FINE, 24), s0 = shade(z0, M, M, FINE, 24), ratio = Buffer.alloc(M * M);
    for (let q = 0; q < M * M; q++) ratio[q] = Math.max(0, Math.min(255, Math.round(128 * (sr[q * 3] + 1) / (s0[q * 3] + 1))));
    await sharp(ratio, { raw: { width: M, height: M, channels: 1 } }).resize(1024, 1024).png().toFile(OUT + `ridgemap_${pct}.png`);
    console.log(`surf_${pct}.jpg  stepover ${s.toFixed(2)} mm, ridge ${(r - Math.sqrt(r * r - (s / 2) ** 2)).toFixed(4)} mm`);
  }
}
