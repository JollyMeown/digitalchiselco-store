// Geometry check for the cutter maths in src/lib/stl-analyse.ts (2026-09-28).
// A 90 degree V-groove 3 mm deep: a ball of radius r stops r(sqrt2 - 1) above
// its bottom, whatever the grid size. Run: node --import tsx <this file>
import { _closeWithTool } from '../../../src/lib/stl-analyse.ts';
let ok = true;
for (const cell of [0.1, 0.17, 0.25]) {
  const W = Math.round(20 / cell), H = 12;
  const vg = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) vg[y * W + x] = Math.min(10, 7 + Math.abs(x * cell - 10));
  const cx = Math.round(10 / cell), row = 6;
  for (const dia of [6, 3, 1.5]) {
    const r = dia / 2;
    if (r / cell < 2) continue;                       // the engine refuses these too
    const got = _closeWithTool(vg, W, H, r / cell, 'ball', 0, cell)[row * W + cx] - 7;
    const want = r * (Math.SQRT2 - 1);
    const pass = Math.abs(got - want) < Math.max(0.03, cell * 0.3);
    ok &&= pass;
    console.log(`cell ${cell} mm  ${dia} mm ball: ${got.toFixed(3)} mm, exact ${want.toFixed(3)} mm  ${pass ? 'OK' : 'FAIL'}`);
  }
}
process.exit(ok ? 0 : 1);
