// "Will it cut?" — the analysis engine behind /tools/will-it-cut.
//
// Everything here runs IN THE VISITOR'S BROWSER. The file is never uploaded,
// which is a genuine privacy promise rather than a slogan: there is no endpoint
// to send it to. It also means the tool costs nothing to run at any scale.
//
// The honest limits of what a mesh can tell you are respected throughout. A
// bounding box is exact. A cut-time estimate is a model, so it is reported as a
// range and labelled as an estimate. Detail loss under a given ball nose is a
// real computation (grayscale morphological closing with a spherical structuring
// element, which is exactly what a ball cutter does to a surface) but it is done
// on a sampled grid, so it is accurate to about a grid cell and no better.

export type Tri = { n: number; pos: Float32Array };

export type Machine = { name: string; x: number; y: number; z: number };
export type MachineClass = { name: string; rpm: number; feed: number; doc: number };

// Work areas in mm. Real cutting areas, which are always smaller than the
// number on the box once the gantry and clamps are accounted for.
export const MACHINES: Machine[] = [
  { name: '3018 / small desktop', x: 300, y: 180, z: 45 },
  { name: 'Shapeoko 3 XXL', x: 838, y: 838, z: 95 },
  { name: 'Shapeoko 5 Pro 4x4', x: 1219, y: 1219, z: 100 },
  { name: 'X-Carve 1000mm', x: 750, y: 750, z: 65 },
  { name: 'Onefinity Woodworker', x: 813, y: 406, z: 133 },
  { name: 'Onefinity Journeyman', x: 813, y: 813, z: 133 },
  { name: 'LongMill MK2 30x30', x: 750, y: 750, z: 115 },
  { name: 'Avid CNC 4x8', x: 2440, y: 1220, z: 200 },
];

// Feeds by machine class. These are the same starting points published in the
// tray guide, so the site never quotes two different sets of numbers.
export const CLASSES: MachineClass[] = [
  { name: 'Hobby, belt driven', rpm: 10000, feed: 800, doc: 1.75 },
  { name: 'Mid hobby (Shapeoko, X-Carve, Onefinity)', rpm: 16000, feed: 1800, doc: 3 },
  { name: 'Prosumer (ball screw)', rpm: 18000, feed: 3000, doc: 5 },
  { name: 'Industrial (ATC, vacuum bed)', rpm: 18000, feed: 5000, doc: 12 },
];

export type Analysis = {
  triangles: number;
  size: { x: number; y: number; z: number };
  min: { x: number; y: number; z: number };
  grid: { w: number; h: number; cell: number };
  height: Float32Array;      // top surface, NaN where nothing covers the cell
  back: Float32Array;        // bottom surface
  coverage: number;          // fraction of the bounding rectangle the model covers
  flatBack: number;          // fraction of covered cells whose back sits on the base plane
  reliefDepth: number;       // carved depth of the top surface
  volume: number;            // mm^3, signed-tetrahedron, absolute
  openEdges: number;         // edges used by exactly one triangle: holes
  degenerate: number;        // zero-area triangles
  detailLoss: { radius: number; max: number; mean: number; areaAffected: number; measurable: boolean }[];
  orientation: Orientation;
};

export type Orientation = {
  /** how flat the CURRENT underside is, 0..1 of the footprint it should cover */
  current: number;
  /** the face that looks most like the flat back of a relief */
  best: { axis: 'X' | 'Y' | 'Z'; sign: 1 | -1; score: number };
  verdict: 'ok' | 'upside-down' | 'on-its-side' | 'not-a-relief';
  /** plain-English instruction, empty when nothing needs doing */
  fix: string;
  /** size in mm once rotated the way `fix` describes */
  rotatedSize: { x: number; y: number; z: number };
};

const KEY = (a: string, b: string) => (a < b ? `${a}_${b}` : `${b}_${a}`);

