// The ONE definition of "where automatic rest machining sends the 1.5 mm bit"
// after a 3 mm finishing pass, shared by the diagram (draw_sim.mjs restmap)
// and the time study (../ball-nose-3mm-vs-1-5mm/sim.mjs), so the picture and
// the numbers in the article cannot disagree.
//   - loss = what a 3 mm ball cannot reach, max-pooled to a DW-wide grid
//   - visible = loss > VIS mm, ignoring a 2 mm band at the board's own edge
//   - specks under MIN_MM2 dropped (Aspire's "minimum detail" slider)
//   - zone = the rest grown by the 1.5 mm ball's radius
import { _closeWithTool } from '../../../src/lib/stl-analyse.ts';

export const VIS = 0.25, MIN_MM2 = 1.0, DW = 1000;

export function restZone(a) {
  const { w, h, cell } = a.grid;
  let floor = Infinity; for (const v of a.height) if (!Number.isNaN(v) && v < floor) floor = v;
  const closed = _closeWithTool(a.height, w, h, 1.5 / cell, 'ball', floor, cell);
  const k = w / DW, DH = Math.round(h / k), dc = cell * k;
  const loss = new Float32Array(DW * DH);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const m = a.height[y * w + x]; if (Number.isNaN(m)) continue;
    const d = closed[y * w + x] - m, i = Math.min(DH - 1, Math.floor(y / k)) * DW + Math.min(DW - 1, Math.floor(x / k));
    if (d > loss[i]) loss[i] = d;
  }
  const EDGE = Math.round(2 / dc);
  const vis = new Uint8Array(DW * DH);
  for (let y = EDGE; y < DH - EDGE; y++) for (let x = EDGE; x < DW - EDGE; x++) if (loss[y * DW + x] > VIS) vis[y * DW + x] = 1;
  const seen = new Uint8Array(DW * DH), stack = [];
  for (let i0 = 0; i0 < vis.length; i0++) {
    if (!vis[i0] || seen[i0]) continue;
    const comp = []; stack.push(i0); seen[i0] = 1;
    while (stack.length) {
      const c = stack.pop(); comp.push(c); const cx = c % DW, cy = (c / DW) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= DW || ny >= DH) continue;
        const n2 = ny * DW + nx; if (vis[n2] && !seen[n2]) { seen[n2] = 1; stack.push(n2); }
      }
    }
    if (comp.length * dc * dc < MIN_MM2) for (const c of comp) vis[c] = 0;
  }
  const R = Math.round(0.75 / dc), disc = [];
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (dx * dx + dy * dy <= R * R) disc.push(dx, dy);
  const zone = new Uint8Array(DW * DH);
  for (let y = 0; y < DH; y++) for (let x = 0; x < DW; x++) {
    if (!vis[y * DW + x]) continue;
    for (let o = 0; o < disc.length; o += 2) { const nx = x + disc[o], ny = y + disc[o + 1]; if (nx >= 0 && ny >= 0 && nx < DW && ny < DH) zone[ny * DW + nx] = 1; }
  }
  let nVis = 0, nZone = 0; for (let i = 0; i < vis.length; i++) { nVis += vis[i]; nZone += zone[i]; }
  return { DW, DH, dc, loss, vis, zone, visiblePct: 100 * nVis / (DW * DH), zonePct: 100 * nZone / (DW * DH) };
}
