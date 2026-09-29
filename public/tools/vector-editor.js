/* DigitalChiselCo Vector Editor (2026-09-29): closed-path node editing over a
 * relief image, shared by the website's Will it cut? "Outline for CAM" tab and
 * BRS's Vector Outline tab. Plain JS, no dependencies.
 *
 * Four ways to make a line, each a numbered list of steps in the panel
 * (owner's decision 2026-09-29: the fully automatic outline was removed, it
 * was not reliable on hand-hewn grounds):
 *   1 Inside and outside line: two guides, the edge is solved between them
 *   2 Draw it yourself: plain points
 *   3 Magnetic pen: clicks along the edge, cheapest edge path between them
 *   4 Brush: a painted band, its two rims become the guides of method 1
 *
 *   const ed = new VectorEditor(container, {
 *     image: HTMLImageElement | ImageBitmap,   // shaded relief or product photo
 *     mmPerPx: number,                          // image pixel -> mm
 *     originMm: [x0, yTopMm],                   // mm at image pixel (0,0); y grows UP in mm
 *     heightMap?: { w, h, z: Float32Array, cell }   // optional, for snap-to-edge
 *     onChange?: (paths) => void,
 *   });
 *   ed.setPaths([{ layer:'blue'|'red', pts:[[xmm,ymm,corner?],...] }, ...]);
 *   ed.getPaths(); ed.toDXF(); ed.toSVG(); ed.toJSON(); ed.loadJSON(); ed.importDXF(text)
 *
 * Paths are closed. Each node: [x, y, corner] in mm; a node with corner=1 is a
 * sharp vertex, otherwise the curve through it is a Catmull-Rom spline (tension
 * slider). Export samples the spline into a polyline (DXF R12 POLYLINE), which
 * every CAM program reads, ArtCAM 2015 included.
 */