/** Parse binary or ASCII STL into a flat vertex array. Returns mm-assumed units. */
export function parseSTL(buf: ArrayBuffer): Float32Array {
  const dv = new DataView(buf);
  // A binary STL declares its triangle count at byte 80. If the file length
  // matches exactly, trust it: some binary files begin with the word "solid",
  // and sniffing the text alone gets those wrong.
  if (buf.byteLength >= 84) {
    const count = dv.getUint32(80, true);
    if (84 + count * 50 === buf.byteLength && count > 0) {
      const pos = new Float32Array(count * 9);
      let o = 84, p = 0;
      for (let i = 0; i < count; i++) {
        o += 12; // skip the stored normal, which is often wrong and never needed
        for (let v = 0; v < 9; v++) { pos[p++] = dv.getFloat32(o, true); o += 4; }
        o += 2;
      }
      return pos;
    }
  }
  // ASCII
  const text = new TextDecoder().decode(buf);
  const nums: number[] = [];
  const re = /vertex\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) { nums.push(+m[1], +m[2], +m[3]); }
  if (!nums.length) throw new Error('This does not look like an STL file.');
  return new Float32Array(nums);
}

/**
 * Rasterise the mesh top down into a height grid, which is the right model for
 * a relief: a CNC router can only reach what it can see from above.
 */
function raster(pos: Float32Array, target = 320) {
  // target is chosen by the caller from the smallest bit we want to resolve
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const sx = maxX - minX || 1, sy = maxY - minY || 1;
  const cell = Math.max(sx, sy) / target;
  const w = Math.max(2, Math.ceil(sx / cell)), h = Math.max(2, Math.ceil(sy / cell));
  const top = new Float32Array(w * h).fill(NaN);
  const bot = new Float32Array(w * h).fill(NaN);

  for (let i = 0; i < pos.length; i += 9) {
    const ax = pos[i], ay = pos[i + 1], az = pos[i + 2];
    const bx = pos[i + 3], by = pos[i + 4], bz = pos[i + 5];
    const cx = pos[i + 6], cy = pos[i + 7], cz = pos[i + 8];
    const x0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - minX) / cell));
    const x1 = Math.min(w - 1, Math.ceil((Math.max(ax, bx, cx) - minX) / cell));
    const y0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - minY) / cell));
    const y1 = Math.min(h - 1, Math.ceil((Math.max(ay, by, cy) - minY) / cell));
    const d = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(d) < 1e-12) continue; // vertical wall: contributes no top surface
    for (let gy = y0; gy <= y1; gy++) {
      const py = minY + (gy + 0.5) * cell;
      for (let gx = x0; gx <= x1; gx++) {
        const px = minX + (gx + 0.5) * cell;
        const u = ((px - ax) * (cy - ay) - (cx - ax) * (py - ay)) / d;
        if (u < -1e-6 || u > 1 + 1e-6) continue;
        const v = ((bx - ax) * (py - ay) - (px - ax) * (by - ay)) / d;
        if (v < -1e-6 || u + v > 1 + 1e-6) continue;
        const z = az + u * (bz - az) + v * (cz - az);
        const k = gy * w + gx;
        if (!(top[k] >= z)) top[k] = z;   // NaN-safe: NaN >= z is false
        if (!(bot[k] <= z)) bot[k] = z;
      }
    }
  }
  return { w, h, cell, top, bot, minX, minY, minZ, maxX, maxY, maxZ };
}

/**
 * Grayscale morphological closing with the SHAPE OF THE TOOL, which is exactly
 * what a cutter does to a surface: it cannot put its centre anywhere the body
 * would collide, so the achievable surface is the original closed by the tool.
 *
 * The structuring element matters and the first version got it wrong. A flat
 * disc is a flat end mill. A ball nose is a HEMISPHERE, so each offset in the
 * disc carries a height sqrt(r^2 - d^2); ignoring that treats a round cutter as
 * a square one and understates what it can reach into.
 */
function closeWithTool(src: Float32Array, w: number, h: number, rCells: number,
                       shape: 'ball' | 'flat', floor: number) {
  const r = Math.max(1, Math.round(rCells));
  const off: number[] = [];      // dx, dy, height offset
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > r * r) continue;
      off.push(dx, dy, shape === 'ball' ? r - Math.sqrt(r * r - d2) : 0);
    }
  }
  const pass = (input: Float32Array, dilate: boolean) => {
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let best = dilate ? -Infinity : Infinity;
        let any = false;
        for (let o = 0; o < off.length; o += 3) {
          const nx = x + off[o], ny = y + off[o + 1];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const v = input[ny * w + nx];
          if (Number.isNaN(v)) continue;
          // the tool's own profile, in the units of the height map
          const g = off[o + 2] * (rCells > 0 ? 1 : 0);
          const cand = dilate ? v + g : v - g;
          best = dilate ? Math.max(best, cand) : Math.min(best, cand);
          any = true;
        }
        out[y * w + x] = any ? best : floor;
      }
    }
    return out;
  };
  return pass(pass(src, true), false);
}

/** Kept for the detail-loss figures, which read better with the true ball. */
const closeWithBall = (src: Float32Array, w: number, h: number, rCells: number, floor: number) =>
  closeWithTool(src, w, h, rCells, 'ball', floor);

// ── machining simulation ────────────────────────────────────────────────
export type SimSurface = { w: number; h: number; cell: number; z: Float32Array };
export type Sim = {
  rough: SimSurface;
  finish: SimSurface;
  /** ridge height left between finishing passes, mm */
  scallop: number;
  /** number of stepdown layers the roughing pass will take */
  layers: number;
};

/**
 * Produce the two surfaces a real job leaves, from the buyer's own file and the
 * tools they picked, so the page can SHOW the difference instead of asserting
 * it in a number.
 *
 *   roughing  = closed with a FLAT cutter, then quantised into stepdown layers,
 *               which is where the terraces come from
 *   finishing = closed with the BALL, plus the scallop ridges left between
 *               passes, whose height is plain geometry: r - sqrt(r^2 - (s/2)^2)
 *
 * It is a surface simulation, not a CAM verification: no holder collisions, no
 * ramping, no deflection. The page says so.
 */
export function simulate(a: Analysis, opts: {
  roughDia: number; stepdown: number; ballDia: number; stepoverPct: number;
}): Sim {
  const ballR = opts.ballDia / 2;
  // Work at a resolution where the ball spans about five cells: fine enough to
  // see, cheap enough to redraw while a slider is moving.
  const k = Math.max(1, Math.round((ballR / a.grid.cell) / 5));
  const w = Math.ceil(a.grid.w / k), h = Math.ceil(a.grid.h / k);
  const cell = a.grid.cell * k;
  const src = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0, n = 0;
      for (let yy = y * k; yy < Math.min(a.grid.h, (y + 1) * k); yy++) {
        for (let xx = x * k; xx < Math.min(a.grid.w, (x + 1) * k); xx++) {
          const v = a.height[yy * a.grid.w + xx];
          if (!Number.isNaN(v)) { sum += v; n++; }
        }
      }
      src[y * w + x] = n ? sum / n : NaN;
    }
  }

  let base = Infinity;
  for (let i = 0; i < src.length; i++) { const v = src[i]; if (!Number.isNaN(v) && v < base) base = v; }
  if (!isFinite(base)) base = 0;

  // roughing: the flat cutter cannot reach in, and it leaves layers behind
  const roughClosed = closeWithTool(src, w, h, (opts.roughDia / 2) / cell, 'flat', base);
  const rough = new Float32Array(w * h);
  const sd = Math.max(0.2, opts.stepdown);
  for (let i = 0; i < rough.length; i++) {
    const v = roughClosed[i];
    rough[i] = Number.isNaN(v) ? NaN : base + Math.ceil((v - base) / sd - 1e-6) * sd;
  }

  // finishing: the ball, plus the ridges it leaves between passes
  const finishClosed = closeWithTool(src, w, h, ballR / cell, 'ball', base);
  const stepMm = opts.ballDia * (opts.stepoverPct / 100);
  const scallop = Math.max(0, ballR - Math.sqrt(Math.max(0, ballR * ballR - (stepMm / 2) * (stepMm / 2))));
  const finish = new Float32Array(w * h);
  const periodCells = Math.max(1e-6, stepMm / cell);
  for (let y = 0; y < h; y++) {
    // ridges run along the raster direction, peaking between passes
    const ridge = scallop * 0.5 * (1 - Math.cos(2 * Math.PI * (y / periodCells)));
    for (let x = 0; x < w; x++) {
      const i = y * w + x, v = finishClosed[i];
      finish[i] = Number.isNaN(v) ? NaN : v + ridge;
    }
  }

  return {
    rough: { w, h, cell, z: rough },
    finish: { w, h, cell, z: finish },
    scallop,
    layers: Math.max(1, Math.ceil((a.reliefDepth || 0) / sd)),
  };
}