(function (global) {
  'use strict';

  const LAYER = { blue: { color: '#1470e0', name: 'Carved area' }, red: { color: '#d81f1f', name: 'Subject' },
    inner: { color: '#1fa83a', name: 'Inner guide', guide: true }, outer: { color: '#f08c1a', name: 'Outer guide', guide: true } };
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const dist2 = dist;

  function segDist(p, a, b) {           // distance from p to segment ab, and the parameter t
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-12;
    const t = clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2, 0, 1);
    return [Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)), t];
  }

  /** Closed Catmull-Rom (cardinal) spline through nodes; corner nodes break the
   *  smoothness. Returns a dense polyline in mm. */
  function splinePts(nodes, tension, per = 8) {
    const n = nodes.length; if (n < 3) return nodes.map((p) => [p[0], p[1]]);
    const out = [];
    const s = (1 - tension) / 2;          // tension 0 = round, 1 = straight polygon
    for (let i = 0; i < n; i++) {
      const p0 = nodes[(i - 1 + n) % n], p1 = nodes[i], p2 = nodes[(i + 1) % n], p3 = nodes[(i + 2) % n];
      const c1 = p1[2] ? 1 : 0, c2 = p2[2] ? 1 : 0;
      // tangents: zero at a corner so the curve arrives straight
      const m1 = c1 ? [0, 0] : [s * (p2[0] - p0[0]), s * (p2[1] - p0[1])];
      const m2 = c2 ? [0, 0] : [s * (p3[0] - p1[0]), s * (p3[1] - p1[1])];
      const steps = (c1 && c2) || tension >= 0.999 ? 1 : per;
      for (let k = 0; k < steps; k++) {
        const t = k / steps, t2 = t * t, t3 = t2 * t;
        const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
        out.push([h00 * p1[0] + h10 * m1[0] + h01 * p2[0] + h11 * m2[0], h00 * p1[1] + h10 * m1[1] + h01 * p2[1] + h11 * m2[1]]);
      }
    }
    return out;
  }

  function simplifyDP(pts, eps) {         // Douglas-Peucker on a closed polyline (mm)
    if (pts.length < 4) return pts.slice();
    const keep = new Uint8Array(pts.length); keep[0] = 1; keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop(); let mi = -1, md = 0;
      for (let i = a + 1; i < b; i++) { const [d] = segDist(pts[i], pts[a], pts[b]); if (d > md) { md = d; mi = i; } }
      if (md > eps && mi > 0) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
    }
    return pts.filter((_, i) => keep[i]);
  }

  function chaikin(pts, passes) {         // corner-cutting smooth, closed
    let p = pts.map((q) => [q[0], q[1], 0]);
    for (let k = 0; k < passes; k++) {
      const out = [];
      for (let i = 0; i < p.length; i++) {
        const a = p[i], b = p[(i + 1) % p.length];
        out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1], 0], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1], 0]);
      }
      p = out;
    }
    return p;
  }

  function offsetPath(pts, d, res = 0.3) {  // grow (d>0) / shrink (d<0) a closed path via a raster mask (robust, self-intersection free)
    if (Math.abs(d) < 1e-9) return pts.map((p) => [p[0], p[1], p[2] || 0]);
    let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
    for (const p of pts) { mnx = Math.min(mnx, p[0]); mny = Math.min(mny, p[1]); mxx = Math.max(mxx, p[0]); mxy = Math.max(mxy, p[1]); }
    const pad = Math.abs(d) + 2 * res, W = Math.ceil((mxx - mnx + 2 * pad) / res), H = Math.ceil((mxy - mny + 2 * pad) / res);
    if (W * H > 9e6) return pts.map((p) => [p[0], p[1], p[2] || 0]);
    const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.fillStyle = '#fff'; g.beginPath();
    pts.forEach((p, i) => { const x = (p[0] - mnx + pad) / res, y = (p[1] - mny + pad) / res; i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.closePath(); g.fill();
    if (d > 0) { g.strokeStyle = '#fff'; g.lineWidth = 2 * d / res; g.lineJoin = 'round'; g.stroke(); }
    else { g.strokeStyle = '#000'; g.lineWidth = 2 * -d / res; g.lineJoin = 'round'; g.stroke(); }
    const data = g.getImageData(0, 0, W, H).data;
    const mask = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) mask[i] = data[i * 4] > 127 ? 1 : 0;
    const loops = traceMask(mask, W, H);
    if (!loops.length) return pts.map((p) => [p[0], p[1], p[2] || 0]);
    loops.sort((a, b) => b.length - a.length);
    const poly = loops[0].map(([x, y]) => [mnx - pad + x * res, mny - pad + y * res]);
    return simplifySafe(poly, res * 0.7).map((p) => [p[0], p[1], 0]);
  }
  /** Douglas-Peucker can pinch a narrow neck into a self-crossing; back off until the result is simple. */
  function simplifySafe(poly, eps) {
    for (const e of [eps, eps / 3, eps / 9]) { const s = simplifyDP(poly, e); if (s.length >= 3 && !hasCrossing(s)) return s; }
    return poly.slice();
  }

  function resample(poly, step) {          // closed polyline -> points every `step` mm
    const out = []; let carry = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], L = dist(a, b); if (L < 1e-9) continue;
      for (let d = carry; d < L; d += step) { const t = d / L; out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]); }
      carry = (carry + Math.ceil((L - carry) / step) * step) - L;
    }
    return out.length >= 3 ? out : poly.map((p) => [p[0], p[1]]);
  }
  function rayPoly(p, d, poly) {           // nearest intersection of the ray p + t*d (t > 0) with a closed polyline
    let best = null;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], ex = b[0] - a[0], ey = b[1] - a[1], den = d[0] * ey - d[1] * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((a[0] - p[0]) * ey - (a[1] - p[1]) * ex) / den, u = ((a[0] - p[0]) * d[1] - (a[1] - p[1]) * d[0]) / den;
      if (t > 1e-6 && u >= 0 && u <= 1 && (!best || t < best.t)) best = { t, q: [p[0] + t * d[0], p[1] + t * d[1]] };
    }
    return best ? best.q : null;
  }
  function hasCrossing(poly) {              // any self-intersection in a closed polyline (O(n^2), fine to ~4000 pts)
    const n = poly.length; if (n < 4) return false;
    const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
    const same = (p, q) => Math.abs(p[0] - q[0]) < 1e-9 && Math.abs(p[1] - q[1]) < 1e-9;
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      if (same(a, b)) continue;                                   // a repeated point is not a crossing
      const minx = Math.min(a[0], b[0]), maxx = Math.max(a[0], b[0]), miny = Math.min(a[1], b[1]), maxy = Math.max(a[1], b[1]);
      for (let j = i + 2; j < n - (i === 0 ? 1 : 0); j++) {
        const c = poly[j], d = poly[(j + 1) % n];
        if (same(c, d) || same(a, c) || same(a, d) || same(b, c) || same(b, d)) continue;   // touching at a shared vertex only
        if (Math.max(c[0], d[0]) < minx || Math.min(c[0], d[0]) > maxx || Math.max(c[1], d[1]) < miny || Math.min(c[1], d[1]) > maxy) continue;
        if (o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b)) return true;
      }
    }
    return false;
  }
  function cornerFlags(nodes, deg = 55) {   // sharp turns become corner nodes so the spline cannot overshoot into a loop
    const n = nodes.length, lim = Math.cos(deg * Math.PI / 180);
    return nodes.map((q, i) => {
      const a = nodes[(i - 1 + n) % n], b = nodes[(i + 1) % n];
      const ux = q[0] - a[0], uy = q[1] - a[1], vx = b[0] - q[0], vy = b[1] - q[1], lu = Math.hypot(ux, uy) || 1, lv = Math.hypot(vx, vy) || 1;
      return [q[0], q[1], (ux * vx + uy * vy) / (lu * lv) < lim ? 1 : 0];
    });
  }
  function nearestOn(p, poly) { let bd = Infinity, bq = poly[0]; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length], [d, t] = segDist(p, a, b); if (d < bd) { bd = d; bq = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]; } } return bq; }

  /** Marching squares on a 0/1 mask: every closed boundary (outer and hole),
   *  as loops of edge-midpoint coordinates in pixel units. Replaces a Moore
   *  tracer that stopped early on rounded shapes (2026-09-29). */
  function traceMask(mask, W, H) {
    const at = (x, y) => (x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x]) ? 1 : 0;
    // segments per cell; endpoints are edge midpoints keyed as integers
    const next = new Map(), key = (x2, y2) => y2 * (2 * W + 3) + x2;   // coordinates doubled to stay integer
    const add = (ax, ay, bx, by) => { next.set(key(ax, ay), [bx, by]); };
    for (let y = -1; y < H; y++) for (let x = -1; x < W; x++) {
      const tl = at(x, y), tr = at(x + 1, y), bl = at(x, y + 1), br = at(x + 1, y + 1);
      const corners = [tl, tr, br, bl];
      if (corners[0] + corners[1] + corners[2] + corners[3] === 0 || corners[0] + corners[1] + corners[2] + corners[3] === 4) continue;
      // midpoints (doubled coords) in clockwise order T, R, B, L; edge i lies between corner i and corner i+1
      const mids = [[2 * x + 2, 2 * y + 1], [2 * x + 3, 2 * y + 2], [2 * x + 2, 2 * y + 3], [2 * x + 1, 2 * y + 2]];
      // Derived, not hand-written (a hand table sent two saddle segments the wrong way, 2026-09-29):
      // walking the cell's perimeter clockwise, the contour ENTERS the inside at an edge whose
      // corners go 0 -> 1 and EXITS where they go 1 -> 0; each inside run gives one segment
      // enter -> exit, so every segment carries the same winding and chains always close.
      for (let i = 0; i < 4; i++) {
        if (corners[i] === 0 && corners[(i + 1) % 4] === 1) {
          let j = (i + 1) % 4; while (!(corners[j] === 1 && corners[(j + 1) % 4] === 0)) j = (j + 1) % 4;
          add(mids[i][0], mids[i][1], mids[j][0], mids[j][1]);
        }
      }
    }
    const loops = [];
    while (next.size) {
      const [k0, first] = next.entries().next().value; next.delete(k0);
      const sx = k0 % (2 * W + 3), sy = Math.floor(k0 / (2 * W + 3));
      const loop = [[sx / 2, sy / 2]]; let cur = first, guard = 0;
      while (cur && ++guard < 4 * W * H) {
        const k = key(cur[0], cur[1]);
        if (k === k0) break;                       // back at the start: the loop is closed implicitly, no repeated point
        loop.push([cur[0] / 2, cur[1] / 2]);
        const nxt = next.get(k); next.delete(k); cur = nxt;
      }
      if (loop.length > 3) loops.push(loop);
    }
    return loops;
  }

  function polyArea(p) { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[i], r = p[(i + 1) % p.length]; a += q[0] * r[1] - r[0] * q[1]; } return a / 2; }
  function pointIn(p, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }

  class VectorEditor {
    constructor(container, opts) {
      this.c = container; this.o = opts; this.paths = []; this.hist = []; this.redo = [];
      this.tension = 0.35; this.tool = 'edit'; this.sel = { path: -1, nodes: new Set() }; this.pen = null;
      this.view = { s: 1, tx: 0, ty: 0 }; this.hover = null; this.drag = null; this.marquee = null; this.cursor = null;
      this.target = 'blue'; this.method = 1; this.penLayer = 'inner'; this.penMode = 'click'; this.pickZ = false; this.imgAlpha = 1;
      LAYER.paint = { color: '#ffd23f', name: 'Brush paint', guide: true, open: true };
      this.uid = 've' + Math.random().toString(36).slice(2, 8);
      this.zr = [0, 10]; const hm = opts.heightMap;
      if (hm) { let lo = Infinity, hi = -Infinity; for (let i = 0; i < hm.z.length; i += 13) { const v = hm.z[i]; if (v > 1e-4) { if (v < lo) lo = v; if (v > hi) hi = v; } } if (hi > lo) this.zr = [Math.floor(lo * 10) / 10, Math.ceil(hi * 10) / 10]; }
      this._build(); this._fit(); this._bind(); this._marks(); this.draw(); if (opts.full) this.setFull(true);
      this.say(hm ? 'Method 1: press "Draw inside line" and click points just inside the edge you want.' : 'No height data: use Method 2 and draw the line yourself.');
    }

    /* ---------- DOM ---------- */
    _build() {
      const tune = `
            <div class="ve-row ve-more">
              <button data-tool="edit" title="Drag a point, or drag the line to move all of it (V)">Move points</button>
              <button data-tool="add" title="Click on the line where you want a new point (A)">Add point</button>
              <button data-act="delnode" title="Delete the selected points (Del)">Delete point</button>
              <button data-act="corner" title="Selected points: sharp corner or round curve (C). Double-click a point does the same.">Sharp / round</button>
              <button data-act="snap" title="Pull the selected points (or the whole line) onto the nearest steep edge">Pull to edge</button>
              <button data-act="smooth" title="Round the whole line a little">Smoother</button>
              <button data-act="simplify" title="Remove points the shape does not need">Fewer points</button>
              <span class="ve-pair">Grow / shrink <button data-act="shrink" title="Move the whole line inward">&minus;</button><input data-num="off" type="number" value="0.5" step="0.25" min="0.05"> mm <button data-act="grow" title="Move the whole line outward">+</button></span>
              <label>Curve <input data-rng="tension" type="range" min="0" max="1" step="0.05" value="0.35" title="Left = round curves, right = straight between points"></label>
            </div>
            <p>Drag a box to select several points. Shift+click adds a point to the selection.</p>`;
      const zmid = ((this.zr[0] + this.zr[1]) / 2).toFixed(2);
      const opts = (smooth) => `<div class="ve-row ve-opts">
              <label>Follow <select data-sel="cost"><option value="edge">the steepest edge</option><option value="level">one height (Z)</option></select></label>
              <span class="ve-pair" data-zbox hidden>Z <input data-rng="zlev" type="range" min="${this.zr[0]}" max="${this.zr[1]}" step="0.05" value="${zmid}"> <output data-out="zlev">${zmid}</output> mm <button data-act="pickz" title="Click a spot on the picture that lies on the edge you want">Pick from the picture</button></span>
              ${smooth ? '<label>Smoothness <input data-rng="stiff" type="range" min="0" max="1" step="0.05" value="0.3" title="Left = follows every detail, right = calmer line"></label>' : ''}
              <label>Points <input data-rng="detail" type="range" min="0" max="1" step="0.05" value="0.55" title="Left = fewer points, right = more points. Straight runs always get few, curves get more."></label>
            </div>`;
      const save = `<div class="ve-row"><b>Save</b><button data-act="dxf" class="ve-go">Save DXF</button><button data-act="svg">Save SVG</button></div>
            <p>DXF opens in Aspire, VCarve, ArtCAM, Carveco and Fusion. The blue and the red line are saved in one file, each on its own layer, at the model's own position. The green and orange helper lines are not saved in it.</p>`;
      this.c.classList.add('ve');
      this.c.innerHTML = `
        <div class="ve-side">
        <div class="ve-head">
          <b>Which line are you making?</b>
          <label class="ve-pill"><input type="radio" name="${this.uid}t" value="blue" checked><i style="background:${LAYER.blue.color}"></i> Blue: edge of the carved area</label>
          <label class="ve-pill"><input type="radio" name="${this.uid}t" value="red"><i style="background:${LAYER.red.color}"></i> Red: around the subject</label>
        </div>
        <div class="ve-methods">
          <button data-method="1" class="on"><b>1. Inside + outside line</b><span>You mark a line inside and a line outside. The software finds the exact edge between them.</span></button>
          <button data-method="2"><b>2. Draw it yourself</b><span>You click around the shape. Every point stays exactly where you put it.</span></button>
          <button data-method="3"><b>3. Magnetic pen</b><span>You click along the edge. Between your clicks the line sticks to the edge by itself.</span></button>
          <button data-method="4"><b>4. Brush</b><span>You paint a wide stroke over the edge. The software finds the edge under the paint.</span></button>
        </div>
        <div class="ve-desc"></div>
        <ol class="ve-steps" data-m="1">
          <li data-step="inner"><span class="ve-n">1</span><div>
            <div class="ve-row"><b>Mark the inside</b><button data-act="peninner" class="ve-go ve-in">Draw inside line</button><em data-mark="inner"></em></div>
            <p>Click points a little INSIDE the edge you want. To finish: click the first point again, double-click, or press Enter. Or hold the mouse button and drag to draw freehand.</p></div></li>
          <li data-step="outer"><span class="ve-n">2</span><div>
            <div class="ve-row"><b>Mark the outside</b><button data-act="penouter" class="ve-go ve-out">Draw outside line</button><span class="ve-or">or</span>
              <span class="ve-pair"><button data-act="outerfrominner" title="Copies the inside line and moves it outward by the gap">Make it from the inside line</button> gap <input data-num="gap" type="number" value="6" step="1" min="1"> mm</span><em data-mark="outer"></em></div>
            <p>The edge you want must lie between the green and the orange line. A narrow band gives the most exact result.</p></div></li>
          <li data-step="solve"><span class="ve-n">3</span><div>
            <div class="ve-row"><b>Find the line</b><button data-act="solve" class="ve-go">Find the line</button><em data-mark="solved"></em>
              <label><input type="checkbox" data-chk="autosolve" checked> Update by itself when I change something</label></div>
            ${opts(true)}</div></li>
          <li data-step="tune"><span class="ve-n">4</span><div>
            <div class="ve-row"><b>Fine-tune, if needed</b><span class="ve-hint">Move a green or orange point and the line is found again, or edit the found line directly:</span></div>${tune}</div></li>
          <li data-step="save"><span class="ve-n">5</span><div>${save}</div></li>
        </ol>
        <ol class="ve-steps" data-m="2" hidden>
          <li data-step="draw"><span class="ve-n">1</span><div>
            <div class="ve-row"><b>Draw the line</b><button data-act="pendraw" class="ve-go">Draw the line</button><em data-mark="own"></em></div>
            <p>Click around the shape, point by point. To finish: click the first point again, double-click, or press Enter. Or hold the mouse button and drag to draw freehand. Zoom in for exact placing.</p></div></li>
          <li data-step="tune"><span class="ve-n">2</span><div>
            <div class="ve-row"><b>Fine-tune</b></div>${tune}</div></li>
          <li data-step="save"><span class="ve-n">3</span><div>${save}</div></li>
        </ol>
        <ol class="ve-steps" data-m="3" hidden>
          <li data-step="draw"><span class="ve-n">1</span><div>
            <div class="ve-row"><b>Trace the edge</b><button data-act="penmag" class="ve-go">Start tracing</button><em data-mark="own"></em></div>
            <p>Click once ON the edge to start. Move the mouse along the edge: the line follows the edge by itself. Click every few centimetres, and at every sharp turn, to pin it down. If it takes a wrong way, click closer. To finish: click the first point again, double-click, or press Enter.</p>
            ${opts(false)}</div></li>
          <li data-step="tune"><span class="ve-n">2</span><div>
            <div class="ve-row"><b>Fine-tune, if needed</b></div>${tune}</div></li>
          <li data-step="save"><span class="ve-n">3</span><div>${save}</div></li>
        </ol>
        <ol class="ve-steps" data-m="4" hidden>
          <li data-step="paint"><span class="ve-n">1</span><div>
            <div class="ve-row"><b>Paint over the edge</b><button data-act="paint" class="ve-go">Paint</button>
              <label>Brush width <input data-rng="brush" type="range" min="2" max="40" step="1" value="10"> <output data-out="brush">10</output> mm</label>
              <button data-act="clearpaint">Clear the paint</button><em data-mark="paint"></em></div>
            <p>Hold the mouse button and paint over the edge, all the way around, until the ends meet. The edge only has to be somewhere under the paint. Several strokes are fine, Undo takes the last one back. A narrower brush gives a more exact result.</p></div></li>
          <li data-step="solve"><span class="ve-n">2</span><div>
            <div class="ve-row"><b>Find the line</b><button data-act="brushsolve" class="ve-go">Find the line</button><em data-mark="solved"></em>
              <label><input type="checkbox" data-chk="autosolve" checked> Find it by itself when the paint closes</label></div>
            ${opts(true)}</div></li>
          <li data-step="tune"><span class="ve-n">3</span><div>
            <div class="ve-row"><b>Fine-tune, if needed</b></div>${tune}</div></li>
          <li data-step="save"><span class="ve-n">4</span><div>${save}</div></li>
        </ol>
        <div class="ve-bar">
          <span class="ve-grp"><button data-act="zoomout" title="Zoom out">&minus;</button><button data-act="zoomin" title="Zoom in">+</button><button data-act="fit" title="Show the whole model (F)">Fit</button><button data-tool="pan" title="Drag the picture (H). Also: hold Space, or drag with the right mouse button">Hand</button><button data-act="full" title="The picture fills the whole window, the steps stay at the left">Full screen</button></span>
          <span class="ve-grp"><button data-act="undo" title="Ctrl+Z">Undo</button><button data-act="redo" title="Ctrl+Y">Redo</button><button data-act="backpoint" title="While drawing: take back the last point (Backspace)">Back one point</button></span>
          <span class="ve-grp"><button data-act="delpath" title="Delete the selected line">Delete this line</button><button data-act="startover" title="Remove the guides and the line of the colour you are working on">Start over</button></span>
          <span class="ve-grp"><label>Picture <input data-rng="alpha" type="range" min="0.15" max="1" step="0.05" value="1" title="Fade the picture to see the lines better"></label></span>
          <span class="ve-grp"><button data-act="json" title="Keeps the guides too, so you can continue later">Save my work</button><label class="ve-file">Open work or DXF<input type="file" accept=".dxf,.json" data-file="open"></label></span>
        </div>
        </div>
        <div class="ve-main"><div class="ve-wrap"><canvas class="ve-cv"></canvas></div>
        <div class="ve-status"></div></div>`;
      const st = document.createElement('style');
      st.textContent = `.ve{font:13px/1.35 system-ui,Arial,sans-serif;color:#2e1d10;user-select:none}
        .ve button{font:inherit;padding:4px 10px;border:1px solid #b08a5a;background:#fff;color:#2e1d10;border-radius:6px;cursor:pointer}
        .ve button:hover{background:#fdf3e2}.ve button.on{background:#854F0B;color:#fff;border-color:#854F0B}
        .ve button.ve-go{background:#854F0B;color:#fff;border-color:#854F0B;font-weight:600}.ve button.ve-go:hover{background:#6e4009}
        .ve button.ve-in{background:#15702a;border-color:#15702a}.ve button.ve-in:hover{background:#0f5a20}
        .ve button.ve-out{background:#9a5206;border-color:#9a5206}.ve button.ve-out:hover{background:#7f4304}
        .ve button.ve-live{outline:3px solid #ffd23f;outline-offset:1px}
        .ve input[type=number]{font:inherit;width:4em;padding:3px 4px;border:1px solid #b08a5a;border-radius:6px;background:#fff;color:#2e1d10}
        .ve select{font:inherit;padding:3px 4px;border:1px solid #b08a5a;border-radius:6px;background:#fff;color:#2e1d10}
        .ve label,.ve-pair{display:inline-flex;gap:5px;align-items:center}
        .ve-head{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;padding:8px 10px;background:#f4ece0;border:1px solid #d8c9b3;border-radius:8px 8px 0 0}
        .ve-pill{padding:4px 10px;border:1px solid #d8c9b3;border-radius:999px;background:#fff;cursor:pointer}.ve-pill i{width:12px;height:12px;border-radius:3px;display:inline-block}
        .ve-methods{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:8px 10px;background:#f4ece0;border:1px solid #d8c9b3;border-top:0;border-bottom:0}
        .ve .ve-methods button{text-align:left;padding:7px 10px;border:2px solid #d8c9b3;border-radius:8px}
        .ve-methods b{display:block;font-size:13.5px}.ve-methods span{display:none}
        .ve-desc{padding:0 12px 8px;background:#f4ece0;border:1px solid #d8c9b3;border-top:0;color:#4a3420}
        .ve .ve-methods button.on{background:#fff7ea;color:#2e1d10;border-color:#854F0B}
        .ve-steps{list-style:none;margin:0;padding:6px 8px 8px;background:#fbf7f0;border:1px solid #d8c9b3;border-top:0;display:grid;gap:4px}.ve-steps[hidden]{display:none}
        .ve-steps li{display:grid;grid-template-columns:26px 1fr;gap:8px;align-items:start;padding:6px 8px;border:1px solid transparent;border-radius:8px}
        .ve-steps li.now{background:#fff;border-color:#e2c89c}
        .ve-n{width:24px;height:24px;border-radius:50%;background:#d8c9b3;color:#2e1d10;display:grid;place-items:center;font-weight:700}
        .ve-steps li.now .ve-n{background:#854F0B;color:#fff}.ve-steps li.done .ve-n{background:#15702a;color:#fff}.ve-n{cursor:pointer}
        .ve-row{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center}.ve-row+.ve-row{margin-top:6px}
        .ve-steps p,.ve-hint{margin:3px 0 0;color:#6d5540;font-size:12.5px}.ve-or{color:#6d5540}
        .ve-steps em{font-style:normal;color:#6d5540}.ve-steps li.done em{color:#15702a;font-weight:600}
        .ve-steps li p,.ve-steps li .ve-more,.ve-steps li .ve-opts{display:none}.ve-steps li.now p,.ve-steps li.open p{display:block}
        .ve-steps li.now .ve-more,.ve-steps li.open .ve-more,.ve-steps li.now .ve-opts,.ve-steps li.open .ve-opts,.ve-steps li.done .ve-opts{display:flex}
        .ve-bar{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;padding:6px 8px;background:#f4ece0;border:1px solid #d8c9b3;border-top:0}
        .ve-grp{display:inline-flex;flex-wrap:wrap;gap:4px;align-items:center;padding-right:10px;border-right:1px solid #d8c9b3}.ve-grp:last-child{border-right:0}
        .ve-file{position:relative;overflow:hidden;padding:4px 10px;border:1px solid #b08a5a;background:#fff;border-radius:6px;cursor:pointer}.ve-file input{position:absolute;inset:0;opacity:0;cursor:pointer}
        .ve-wrap{position:relative;background:#2b2b2b;border:1px solid #d8c9b3;border-top:0;height:72vh;min-height:420px;overflow:hidden}
        .ve-cv{position:absolute;inset:0;width:100%;height:100%;cursor:crosshair;touch-action:none}
        .ve-status{padding:5px 8px;background:#f4ece0;border:1px solid #d8c9b3;border-top:0;border-radius:0 0 8px 8px;color:#4a3420;min-height:1.4em}
        .ve.ve-full{position:fixed;inset:0;z-index:2147483000;background:#faf6ef;display:flex;padding:8px;gap:8px;box-sizing:border-box}
        .ve-full .ve-side{width:400px;flex:none;overflow:auto}.ve-full .ve-main{flex:1;min-width:0;display:flex;flex-direction:column}
        .ve-full .ve-wrap{flex:1;height:auto;min-height:0;border-top:1px solid #d8c9b3;border-radius:8px 8px 0 0}.ve-full .ve-methods{grid-template-columns:1fr 1fr}
        .ve-full .ve-bar{border-radius:0 0 8px 8px}
        @media (max-width:900px){.ve.ve-full{flex-direction:column}.ve-full .ve-side{width:auto;max-height:42vh}}
        @media (max-width:1100px){.ve-methods{grid-template-columns:1fr 1fr}}@media (max-width:640px){.ve-methods{grid-template-columns:1fr}}`;
      this.c.prepend(st);
      this.cv = this.c.querySelector('.ve-cv'); this.g = this.cv.getContext('2d'); this.status = this.c.querySelector('.ve-status');
      const all = (s, f) => this.c.querySelectorAll(s).forEach(f);
      all('[data-tool]', (b) => b.onclick = () => this.setTool(b.dataset.tool));
      all('[data-act]', (b) => b.onclick = () => this.act(b.dataset.act));
      all('[data-method]', (b) => b.onclick = () => this.setMethod(+b.dataset.method));
      all('.ve-steps .ve-n', (n) => n.onclick = () => n.parentElement.classList.toggle('open'));
      this._desc();
      all(`input[name="${this.uid}t"]`, (r) => r.onchange = () => this.setTarget(r.value));
      all('[data-rng="tension"]', (r) => r.oninput = () => { this.tension = +r.value; all('[data-rng="tension"]', (o) => { o.value = r.value; }); this.draw(); });
      this.c.querySelector('[data-rng="alpha"]').oninput = (e) => { this.imgAlpha = +e.target.value; this.draw(); };
      all('[data-rng="zlev"]', (z) => z.oninput = () => { z.closest('.ve-pair').querySelector('output').textContent = (+z.value).toFixed(2); this._retree(); this._maybeAutoSolve(); });
      all('[data-rng="stiff"]', (r) => r.oninput = () => this._maybeAutoSolve());
      all('[data-rng="detail"]', (r) => r.oninput = () => this._maybeAutoSolve());
      all('[data-rng="brush"]', (r) => r.oninput = () => { r.closest('label').querySelector('output').textContent = r.value; this.draw(); });
      all('[data-sel="cost"]', (c) => c.onchange = () => { c.closest('.ve-steps').querySelector('[data-zbox]').hidden = c.value !== 'level'; this._retree(); this._maybeAutoSolve(); });
      this.c.querySelector('[data-file="open"]').onchange = (e) => this._open(e.target.files[0]);
      new ResizeObserver(() => { this._size(); this.draw(); }).observe(this.c.querySelector('.ve-wrap'));
      this._size();
    }
    _size() { const w = this.c.querySelector('.ve-wrap'); const r = window.devicePixelRatio || 1; this.cv.width = w.clientWidth * r; this.cv.height = w.clientHeight * r; this.dpr = r; }
    _fit() {
      const img = this.o.image; if (!img) return;
      const W = this.cv.width, H = this.cv.height, s = 0.95 * Math.min(W / img.width, H / img.height);
      this.view = { s, tx: (W - img.width * s) / 2, ty: (H - img.height * s) / 2 };
    }
    setFull(on) {
      this.c.classList.toggle('ve-full', on); document.documentElement.style.overflow = on ? 'hidden' : '';
      this.c.querySelector('[data-act="full"]').textContent = on ? 'Leave full screen' : 'Full screen';
      if (!on) this.c.scrollIntoView({ block: 'start' });          // the page was locked while full screen: come back to the tool
      this._size(); this._fit(); this.draw();
    }
    _zoom(k, at) { const s = at || [this.cv.width / 2, this.cv.height / 2], ns = clamp(this.view.s * k, 0.05, 60); this.view.tx = s[0] - (s[0] - this.view.tx) * ns / this.view.s; this.view.ty = s[1] - (s[1] - this.view.ty) * ns / this.view.s; this.view.s = ns; this.draw(); }
    _desc() { this.c.querySelector('.ve-desc').textContent = this.c.querySelector(`[data-method="${this.method}"] span`).textContent; }
    _in(sel) { return this.c.querySelector(`.ve-steps[data-m="${this.method}"] ${sel}`) || this.c.querySelector(sel); }

    /* ---------- coordinates: mm <-> image px <-> screen px ---------- */
    mmToImg(p) { return [(p[0] - this.o.originMm[0]) / this.o.mmPerPx, (this.o.originMm[1] - p[1]) / this.o.mmPerPx]; }
    imgToMm(q) { return [this.o.originMm[0] + q[0] * this.o.mmPerPx, this.o.originMm[1] - q[1] * this.o.mmPerPx]; }
    imgToScr(q) { return [q[0] * this.view.s + this.view.tx, q[1] * this.view.s + this.view.ty]; }
    scrToImg(s) { return [(s[0] - this.view.tx) / this.view.s, (s[1] - this.view.ty) / this.view.s]; }
    mmToScr(p) { return this.imgToScr(this.mmToImg(p)); }
    scrToMm(s) { return this.imgToMm(this.scrToImg(s)); }
    _evt(e) { const r = this.cv.getBoundingClientRect(); return [(e.clientX - r.left) * this.dpr, (e.clientY - r.top) * this.dpr]; }
    pxMm() { return this.o.mmPerPx / this.view.s * this.dpr; }   // mm per screen css px
    _zAt(p) { const hm = this.o.heightMap; if (!hm) return null; const x = Math.round((p[0] - this.o.originMm[0]) / hm.cell), y = Math.round((this.o.originMm[1] - p[1]) / hm.cell); if (x < 0 || y < 0 || x >= hm.w || y >= hm.h) return null; const v = hm.z[y * hm.w + x]; return v > 1e-4 ? v : null; }

    /* ---------- state ---------- */
    _keep(p) { const o = { layer: p.layer || 'blue', pts: p.pts.map((q) => [q[0], q[1], q[2] || 0]) }; if (p.t) o.t = p.t; if (p.auto) o.auto = 1; if (p.r) o.r = p.r; return o; }
    setPaths(paths) { this.paths = paths.map((p) => this._keep(p)); this.hist = []; this.redo = []; this.sel = { path: -1, nodes: new Set() }; this._marks(); this.draw(); }
    getPaths() { return this.paths.map((p) => this._keep(p)); }
    _push() { this.hist.push(JSON.stringify(this.paths)); if (this.hist.length > 200) this.hist.shift(); this.redo = []; }
    _changed(fromGuide) { this._marks(); this.draw(); this.o.onChange && this.o.onChange(this.getPaths()); if (fromGuide) this._maybeAutoSolve(); }
    _shown(P) { return LAYER[P.layer].guide ? this.method === (P.layer === 'paint' ? 4 : 1) && (P.t || 'blue') === this.target : true; }
    _editable(P) { return this._shown(P) && !LAYER[P.layer].open; }
    _paint() { return this.paths.filter((P) => P.layer === 'paint' && (P.t || 'blue') === this.target); }
    _guide(kind) { for (let i = this.paths.length - 1; i >= 0; i--) { const P = this.paths[i]; if (P.layer === kind && (P.t || 'blue') === this.target) return P; } return null; }
    setTool(t) { this.tool = t; this.pen = null; this.pickZ = false; this.c.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t)); this._live(); this.draw(); }
    setTarget(t) { this.target = t; this.pen = null; this.sel = { path: -1, nodes: new Set() }; if (this.tool === 'pen' || this.tool === 'brush') this.setTool('edit'); this._marks(); this.draw(); this.say(`Now making the ${t === 'blue' ? 'BLUE line (edge of the carved area)' : 'RED line (around the subject)'}. Start at step 1.`); }
    setMethod(m) {
      this.method = m; this.c.querySelectorAll('[data-method]').forEach((b) => b.classList.toggle('on', +b.dataset.method === m));
      this.c.querySelectorAll('.ve-steps').forEach((l) => { l.hidden = +l.dataset.m !== m; }); this._desc();
      this.setTool('edit'); this._marks(); this._size(); this.draw();
      if (m !== 2 && !this.o.heightMap) return this.say('This method needs the height data of the model. Use Method 2.');
      this.say(['', 'Method 1: draw a line inside and a line outside the edge; the software finds the edge between them.', 'Method 2: press "Draw the line" and click around the shape.', 'Method 3: press "Start tracing", click on the edge and move along it.', 'Method 4: press "Paint" and paint over the edge, all the way around.'][m]);
    }
    say(s) { this.status.textContent = s; this._said = s; }
    _live() {   // the button of what the mouse is doing right now gets a yellow ring
      const on = this.tool === 'pen' ? (this.penLayer === 'inner' ? 'peninner' : this.penLayer === 'outer' ? 'penouter' : this.penMode === 'mag' ? 'penmag' : 'pendraw') : this.tool === 'brush' ? 'paint' : this.pickZ ? 'pickz' : '';
      this.c.querySelectorAll('[data-act]').forEach((b) => b.classList.toggle('ve-live', b.dataset.act === on));
    }
    _marks() {   // ticks and the "you are here" step
      const gi = this._guide('inner'), go = this._guide('outer'), found = this.paths.find((P) => P.auto && P.layer === this.target), own = this.paths.filter((P) => !LAYER[P.layer].guide && P.layer === this.target);
      const name = this.target === 'blue' ? 'blue' : 'red', set = (k, t) => this.c.querySelectorAll(`[data-mark="${k}"]`).forEach((e) => { e.textContent = t; });
      set('inner', gi ? `✓ drawn (${gi.pts.length} points)` : 'not drawn yet'); set('outer', go ? `✓ drawn (${go.pts.length} points)` : 'not drawn yet');
      set('solved', found ? `✓ ${name} line found (${found.pts.length} points)` : 'not found yet');
      set('own', own.length ? `✓ ${own.length} ${name} line${own.length > 1 ? 's' : ''}` : 'not drawn yet');
      const np = this._paint().length; set('paint', np ? `\u2713 ${np} stroke${np > 1 ? 's' : ''}` : 'nothing painted yet');
      const done = { 1: { inner: !!gi, outer: !!go, solve: !!found }, 2: { draw: own.length > 0 }, 3: { draw: own.length > 0 }, 4: { paint: np > 0, solve: !!found } };
      this.c.querySelectorAll('.ve-steps').forEach((l) => { const d = done[+l.dataset.m]; let now = false; l.querySelectorAll('li').forEach((li) => { const ok = !!d[li.dataset.step]; li.classList.toggle('done', ok); const cur = !ok && !now; li.classList.toggle('now', cur); if (cur) now = true; }); });
    }

    act(a) {
      const P = this.paths[this.sel.path];
      if (a === 'undo') { if (!this.hist.length) return; this.redo.push(JSON.stringify(this.paths)); this.paths = JSON.parse(this.hist.pop()); this.sel = { path: -1, nodes: new Set() }; this._changed(); }
      else if (a === 'redo') { if (!this.redo.length) return; this.hist.push(JSON.stringify(this.paths)); this.paths = JSON.parse(this.redo.pop()); this.sel = { path: -1, nodes: new Set() }; this._changed(); }
      else if (a === 'fit') { this._fit(); this.draw(); }
      else if (a === 'full') this.setFull(!this.c.classList.contains('ve-full'));
      else if (a === 'zoomin') this._zoom(1.4); else if (a === 'zoomout') this._zoom(1 / 1.4);
      else if (a === 'backpoint') {
        if (!this.pen) return this.say('"Back one point" works while you are drawing a line.');
        if (this.pen.mag) { this.pen.anchors.pop(); this.pen.segs.pop(); if (!this.pen.anchors.length) this.pen = null; else { this.pen.pts = this._magPts(this.pen); this.pen.tree = this._magTree(this.pen.anchors[this.pen.anchors.length - 1]); } }
        else { this.pen.pts.pop(); if (!this.pen.pts.length) this.pen = null; }
        this.draw();
      }
      else if (a === 'delnode') { if (!P || !this.sel.nodes.size) return this.say('Click a point first (it turns yellow), then delete it.'); if (P.pts.length - this.sel.nodes.size < 3) return this.say('A line needs at least 3 points.'); this._push(); P.pts = P.pts.filter((_, i) => !this.sel.nodes.has(i)); this.sel.nodes.clear(); this._changed(LAYER[P.layer].guide); }
      else if (a === 'corner') { if (!P || !this.sel.nodes.size) return this.say('Click a point first (it turns yellow).'); this._push(); for (const i of this.sel.nodes) P.pts[i][2] = P.pts[i][2] ? 0 : 1; this._changed(); }
      else if (a === 'delpath') { if (!P) return this.say('Click a line first, then delete it.'); this._push(); this.paths.splice(this.sel.path, 1); this.sel = { path: -1, nodes: new Set() }; this._changed(); }
      else if (a === 'startover') { const keep = this.paths.filter((Q) => LAYER[Q.layer].guide ? (Q.t || 'blue') !== this.target : Q.layer !== this.target); if (keep.length === this.paths.length) return; this._push(); this.paths = keep; this.sel = { path: -1, nodes: new Set() }; this.setTool('edit'); this._changed(); this.say(`The ${this.target} line and its guides are removed. Undo brings them back.`); }
      else if (a === 'smooth') { if (!P) return this.say('Click a line first.'); this._push(); P.pts = chaikin(P.pts, 1); this.sel.nodes.clear(); this._edited(P); this._changed(LAYER[P.layer].guide); }
      else if (a === 'simplify') { if (!P) return this.say('Click a line first.'); this._push(); const before = P.pts.length, s = simplifySafe(P.pts.map((q) => q.slice()), Math.max(0.2, this._detail() * 2)); if (s.length >= 3) P.pts = s.map((q) => [q[0], q[1], q[2] || 0]); this.sel.nodes.clear(); this._edited(P); this._changed(LAYER[P.layer].guide); this.say(`${before} points reduced to ${P.pts.length}. Press again for fewer.`); }
      else if (a === 'grow' || a === 'shrink') { if (!P) return this.say('Click a line first.'); const d = Math.abs(+this._in('[data-num="off"]').value || 0.5) * (a === 'grow' ? 1 : -1); this._push(); const o = offsetPath(splinePts(P.pts, this.tension, 4), d); if (o.length >= 3) P.pts = cornerFlags(simplifySafe(o, this._detail()).map((q) => [q[0], q[1], 0])); this.sel.nodes.clear(); this._edited(P); this._changed(LAYER[P.layer].guide); this.say(`Line moved ${a === 'grow' ? 'outward' : 'inward'} by ${Math.abs(d)} mm.`); }
      else if (a === 'snap') { if (!P) return this.say('Click a line first.'); this._push(); this._snap(P); this._edited(P); this._changed(LAYER[P.layer].guide); }
      else if (a === 'penmag') { if (!this.o.heightMap) return this.say('The magnetic pen needs the height data of the model.'); this.penLayer = this.target; this.penMode = 'mag'; this.setTool('pen'); this.say('Magnetic pen: click once ON the edge to start, then move along the edge and click to pin the line down.'); }
      else if (a === 'paint') { if (!this.o.heightMap) return this.say('The brush needs the height data of the model.'); this.setTool('brush'); this.say('Brush: hold the mouse button and paint over the edge, all the way around until the ends meet.'); }
      else if (a === 'clearpaint') { if (!this._paint().length) return; this._push(); this.paths = this.paths.filter((Q) => !(Q.layer === 'paint' && (Q.t || 'blue') === this.target)); this._changed(); this.say('Paint cleared. Undo brings it back.'); }
      else if (a === 'brushsolve') this.brushSolve();
      else if (a === 'peninner' || a === 'penouter' || a === 'pendraw') {
        if (a !== 'pendraw' && !this.o.heightMap) return this.say('Method 1 needs the height data of the model.');
        this.penLayer = a === 'peninner' ? 'inner' : a === 'penouter' ? 'outer' : this.target; this.penMode = 'click'; this.setTool('pen');
        this.say(a === 'peninner' ? 'INSIDE line (green): click points just inside the edge you want. Finish with a click on the first point, a double-click, or Enter.'
          : a === 'penouter' ? 'OUTSIDE line (orange): click points just outside the edge you want. Finish with a click on the first point, a double-click, or Enter.'
            : `Drawing the ${this.target} line: click around the shape. Finish with a click on the first point, a double-click, or Enter.`);
      }
      else if (a === 'outerfrominner') this.outerFromInner();
      else if (a === 'pickz') { if (!this.o.heightMap) return; this.pen = null; this.tool = 'edit'; this.pickZ = true; this._live(); this.say('Click a spot on the picture that lies on the edge you want: its height becomes Z.'); }
      else if (a === 'solve') this.solveBand();
      else if (a === 'dxf') { if (!this.paths.some((Q) => !LAYER[Q.layer].guide)) return this.say('There is no line to save yet.'); this._download(this.toDXF(), (this.o.name || 'outline') + '.dxf', 'application/dxf'); this.say('DXF saved. The green and orange guide lines are not part of it.'); }
      else if (a === 'svg') { if (!this.paths.some((Q) => !LAYER[Q.layer].guide)) return this.say('There is no line to save yet.'); this._download(this.toSVG(), (this.o.name || 'outline') + '.svg', 'image/svg+xml'); }
      else if (a === 'json') this._download(this.toJSON(), (this.o.name || 'outline') + '_work.json', 'application/json');
    }
    _detail() { const t = +this._in('[data-rng="detail"]').value; return 0.6 * Math.pow(0.05 / 0.6, t); }   // slider 0..1 -> 0.6 .. 0.05 mm
    _edited(P) {   // a found line that is edited by hand must not be overwritten by the next automatic update
      if (!P || !P.auto) return; const cb = this._in('[data-chk="autosolve"]');
      if (cb.checked) { cb.checked = false; this._note = 'Automatic update is now OFF so your edits are kept. "Find the line" would replace them.'; }
    }

    /* ---------- snapping to height edges ---------- */
    _grad() {
      const hm = this.o.heightMap; if (!hm || this._g) return this._g;
      const { w, h, z } = hm, g = new Float32Array(w * h);
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; g[i] = Math.hypot(z[i + 1] - z[i - 1], z[i + w] - z[i - w]); }
      return (this._g = g);
    }
    _snap(P, radiusMm = 3) {
      const hm = this.o.heightMap, g = this._grad(); if (!g) return this.say('No height data loaded, so there is no edge to pull to.');
      const cell = hm.cell, r = Math.round(radiusMm / cell);
      const toMap = (p) => [Math.round((p[0] - this.o.originMm[0]) / cell), Math.round((this.o.originMm[1] - p[1]) / cell)];
      const idx = (this.sel.nodes.size ? [...this.sel.nodes] : P.pts.map((_, i) => i)).filter((i) => P.pts[i]);
      for (const i of idx) {
        const [cx, cy] = toMap(P.pts[i]); let best = -1, bx = cx, by = cy;
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          const x = cx + dx, y = cy + dy; if (x < 1 || y < 1 || x >= hm.w - 1 || y >= hm.h - 1 || dx * dx + dy * dy > r * r) continue;
          const v = g[y * hm.w + x] / (1 + 0.15 * Math.hypot(dx, dy));           // prefer near
          if (v > best) { best = v; bx = x; by = y; }
        }
        P.pts[i][0] = this.o.originMm[0] + bx * cell; P.pts[i][1] = this.o.originMm[1] - by * cell;
      }
      this.say(`${idx.length} point${idx.length > 1 ? 's' : ''} pulled to the nearest steep edge (within ${radiusMm} mm).`);
    }

    /* ---------- outside guide from the inside guide: one line drawn, not two ---------- */
    outerFromInner() {
      const gi = this._guide('inner'); if (!gi) return this.say('Draw the inside line first (step 1).');
      const gap = Math.max(1, +this.c.querySelector('[data-num="gap"]').value || 6);
      const outer = offsetPath(splinePts(gi.pts, this.tension, 4), gap, 0.4);
      if (outer.length < 3) return this.say('Could not make the outside line: try a smaller gap.');
      this._push();
      this.paths = this.paths.filter((P) => !(P.layer === 'outer' && (P.t || 'blue') === this.target));
      this.paths.push({ layer: 'outer', t: this.target, pts: simplifySafe(outer, 0.3).map((q) => [q[0], q[1], 0]) });
      this.setTool('edit'); this._changed(true);
      this.say(`Outside line made ${gap} mm outside the inside line. If the edge you want leaves the band somewhere, drag the orange points there.`);
    }

    _maybeAutoSolve() {
      if ((this.method !== 1 && this.method !== 4) || !this._in('[data-chk="autosolve"]').checked) return;
      if (!this._guide('inner') || !this._guide('outer')) return;
      clearTimeout(this._autoT); this._autoT = setTimeout(() => this.solveBand(true), 220);
    }

    /* ---------- band solver: the boundary between the inner and outer guides ---------- */
    solveBand(quiet = false) {
      const hm = this.o.heightMap; if (!hm) return this.say('Method 1 needs the height data of the model.');
      const gi = this._guide('inner'), go = this._guide('outer');
      if (!gi || !go) return this.say(!gi ? 'Draw the inside line first (step 1).' : 'Now the outside line is needed (step 2).');
      let I = splinePts(gi.pts, this.tension, 6), O = splinePts(go.pts, this.tension, 6);
      const area = (p) => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[i], r = p[(i + 1) % p.length]; a += q[0] * r[1] - r[0] * q[1]; } return a / 2; };
      if (Math.abs(area(I)) > Math.abs(area(O))) [I, O] = [O, I];
      if (area(I) < 0) I.reverse(); if (area(O) < 0) O.reverse();
      I = resample(I, Math.max(0.4, hm.cell * 2)); O = resample(O, Math.max(0.4, hm.cell));
      // RUNGS as flow lines of the distance field from the inner guide (2026-09-29):
      // straight normals crossed the band in concavities and the boundary jumped
      // across the shape. Flow lines of a distance field never cross each other,
      // so every rung stays inside the band and the boundary cannot self-intersect.
      const res = Math.max(0.25, hm.cell * 0.75);
      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      for (const q of O) { bx0 = Math.min(bx0, q[0]); by0 = Math.min(by0, q[1]); bx1 = Math.max(bx1, q[0]); by1 = Math.max(by1, q[1]); }
      const pad = 2 * res, GW = Math.ceil((bx1 - bx0 + 2 * pad) / res), GH = Math.ceil((by1 - by0 + 2 * pad) / res);
      if (GW * GH > 16e6) return this.say('The band is too large to solve at this resolution.');
      const toG = (q) => [(q[0] - bx0 + pad) / res, (q[1] - by0 + pad) / res], fromG = (x, y) => [bx0 - pad + x * res, by0 - pad + y * res];
      const rast = (poly) => { const c = document.createElement('canvas'); c.width = GW; c.height = GH; const g2 = c.getContext('2d'); g2.fillStyle = '#000'; g2.fillRect(0, 0, GW, GH); g2.fillStyle = '#fff'; g2.beginPath(); poly.forEach((q, i) => { const [x, y] = toG(q); i ? g2.lineTo(x, y) : g2.moveTo(x, y); }); g2.closePath(); g2.fill(); const d = g2.getImageData(0, 0, GW, GH).data, m = new Uint8Array(GW * GH); for (let i = 0; i < m.length; i++) m[i] = d[i * 4] > 127 ? 1 : 0; return m; };
      const inM = rast(I), outM = rast(O);
      { let band = 0; for (let i = 0; i < inM.length; i++) if (outM[i] && !inM[i]) band++; if (band < 50) return this.say('The inside and outside lines lie on top of each other: there is no band between them. Move one of them.'); }
      // chamfer distance (3-4) from the inner region
      const INF = 1e9, dist = new Float32Array(GW * GH); for (let i = 0; i < dist.length; i++) dist[i] = inM[i] ? 0 : INF;
      for (let y = 1; y < GH; y++) for (let x = 0; x < GW; x++) { const i = y * GW + x; let v = dist[i]; v = Math.min(v, dist[i - GW] + 3); if (x > 0) v = Math.min(v, dist[i - 1] + 3, dist[i - GW - 1] + 4); if (x < GW - 1) v = Math.min(v, dist[i - GW + 1] + 4); dist[i] = v; }
      for (let y = GH - 2; y >= 0; y--) for (let x = GW - 1; x >= 0; x--) { const i = y * GW + x; let v = dist[i]; v = Math.min(v, dist[i + GW] + 3); if (x < GW - 1) v = Math.min(v, dist[i + 1] + 3, dist[i + GW + 1] + 4); if (x > 0) v = Math.min(v, dist[i + GW - 1] + 4); dist[i] = v; }
      const dAt = (x, y) => dist[clamp(Math.round(y), 0, GH - 1) * GW + clamp(Math.round(x), 0, GW - 1)];
      const inBand = (x, y) => { const xi = Math.round(x), yi = Math.round(y); return xi >= 0 && yi >= 0 && xi < GW && yi < GH && outM[yi * GW + xi] && !inM[yi * GW + xi]; };
      const N = I.length, M = 48, rungs = [];
      for (let k = 0; k < N; k++) {
        let [x, y] = toG(I[k]); const line = [[x, y]]; let steps = 0;
        // start just outside the inner region
        for (let t = 0; t < 6 && !inBand(x, y); t++) { const gx = dAt(x + 1, y) - dAt(x - 1, y), gy = dAt(x, y + 1) - dAt(x, y - 1), L = Math.hypot(gx, gy) || 1; x += gx / L * 0.7; y += gy / L * 0.7; }
        while (steps++ < 4 * (GW + GH)) {
          const gx = dAt(x + 1, y) - dAt(x - 1, y), gy = dAt(x, y + 1) - dAt(x, y - 1), L = Math.hypot(gx, gy);
          if (L < 1e-6) break;
          x += gx / L * 0.7; y += gy / L * 0.7;
          if (!inBand(x, y)) break;
          line.push([x, y]);
        }
        if (line.length < 2) { const q = toG(nearestOn(I[k], O)); line.push(q); }
        // resample the flow line into M points (mm)
        const mm = line.map((q) => fromG(q[0], q[1])); let total = 0; const cum = [0]; for (let i = 1; i < mm.length; i++) { total += dist2(mm[i - 1], mm[i]); cum.push(total); }
        const r = []; for (let j = 0; j < M; j++) { const tgt = total * (j + 0.5) / M; let i = 1; while (i < cum.length - 1 && cum[i] < tgt) i++; const t = cum[i] - cum[i - 1] > 1e-9 ? (tgt - cum[i - 1]) / (cum[i] - cum[i - 1]) : 0; r.push([mm[i - 1][0] + t * (mm[i][0] - mm[i - 1][0]), mm[i - 1][1] + t * (mm[i][1] - mm[i - 1][1])]); }
        rungs.push(r);
      }
      const cost = this._in('[data-sel="cost"]').value, Zv = +this._in('[data-rng="zlev"]').value, stiff = +this._in('[data-rng="stiff"]').value;
      const g = this._grad(), gmax = this._gmax();
      const zAt = (p) => { const x = (p[0] - this.o.originMm[0]) / hm.cell, y = (this.o.originMm[1] - p[1]) / hm.cell; const xi = clamp(Math.round(x), 0, hm.w - 1), yi = clamp(Math.round(y), 0, hm.h - 1); return [hm.z[yi * hm.w + xi], g[yi * hm.w + xi]]; };
      const C = new Float32Array(N * M);
      for (let k = 0; k < N; k++) for (let j = 0; j < M; j++) { const [z, gr] = zAt(rungs[k][j]); C[k * M + j] = cost === 'level' ? Math.min(1, Math.abs(z - Zv) / 2) : 1 - Math.min(1, gr / gmax); }
      // dynamic programming around the ring with exact closure: every start position on rung 0 is tried
      const lam = 0.02 + stiff * 0.5, R = 3; let bestTot = Infinity, bestPath = null;
      const D = new Float32Array(N * M), B = new Int16Array(N * M);
      for (let j0 = 0; j0 < M; j0++) {
        for (let j = 0; j < M; j++) D[j] = j === j0 ? C[j] : 1e9;
        for (let k = 1; k < N; k++) for (let j = 0; j < M; j++) {
          let bv = 1e9, bj = j;
          for (let d = -R; d <= R; d++) { const pj = j + d; if (pj < 0 || pj >= M) continue; const v = D[(k - 1) * M + pj] + lam * Math.abs(d); if (v < bv) { bv = v; bj = pj; } }
          D[k * M + j] = bv + C[k * M + j]; B[k * M + j] = bj;
        }
        let bj = j0, bv = 1e9;
        for (let d = -R; d <= R; d++) { const pj = j0 + d; if (pj < 0 || pj >= M) continue; const v = D[(N - 1) * M + pj] + lam * Math.abs(d); if (v < bv) { bv = v; bj = pj; } }
        if (bv < bestTot) { bestTot = bv; const path = new Int16Array(N); let j = bj; for (let k = N - 1; k >= 0; k--) { path[k] = j; j = B[k * M + j]; } bestPath = path; }
      }
      const pts = []; for (let k = 0; k < N; k++) pts.push(rungs[k][bestPath[k]]);
      // node count is decided by the shape: straight runs keep few nodes, curves keep many, within `detail` mm of the solved edge
      const detail = this._detail();
      const simp = this._finish(chaikin(pts, 1), detail);
      const layer = this.target, at = this.paths.findIndex((P) => P.auto && P.layer === layer);
      this._push();
      if (at >= 0) this.paths[at] = { layer, auto: 1, pts: simp }; else this.paths.push({ layer, auto: 1, pts: simp });
      if (!quiet) { if (this.tool === 'pen') this.setTool('edit'); this.sel = { path: at >= 0 ? at : this.paths.length - 1, nodes: new Set() }; }
      this._marks(); this.draw(); this.o.onChange && this.o.onChange(this.getPaths());
      const rough = this._spots({ pts: simp }).length;
      this.say(`${layer === 'blue' ? 'Blue' : 'Red'} line found: ${simp.length} points.${rough ? ` ${rough} place${rough > 1 ? 's look' : ' looks'} rough (yellow ring): zoom in there.` : ''} Not right somewhere? ${this.method === 4 ? 'Paint again there with a narrower brush, or drag the points of the line.' : 'Drag a green or orange point there, or drag the points of the line.'} Then save.`);
    }

    /* places where a found line zigzags (4 or more sharp turns within 12 mm): shown as yellow rings so the eye goes there first */
    _spots(P) {
      const p = P.pts, n = p.length, out = []; if (n < 8) return out;
      const sharp = p.map((q, i) => { const a = p[(i - 1 + n) % n], b = p[(i + 1) % n], ux = q[0] - a[0], uy = q[1] - a[1], vx = b[0] - q[0], vy = b[1] - q[1]; return (ux * vx + uy * vy) / ((Math.hypot(ux, uy) || 1) * (Math.hypot(vx, vy) || 1)) < 0.5 ? 1 : 0; });
      for (let i = 0; i < n; i++) {
        if (!sharp[i]) continue; let len = 0, cnt = 1, j = i, cx = p[i][0], cy = p[i][1];
        while (len < 12 && cnt < 50) { const k = (j + 1) % n; if (k === i) break; len += dist(p[j], p[k]); j = k; if (len < 12 && sharp[j]) { cnt++; cx += p[j][0]; cy += p[j][1]; } }
        if (cnt >= 4 && !out.some((o) => Math.hypot(o[0] - cx / cnt, o[1] - cy / cnt) < 14)) out.push([cx / cnt, cy / cnt]);
      }
      return out;
    }

    /* a solved or traced polyline becomes nodes: never self-crossing, neither as a polygon nor as the drawn curve */
    _finish(poly, detail) {
      const nodes = (p) => cornerFlags(simplifySafe(p, detail).map((q) => [q[0], q[1], 0]));
      // where a line doubles back or neighbouring rungs converge it can cross itself; a raster
      // round trip keeps only the outer boundary of the filled shape
      const cleaned = offsetPath(poly, 0.001, Math.max(0.15, detail * 0.6));
      let simp = nodes(cleaned.length >= 3 ? cleaned : poly);
      if (hasCrossing(splinePts(simp, this.tension, 8))) { const c2 = offsetPath(splinePts(simp, this.tension, 8), 0.001, 0.15); if (c2.length >= 3) simp = nodes(c2); }
      if (hasCrossing(splinePts(simp, this.tension, 8))) simp = simp.map((q) => [q[0], q[1], 1]);      // straight runs cannot overshoot
      return simp;
    }

    /* ---------- Method 3, magnetic pen: between two clicks the line is the cheapest way along the edge ---------- */
    _gmax() { if (this._gm) return this._gm; const g = this._grad(), sv = []; for (let i = 0; i < g.length; i += 97) sv.push(g[i]); sv.sort((a, b) => a - b); return (this._gm = sv[Math.floor(sv.length * 0.98)] || 1); }
    _toMap(p) { const hm = this.o.heightMap; return [clamp(Math.round((p[0] - this.o.originMm[0]) / hm.cell), 0, hm.w - 1), clamp(Math.round((this.o.originMm[1] - p[1]) / hm.cell), 0, hm.h - 1)]; }
    _fromMap(x, y) { const c = this.o.heightMap.cell; return [this.o.originMm[0] + x * c, this.o.originMm[1] - y * c]; }
    _snapPt(p, radiusMm) {   // the steepest spot near p, nearer spots preferred
      const hm = this.o.heightMap, g = this._grad(), r = Math.round(radiusMm / hm.cell), [cx, cy] = this._toMap(p); let best = -1, bx = cx, by = cy;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const x = cx + dx, y = cy + dy; if (x < 1 || y < 1 || x >= hm.w - 1 || y >= hm.h - 1 || dx * dx + dy * dy > r * r) continue; const v = g[y * hm.w + x] / (1 + 0.15 * Math.hypot(dx, dy)); if (v > best) { best = v; bx = x; by = y; } }
      return this._fromMap(bx, by);
    }
    _magTree(mm) {           // Dijkstra from the anchor over a 45 mm window; cost is low on the edge that is followed
      const hm = this.o.heightMap, g = this._grad(), gmax = this._gmax(), R = Math.round(45 / hm.cell), [ax, ay] = this._toMap(mm);
      const x0 = Math.max(0, ax - R), y0 = Math.max(0, ay - R), W = Math.min(hm.w - 1, ax + R) - x0 + 1, H = Math.min(hm.h - 1, ay + R) - y0 + 1, n = W * H;
      const level = this._in('[data-sel="cost"]').value === 'level', Zv = +this._in('[data-rng="zlev"]').value, cost = new Float32Array(n);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y + y0) * hm.w + x + x0, c = level ? Math.min(1, Math.abs(hm.z[i] - Zv) / 1.5) : 1 - Math.min(1, g[i] / gmax); cost[y * W + x] = 0.02 + c * c; }
      const D = new Float32Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), done = new Uint8Array(n), hk = [], hv = [];
      const push = (k, v) => { let i = hk.length; hk.push(k); hv.push(v); while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= k) break; hk[i] = hk[p]; hv[i] = hv[p]; i = p; } hk[i] = k; hv[i] = v; };
      const pop = () => { const top = hv[0], lk = hk.pop(), lv = hv.pop(), m = hk.length; if (m) { let i = 0; for (;;) { let c = 2 * i + 1; if (c >= m) break; if (c + 1 < m && hk[c + 1] < hk[c]) c++; if (hk[c] >= lk) break; hk[i] = hk[c]; hv[i] = hv[c]; i = c; } hk[i] = lk; hv[i] = lv; } return top; };
      const s = (ay - y0) * W + (ax - x0), dx = [1, -1, 0, 0, 1, 1, -1, -1], dy = [0, 0, 1, -1, 1, -1, 1, -1]; D[s] = 0; push(0, s);
      while (hk.length) {
        const u = pop(); if (done[u]) continue; done[u] = 1; const ux = u % W, uy = (u - ux) / W;
        for (let k = 0; k < 8; k++) { const vx = ux + dx[k], vy = uy + dy[k]; if (vx < 0 || vy < 0 || vx >= W || vy >= H) continue; const v = vy * W + vx; if (done[v]) continue; const nd = D[u] + cost[v] * (k < 4 ? 1 : 1.4142); if (nd < D[v]) { D[v] = nd; prev[v] = u; push(nd, v); } }
      }
      return { x0, y0, W, H, prev, s };
    }
    _magPath(tree, mm) {     // anchor -> mm along the tree, in mm; beyond the window the rest is a straight line
      const [tx, ty] = this._toMap(mm), cx = clamp(tx, tree.x0, tree.x0 + tree.W - 1), cy = clamp(ty, tree.y0, tree.y0 + tree.H - 1), out = [];
      let u = (cy - tree.y0) * tree.W + (cx - tree.x0), guard = 0;
      while (u >= 0 && guard++ < 1e6) { const x = u % tree.W, y = (u - x) / tree.W; out.push(this._fromMap(x + tree.x0, y + tree.y0)); if (u === tree.s) break; u = tree.prev[u]; }
      out.reverse(); if (cx !== tx || cy !== ty) out.push([mm[0], mm[1]]); return out;
    }
    _magPts(pen) { const out = [[pen.anchors[0][0], pen.anchors[0][1], 0]]; for (const sg of pen.segs) for (let i = 1; i < sg.length; i++) out.push([sg[i][0], sg[i][1], 0]); return out; }
    _retree() { if (this.pen && this.pen.mag) this.pen.tree = this._magTree(this.pen.anchors[this.pen.anchors.length - 1]); }
    _magClick(s) {
      const level = this._in('[data-sel="cost"]').value === 'level', raw = this.scrToMm(s), a = level ? raw : this._snapPt(raw, Math.min(2.5, Math.max(0.6, 8 * this.pxMm() / this.dpr)));
      if (!this.pen) { this.pen = { layer: this.target, mag: true, anchors: [a], segs: [], pts: [[a[0], a[1], 0]] }; }
      else if (this.pen.anchors.length > 2 && dist(this.mmToScr(this.pen.anchors[0]), s) < 10 * this.dpr) return this._closePen();
      else { this.pen.segs.push(this._magPath(this.pen.tree, a)); this.pen.anchors.push(a); this.pen.pts = this._magPts(this.pen); }
      this.pen.tree = this._magTree(a); this.draw();
    }

    /* ---------- Method 4, brush: the paint IS the band; its two rims become the guides ---------- */
    brushSolve(quiet = false) {
      const hm = this.o.heightMap; if (!hm) return this.say('The brush needs the height data of the model.');
      const strokes = this._paint(); if (!strokes.length) return this.say('Paint over the edge first (step 1).');
      const res = Math.max(0.4, hm.cell * 1.5), GW = Math.ceil(hm.w * hm.cell / res) + 2, GH = Math.ceil(hm.h * hm.cell / res) + 2, [ox, oy] = this.o.originMm;
      const c = document.createElement('canvas'); c.width = GW; c.height = GH; const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, GW, GH);
      g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round';
      // the paint stays 1 cell inside the raster so both rims are closed loops
      g.save(); g.beginPath(); g.rect(1, 1, GW - 2, GH - 2); g.clip();
      for (const S of strokes) { const q = S.pts.map((p) => [(p[0] - ox) / res + 1, (oy - p[1]) / res + 1]); g.lineWidth = 2 * S.r / res; g.beginPath(); q.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); if (q.length === 1) g.lineTo(q[0][0] + 0.01, q[0][1]); g.stroke(); }
      g.restore();
      const d = g.getImageData(0, 0, GW, GH).data, mask = new Uint8Array(GW * GH); for (let i = 0; i < mask.length; i++) mask[i] = d[i * 4] > 127 ? 1 : 0;
      const loops = traceMask(mask, GW, GH).map((l) => l.map(([x, y]) => [ox + (x - 1) * res, oy - (y - 1) * res])).map((l) => ({ l, a: Math.abs(polyArea(l)) })).sort((p, q) => q.a - p.a);
      const outer = loops[0], inner = outer && loops.slice(1).find((h) => h.a > 0.08 * outer.a && pointIn(h.l[0], outer.l));
      if (!outer || !inner) { if (!quiet) this.say('The paint does not go all the way around yet. Keep painting until the two ends meet.'); return false; }
      const mk = (l) => simplifySafe(l, 0.3).map((q) => [q[0], q[1], 0]);
      this.paths = this.paths.filter((P) => !((P.layer === 'inner' || P.layer === 'outer') && (P.t || 'blue') === this.target));
      this.paths.push({ layer: 'inner', t: this.target, pts: mk(inner.l) }, { layer: 'outer', t: this.target, pts: mk(outer.l) });
      const keep = this.tool; this.solveBand(quiet); if (keep === 'brush' && this.tool !== 'brush') this.setTool('brush'); return true;
    }

    /* ---------- hit testing ---------- */
    _hit(s) {
      const tolN = 9 * this.dpr, tolS = 6 * this.dpr; let best = null;
      this.paths.forEach((P, pi) => {
        if (!this._editable(P)) return;
        P.pts.forEach((q, ni) => { const d = dist(s, this.mmToScr(q)); if (d < tolN && (!best || d < best.d)) best = { type: 'node', path: pi, node: ni, d }; });
      });
      if (best) return best;
      this.paths.forEach((P, pi) => {
        if (!this._editable(P)) return;
        const poly = splinePts(P.pts, this.tension, 6).map((q) => this.mmToScr(q));
        const per = Math.max(1, Math.round(poly.length / P.pts.length));
        for (let i = 0; i < poly.length; i++) { const [d] = segDist(s, poly[i], poly[(i + 1) % poly.length]); if (d < tolS && (!best || d < best.d)) best = { type: 'seg', path: pi, seg: Math.floor(i / per), d, at: this.scrToMm(s) }; }
      });
      return best;
    }

    /* ---------- events ---------- */
    _bind() {
      const cv = this.cv; let space = false;
      cv.addEventListener('contextmenu', (e) => e.preventDefault());
      cv.addEventListener('wheel', (e) => { e.preventDefault(); this._zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, this._evt(e)); }, { passive: false });
      cv.addEventListener('pointerdown', (e) => {
        try { cv.setPointerCapture(e.pointerId); } catch (_) { /* a pen or a scripted pointer may have no capture */ }
        const s = this._evt(e);
        if (e.button === 1 || space || this.tool === 'pan' || e.button === 2) { this.drag = { type: 'pan', s, v: { ...this.view } }; return; }
        if (this.pickZ) {
          const z = this._zAt(this.scrToMm(s)); this.pickZ = false; this._live();
          if (z === null) return this.say('That spot is outside the model. Press "Pick from the picture" and click on the model.');
          const r = this._in('[data-rng="zlev"]'); r.value = z; r.closest('.ve-pair').querySelector('output').textContent = (+r.value).toFixed(2); this._retree();
          this.say(`Z set to ${(+r.value).toFixed(2)} mm.`); this._maybeAutoSolve(); return;
        }
        if (this.tool === 'brush') { const mm = this.scrToMm(s); this._push(); this.paths.push({ layer: 'paint', t: this.target, r: +this._in('[data-rng="brush"]').value / 2, pts: [[mm[0], mm[1], 0]] }); this.drag = { type: 'paint', last: s }; this.draw(); return; }
        if (this.tool === 'pen' && this.penMode === 'mag') { this._magClick(s); return; }
        if (this.tool === 'pen') {
          const mm = this.scrToMm(s), sharp = LAYER[this.penLayer].guide ? 1 : 0;
          if (!this.pen) { this.pen = { layer: this.penLayer, pts: [[mm[0], mm[1], sharp]] }; }
          else if (this.pen.pts.length > 2 && dist(this.mmToScr(this.pen.pts[0]), s) < 10 * this.dpr) { this._closePen(); return; }
          else this.pen.pts.push([mm[0], mm[1], sharp]);
          this.penDrag = { last: s, moved: false };            // drag = freehand
          this.draw(); return;
        }
        const h = this._hit(s);
        if (this.tool === 'add') {
          if (h && h.type === 'seg') { this._push(); const P = this.paths[h.path]; P.pts.splice(h.seg + 1, 0, [h.at[0], h.at[1], 0]); this.sel = { path: h.path, nodes: new Set([h.seg + 1]) }; this._edited(P); this._changed(LAYER[P.layer].guide); }
          else this.say('Click ON a line to add a point there.');
          return;
        }
        if (h && h.type === 'node') {
          if (e.shiftKey && this.sel.path === h.path) { this.sel.nodes.has(h.node) ? this.sel.nodes.delete(h.node) : this.sel.nodes.add(h.node); }
          else if (!(this.sel.path === h.path && this.sel.nodes.has(h.node))) this.sel = { path: h.path, nodes: new Set([h.node]) };
          this.drag = { type: 'nodes', s, start: this.paths[h.path].pts.map((q) => q.slice()), pushed: false }; this.draw(); return;
        }
        if (h && h.type === 'seg') { this.sel = { path: h.path, nodes: new Set() }; this.drag = { type: 'path', s, start: this.paths[h.path].pts.map((q) => q.slice()), pushed: false }; this.draw(); return; }
        this.sel = { path: this.sel.path, nodes: new Set() }; this.marquee = { a: s, b: s }; this.draw();
      });
      cv.addEventListener('pointermove', (e) => {
        const s = this._evt(e); this.cursor = s;
        if (this.penDrag && this.pen && (e.buttons & 1)) {
          if (dist(s, this.penDrag.last) > 7 * this.dpr) { const mm = this.scrToMm(s); this.pen.pts.push([mm[0], mm[1], 0]); this.penDrag.last = s; this.penDrag.moved = true; this.draw(); }
          return;
        }
        if (this.drag && this.drag.type === 'paint') { if (dist(s, this.drag.last) > 3 * this.dpr) { const mm = this.scrToMm(s); this.paths[this.paths.length - 1].pts.push([mm[0], mm[1], 0]); this.drag.last = s; this.draw(); } return; }
        if (this.drag && this.drag.type === 'pan') { this.view.tx = this.drag.v.tx + s[0] - this.drag.s[0]; this.view.ty = this.drag.v.ty + s[1] - this.drag.s[1]; this.draw(); return; }
        if (this.drag && (this.drag.type === 'nodes' || this.drag.type === 'path')) {
          const P = this.paths[this.sel.path];
          if (!this.drag.pushed) { if (dist(s, this.drag.s) < 3 * this.dpr) return; this.hist.push(JSON.stringify(this.paths.map((Q, i) => i === this.sel.path ? { ...Q, pts: this.drag.start } : Q))); this.redo = []; this.drag.pushed = true; this._edited(P); }
          const dm = this.pxMm() / this.dpr, dx = (s[0] - this.drag.s[0]) * dm, dy = -(s[1] - this.drag.s[1]) * dm;
          const idx = this.drag.type === 'path' ? P.pts.map((_, i) => i) : [...this.sel.nodes];
          for (const i of idx) { P.pts[i][0] = this.drag.start[i][0] + dx; P.pts[i][1] = this.drag.start[i][1] + dy; }
          this.draw(); return;
        }
        if (this.marquee) { this.marquee.b = s; this.draw(); return; }
        this.hover = this.tool === 'pen' || this.tool === 'brush' ? null : this._hit(s); const mm = this.scrToMm(s), z = this._zAt(mm);
        cv.style.cursor = this.tool === 'pan' || space ? 'grab' : this.pickZ || this.tool === 'pen' || this.tool === 'brush' ? 'crosshair' : this.hover ? (this.hover.type === 'node' ? 'move' : 'pointer') : 'default';
        const P = this.paths[this.sel.path];
        this.status.textContent = `X ${mm[0].toFixed(1)}  Y ${mm[1].toFixed(1)}${z !== null ? '  height ' + z.toFixed(2) : ''} mm` + (this.pen ? `  |  drawing: ${(this.pen.anchors || this.pen.pts).length} points` : P ? `  |  ${LAYER[P.layer].name}: ${P.pts.length} points, ${this.sel.nodes.size} selected` : '') + (this._said ? '  |  ' + this._said : '');
        this.draw();
      });
      const up = () => {
        if (this.penDrag) { const moved = this.penDrag.moved; this.penDrag = null; if (moved && this.pen && this.pen.pts.length >= 3) { this._closePen(); return; } }
        if (this.drag && this.drag.type === 'paint') { this.drag = null; this._marks(); this.o.onChange && this.o.onChange(this.getPaths()); if (this._in('[data-chk="autosolve"]').checked) { if (this.brushSolve(true) === false) this.say('Keep painting until the two ends meet. The line is found as soon as the paint goes all the way around.'); } else this.say('Painted. Press "Find the line" when the paint goes all the way around.'); this.draw(); return; }
        if (this.drag && this.drag.pushed) { const P = this.paths[this.sel.path]; this._marks(); this.o.onChange && this.o.onChange(this.getPaths()); if (P && LAYER[P.layer].guide) this._maybeAutoSolve(); if (this._note) { this.say(this._note); this._note = ''; } }
        if (this.marquee) {
          const { a, b } = this.marquee, x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
          if (x1 - x0 > 4 && y1 - y0 > 4) {
            const inBox = (q) => { const t = this.mmToScr(q); return t[0] >= x0 && t[0] <= x1 && t[1] >= y0 && t[1] <= y1; };
            let pick = this.sel.path; if (pick >= 0 && !(this.paths[pick] && this._editable(this.paths[pick]) && this.paths[pick].pts.some(inBox))) pick = -1;
            if (pick < 0) this.paths.forEach((P, pi) => { if (pick < 0 && this._editable(P) && P.pts.some(inBox)) pick = pi; });
            if (pick >= 0) { this.sel = { path: pick, nodes: new Set() }; this.paths[pick].pts.forEach((q, i) => { if (inBox(q)) this.sel.nodes.add(i); }); }
          }
          this.marquee = null;
        }
        this.drag = null; this.draw();
      };
      cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
      cv.addEventListener('pointerleave', () => { this.cursor = null; this.draw(); });
      cv.addEventListener('dblclick', (e) => {
        if (this.pen && this.pen.mag) { const A = this.pen.anchors, n = A.length; if (n > 1 && dist(this.mmToScr(A[n - 1]), this.mmToScr(A[n - 2])) < 6 * this.dpr) { A.pop(); this.pen.segs.pop(); this.pen.tree = this._magTree(A[A.length - 1]); } this._closePen(); return; }
        if (this.pen) { const p = this.pen.pts, n = p.length; if (n > 1 && dist(this.mmToScr(p[n - 1]), this.mmToScr(p[n - 2])) < 6 * this.dpr) p.pop(); this._closePen(); return; }
        const h = this._hit(this._evt(e)); if (h && h.type === 'node') { this._push(); const q = this.paths[h.path].pts[h.node]; q[2] = q[2] ? 0 : 1; this._changed(); }
      });
      window.addEventListener('keydown', (e) => {
        if (!this.c.isConnected || (e.target && /input|select|textarea/i.test(e.target.tagName))) return;
        if (e.code === 'Space') { space = true; cv.style.cursor = 'grab'; e.preventDefault(); return; }
        const k = e.key.toLowerCase();
        if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); this.act('undo'); }
        else if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); this.act('redo'); }
        else if (e.ctrlKey || e.metaKey || e.altKey) return;
        else if (k === 'backspace' && this.pen) { e.preventDefault(); this.act('backpoint'); }
        else if (k === 'delete' || k === 'backspace') { e.preventDefault(); this.act('delnode'); }
        else if (k === 'c') this.act('corner'); else if (k === 'v') this.setTool('edit'); else if (k === 'a') this.setTool('add');
        else if (k === 'h') this.setTool('pan'); else if (k === 'f') this.act('fit');
        else if (k === '+' || k === '=') this.act('zoomin'); else if (k === '-') this.act('zoomout');
        else if (k === 'enter' && this.pen) this._closePen(); else if (k === 'escape') { this.pen = null; this.penDrag = null; this.pickZ = false; this.sel.nodes.clear(); if (this.tool === 'pen' || this.tool === 'brush') this.setTool('edit'); this._live(); this.draw(); }
        else if (k === 's' && this.method === 1) this.act('solve'); else if (k === 's' && this.method === 4) this.act('brushsolve');
      });
      window.addEventListener('keyup', (e) => { if (e.code === 'Space') { space = false; cv.style.cursor = 'default'; } });
    }
    _closePen() {
      if (!this.pen) return;
      if (this.pen.mag) {
        const pen = this.pen; if (pen.anchors.length < 3) return this.say('Click at least 3 times along the edge before you close the line.');
        pen.segs.push(this._magPath(pen.tree, pen.anchors[0])); const raw = this._magPts(pen), detail = this._detail();
        const n = raw.length, soft = raw.map((_, i) => { let x = 0, y = 0; for (let k = -2; k <= 2; k++) { const q = raw[(i + k + n) % n]; x += q[0]; y += q[1]; } return [x / 5, y / 5]; });   // the pixel staircase is averaged away
        const pts = this._finish(soft, detail);
        this._push(); this.paths.push({ layer: pen.layer, pts }); this.pen = null; this.sel = { path: this.paths.length - 1, nodes: new Set() }; this.setTool('edit'); this._changed();
        return this.say(`${pen.layer === 'blue' ? 'Blue' : 'Red'} line traced: ${pts.length} points from your ${pen.anchors.length} clicks. Drag any point to correct it, then save.`);
      }
      if (this.pen.pts.length < 3) return this.say('A line needs at least 3 points: keep clicking.');
      const layer = this.pen.layer, guide = LAYER[layer].guide; let pts = this.pen.pts;
      if (pts.length > 40) { const sp = simplifyDP(pts, Math.max(0.2, this.pxMm() * 1.5)); if (sp.length >= 3) pts = sp.map((q) => [q[0], q[1], 0]); }   // freehand: thin the points
      if (!guide) pts = cornerFlags(pts);                                                           // a hand-drawn line is a smooth curve with sharp turns kept sharp
      this._push();
      if (guide) this.paths = this.paths.filter((P) => !(P.layer === layer && (P.t || 'blue') === this.target));   // one inside and one outside line per colour
      this.paths.push(guide ? { layer, t: this.target, pts } : { layer, pts }); this.pen = null;
      const gi = this._guide('inner'), go = this._guide('outer');
      if (guide && !(gi && go)) {                                    // straight on to the other guide
        this.penLayer = gi ? 'outer' : 'inner'; this.sel = { path: -1, nodes: new Set() }; this.setTool('pen'); this._changed(false);
        return this.say(gi ? 'Inside line done. Now the OUTSIDE line (orange): click points just outside the edge. Or press "Make it from the inside line".' : 'Outside line done. Now the INSIDE line (green): click points just inside the edge.');
      }
      this.sel = { path: this.paths.length - 1, nodes: new Set() }; this.setTool('edit'); this._changed(guide);
      if (guide) this.say(this._in('[data-chk="autosolve"]').checked ? 'Both lines are ready: finding the edge between them...' : 'Both lines are ready: press "Find the line".');
      else this.say(`${layer === 'blue' ? 'Blue' : 'Red'} line drawn with ${pts.length} points. Drag any point to correct it, then save.`);
    }

    /* ---------- drawing ---------- */
    draw() {
      const g = this.g, W = this.cv.width, H = this.cv.height; g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, H);
      g.fillStyle = '#2b2b2b'; g.fillRect(0, 0, W, H);
      if (this.o.image) { g.save(); g.globalAlpha = this.imgAlpha; g.imageSmoothingEnabled = this.view.s < 2; g.setTransform(this.view.s, 0, 0, this.view.s, this.view.tx, this.view.ty); g.drawImage(this.o.image, 0, 0); g.restore(); }
      const gi = this.method === 1 && this._guide('inner'), go = this.method === 1 && this._guide('outer');
      if (gi && go) {
        g.beginPath();
        for (const P of [go, gi]) { const poly = splinePts(P.pts, this.tension, 8).map((q) => this.mmToScr(q)); poly.forEach((q, i) => i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])); g.closePath(); }
        g.fillStyle = 'rgba(255, 210, 60, 0.18)'; g.fill('evenodd');
      }
      for (const P of this.paths) {
        if (P.layer !== 'paint' || !this._shown(P)) continue;
        const q = P.pts.map((p) => this.mmToScr(p)); g.beginPath(); q.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); if (q.length === 1) g.lineTo(q[0][0] + 0.01, q[0][1]);
        g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = 2 * P.r / this.o.mmPerPx * this.view.s; g.strokeStyle = 'rgba(255, 210, 60, 0.32)'; g.stroke(); g.lineCap = 'butt'; g.lineJoin = 'miter';
      }
      if (this.tool === 'brush' && this.cursor) { const r = +this._in('[data-rng="brush"]').value / 2 / this.o.mmPerPx * this.view.s; g.beginPath(); g.arc(this.cursor[0], this.cursor[1], r, 0, 7); g.lineWidth = 1.5 * this.dpr; g.strokeStyle = '#ffd23f'; g.stroke(); }
      this.paths.forEach((P, pi) => {
        if (!this._editable(P)) return;
        const col = LAYER[P.layer].color, selP = pi === this.sel.path, poly = splinePts(P.pts, this.tension, 10).map((q) => this.mmToScr(q));
        g.beginPath(); poly.forEach((q, i) => i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])); g.closePath();
        g.lineWidth = (selP ? 2.5 : 1.8) * this.dpr; g.strokeStyle = col; if (LAYER[P.layer].guide) g.setLineDash([7 * this.dpr, 5 * this.dpr]); g.stroke(); g.setLineDash([]);
        if (selP || LAYER[P.layer].guide || this.hover && this.hover.path === pi) {
          P.pts.forEach((q, i) => { const s = this.mmToScr(q), on = this.sel.nodes.has(i) && selP, r = (on ? 5 : 3.5) * this.dpr; g.beginPath(); q[2] && !LAYER[P.layer].guide ? g.rect(s[0] - r, s[1] - r, 2 * r, 2 * r) : g.arc(s[0], s[1], r, 0, 7); g.fillStyle = on ? '#ffd23f' : '#fff'; g.fill(); g.lineWidth = 1.2 * this.dpr; g.strokeStyle = col; g.stroke(); });
        }
      });
      if (this.pen && this.pen.mag) {
        const col = LAYER[this.pen.layer].color, line = (pp, dash) => { g.beginPath(); pp.forEach((q, i) => { const t = this.mmToScr(q); i ? g.lineTo(t[0], t[1]) : g.moveTo(t[0], t[1]); }); g.lineWidth = 2 * this.dpr; g.setLineDash(dash ? [6 * this.dpr, 4 * this.dpr] : []); g.strokeStyle = col; g.stroke(); g.setLineDash([]); };
        line(this.pen.pts, false); if (this.cursor && this.pen.tree) line(this._magPath(this.pen.tree, this.scrToMm(this.cursor)), true);
        this.pen.anchors.forEach((q, i) => { const t = this.mmToScr(q); g.beginPath(); g.arc(t[0], t[1], (i ? 3.5 : 6) * this.dpr, 0, 7); g.fillStyle = i ? '#fff' : '#ffd23f'; g.fill(); g.lineWidth = 1.2 * this.dpr; g.strokeStyle = col; g.stroke(); });
      } else if (this.pen) {
        const pts = this.pen.pts.map((q) => this.mmToScr(q)), col = LAYER[this.pen.layer].color;
        g.beginPath(); pts.forEach((q, i) => i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])); if (this.cursor && !this.penDrag) g.lineTo(this.cursor[0], this.cursor[1]);
        g.lineWidth = 1.8 * this.dpr; g.setLineDash([6 * this.dpr, 4 * this.dpr]); g.strokeStyle = col; g.stroke(); g.setLineDash([]);
        pts.forEach((q, i) => { g.beginPath(); g.arc(q[0], q[1], (i ? 3 : 6) * this.dpr, 0, 7); g.fillStyle = i ? '#fff' : '#ffd23f'; g.fill(); g.lineWidth = 1.2 * this.dpr; g.strokeStyle = col; g.stroke(); });
      }
      for (const P of this.paths) {
        if (!P.auto || !this._shown(P)) continue;
        for (const q of this._spots(P)) { const t = this.mmToScr(q); g.beginPath(); g.arc(t[0], t[1], Math.max(14 * this.dpr, 7 / this.o.mmPerPx * this.view.s), 0, 7); g.lineWidth = 2 * this.dpr; g.setLineDash([5 * this.dpr, 4 * this.dpr]); g.strokeStyle = '#ffd23f'; g.stroke(); g.setLineDash([]); }
      }
      if (this.marquee) { const { a, b } = this.marquee; g.strokeStyle = '#ffd23f'; g.lineWidth = this.dpr; g.setLineDash([4, 3]); g.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); g.setLineDash([]); }
    }

    /* ---------- export / import ---------- */
    _samples(P) {   // export geometry: the drawn spline, guaranteed free of self-intersections
      let s = splinePts(P.pts, this.tension, P.pts.length > 400 ? 4 : 8).map((q) => [q[0], q[1]]);
      if (s.length <= 40000 && hasCrossing(s)) { const c = offsetPath(s, 0.001, 0.15); if (c.length >= 3) s = c.map((q) => [q[0], q[1]]); }
      return s;
    }
    toDXF(layers) {
      const out = ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC', '0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '70', '2',
        '0', 'LAYER', '2', 'CARVED_AREA', '70', '0', '62', '5', '6', 'CONTINUOUS', '0', 'LAYER', '2', 'SUBJECT', '70', '0', '62', '1', '6', 'CONTINUOUS', '0', 'ENDTAB', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'];
      for (const P of this.paths) {
        if (LAYER[P.layer].guide || (layers && !layers.includes(P.layer))) continue;
        const lay = P.layer === 'red' ? 'SUBJECT' : 'CARVED_AREA';
        out.push('0', 'POLYLINE', '8', lay, '66', '1', '70', '1', '10', '0.0', '20', '0.0', '30', '0.0');
        for (const q of this._samples(P)) out.push('0', 'VERTEX', '8', lay, '10', q[0].toFixed(4), '20', q[1].toFixed(4), '30', '0.0');
        out.push('0', 'SEQEND', '8', lay);
      }
      out.push('0', 'ENDSEC', '0', 'EOF'); return out.join('\r\n') + '\r\n';
    }
    toSVG() {
      const img = this.o.image, w = img ? img.width * this.o.mmPerPx : 300, h = img ? img.height * this.o.mmPerPx : 300, [x0, yT] = this.o.originMm;
      const ps = this.paths.filter((P) => !LAYER[P.layer].guide).map((P) => `<path fill="none" stroke="${LAYER[P.layer].color}" stroke-width="0.3" d="${this._samples(P).map((q, i) => `${i ? 'L' : 'M'}${(q[0] - x0).toFixed(3)} ${(yT - q[1]).toFixed(3)}`).join(' ')} Z"/>`);
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w.toFixed(3)} ${h.toFixed(3)}">${ps.join('')}</svg>`;
    }
    toJSON() { return JSON.stringify({ version: 2, tension: this.tension, originMm: this.o.originMm, mmPerPx: this.o.mmPerPx, paths: this.paths }, null, 0); }
    loadJSON(text) { const j = JSON.parse(text); if (j.tension != null) { this.tension = j.tension; this.c.querySelectorAll('[data-rng="tension"]').forEach((r) => { r.value = j.tension; }); } this.setPaths(j.paths || []); this.say(`Work opened: ${this.paths.length} line(s).`); }
    importDXF(text) {
      const t = text.split(/\r?\n/).map((s) => s.trim()); const paths = []; let cur = null, inV = false, x = 0, lay = 'blue', lw = null;
      for (let i = 0; i + 1 < t.length; i += 2) {
        const code = t[i], val = t[i + 1];
        if (code === '0') { inV = val === 'VERTEX'; if (val === 'POLYLINE' || val === 'LWPOLYLINE') { cur = []; lw = val === 'LWPOLYLINE'; lay = 'blue'; } else if (val === 'SEQEND' || (lw && cur && cur.length && val !== 'VERTEX')) { if (cur && cur.length >= 3) paths.push({ layer: lay, pts: cur.map((q) => [q[0], q[1], 1]) }); cur = null; lw = null; } }
        else if (cur && code === '8' && /SUBJECT|RED/i.test(val)) lay = 'red';
        else if (cur && (inV || lw) && code === '10') x = +val; else if (cur && (inV || lw) && code === '20') cur.push([x, +val]);
      }
      if (cur && cur.length >= 3) paths.push({ layer: lay, pts: cur.map((q) => [q[0], q[1], 1]) });
      paths.forEach((P) => { const s = simplifySafe(P.pts, 0.15); if (s.length >= 3) P.pts = cornerFlags(s.map((q) => [q[0], q[1], 0])); });
      this.setPaths(paths); this.setMethod(2); this.say(`${paths.length} line(s) opened from the DXF. Drag the points to correct them.`);
    }
    _open(file) { if (!file) return; const r = new FileReader(); r.onload = () => { try { /\.json$/i.test(file.name) ? this.loadJSON(r.result) : this.importDXF(r.result); } catch (e) { this.say('That file could not be read.'); } }; r.readAsText(file); }
    _download(text, name, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }
  }

  VectorEditor.splinePts = splinePts; VectorEditor.traceMask = traceMask; VectorEditor.simplifyDP = simplifyDP; VectorEditor.offsetPath = offsetPath;
  VectorEditor.cornerFlags = cornerFlags; VectorEditor.hasCrossing = hasCrossing; VectorEditor.simplifySafe = simplifySafe;
  global.VectorEditor = VectorEditor;
})(typeof window !== 'undefined' ? window : globalThis);