/**
 * Which way up is this thing?
 *
 * A relief is a slab with one big flat face: the back, which lies on the bed.
 * So for each of the six axis directions, add up the area of triangles that
 * both FACE that direction and SIT at the far extreme of it, then compare that
 * to the area of the bounding box face it would have to cover. A proper relief
 * scores near 1 on exactly one direction.
 *
 * That single number separates the three cases that matter and which the old
 * flat-back test lumped together: correctly oriented, lying on its side or
 * upside down (rotate it, then it cuts fine), and a genuine 3D model with no
 * flat face anywhere (no rotation will save it).
 */
function orient(pos: Float32Array, size: { x: number; y: number; z: number },
                min: { x: number; y: number; z: number }): Orientation {
  const max = { x: min.x + size.x, y: min.y + size.y, z: min.z + size.z };
  const DIRS: { axis: 'X' | 'Y' | 'Z'; sign: 1 | -1; n: [number, number, number]; face: number }[] = [
    { axis: 'Z', sign: -1, n: [0, 0, -1], face: size.x * size.y },
    { axis: 'Z', sign: 1, n: [0, 0, 1], face: size.x * size.y },
    { axis: 'Y', sign: -1, n: [0, -1, 0], face: size.x * size.z },
    { axis: 'Y', sign: 1, n: [0, 1, 0], face: size.x * size.z },
    { axis: 'X', sign: -1, n: [-1, 0, 0], face: size.y * size.z },
    { axis: 'X', sign: 1, n: [1, 0, 0], face: size.y * size.z },
  ];
  const area = new Float64Array(6);
  // A triangle counts only if it is nearly parallel to the face AND sitting on
  // it. Without the position test every flat step inside the carving would
  // count towards the back.
  const tol = Math.max(size.x, size.y, size.z) * 0.02;
  for (let i = 0; i < pos.length; i += 9) {
    const ax = pos[i], ay = pos[i + 1], az = pos[i + 2];
    const bx = pos[i + 3], by = pos[i + 4], bz = pos[i + 5];
    const cx = pos[i + 6], cy = pos[i + 7], cz = pos[i + 8];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12) continue;
    const a2 = len / 2;
    nx /= len; ny /= len; nz /= len;
    for (let d = 0; d < 6; d++) {
      const D = DIRS[d];
      if (nx * D.n[0] + ny * D.n[1] + nz * D.n[2] < 0.985) continue;   // ~10 degrees
      const co = D.axis === 'X' ? [ax, bx, cx] : D.axis === 'Y' ? [ay, by, cy] : [az, bz, cz];
      const edge = D.sign < 0
        ? (D.axis === 'X' ? min.x : D.axis === 'Y' ? min.y : min.z)
        : (D.axis === 'X' ? max.x : D.axis === 'Y' ? max.y : max.z);
      if (Math.abs(Math.max(...co.map((v) => Math.abs(v - edge)))) > tol) continue;
      area[d] += a2;
    }
  }
  const scores = DIRS.map((D, d) => ({ ...D, score: D.face > 0 ? Math.min(1, area[d] / D.face) : 0 }));
  const current = scores[0].score;                       // back on -Z, the CNC case
  const best = [...scores].sort((a, b) => b.score - a.score)[0];

  const R = { x: size.x, y: size.y, z: size.z };
  let verdict: Orientation['verdict'] = 'not-a-relief';
  let fix = '';
  let rotatedSize = { ...R };
  if (current >= 0.55) {
    verdict = 'ok';
  } else if (best.score >= 0.55) {
    if (best.axis === 'Z') {
      verdict = 'upside-down';
      fix = 'Flip it over. The flat face is on top, so the machine is looking at the back of the carving.';
    } else {
      verdict = 'on-its-side';
      fix = best.axis === 'X'
        ? 'Rotate it 90 degrees about the Y axis. It is standing on its edge.'
        : 'Rotate it 90 degrees about the X axis. It is standing up rather than lying down.';
      rotatedSize = best.axis === 'X'
        ? { x: size.z, y: size.y, z: size.x }
        : { x: size.x, y: size.z, z: size.y };
    }
  }
  return { current, best: { axis: best.axis, sign: best.sign, score: best.score }, verdict, fix, rotatedSize };
}

export function analyse(pos: Float32Array, onProgress?: (p: number) => void): Analysis {
  const triangles = Math.floor(pos.length / 9);
  onProgress?.(0.15);
  // Resolve the grid finely enough that the smallest cutter spans several
  // cells, but back off on very large meshes where the per-triangle cost, not
  // the grid, is what makes this slow.
  const target = 640;
  const r = raster(pos, target);
  onProgress?.(0.5);

  const n = r.w * r.h;
  let covered = 0, flat = 0, topMax = -Infinity, topMin = Infinity;
  const baseTol = Math.max(0.05, (r.maxZ - r.minZ) * 0.02);
  for (let i = 0; i < n; i++) {
    const t = r.top[i]; if (Number.isNaN(t)) continue;
    covered++;
    if (t > topMax) topMax = t;
    if (t < topMin) topMin = t;
    if (Math.abs(r.bot[i] - r.minZ) <= baseTol) flat++;
  }

  // Volume always. Edge topology only up to a size where the string-keyed
  // pass is quick: on a two million triangle mesh it is six million map writes
  // and dominates everything else, so past the cap it is reported as unchecked
  // rather than quietly guessed at.
  const CHECK_EDGES_UP_TO = 600_000;
  const doEdges = triangles <= CHECK_EDGES_UP_TO;
  let vol = 0, degenerate = 0;
  const edges = new Map<string, number>();
  const q = 1e4; // quantise vertices so shared corners actually match
  for (let i = 0; i < pos.length; i += 9) {
    const ax = pos[i], ay = pos[i + 1], az = pos[i + 2];
    const bx = pos[i + 3], by = pos[i + 4], bz = pos[i + 5];
    const cx = pos[i + 6], cy = pos[i + 7], cz = pos[i + 8];
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (Math.hypot(nx, ny, nz) < 1e-9) degenerate++;
    if (!doEdges) continue;
    const ka = `${Math.round(ax * q)},${Math.round(ay * q)},${Math.round(az * q)}`;
    const kb = `${Math.round(bx * q)},${Math.round(by * q)},${Math.round(bz * q)}`;
    const kc = `${Math.round(cx * q)},${Math.round(cy * q)},${Math.round(cz * q)}`;
    if (doEdges) for (const e of [KEY(ka, kb), KEY(kb, kc), KEY(kc, ka)]) {
      edges.set(e, (edges.get(e) || 0) + 1);
    }
  }
  let openEdges = doEdges ? 0 : -1;   // -1 means not checked
  if (doEdges) for (const c of edges.values()) if (c === 1) openEdges++;
  onProgress?.(0.75);

  // Detail loss per ball nose. Two things went wrong in the first version and
  // both are worth stating, because they are the traps in this measurement.
  //
  // 1. RESOLUTION. A 1.5 mm cutter on a 650 mm panel is a third of a grid cell,
  //    so every bit size rounded to the same single-cell disc and returned
  //    identical answers. A bit must span at least two cells to mean anything,
  //    and when it does not we say so instead of printing a confident number.
  // 2. THE SILHOUETTE. Closing against the empty space around the model fills
  //    the vertical drop at its outline, which is metres of "lost detail" that
  //    is really just the edge of the part. Cells near that boundary are
  //    excluded, and the headline figure is the 99th percentile rather than the
  //    maximum, so one bad cell cannot define the result.
  const detailLoss = [1.5, 3, 6].map((dia) => {
    const rad = dia / 2;
    const rFull = rad / r.cell;
    const dead = { radius: dia, max: 0, mean: 0, areaAffected: 0, measurable: false };
    if (rFull < 2) return dead;   // the cutter is smaller than the grid can see

    // Work on a grid where the cutter spans about five cells whatever its size.
    // Without this the cost explodes: a 6 mm bit on a 150 mm part is thirteen
    // cells of radius at full resolution, which is a 500-offset disc over
    // 400,000 cells twice, and took eight seconds for no extra accuracy.
    const k = Math.max(1, Math.round(rFull / 5));
    const dw = Math.ceil(r.w / k), dh = Math.ceil(r.h / k);
    const small = new Float32Array(dw * dh);
    for (let y = 0; y < dh; y++) {
      for (let x = 0; x < dw; x++) {
        let sum = 0, n = 0;
        for (let yy = y * k; yy < Math.min(r.h, (y + 1) * k); yy++) {
          for (let xx = x * k; xx < Math.min(r.w, (x + 1) * k); xx++) {
            const v = r.top[yy * r.w + xx];
            if (!Number.isNaN(v)) { sum += v; n++; }
          }
        }
        small[y * dw + x] = n ? sum / n : NaN;
      }
    }
    const rd = rFull / k;
    const closed = closeWithBall(small, dw, dh, rd, r.minZ);

    // Exclude everything within the cutter's reach of the outline. Closing
    // against empty space fills the vertical drop at the edge of the part,
    // which is not lost detail, it is the edge of the part.
    const ri = Math.ceil(rd) + 1;
    const near = new Uint8Array(dw * dh);
    for (let y = 0; y < dh; y++) {
      for (let x = 0; x < dw; x++) {
        if (!Number.isNaN(small[y * dw + x])) continue;
        for (let dy = -ri; dy <= ri; dy++) {
          const ny = y + dy; if (ny < 0 || ny >= dh) continue;
          for (let dx = -ri; dx <= ri; dx++) {
            const nx = x + dx; if (nx < 0 || nx >= dw) continue;
            near[ny * dw + nx] = 1;
          }
        }
      }
    }

    const losses: number[] = [];
    let sum = 0, cnt = 0, affected = 0;
    for (let i = 0; i < small.length; i++) {
      const a = small[i];
      if (Number.isNaN(a) || near[i]) continue;
      const d = Math.max(0, closed[i] - a);
      losses.push(d); sum += d; cnt++;
      if (d > 0.05) affected++;
    }
    if (cnt < 50) return dead;
    losses.sort((a, b) => a - b);
    // the 99th percentile, so one rogue cell cannot define the headline number
    const p99 = losses[Math.min(losses.length - 1, Math.floor(losses.length * 0.99))];
    return {
      radius: dia,
      max: Math.round(p99 * 100) / 100,
      mean: Math.round((sum / cnt) * 100) / 100,
      areaAffected: Math.round(1000 * affected / cnt) / 10,
      measurable: true,
    };
  });
  const orientation = orient(pos, { x: r.maxX - r.minX, y: r.maxY - r.minY, z: r.maxZ - r.minZ }, { x: r.minX, y: r.minY, z: r.minZ });
  onProgress?.(1);

  return {
    triangles,
    size: { x: r.maxX - r.minX, y: r.maxY - r.minY, z: r.maxZ - r.minZ },
    min: { x: r.minX, y: r.minY, z: r.minZ },
    grid: { w: r.w, h: r.h, cell: r.cell },
    height: r.top, back: r.bot,
    coverage: covered / n,
    flatBack: covered ? flat / covered : 0,
    reliefDepth: topMax - topMin,
    volume: Math.abs(vol),
    openEdges, degenerate, detailLoss, orientation,
  };
}

/** Cut-time model. Reported as an estimate because that is what it is. */
export function cutTime(a: Analysis, cls: MachineClass, ballDia: number, stepoverPct: number, scale = 1) {
  const sx = a.size.x * scale, sy = a.size.y * scale, depth = a.reliefDepth * scale;
  const stepover = ballDia * (stepoverPct / 100);
  // Finishing: a raster pass, one line per stepover across the part.
  const passes = Math.max(1, Math.ceil(sy / stepover));
  const finishMm = passes * sx;
  const finishMin = finishMm / (cls.feed * 0.5);
  // Roughing: material above the floor that is not part of the model.
  const boxVol = sx * sy * depth;
  const modelAbove = Math.min(boxVol, a.volume * scale ** 3 * 0.55);
  const waste = Math.max(boxVol * 0.15, boxVol - modelAbove);
  const mrr = cls.doc * 6 * 0.4 * cls.feed;   // 6 mm cutter, 40% stepover
  const roughMin = waste / mrr;
  return { roughMin, finishMin, totalMin: roughMin + finishMin, passes };
}

export const fmtTime = (min: number) => {
  if (!isFinite(min) || min < 0) return '—';
  if (min < 1) return 'under a minute';
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
};
