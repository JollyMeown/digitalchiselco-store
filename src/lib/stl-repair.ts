// Broken STL Auto-Repair: the engine behind /tools/stl-repair.
//
// Runs in a Web Worker in the visitor's browser, like "Will it cut?": the file
// is never uploaded, there is no endpoint to send it to, and it costs nothing
// to run at any scale.
//
// The idea that makes it more than another "fix normals" button: a mesh is
// repaired FOR the machine that will make it.
//   CNC router   rebuilt as a 2.5D relief from what the cutter can see: always
//                watertight, no undercuts, a flat back, no self-intersections.
//   Laser relief the same rebuild, delivered as a greyscale depth map (lasers
//                burn from an image, not from an STL), plus the solid STL.
//   FDM / resin  a true 3D repair: holes closed, edges made manifold, normals
//                pointed outwards, debris removed, flat side on the bed, with
//                each process's own thin-wall limit and triangle budget.
//
// Honesty rules, same as the rest of the site's tools:
//   * every "Ready" badge is earned by re-checking the OUTPUT with the same
//     checks that found the problems, never printed on the strength of having
//     run a repair;
//   * what cannot be repaired automatically (self-intersections in a 3D print,
//     walls that are too thin) is counted and shown, not hidden.

import earcut from 'earcut';
import { MeshoptSimplifier } from 'meshoptimizer';
import { parseSTL } from './stl-analyse';

export type Mode = 'cnc' | 'fdm' | 'resin' | 'laser';
export type Mesh = { V: Float32Array; F: Uint32Array };

export const MODES: Record<Mode, { label: string; thin: number; maxTris: number; relief: boolean }> = {
  cnc:   { label: 'CNC router',   thin: 0,   maxTris: 2_000_000, relief: true },
  laser: { label: 'Laser relief', thin: 0,   maxTris: 2_000_000, relief: true },
  fdm:   { label: 'FDM print',    thin: 0.8, maxTris: 1_000_000, relief: false },
  resin: { label: 'Resin print',  thin: 0.3, maxTris: 2_000_000, relief: false },
};

type Progress = (p: number, label: string) => void;
const noop: Progress = () => {};

// ── reading files ────────────────────────────────────────────────────────

const UNIT_MM: Record<string, number> = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 };

export type Loaded = { soup: Float32Array; format: 'STL' | 'OBJ' | '3MF'; unit: string | null };

/** STL, OBJ or 3MF into a triangle soup in millimetres where the file says so. */
export async function readModel(buf: ArrayBuffer, name: string): Promise<Loaded> {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const u8 = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
  const isZip = u8[0] === 0x50 && u8[1] === 0x4b;
  if (ext === '3mf' || isZip) return { ...(await read3MF(buf)), format: '3MF' };
  if (ext === 'obj') return { soup: readOBJ(new TextDecoder().decode(buf)), format: 'OBJ', unit: null };
  return { soup: parseSTL(buf), format: 'STL', unit: null };
}

function readOBJ(text: string): Float32Array {
  const v: number[] = [];
  const out: number[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    let j = text.indexOf('\n', i);
    if (j < 0) j = n;
    const c0 = text.charCodeAt(i), c1 = text.charCodeAt(i + 1);
    if (c0 === 118 && (c1 === 32 || c1 === 9)) {                    // "v "
      const p = text.slice(i + 2, j).trim().split(/\s+/);
      v.push(+p[0], +p[1], +p[2]);
    } else if (c0 === 102 && (c1 === 32 || c1 === 9)) {             // "f "
      const p = text.slice(i + 2, j).trim().split(/\s+/);
      const nv = v.length / 3;
      const idx = p.map((s) => { const k = parseInt(s, 10); return k < 0 ? nv + k : k - 1; });
      for (let k = 1; k + 1 < idx.length; k++) {
        for (const q of [idx[0], idx[k], idx[k + 1]]) {
          if (q < 0 || q >= nv) continue;
          out.push(v[q * 3], v[q * 3 + 1], v[q * 3 + 2]);
        }
      }
    }
    i = j + 1;
  }
  if (out.length < 9 || out.length % 9) throw new Error('No usable faces were found in this OBJ file.');
  return new Float32Array(out);
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The .model parts of a 3MF (a zip). Only what is needed: stored or deflated entries. */
async function unzipModels(buf: ArrayBuffer): Promise<Map<string, string>> {
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('This 3MF file is damaged: it is not a readable zip archive.');
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  if (off === 0xffffffff) throw new Error('This 3MF is over 4 GB (zip64), which this page cannot open. Export it as STL instead.');
  const td = new TextDecoder();
  const out = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(off, true) !== 0x02014b50) break;
    const method = dv.getUint16(off + 10, true);
    const csize = dv.getUint32(off + 20, true);
    const nameLen = dv.getUint16(off + 28, true), extraLen = dv.getUint16(off + 30, true), commLen = dv.getUint16(off + 32, true);
    const local = dv.getUint32(off + 42, true);
    const name = td.decode(u8.subarray(off + 46, off + 46 + nameLen));
    off += 46 + nameLen + extraLen + commLen;
    if (!/\.model$/i.test(name)) continue;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const data = u8.subarray(start, start + csize);
    let raw: Uint8Array;
    if (method === 0) raw = data;
    else if (method === 8) raw = await inflateRaw(data);
    else throw new Error('This 3MF uses a compression method this page cannot read. Export it as STL instead.');
    out.set('/' + name.replace(/^\/+/, ''), td.decode(raw));
  }
  if (!out.size) throw new Error('No 3D model was found inside this 3MF file.');
  return out;
}

const attr = (s: string, key: string): string | null => {
  const k = ' ' + key + '="';
  const i = s.indexOf(k);
  if (i < 0) return null;
  const j = s.indexOf('"', i + k.length);
  return s.slice(i + k.length, j);
};

// 3MF transforms are 3x4, row-vector convention: p' = p * M.
type M34 = number[];
const ID: M34 = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const parseM = (s: string | null): M34 => {
  if (!s) return ID;
  const n = s.trim().split(/\s+/).map(Number);
  return n.length === 12 && n.every(Number.isFinite) ? n : ID;
};
/** apply A, then B */
function mulM(A: M34, B: M34): M34 {
  const R = new Array(12).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    R[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
  }
  for (let j = 0; j < 3; j++) R[9 + j] = A[9] * B[j] + A[10] * B[3 + j] + A[11] * B[6 + j] + B[9 + j];
  return R;
}

async function read3MF(buf: ArrayBuffer): Promise<{ soup: Float32Array; unit: string }> {
  const docs = await unzipModels(buf);
  const main = [...docs.keys()].find((k) => /\/3D\/3dmodel\.model$/i.test(k)) || [...docs.keys()][0];
  const unit = (docs.get(main)!.match(/<model\b[^>]*\bunit="([^"]+)"/) || [])[1] || 'millimeter';
  const scale = UNIT_MM[unit] ?? 1;

  type Obj = { body: string };
  const objs = new Map<string, Map<string, Obj>>();
  const objectsIn = (path: string) => {
    let m = objs.get(path);
    if (m) return m;
    m = new Map();
    const xml = docs.get(path) || '';
    const re = /<object\b([^>]*)>([\s\S]*?)<\/object>/g;
    let r: RegExpExecArray | null;
    while ((r = re.exec(xml))) { const id = attr(' ' + r[1], 'id'); if (id) m.set(id, { body: r[2] }); }
    objs.set(path, m);
    return m;
  };

  const out: number[] = [];
  const emit = (path: string, id: string, M: M34, depth: number) => {
    if (depth > 8) return;
    const o = objectsIn(path).get(id);
    if (!o) return;
    const meshAt = o.body.indexOf('<mesh');
    if (meshAt >= 0) {
      const verts: number[] = [];
      const vre = /<vertex\b([^>]*?)\/?>/g;
      let r: RegExpExecArray | null;
      while ((r = vre.exec(o.body))) {
        const s = ' ' + r[1];
        const x = +attr(s, 'x')!, y = +attr(s, 'y')!, z = +attr(s, 'z')!;
        verts.push(x * M[0] + y * M[3] + z * M[6] + M[9], x * M[1] + y * M[4] + z * M[7] + M[10], x * M[2] + y * M[5] + z * M[8] + M[11]);
      }
      const tre = /<triangle\b([^>]*?)\/?>/g;
      const nv = verts.length / 3;
      while ((r = tre.exec(o.body))) {
        const s = ' ' + r[1];
        const a = +attr(s, 'v1')!, b = +attr(s, 'v2')!, c = +attr(s, 'v3')!;
        if (!(a < nv && b < nv && c < nv)) continue;
        out.push(verts[a * 3] * scale, verts[a * 3 + 1] * scale, verts[a * 3 + 2] * scale,
                 verts[b * 3] * scale, verts[b * 3 + 1] * scale, verts[b * 3 + 2] * scale,
                 verts[c * 3] * scale, verts[c * 3 + 1] * scale, verts[c * 3 + 2] * scale);
      }
    }
    const cre = /<component\b([^>]*?)\/?>/g;
    let r: RegExpExecArray | null;
    while ((r = cre.exec(o.body))) {
      const s = ' ' + r[1];
      const cid = attr(s, 'objectid');
      if (!cid) continue;
      const p = attr(s, 'p:path');
      emit(p ? '/' + p.replace(/^\/+/, '') : path, cid, mulM(parseM(attr(s, 'transform')), M), depth + 1);
    }
  };

  const items: { id: string; M: M34; path: string }[] = [];
  const ire = /<item\b([^>]*?)\/?>/g;
  let r: RegExpExecArray | null;
  const mainXml = docs.get(main)!;
  while ((r = ire.exec(mainXml))) {
    const s = ' ' + r[1];
    const id = attr(s, 'objectid');
    const p = attr(s, 'p:path');
    if (id) items.push({ id, M: parseM(attr(s, 'transform')), path: p ? '/' + p.replace(/^\/+/, '') : main });
  }
  if (items.length) for (const it of items) emit(it.path, it.id, it.M, 0);
  else for (const id of objectsIn(main).keys()) emit(main, id, ID, 0);
  if (out.length < 9) throw new Error('This 3MF file contains no triangles.');
  return { soup: new Float32Array(out), unit };
}

// ── indexed mesh basics ──────────────────────────────────────────────────

function bounds(V: Float32Array) {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < V.length; i += 3) {
    const x = V[i], y = V[i + 1], z = V[i + 2];
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  const size = [x1 - x0, y1 - y0, z1 - z0];
  return { min: [x0, y0, z0], max: [x1, y1, z1], size, diag: Math.hypot(size[0], size[1], size[2]) || 1 };
}

/** Join corners that are the same point. An STL stores every triangle's corners separately. */
export function weld(soup: Float32Array): Mesh {
  const n = soup.length / 3;
  const q = Math.max(bounds(soup).diag * 1e-7, 1e-9);
  let cap = 1;
  while (cap < n * 2) cap <<= 1;
  const mask = cap - 1;
  const table = new Int32Array(cap).fill(-1);
  const V = new Float32Array(n * 3);
  const F = new Uint32Array(n);
  let nv = 0;
  for (let i = 0; i < n; i++) {
    const x = soup[i * 3], y = soup[i * 3 + 1], z = soup[i * 3 + 2];
    const qx = Math.round(x / q) | 0, qy = Math.round(y / q) | 0, qz = Math.round(z / q) | 0;
    let h = (Math.imul(qx, 73856093) ^ Math.imul(qy, 19349663) ^ Math.imul(qz, 83492791)) & mask;
    for (;;) {
      const t = table[h];
      if (t < 0) { table[h] = nv; V[nv * 3] = x; V[nv * 3 + 1] = y; V[nv * 3 + 2] = z; F[i] = nv++; break; }
      if ((Math.round(V[t * 3] / q) | 0) === qx && (Math.round(V[t * 3 + 1] / q) | 0) === qy && (Math.round(V[t * 3 + 2] / q) | 0) === qz) { F[i] = t; break; }
      h = (h + 1) & mask;
    }
  }
  return { V: V.slice(0, nv * 3), F };
}

const nxt = (h: number) => h - (h % 3) + ((h % 3) + 1) % 3;
const prv = (h: number) => h - (h % 3) + ((h % 3) + 2) % 3;

/** Outgoing half-edges per vertex, CSR. A half-edge id is face*3 + corner. */
type Adj = { start: Uint32Array; he: Uint32Array };
function adjacency(nv: number, F: Uint32Array): Adj {
  const start = new Uint32Array(nv + 1);
  for (let h = 0; h < F.length; h++) start[F[h] + 1]++;
  for (let i = 0; i < nv; i++) start[i + 1] += start[i];
  const cur = start.slice(0, nv);
  const he = new Uint32Array(F.length);
  for (let h = 0; h < F.length; h++) he[cur[F[h]]++] = h;
  return { start, he };
}

/** Faces on the undirected edge of half-edge h, split by direction. */
function edgeCount(F: Uint32Array, A: Adj, h: number): [number, number] {
  const u = F[h], w = F[nxt(h)];
  let same = 0, opp = 0;
  for (let k = A.start[u]; k < A.start[u + 1]; k++) if (F[nxt(A.he[k])] === w) same++;
  for (let k = A.start[w]; k < A.start[w + 1]; k++) if (F[nxt(A.he[k])] === u) opp++;
  return [same, opp];
}

function faceArea2(V: Float32Array, a: number, b: number, c: number) {
  const ux = V[b * 3] - V[a * 3], uy = V[b * 3 + 1] - V[a * 3 + 1], uz = V[b * 3 + 2] - V[a * 3 + 2];
  const vx = V[c * 3] - V[a * 3], vy = V[c * 3 + 1] - V[a * 3 + 1], vz = V[c * 3 + 2] - V[a * 3 + 2];
  return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
}

/**
 * A broken triangle: repeated corners, or corners on one line (height under a
 * millionth of its own longest edge). Judged by SHAPE, not by a fixed area: a
 * fixed cut-off calls a thin but perfectly valid triangle on a big part broken,
 * and flips its verdict when the part is merely moved and the coordinates
 * round differently. `floor` is only a guard against exact zero.
 */
function isSliver(V: Float32Array, a: number, b: number, c: number, floor: number) {
  if (a === b || b === c || a === c) return true;
  const L = (p: number, q: number) => Math.hypot(V[p * 3] - V[q * 3], V[p * 3 + 1] - V[q * 3 + 1], V[p * 3 + 2] - V[q * 3 + 2]);
  const l = Math.max(L(a, b), L(b, c), L(c, a));
  if (l === 0) return true;
  return faceArea2(V, a, b, c) / l < Math.max(1e-6 * l, floor);
}

function faceVolume(V: Float32Array, a: number, b: number, c: number) {
  const ax = V[a * 3], ay = V[a * 3 + 1], az = V[a * 3 + 2];
  const bx = V[b * 3], by = V[b * 3 + 1], bz = V[b * 3 + 2];
  const cx = V[c * 3], cy = V[c * 3 + 1], cz = V[c * 3 + 2];
  return (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
}

/** Keep the marked faces and drop vertices nothing uses any more. */
function compact(m: Mesh, keep: Uint8Array | null): Mesh {
  const nf = m.F.length / 3;
  const remap = new Int32Array(m.V.length / 3).fill(-1);
  let kf = 0;
  for (let f = 0; f < nf; f++) if (!keep || keep[f]) kf++;
  const F = new Uint32Array(kf * 3);
  let nv = 0, o = 0;
  const Vout: number[] = [];
  for (let f = 0; f < nf; f++) {
    if (keep && !keep[f]) continue;
    for (let k = 0; k < 3; k++) {
      const v = m.F[f * 3 + k];
      if (remap[v] < 0) { remap[v] = nv++; Vout.push(m.V[v * 3], m.V[v * 3 + 1], m.V[v * 3 + 2]); }
      F[o++] = remap[v];
    }
  }
  return { V: new Float32Array(Vout), F };
}

// ── spatial grid (self-intersections, thickness, inside/outside) ─────────

type Grid = { o: number[]; s: number; n: number[]; start: Uint32Array; items: Uint32Array };

function buildGrid(m: Mesh, maxCells = 6_000_000): Grid {
  const b = bounds(m.V);
  const nf = m.F.length / 3;
  let area = 0;
  for (let f = 0; f < nf; f++) area += faceArea2(m.V, m.F[f * 3], m.F[f * 3 + 1], m.F[f * 3 + 2]) / 2;
  let s = Math.max(Math.sqrt(area / Math.max(1, nf)) * 2.5, b.diag * 1e-4);
  const dims = () => b.size.map((v) => Math.max(1, Math.ceil(v / s) + 1));
  let n = dims();
  while (n[0] * n[1] * n[2] > maxCells) { s *= 1.3; n = dims(); }
  const o = [b.min[0] - s * 0.5, b.min[1] - s * 0.5, b.min[2] - s * 0.5];
  const cellRange = (f: number, out: Int32Array) => {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let k = 0; k < 3; k++) {
      const v = m.F[f * 3 + k];
      const x = m.V[v * 3], y = m.V[v * 3 + 1], z = m.V[v * 3 + 2];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    out[0] = Math.max(0, Math.floor((x0 - o[0]) / s)); out[1] = Math.max(0, Math.floor((y0 - o[1]) / s)); out[2] = Math.max(0, Math.floor((z0 - o[2]) / s));
    out[3] = Math.min(n[0] - 1, Math.floor((x1 - o[0]) / s)); out[4] = Math.min(n[1] - 1, Math.floor((y1 - o[1]) / s)); out[5] = Math.min(n[2] - 1, Math.floor((z1 - o[2]) / s));
  };
  const cells = n[0] * n[1] * n[2];
  const start = new Uint32Array(cells + 1);
  const r = new Int32Array(6);
  let total = 0;
  for (let f = 0; f < nf; f++) {
    cellRange(f, r);
    for (let z = r[2]; z <= r[5]; z++) for (let y = r[1]; y <= r[4]; y++) for (let x = r[0]; x <= r[3]; x++) { start[(z * n[1] + y) * n[0] + x + 1]++; total++; }
  }
  for (let i = 0; i < cells; i++) start[i + 1] += start[i];
  const cur = start.slice(0, cells);
  const items = new Uint32Array(total);
  for (let f = 0; f < nf; f++) {
    cellRange(f, r);
    for (let z = r[2]; z <= r[5]; z++) for (let y = r[1]; y <= r[4]; y++) for (let x = r[0]; x <= r[3]; x++) items[cur[(z * n[1] + y) * n[0] + x]++] = f;
  }
  return { o, s, n, start, items };
}

/** Moller-Trumbore, both sides. Returns t or Infinity. */
function rayTri(V: Float32Array, a: number, b: number, c: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number) {
  const ax = V[a * 3], ay = V[a * 3 + 1], az = V[a * 3 + 2];
  const e1x = V[b * 3] - ax, e1y = V[b * 3 + 1] - ay, e1z = V[b * 3 + 2] - az;
  const e2x = V[c * 3] - ax, e2y = V[c * 3 + 1] - ay, e2z = V[c * 3 + 2] - az;
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-14) return Infinity;
  const inv = 1 / det;
  const tx = ox - ax, ty = oy - ay, tz = oz - az;
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < 0 || u > 1) return Infinity;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < 0 || u + v > 1) return Infinity;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t > 0 ? t : Infinity;
}

/**
 * Walk the grid along a ray (Amanatides-Woo) calling visit(face) once per face.
 * visit returns false to stop early.
 */
function walkRay(G: Grid, stamp: Uint32Array, ray: number, ox: number, oy: number, oz: number,
                 dx: number, dy: number, dz: number, maxT: number, visit: (f: number) => boolean) {
  const o = [ox, oy, oz], d = [dx, dy, dz];
  const c = [0, 0, 0], step = [0, 0, 0], tMax = [0, 0, 0], tDelta = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    let ck = Math.floor((o[k] - G.o[k]) / G.s);
    if (ck < 0 || ck >= G.n[k]) return;
    c[k] = ck;
    if (d[k] > 0) { step[k] = 1; tMax[k] = (G.o[k] + (ck + 1) * G.s - o[k]) / d[k]; tDelta[k] = G.s / d[k]; }
    else if (d[k] < 0) { step[k] = -1; tMax[k] = (G.o[k] + ck * G.s - o[k]) / d[k]; tDelta[k] = -G.s / d[k]; }
    else { step[k] = 0; tMax[k] = Infinity; tDelta[k] = Infinity; }
  }
  let t = 0;
  for (let guard = 0; guard < 100000; guard++) {
    const cell = (c[2] * G.n[1] + c[1]) * G.n[0] + c[0];
    for (let k = G.start[cell]; k < G.start[cell + 1]; k++) {
      const f = G.items[k];
      if (stamp[f] === ray) continue;
      stamp[f] = ray;
      if (!visit(f)) return;
    }
    const ax = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : (tMax[1] < tMax[2] ? 1 : 2);
    t = tMax[ax];
    if (t > maxT) return;
    c[ax] += step[ax];
    if (c[ax] < 0 || c[ax] >= G.n[ax]) return;
    tMax[ax] += tDelta[ax];
  }
}

// Moller 1997 triangle-triangle test, the interval version.
function intervals(VV0: number, VV1: number, VV2: number, D0: number, D1: number, D2: number, D0D1: number, D0D2: number, out: number[]) {
  if (D0D1 > 0) { out[0] = VV2 + (VV0 - VV2) * D2 / (D2 - D0); out[1] = VV2 + (VV1 - VV2) * D2 / (D2 - D1); }
  else if (D0D2 > 0) { out[0] = VV1 + (VV0 - VV1) * D1 / (D1 - D0); out[1] = VV1 + (VV2 - VV1) * D1 / (D1 - D2); }
  else if (D1 * D2 > 0 || D0 !== 0) { out[0] = VV0 + (VV1 - VV0) * D0 / (D0 - D1); out[1] = VV0 + (VV2 - VV0) * D0 / (D0 - D2); }
  else if (D1 !== 0) { out[0] = VV1 + (VV0 - VV1) * D1 / (D1 - D0); out[1] = VV1 + (VV2 - VV1) * D1 / (D1 - D2); }
  else if (D2 !== 0) { out[0] = VV2 + (VV0 - VV2) * D2 / (D2 - D0); out[1] = VV2 + (VV1 - VV2) * D2 / (D2 - D1); }
  else return true; // coplanar
  return false;
}
const I1 = [0, 0], I2 = [0, 0];
function triTri(V: Float32Array, a: number[], b: number[], eps: number): boolean {
  const P = (i: number, k: number) => V[i * 3 + k];
  const plane = (t: number[]) => {
    const e1 = [P(t[1], 0) - P(t[0], 0), P(t[1], 1) - P(t[0], 1), P(t[1], 2) - P(t[0], 2)];
    const e2 = [P(t[2], 0) - P(t[0], 0), P(t[2], 1) - P(t[0], 1), P(t[2], 2) - P(t[0], 2)];
    const N = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const d = -(N[0] * P(t[0], 0) + N[1] * P(t[0], 1) + N[2] * P(t[0], 2));
    return { N, d, len: Math.hypot(N[0], N[1], N[2]) };
  };
  const p2 = plane(b);
  const dist = (pl: ReturnType<typeof plane>, i: number) => {
    const v = pl.N[0] * P(i, 0) + pl.N[1] * P(i, 1) + pl.N[2] * P(i, 2) + pl.d;
    return Math.abs(v) < eps * pl.len ? 0 : v;
  };
  const du0 = dist(p2, a[0]), du1 = dist(p2, a[1]), du2 = dist(p2, a[2]);
  if (du0 * du1 > 0 && du0 * du2 > 0) return false;
  const p1 = plane(a);
  const dv0 = dist(p1, b[0]), dv1 = dist(p1, b[1]), dv2 = dist(p1, b[2]);
  if (dv0 * dv1 > 0 && dv0 * dv2 > 0) return false;
  const D = [p1.N[1] * p2.N[2] - p1.N[2] * p2.N[1], p1.N[2] * p2.N[0] - p1.N[0] * p2.N[2], p1.N[0] * p2.N[1] - p1.N[1] * p2.N[0]];
  const ax = Math.abs(D[0]), ay = Math.abs(D[1]), az = Math.abs(D[2]);
  const k = ax > ay ? (ax > az ? 0 : 2) : (ay > az ? 1 : 2);
  if (intervals(P(a[0], k), P(a[1], k), P(a[2], k), du0, du1, du2, du0 * du1, du0 * du2, I1)) return false; // coplanar: not counted
  if (intervals(P(b[0], k), P(b[1], k), P(b[2], k), dv0, dv1, dv2, dv0 * dv1, dv0 * dv2, I2)) return false;
  const a0 = Math.min(I1[0], I1[1]), a1 = Math.max(I1[0], I1[1]);
  const b0 = Math.min(I2[0], I2[1]), b1 = Math.max(I2[0], I2[1]);
  return !(a1 < b0 || b1 < a0);
}

function touching(V: Float32Array, A: number[], B: number[], eps: number) {
  for (const a of A) for (const b of B) {
    if (Math.abs(V[a * 3] - V[b * 3]) <= eps && Math.abs(V[a * 3 + 1] - V[b * 3 + 1]) <= eps && Math.abs(V[a * 3 + 2] - V[b * 3 + 2]) <= eps) return true;
  }
  return false;
}

/** Faces that pass through another face. -1 when the mesh is too big to check in a browser. */
function selfIntersections(m: Mesh, G: Grid, budgetMs = 7000): { count: number; faces: Uint8Array | null } {
  const nf = m.F.length / 3;
  if (nf > 700_000) return { count: -1, faces: null };
  const eps = bounds(m.V).diag * 1e-9;
  const hit = new Uint8Array(nf);
  const t0 = performance.now();
  const cellOf = (f: number, k: number) => {
    let lo = Infinity;
    for (let c = 0; c < 3; c++) { const v = m.V[m.F[f * 3 + c] * 3 + k]; if (v < lo) lo = v; }
    return Math.max(0, Math.floor((lo - G.o[k]) / G.s));
  };
  const A = [0, 0, 0], B = [0, 0, 0];
  let checks = 0;
  const cells = G.n[0] * G.n[1] * G.n[2];
  for (let cell = 0; cell < cells; cell++) {
    const s = G.start[cell], e = G.start[cell + 1];
    if (e - s < 2) continue;
    const cx = cell % G.n[0], cy = Math.floor(cell / G.n[0]) % G.n[1], cz = Math.floor(cell / (G.n[0] * G.n[1]));
    for (let i = s; i < e; i++) {
      const f = G.items[i];
      A[0] = m.F[f * 3]; A[1] = m.F[f * 3 + 1]; A[2] = m.F[f * 3 + 2];
      for (let j = i + 1; j < e; j++) {
        const g = G.items[j];
        B[0] = m.F[g * 3]; B[1] = m.F[g * 3 + 1]; B[2] = m.F[g * 3 + 2];
        if (A[0] === B[0] || A[0] === B[1] || A[0] === B[2] || A[1] === B[0] || A[1] === B[1] || A[1] === B[2] || A[2] === B[0] || A[2] === B[1] || A[2] === B[2]) continue;
        // corners in the same place but not joined: parts that touch, not cross
        if (touching(m.V, A, B, eps * 10)) continue;
        // test each pair once: in the first cell their boxes share
        if (Math.max(cellOf(f, 0), cellOf(g, 0)) !== cx || Math.max(cellOf(f, 1), cellOf(g, 1)) !== cy || Math.max(cellOf(f, 2), cellOf(g, 2)) !== cz) continue;
        if (triTri(m.V, A, B, eps)) { hit[f] = 1; hit[g] = 1; }
        if ((++checks & 4095) === 0 && performance.now() - t0 > budgetMs) return { count: -1, faces: null };
      }
    }
  }
  let count = 0;
  for (let f = 0; f < nf; f++) count += hit[f];
  return { count, faces: hit };
}

// ── orientation of faces ─────────────────────────────────────────────────

type Shells = {
  shell: Int32Array; n: number;
  flip: Uint8Array;            // final: faces whose winding must be reversed
  flipped: number;             // how many
  closed: Uint8Array;          // per shell
  tris: Uint32Array;           // per shell
  volume: Float64Array;        // per shell, after flipping
  diag: Float64Array;          // per shell bounding box
  nonOrientable: number;
};

/**
 * Make the winding agree across every shared edge, then point each closed
 * shell outwards (inwards for a cavity inside another shell). Open shells are
 * oriented the way most of their faces already are.
 */
function orientShells(m: Mesh, A: Adj, G: Grid | null): Shells {
  const F = m.F, V = m.V;
  const nf = F.length / 3;
  const shell = new Int32Array(nf).fill(-1);
  const rel = new Uint8Array(nf);
  const queue = new Uint32Array(nf);
  let n = 0, nonOrientable = 0;
  const tris: number[] = [], open: number[] = [], flaggedPer: number[] = [];
  for (let seed = 0; seed < nf; seed++) {
    if (shell[seed] >= 0) continue;
    let qh = 0, qt = 0;
    queue[qt++] = seed; shell[seed] = n; rel[seed] = 0;
    let count = 0, flagged = 0, isOpen = 0;
    while (qh < qt) {
      const f = queue[qh++];
      count++; flagged += rel[f];
      for (let k = 0; k < 3; k++) {
        const h = f * 3 + k;
        const u = F[h], w = F[nxt(h)];
        let other = -1, sameDir = 0, faces = 1;
        for (let i = A.start[u]; i < A.start[u + 1]; i++) {
          const g = A.he[i];
          if (g === h || F[nxt(g)] !== w) continue;
          faces++; other = (g / 3) | 0; sameDir = 1;
        }
        for (let i = A.start[w]; i < A.start[w + 1]; i++) {
          const g = A.he[i];
          if (F[nxt(g)] !== u) continue;
          faces++; other = (g / 3) | 0; sameDir = 0;
        }
        if (faces === 1) { isOpen = 1; continue; }
        if (faces !== 2) continue;                       // non-manifold: not a link
        const want = rel[f] ^ sameDir;
        if (shell[other] < 0) { shell[other] = n; rel[other] = want; queue[qt++] = other; }
        else if (rel[other] !== want) nonOrientable++;
      }
    }
    tris.push(count); open.push(isOpen); flaggedPer.push(flagged);
    n++;
  }
  // signed volume and box per shell, using the relative winding
  const vol = new Float64Array(n);
  const box = new Float64Array(n * 6);
  for (let s = 0; s < n; s++) { box[s * 6] = box[s * 6 + 1] = box[s * 6 + 2] = Infinity; box[s * 6 + 3] = box[s * 6 + 4] = box[s * 6 + 5] = -Infinity; }
  for (let f = 0; f < nf; f++) {
    const s = shell[f];
    const v = faceVolume(V, F[f * 3], F[f * 3 + 1], F[f * 3 + 2]);
    vol[s] += rel[f] ? -v : v;
    for (let k = 0; k < 3; k++) {
      const p = F[f * 3 + k];
      for (let a = 0; a < 3; a++) {
        const c = V[p * 3 + a];
        if (c < box[s * 6 + a]) box[s * 6 + a] = c;
        if (c > box[s * 6 + 3 + a]) box[s * 6 + 3 + a] = c;
      }
    }
  }
  // A closed shell sitting inside another closed shell is a cavity and should
  // face inwards. Checked only where a box sits inside another box, by casting
  // a ray and counting crossings of the container.
  const expect = new Int8Array(n).fill(1);
  const closedIdx: number[] = [];
  for (let s = 0; s < n; s++) if (!open[s]) closedIdx.push(s);
  if (G && closedIdx.length > 1 && closedIdx.length <= 200) {
    const firstFace = new Int32Array(n).fill(-1);
    for (let f = 0; f < nf; f++) if (firstFace[shell[f]] < 0) firstFace[shell[f]] = f;
    const stamp = new Uint32Array(nf);
    let ray = 0;
    for (const s of closedIdx) {
      let depth = 0;
      for (const c of closedIdx) {
        if (c === s) continue;
        const inside = box[c * 6] <= box[s * 6] && box[c * 6 + 1] <= box[s * 6 + 1] && box[c * 6 + 2] <= box[s * 6 + 2]
          && box[c * 6 + 3] >= box[s * 6 + 3] && box[c * 6 + 4] >= box[s * 6 + 4] && box[c * 6 + 5] >= box[s * 6 + 5];
        if (!inside) continue;
        const p = F[firstFace[s] * 3];
        const ox = V[p * 3], oy = V[p * 3 + 1], oz = V[p * 3 + 2];
        const dx = 0.8017, dy = 0.4519, dz = 0.3913;      // odd direction, avoids hitting edges exactly
        let crossings = 0;
        walkRay(G, stamp, ++ray, ox, oy, oz, dx, dy, dz, Infinity, (f) => {
          if (shell[f] !== c) return true;
          if (rayTri(V, F[f * 3], F[f * 3 + 1], F[f * 3 + 2], ox, oy, oz, dx, dy, dz) < Infinity) crossings++;
          return true;
        });
        if (crossings % 2 === 1) depth++;
      }
      if (depth % 2 === 1) expect[s] = -1;
    }
  }
  const invert = new Uint8Array(n);
  for (let s = 0; s < n; s++) {
    if (!open[s]) invert[s] = vol[s] * expect[s] < 0 ? 1 : 0;
    else invert[s] = flaggedPer[s] * 2 > tris[s] ? 1 : 0;
  }
  const flip = new Uint8Array(nf);
  let flipped = 0;
  for (let f = 0; f < nf; f++) { flip[f] = rel[f] ^ invert[shell[f]]; flipped += flip[f]; }
  const volume = new Float64Array(n), diag = new Float64Array(n), closed = new Uint8Array(n);
  for (let s = 0; s < n; s++) {
    volume[s] = invert[s] ? -vol[s] : vol[s];
    diag[s] = Math.hypot(box[s * 6 + 3] - box[s * 6], box[s * 6 + 4] - box[s * 6 + 1], box[s * 6 + 5] - box[s * 6 + 2]);
    closed[s] = open[s] ? 0 : 1;
  }
  return { shell, n, flip, flipped, closed, tris: Uint32Array.from(tris), volume, diag, nonOrientable };
}

// ── checks ───────────────────────────────────────────────────────────────

export type Report = {
  triangles: number;
  size: number[];
  volume: number;               // cm^3
  holes: number;
  openEdges: number;
  nonManifold: number;
  duplicates: number;
  bad: number;
  flipped: number;
  shells: number;
  debris: number;
  selfX: number;                // faces, -1 = not checked
  thin: { limit: number; pct: number; checked: boolean };
  sheet: boolean;
  highPoly: boolean;
  maxTris: number;
  units: { suspect: boolean; suggest: number; known: string | null };
  orient: { ok: boolean; relief: boolean; score: number; dir: number; note: string };
  base: { ok: boolean; note: string };
  total: number;
  overlay: { holes: Float32Array; nonManifold: Float32Array; selfX: Float32Array };
};

const DIRS = [
  { axis: 2, sign: -1 }, { axis: 2, sign: 1 }, { axis: 1, sign: -1 },
  { axis: 1, sign: 1 }, { axis: 0, sign: -1 }, { axis: 0, sign: 1 },
];
const DIR_NAME = ['underside', 'top', 'front', 'back', 'left side', 'right side'];

/** Flat area lying on each of the six bounding-box faces, with outward normals. */
function flatFaces(m: Mesh, flip: Uint8Array | null) {
  const b = bounds(m.V);
  const tol = b.diag * 0.004 + 1e-6;
  const area = new Float64Array(6);
  const nf = m.F.length / 3;
  for (let f = 0; f < nf; f++) {
    const a = m.F[f * 3], bb = m.F[f * 3 + 1], c = m.F[f * 3 + 2];
    const ux = m.V[bb * 3] - m.V[a * 3], uy = m.V[bb * 3 + 1] - m.V[a * 3 + 1], uz = m.V[bb * 3 + 2] - m.V[a * 3 + 2];
    const vx = m.V[c * 3] - m.V[a * 3], vy = m.V[c * 3 + 1] - m.V[a * 3 + 1], vz = m.V[c * 3 + 2] - m.V[a * 3 + 2];
    let n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const len = Math.hypot(n[0], n[1], n[2]);
    if (len < 1e-12) continue;
    const sg = flip && flip[f] ? -1 : 1;
    n = n.map((x) => (x * sg) / len);
    for (let d = 0; d < 6; d++) {
      const D = DIRS[d];
      if (n[D.axis] * D.sign < 0.985) continue;
      const edge = D.sign < 0 ? b.min[D.axis] : b.max[D.axis];
      let far = 0;
      for (let k = 0; k < 3; k++) far = Math.max(far, Math.abs(m.V[m.F[f * 3 + k] * 3 + D.axis] - edge));
      if (far > tol) continue;
      area[d] += len / 2;
    }
  }
  const faceArea = (d: number) => { const ax = DIRS[d].axis; const o = [0, 1, 2].filter((k) => k !== ax); return b.size[o[0]] * b.size[o[1]] || 1; };
  return { area, score: [0, 1, 2, 3, 4, 5].map((d) => Math.min(1, area[d] / faceArea(d))), b };
}

/**
 * Which face is the back of a relief: the LARGEST face that is mostly flat.
 * "Mostly flat" alone is not enough: a relief standing on its edge has a flat
 * edge underneath, and that strip is as flat as the back. -1 = none.
 */
function reliefBack(ff: { area: Float64Array; score: number[] }) {
  let best = -1;
  for (let d = 0; d < 6; d++) if (ff.score[d] >= 0.55 && (best < 0 || ff.area[d] > ff.area[best] * 1.0001)) best = d;
  return best;
}

/** Groups of corners joined by open edges, one group per hole. */
function openOutlines(F: Uint32Array, isB: Uint8Array, nv: number): number[][] {
  const par = new Int32Array(nv).map((_, i) => i);
  const find = (x: number): number => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  const onB = new Uint8Array(nv);
  for (let h = 0; h < F.length; h++) {
    if (!isB[h]) continue;
    const u = F[h], w = F[nxt(h)];
    onB[u] = 1; onB[w] = 1;
    const a = find(u), b = find(w);
    if (a !== b) par[a] = b;
  }
  const groups = new Map<number, number[]>();
  for (let v = 0; v < nv; v++) {
    if (!onB[v]) continue;
    const r = find(v);
    const g = groups.get(r);
    if (g) g.push(v); else groups.set(r, [v]);
  }
  return [...groups.values()];
}

function boundaryLoops(m: Mesh, A: Adj, isB: Uint8Array): { loops: number[][]; hes: number[][] } {
  const used = new Uint8Array(m.F.length);
  const loops: number[][] = [], hes: number[][] = [];
  for (let h0 = 0; h0 < m.F.length; h0++) {
    if (!isB[h0] || used[h0]) continue;
    const loop: number[] = [], he: number[] = [];
    let h = h0, ok = false;
    for (let guard = 0; guard < 2_000_000; guard++) {
      used[h] = 1; loop.push(m.F[h]); he.push(h);
      const w = m.F[nxt(h)];
      if (w === m.F[h0]) { ok = true; break; }
      let next = -1;
      for (let k = A.start[w]; k < A.start[w + 1]; k++) { const g = A.he[k]; if (isB[g] && !used[g]) { next = g; break; } }
      if (next < 0) break;
      h = next;
    }
    if (loop.length >= 2) { loops.push(loop); hes.push(ok ? he : []); }
  }
  return { loops, hes };
}

function seg(out: number[], V: Float32Array, a: number, b: number) {
  out.push(V[a * 3], V[a * 3 + 1], V[a * 3 + 2], V[b * 3], V[b * 3 + 1], V[b * 3 + 2]);
}

/** selfX: false = do not test (the rebuilt relief cannot intersect itself by construction, reported as 0). */
export type CheckCtx = { mode: Mode; unitKnown: string | null; fileMaxDim: number; thinLimit?: number; selfX?: boolean };

/** Run every check. Used on the original AND on the repaired file. */
export function check(m: Mesh, ctx: CheckCtx, progress: Progress = noop): Report {
  const rule = MODES[ctx.mode];
  const F = m.F, V = m.V;
  const nf = F.length / 3;
  const b = bounds(V);
  progress(0.05, 'Building edges…');
  const A = adjacency(V.length / 3, F);

  // bad triangles and duplicates
  let bad = 0, duplicates = 0;
  const floor = b.diag * 1e-10;
  for (let f = 0; f < nf; f++) {
    const a = F[f * 3], c1 = F[f * 3 + 1], c2 = F[f * 3 + 2];
    if (isSliver(V, a, c1, c2, floor)) { bad++; continue; }
    const lo = Math.min(a, c1, c2);
    for (let k = A.start[lo]; k < A.start[lo + 1]; k++) {
      const g = (A.he[k] / 3) | 0;
      if (g >= f) continue;
      const x = F[g * 3], y = F[g * 3 + 1], z = F[g * 3 + 2];
      if ((x === a || x === c1 || x === c2) && (y === a || y === c1 || y === c2) && (z === a || z === c1 || z === c2)) { duplicates++; break; }
    }
  }

  // edges
  progress(0.2, 'Checking edges…');
  const isB = new Uint8Array(F.length);
  let openEdges = 0, nonManifoldW = 0;
  const holeSeg: number[] = [], nmSeg: number[] = [];
  for (let h = 0; h < F.length; h++) {
    const [same, opp] = edgeCount(F, A, h);
    const t = same + opp;
    if (t === 1) { isB[h] = 1; openEdges++; if (holeSeg.length < 600_000) seg(holeSeg, V, F[h], F[nxt(h)]); }
    else if (t > 2) { nonManifoldW += 1 / t; if (nmSeg.length < 600_000 && F[h] < F[nxt(h)]) seg(nmSeg, V, F[h], F[nxt(h)]); }
  }
  const nonManifold = Math.round(nonManifoldW);
  // Holes are counted as connected outlines of open edges, whatever way their
  // faces point: on a broken file the faces round a hole are often flipped, and
  // a walk that follows face direction then cannot get round the hole.
  const loops = openOutlines(F, isB, V.length / 3);
  const holes = loops.length;

  progress(0.35, 'Indexing space…');
  const G = buildGrid(m);

  // Zero thickness: an open surface with nothing behind it, like a relief
  // exported without its back. A closed part with a hole is not that, however
  // big the hole, so it is tested directly: from points on the surface, look
  // both ways. A sheet has open air on both sides almost everywhere.
  const sheet = openEdges > 0 && openAirShare(m, G) > 0.5;
  progress(0.45, 'Checking which way faces point…');
  const S = orientShells(m, A, G);

  // debris: tiny loose bits, never a deliberate small part like the dot of an i
  let debris = 0;
  const boxVol = Math.max(1e-9, b.size[0] * b.size[1] * b.size[2]);
  for (let s = 0; s < S.n; s++) if (isDebris(S, s, b.diag, boxVol)) debris++;

  // self-intersections
  let selfX = ctx.selfX === false ? 0 : -1;
  const sxSeg: number[] = [];
  if (ctx.selfX !== false) {
    progress(0.55, 'Looking for faces that cross each other…');
    const r = selfIntersections(m, G);
    selfX = r.count;
    if (r.faces) for (let f = 0; f < nf && sxSeg.length < 600_000; f++) {
      if (!r.faces[f]) continue;
      seg(sxSeg, V, F[f * 3], F[f * 3 + 1]); seg(sxSeg, V, F[f * 3 + 1], F[f * 3 + 2]); seg(sxSeg, V, F[f * 3 + 2], F[f * 3]);
    }
  }

  // thickness, sampled: rays from the surface straight inwards
  progress(0.8, 'Measuring wall thickness…');
  const thinLimit = ctx.thinLimit ?? rule.thin;
  const thin = { limit: thinLimit, pct: 0, checked: false };
  if (thinLimit > 0 && nf > 0) thin.pct = thinShare(m, S.flip, G, thinLimit), thin.checked = true;

  // units
  const units = { suspect: false, suggest: 1, known: ctx.unitKnown };
  if (!ctx.unitKnown) {
    const L = ctx.fileMaxDim;
    if (L < 1) units.suspect = true, units.suggest = 1000;
    else if (L < 10) units.suspect = true, units.suggest = 25.4;
    else if (L > 3000) units.suspect = true, units.suggest = L / 1000 >= 10 ? 0.001 : 0.1;
  }

  // orientation and base
  const ff = flatFaces(m, S.flip);
  const best = reliefBack(ff);
  const orient = { ok: true, relief: best >= 0, score: best >= 0 ? ff.score[best] : 0, dir: 0, note: '' };
  const base = { ok: true, note: '' };
  if (rule.relief) {
    if (best === 0 || (best > 0 && ff.area[0] >= ff.area[best] * 0.9)) { /* flat back already down */ }
    else if (best > 0) { orient.ok = false; orient.dir = best; orient.note = `The flat back is on the ${DIR_NAME[best]}, so the router would be looking at the wrong side.`; }
    else if (sheet) { /* an open relief surface: rebuilt with a back */ }
    else { orient.note = 'No flat back in any direction: this is a full 3D model. A router reaches only what it can see from above, so the rebuild keeps that.'; }
    const fb = ff.score[0];
    if (orient.ok && !sheet && fb < 0.55 && orient.relief) { base.ok = false; base.note = 'The back is not flat.'; }
  } else {
    const contact = ff.area.map((a) => a);
    const bestC = contact.indexOf(Math.max(...contact));
    if (contact[0] < contact[bestC] * 0.8 && contact[bestC] > 25) {
      orient.ok = false; orient.dir = bestC;
      orient.note = `The largest flat face is the ${DIR_NAME[bestC]}. Turned to sit on it, the print needs fewer supports.`;
    }
    const sitting = orient.ok ? contact[0] : contact[bestC];
    if (sitting < 5) { base.ok = false; base.note = 'It touches the bed on a point or an edge: use a brim or supports.'; }
  }

  const highPoly = nf > rule.maxTris;
  let volume = 0;
  for (let s = 0; s < S.n; s++) volume += S.volume[s];
  const total = holes + nonManifold + duplicates + bad + S.flipped + Math.max(0, selfX) + debris
    + (sheet ? 1 : 0) + (thin.checked && thin.pct >= 1 ? 1 : 0) + (highPoly ? 1 : 0)
    + (units.suspect ? 1 : 0) + (orient.ok ? 0 : 1) + (base.ok ? 0 : 1);
  progress(1, 'Done');
  return {
    triangles: nf, size: b.size, volume: Math.abs(volume) / 1000,
    holes, openEdges, nonManifold, duplicates, bad, flipped: S.flipped,
    shells: S.n, debris, selfX, thin, sheet, highPoly, maxTris: rule.maxTris,
    units, orient, base, total,
    overlay: { holes: new Float32Array(holeSeg), nonManifold: new Float32Array(nmSeg), selfX: new Float32Array(sxSeg) },
  };
}

/**
 * Debris = bits nobody meant to make: stray triangles, specks far smaller than
 * the part, closed bits with no volume. Never a real piece that merely has a
 * hole in it, nor a small deliberate part like the dot of an i.
 */
function isDebris(S: Shells, s: number, diag: number, boxVol: number) {
  return (S.tris[s] <= 3 && !S.closed[s] && S.diag[s] < diag * 0.05)
    || S.diag[s] < diag * 0.002
    || (S.closed[s] === 1 && Math.abs(S.volume[s]) < boxVol * 1e-9);
}

/** Share of sampled surface points with nothing in front of them AND nothing behind. */
function openAirShare(m: Mesh, G: Grid) {
  const F = m.F, V = m.V;
  const nf = F.length / 3;
  const N = Math.min(1500, nf);
  let seed = 777;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const stamp = new Uint32Array(nf);
  const eps = bounds(V).diag * 1e-6;
  let ray = 0, open = 0, tried = 0;
  for (let i = 0; i < N; i++) {
    const f = Math.floor(rnd() * nf);
    const a = F[f * 3], b = F[f * 3 + 1], c = F[f * 3 + 2];
    const ux = V[b * 3] - V[a * 3], uy = V[b * 3 + 1] - V[a * 3 + 1], uz = V[b * 3 + 2] - V[a * 3 + 2];
    const vx = V[c * 3] - V[a * 3], vy = V[c * 3 + 1] - V[a * 3 + 1], vz = V[c * 3 + 2] - V[a * 3 + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (!l) continue;
    nx /= l; ny /= l; nz /= l;
    const cx = (V[a * 3] + V[b * 3] + V[c * 3]) / 3, cy = (V[a * 3 + 1] + V[b * 3 + 1] + V[c * 3 + 1]) / 3, cz = (V[a * 3 + 2] + V[b * 3 + 2] + V[c * 3 + 2]) / 3;
    tried++;
    let hits = 0;
    for (const s of [1, -1]) {
      const ox = cx + nx * eps * s, oy = cy + ny * eps * s, oz = cz + nz * eps * s;
      let hit = false;
      walkRay(G, stamp, ++ray, ox, oy, oz, nx * s, ny * s, nz * s, Infinity, (g) => {
        if (g === f) return true;
        if (rayTri(V, F[g * 3], F[g * 3 + 1], F[g * 3 + 2], ox, oy, oz, nx * s, ny * s, nz * s) < Infinity) { hit = true; return false; }
        return true;
      });
      if (hit) hits++;
    }
    if (!hits) open++;
  }
  return tried ? open / tried : 0;
}

/** Share of the surface (percent, sampled) where the wall is thinner than `limit`. */
function thinShare(m: Mesh, flip: Uint8Array, G: Grid, limit: number) {
  const F = m.F, V = m.V;
  const nf = F.length / 3;
  const cum = new Float64Array(nf);
  let acc = 0;
  for (let f = 0; f < nf; f++) { acc += faceArea2(V, F[f * 3], F[f * 3 + 1], F[f * 3 + 2]); cum[f] = acc; }
  if (acc <= 0) return 0;
  const N = Math.min(4000, nf);
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const stamp = new Uint32Array(nf);
  let thin = 0, ray = 0;
  const eps = bounds(V).diag * 1e-6;
  for (let i = 0; i < N; i++) {
    const r = rnd() * acc;
    let lo = 0, hi = nf - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < r) lo = mid + 1; else hi = mid; }
    const f = lo;
    const a = F[f * 3], b = F[f * 3 + 1], c = F[f * 3 + 2];
    const ux = V[b * 3] - V[a * 3], uy = V[b * 3 + 1] - V[a * 3 + 1], uz = V[b * 3 + 2] - V[a * 3 + 2];
    const vx = V[c * 3] - V[a * 3], vy = V[c * 3 + 1] - V[a * 3 + 1], vz = V[c * 3 + 2] - V[a * 3 + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) * (flip[f] ? -1 : 1);
    if (!len) continue;
    nx /= len; ny /= len; nz /= len;
    const cx = (V[a * 3] + V[b * 3] + V[c * 3]) / 3, cy = (V[a * 3 + 1] + V[b * 3 + 1] + V[c * 3 + 1]) / 3, cz = (V[a * 3 + 2] + V[b * 3 + 2] + V[c * 3 + 2]) / 3;
    const ox = cx - nx * eps, oy = cy - ny * eps, oz = cz - nz * eps;
    let best = Infinity;
    walkRay(G, stamp, ++ray, ox, oy, oz, -nx, -ny, -nz, limit, (g) => {
      if (g === f) return true;
      const t = rayTri(V, F[g * 3], F[g * 3 + 1], F[g * 3 + 2], ox, oy, oz, -nx, -ny, -nz);
      if (t < best) best = t;
      return true;
    });
    if (best < limit) thin++;
  }
  return Math.round((1000 * thin) / N) / 10;
}

// ── repairs ──────────────────────────────────────────────────────────────

/** Remove zero-area faces and repeated faces (both copies of a back-to-back pair). */
function cleanFaces(m: Mesh): { mesh: Mesh; bad: number; dup: number } {
  const F = m.F, V = m.V;
  const nf = F.length / 3;
  const b = bounds(V);
  const floor = b.diag * 1e-10;
  const keep = new Uint8Array(nf).fill(1);
  let bad = 0, dup = 0;
  const A = adjacency(V.length / 3, F);
  for (let f = 0; f < nf; f++) {
    if (isSliver(V, F[f * 3], F[f * 3 + 1], F[f * 3 + 2], floor)) { keep[f] = 0; bad++; }
  }
  for (let f = 0; f < nf; f++) {
    if (!keep[f]) continue;
    const a = F[f * 3], c1 = F[f * 3 + 1], c2 = F[f * 3 + 2];
    const lo = Math.min(a, c1, c2);
    for (let k = A.start[lo]; k < A.start[lo + 1]; k++) {
      const g = (A.he[k] / 3) | 0;
      if (g <= f || !keep[g]) continue;
      const x = F[g * 3], y = F[g * 3 + 1], z = F[g * 3 + 2];
      if (!((x === a || x === c1 || x === c2) && (y === a || y === c1 || y === c2) && (z === a || z === c1 || z === c2))) continue;
      // same winding = a copy, drop it; opposite winding = an internal double wall, drop both
      const sameWinding = (x === a && y === c1) || (y === a && z === c1) || (z === a && x === c1);
      keep[g] = 0; dup++;
      if (!sameWinding) { keep[f] = 0; dup++; break; }
    }
  }
  return { mesh: compact(m, keep), bad, dup };
}

/** Close hairline cracks: open-edge corners closer than `tol` become one corner. */
function stitch(m: Mesh, tol: number): { mesh: Mesh; merged: number } {
  const F = m.F, V = m.V;
  const nv = V.length / 3;
  const A = adjacency(nv, F);
  const onB = new Uint8Array(nv);
  for (let h = 0; h < F.length; h++) { const [s, o] = edgeCount(F, A, h); if (s + o === 1) { onB[F[h]] = 1; onB[F[nxt(h)]] = 1; } }
  const cells = new Map<string, number[]>();
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  for (let v = 0; v < nv; v++) {
    if (!onB[v]) continue;
    const k = key(Math.floor(V[v * 3] / tol), Math.floor(V[v * 3 + 1] / tol), Math.floor(V[v * 3 + 2] / tol));
    const l = cells.get(k); if (l) l.push(v); else cells.set(k, [v]);
  }
  const parent = new Int32Array(nv).map((_, i) => i);
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  let merged = 0;
  for (let v = 0; v < nv; v++) {
    if (!onB[v]) continue;
    const cx = Math.floor(V[v * 3] / tol), cy = Math.floor(V[v * 3 + 1] / tol), cz = Math.floor(V[v * 3 + 2] / tol);
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const l = cells.get(key(cx + dx, cy + dy, cz + dz));
      if (!l) continue;
      for (const w of l) {
        if (w <= v) continue;
        if (Math.hypot(V[v * 3] - V[w * 3], V[v * 3 + 1] - V[w * 3 + 1], V[v * 3 + 2] - V[w * 3 + 2]) > tol) continue;
        const a = find(v), c = find(w);
        if (a !== c) { parent[c] = a; merged++; }
      }
    }
  }
  if (!merged) return { mesh: m, merged: 0 };
  const F2 = new Uint32Array(F.length);
  for (let i = 0; i < F.length; i++) F2[i] = find(F[i]);
  return { mesh: compact({ V, F: F2 }, null), merged };
}

/**
 * Split vertices where separate fans of faces meet at one point, and edges that
 * carry more than two faces. Afterwards every edge has at most two faces.
 */
function splitNonManifold(m: Mesh): { mesh: Mesh; split: number } {
  const F = m.F, V = m.V;
  const nv = V.length / 3;
  const A = adjacency(nv, F);
  const F2 = F.slice();
  const extra: number[] = [];
  let next = nv, split = 0;
  const facesOn = (u: number, w: number, out: number[]) => {
    out.length = 0;
    for (let k = A.start[u]; k < A.start[u + 1]; k++) if (F[nxt(A.he[k])] === w) out.push((A.he[k] / 3) | 0);
    for (let k = A.start[w]; k < A.start[w + 1]; k++) if (F[nxt(A.he[k])] === u) out.push((A.he[k] / 3) | 0);
    return out;
  };
  const tmp: number[] = [];
  /**
   * Faces around an edge carrying more than two, paired the way solids meet:
   * two cubes touching along an edge put four faces on it, and each cube's
   * own two faces belong together. Walking round the edge by angle, a face
   * running w->u has its solid on the increasing-angle side and the next face
   * running u->w closes that wedge. Unbalanced edges are left unpaired (cut).
   */
  const pairsOn = (u: number, w: number): [number, number][] => {
    const items: { f: number; same: boolean; ang: number }[] = [];
    const dx = V[w * 3] - V[u * 3], dy = V[w * 3 + 1] - V[u * 3 + 1], dz = V[w * 3 + 2] - V[u * 3 + 2];
    const dl = Math.hypot(dx, dy, dz) || 1;
    const d = [dx / dl, dy / dl, dz / dl];
    const ref = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const r0 = ref[0] - d[0] * (ref[0] * d[0] + ref[1] * d[1] + ref[2] * d[2]);
    const r1 = ref[1] - d[1] * (ref[0] * d[0] + ref[1] * d[1] + ref[2] * d[2]);
    const r2 = ref[2] - d[2] * (ref[0] * d[0] + ref[1] * d[1] + ref[2] * d[2]);
    const rl = Math.hypot(r0, r1, r2) || 1;
    const r = [r0 / rl, r1 / rl, r2 / rl];
    const s = [d[1] * r[2] - d[2] * r[1], d[2] * r[0] - d[0] * r[2], d[0] * r[1] - d[1] * r[0]];
    const add = (h: number, same: boolean) => {
      const x = F[nxt(nxt(h))];
      const vx = V[x * 3] - V[u * 3], vy = V[x * 3 + 1] - V[u * 3 + 1], vz = V[x * 3 + 2] - V[u * 3 + 2];
      items.push({ f: (h / 3) | 0, same, ang: Math.atan2(vx * s[0] + vy * s[1] + vz * s[2], vx * r[0] + vy * r[1] + vz * r[2]) });
    };
    for (let k = A.start[u]; k < A.start[u + 1]; k++) if (F[nxt(A.he[k])] === w) add(A.he[k], true);
    for (let k = A.start[w]; k < A.start[w + 1]; k++) if (F[nxt(A.he[k])] === u) add(A.he[k], false);
    const nSame = items.filter((i) => i.same).length;
    if (nSame * 2 !== items.length) return [];
    items.sort((a, b) => a.ang - b.ang);
    const out: [number, number][] = [];
    const n = items.length;
    for (let i = 0; i < n; i++) {
      const a = items[i], b = items[(i + 1) % n];
      if (!a.same && b.same) out.push([a.f, b.f]);
    }
    return out.length * 2 === n ? out : [];
  };
  for (let u = 0; u < nv; u++) {
    const s = A.start[u], e = A.start[u + 1];
    const deg = e - s;
    if (deg < 2) continue;
    const local = new Map<number, number>();
    for (let k = s; k < e; k++) local.set((A.he[k] / 3) | 0, k - s);
    const par = Array.from({ length: deg }, (_, i) => i);
    const fnd = (x: number): number => { while (par[x] !== x) x = par[x] = par[par[x]]; return x; };
    const join = (f1: number, f2: number) => {
      const a = local.get(f1), b = local.get(f2);
      if (a !== undefined && b !== undefined) par[fnd(a)] = fnd(b);
    };
    for (let k = s; k < e; k++) {
      const h = A.he[k];
      for (const w of [F[nxt(h)], F[prv(h)]]) {
        const fs = facesOn(u, w, tmp);
        if (fs.length === 2) join(fs[0], fs[1]);
        else if (fs.length > 2) for (const [f1, f2] of pairsOn(u, w)) join(f1, f2);
      }
    }
    const groups = new Map<number, number>();
    for (let i = 0; i < deg; i++) { const r = fnd(i); if (!groups.has(r)) groups.set(r, groups.size); }
    if (groups.size < 2) continue;
    const ids = [u];
    for (let g = 1; g < groups.size; g++) { ids.push(next++); extra.push(V[u * 3], V[u * 3 + 1], V[u * 3 + 2]); split++; }
    for (let k = s; k < e; k++) F2[A.he[k]] = ids[groups.get(fnd(k - s))!];
  }
  if (!split) return { mesh: m, split: 0 };
  const V2 = new Float32Array(V.length + extra.length);
  V2.set(V); V2.set(extra, V.length);
  return { mesh: { V: V2, F: F2 }, split };
}

/** Close every hole. Returns the new mesh and how many were closed. */
function fillHoles(m: Mesh): { mesh: Mesh; filled: number } {
  const A = adjacency(m.V.length / 3, m.F);
  const isB = new Uint8Array(m.F.length);
  for (let h = 0; h < m.F.length; h++) { const [s, o] = edgeCount(m.F, A, h); if (s + o === 1) isB[h] = 1; }
  const { loops, hes } = boundaryLoops(m, A, isB);
  if (!loops.length) return { mesh: m, filled: 0 };
  const V: number[] = Array.from(m.V);
  const keep = new Uint8Array(m.F.length / 3).fill(1);
  const add: number[] = [];
  const P = (i: number, k: number) => V[i * 3 + k];
  let filled = 0;
  for (let li = 0; li < loops.length; li++) {
    const loop = loops[li];
    if (!hes[li].length || loop.length < 3) continue;                // did not close on itself
    const poly = loop.slice().reverse();
    const n = poly.length;
    // Newell normal
    let nx = 0, ny = 0, nz = 0, per = 0;
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      nx += (P(a, 1) - P(b, 1)) * (P(a, 2) + P(b, 2));
      ny += (P(a, 2) - P(b, 2)) * (P(a, 0) + P(b, 0));
      nz += (P(a, 0) - P(b, 0)) * (P(a, 1) + P(b, 1));
      per += Math.hypot(P(a, 0) - P(b, 0), P(a, 1) - P(b, 1), P(a, 2) - P(b, 2));
    }
    const nl = Math.hypot(nx, ny, nz);
    if (nl < per * per * 1e-7) {
      // A slit, not a hole: corners lying along an edge of the face opposite
      // (a T-junction). Split that face at those corners instead of covering
      // the slit with triangles of no area.
      if (zipSlit(m, loop, hes[li], keep, add)) { filled++; continue; }
    }
    if (n === 3) { add.push(poly[0], poly[1], poly[2]); filled++; continue; }
    let tris: number[] = [];
    if (n <= 200_000 && nl > 0) {
      nx /= nl; ny /= nl; nz /= nl;
      // basis on the hole's plane, oriented so the polygon runs anticlockwise
      const ref = Math.abs(nx) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      let e1 = [ref[1] * nz - ref[2] * ny, ref[2] * nx - ref[0] * nz, ref[0] * ny - ref[1] * nx];
      const l1 = Math.hypot(e1[0], e1[1], e1[2]); e1 = e1.map((x) => x / l1);
      const e2 = [ny * e1[2] - nz * e1[1], nz * e1[0] - nx * e1[2], nx * e1[1] - ny * e1[0]];
      const flat = new Float64Array(n * 2);
      for (let i = 0; i < n; i++) {
        const v = poly[i];
        flat[i * 2] = P(v, 0) * e1[0] + P(v, 1) * e1[1] + P(v, 2) * e1[2];
        flat[i * 2 + 1] = P(v, 0) * e2[0] + P(v, 1) * e2[1] + P(v, 2) * e2[2];
      }
      tris = earcut(flat);
      // keep the winding of the polygon whatever order earcut returns
      for (let t = 0; t < tris.length; t += 3) {
        const a = tris[t], b = tris[t + 1], c = tris[t + 2];
        const s = (flat[b * 2] - flat[a * 2]) * (flat[c * 2 + 1] - flat[a * 2 + 1]) - (flat[c * 2] - flat[a * 2]) * (flat[b * 2 + 1] - flat[a * 2 + 1]);
        if (s < 0) { tris[t + 1] = c; tris[t + 2] = b; }
      }
    }
    if (tris.length >= (n - 2) * 3) {
      for (const t of tris) add.push(poly[t]);
    } else {
      // fall back to a fan around the hole's centre
      let cx = 0, cy = 0, cz = 0;
      for (const v of poly) { cx += P(v, 0); cy += P(v, 1); cz += P(v, 2); }
      const c = V.length / 3;
      V.push(cx / n, cy / n, cz / n);
      for (let i = 0; i < n; i++) add.push(poly[i], poly[(i + 1) % n], c);
    }
    filled++;
  }
  const nf = m.F.length / 3;
  const F: number[] = [];
  for (let f = 0; f < nf; f++) if (keep[f]) F.push(m.F[f * 3], m.F[f * 3 + 1], m.F[f * 3 + 2]);
  for (const x of add) F.push(x);
  return { mesh: compact({ V: new Float32Array(V), F: Uint32Array.from(F) }, null), filled };
}

function zipSlit(m: Mesh, loop: number[], he: number[], keep: Uint8Array, add: number[]): boolean {
  const V = m.V, F = m.F;
  const n = loop.length;
  const d = (a: number, b: number) => Math.hypot(V[a * 3] - V[b * 3], V[a * 3 + 1] - V[b * 3 + 1], V[a * 3 + 2] - V[b * 3 + 2]);
  let li = 0, best = -1;
  for (let i = 0; i < n; i++) { const l = d(loop[i], loop[(i + 1) % n]); if (l > best) { best = l; li = i; } }
  const h = he[li];
  const p = F[h], q = F[nxt(h)], r = F[nxt(nxt(h))];
  const f = (h / 3) | 0;
  if (!keep[f]) return false;
  // corners between q and p walking the loop, then put them in order from p
  const chain: number[] = [];
  for (let k = 2; k < n; k++) chain.push(loop[(li + k) % n]);
  chain.reverse();
  const L = best || 1;
  for (const c of chain) {
    const t = ((V[c * 3] - V[p * 3]) * (V[q * 3] - V[p * 3]) + (V[c * 3 + 1] - V[p * 3 + 1]) * (V[q * 3 + 1] - V[p * 3 + 1]) + (V[c * 3 + 2] - V[p * 3 + 2]) * (V[q * 3 + 2] - V[p * 3 + 2])) / (L * L);
    if (t <= 0 || t >= 1) return false;
    const off = Math.hypot(V[p * 3] + t * (V[q * 3] - V[p * 3]) - V[c * 3], V[p * 3 + 1] + t * (V[q * 3 + 1] - V[p * 3 + 1]) - V[c * 3 + 1], V[p * 3 + 2] + t * (V[q * 3 + 2] - V[p * 3 + 2]) - V[c * 3 + 2]);
    if (off > L * 1e-3) return false;
  }
  keep[f] = 0;
  const pts = [p, ...chain, q];
  for (let i = 0; i + 1 < pts.length; i++) add.push(pts[i], pts[i + 1], r);
  return true;
}

function applyFlips(m: Mesh, flip: Uint8Array) {
  const F = m.F.slice();
  for (let f = 0; f < flip.length; f++) if (flip[f]) { const t = F[f * 3 + 1]; F[f * 3 + 1] = F[f * 3 + 2]; F[f * 3 + 2] = t; }
  return { V: m.V, F };
}

/** Rotate so direction `dir` (index into DIRS) points down. Proper rotations only. */
function rotateDown(V: Float32Array, dir: number) {
  const out = new Float32Array(V.length);
  for (let i = 0; i < V.length; i += 3) {
    const x = V[i], y = V[i + 1], z = V[i + 2];
    let X = x, Y = y, Z = z;
    switch (dir) {
      case 1: Y = -y; Z = -z; break;          // top down: 180 about X
      case 2: Y = -z; Z = y; break;           // front (-Y) down
      case 3: Y = z; Z = -y; break;           // back (+Y) down
      case 4: X = -z; Z = x; break;           // left (-X) down
      case 5: X = z; Z = -x; break;           // right (+X) down
    }
    out[i] = X; out[i + 1] = Y; out[i + 2] = Z;
  }
  return out;
}

function place(V: Float32Array, centre: boolean) {
  const b = bounds(V);
  const dx = centre ? -(b.min[0] + b.max[0]) / 2 : -b.min[0];
  const dy = centre ? -(b.min[1] + b.max[1]) / 2 : -b.min[1];
  const dz = -b.min[2];
  for (let i = 0; i < V.length; i += 3) { V[i] += dx; V[i + 1] += dy; V[i + 2] += dz; }
}

// ── the relief rebuild (CNC, laser, and solid reliefs for printing) ──────

export type ReliefGrid = { w: number; h: number; cell: number; z: Float32Array; base: number; top: number; gaps?: number };

function rasterTop(m: Mesh, target: number, minCell: number, fillGaps = false): ReliefGrid {
  const b = bounds(m.V);
  const cell = Math.max(minCell, Math.max(b.size[0], b.size[1]) / target);
  const w = Math.max(2, Math.ceil(b.size[0] / cell) + 1), h = Math.max(2, Math.ceil(b.size[1] / cell) + 1);
  const Z = new Float32Array(w * h).fill(NaN);
  const V = m.V, F = m.F;
  const nf = F.length / 3;
  for (let f = 0; f < nf; f++) {
    const a = F[f * 3] * 3, bb = F[f * 3 + 1] * 3, c = F[f * 3 + 2] * 3;
    const ax = V[a], ay = V[a + 1], az = V[a + 2], bx = V[bb], by = V[bb + 1], bz = V[bb + 2], cx = V[c], cy = V[c + 1], cz = V[c + 2];
    const d = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(d) < 1e-14) continue;
    const x0 = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - b.min[0]) / cell - 1e-9));
    const x1 = Math.min(w - 1, Math.floor((Math.max(ax, bx, cx) - b.min[0]) / cell + 1e-9));
    const y0 = Math.max(0, Math.ceil((Math.min(ay, by, cy) - b.min[1]) / cell - 1e-9));
    const y1 = Math.min(h - 1, Math.floor((Math.max(ay, by, cy) - b.min[1]) / cell + 1e-9));
    for (let gy = y0; gy <= y1; gy++) {
      const py = b.min[1] + gy * cell;
      for (let gx = x0; gx <= x1; gx++) {
        const px = b.min[0] + gx * cell;
        const u = ((px - ax) * (cy - ay) - (cx - ax) * (py - ay)) / d;
        if (u < -1e-7 || u > 1 + 1e-7) continue;
        const v = ((bx - ax) * (py - ay) - (px - ax) * (by - ay)) / d;
        if (v < -1e-7 || u + v > 1 + 1e-7) continue;
        const z = az + u * (bz - az) + v * (cz - az);
        const k = gy * w + gx;
        if (!(Z[k] >= z)) Z[k] = z;
      }
    }
  }
  // pinholes: a missing sample surrounded by surface is a gap between triangles
  for (let pass = 0; pass < 3; pass++) {
    const fill: number[] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const k = y * w + x;
      if (!Number.isNaN(Z[k])) continue;
      let s = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const X = x + dx, Y = y + dy;
        if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
        const v = Z[Y * w + X];
        if (!Number.isNaN(v)) { s += v; c++; }
      }
      if (c >= 6) fill.push(k, s / c);
    }
    if (!fill.length) break;
    for (let i = 0; i < fill.length; i += 2) Z[fill[i]] = fill[i + 1];
  }
  const gaps = fillGaps ? fillEnclosedGaps(Z, w, h) : 0;
  let top = -Infinity;
  for (let i = 0; i < Z.length; i++) if (Z[i] > top) top = Z[i];
  return { w, h, cell, z: Z, base: b.min[2], top, gaps };
}

/**
 * A file that arrived with holes in its surface leaves gaps in the grid. Gaps
 * the surface surrounds completely, and that are small (under 2% of the
 * design), are missing patches: they are filled from their edges inwards.
 * Bigger enclosed gaps are kept, because those are usually deliberate
 * cut-outs. Only used when the original file had holes; a closed file's
 * enclosed gaps are always real openings.
 */
function fillEnclosedGaps(Z: Float32Array, w: number, h: number): number {
  let filled = 0;
  const n = w * h;
  const outside = new Uint8Array(n);
  const q: number[] = [];
  for (let x = 0; x < w; x++) for (const y of [0, h - 1]) { const k = y * w + x; if (Number.isNaN(Z[k]) && !outside[k]) { outside[k] = 1; q.push(k); } }
  for (let y = 0; y < h; y++) for (const x of [0, w - 1]) { const k = y * w + x; if (Number.isNaN(Z[k]) && !outside[k]) { outside[k] = 1; q.push(k); } }
  while (q.length) {
    const k = q.pop()!, x = k % w, y = (k / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const X = x + dx, Y = y + dy;
      if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
      const j = Y * w + X;
      if (!outside[j] && Number.isNaN(Z[j])) { outside[j] = 1; q.push(j); }
    }
  }
  let covered = 0;
  for (let k = 0; k < n; k++) if (!Number.isNaN(Z[k])) covered++;
  const seen = new Uint8Array(n);
  for (let s = 0; s < n; s++) {
    if (seen[s] || outside[s] || !Number.isNaN(Z[s])) continue;
    const comp: number[] = [s];
    seen[s] = 1;
    for (let i = 0; i < comp.length; i++) {
      const k = comp[i], x = k % w, y = (k / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X = x + dx, Y = y + dy;
        if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
        const j = Y * w + X;
        if (!seen[j] && Number.isNaN(Z[j])) { seen[j] = 1; comp.push(j); }
      }
    }
    if (comp.length > covered * 0.02) continue;
    filled++;
    // fill from the edge inwards, one ring at a time
    let left = comp;
    for (let guard = 0; left.length && guard < 10000; guard++) {
      const next: number[] = [], set: [number, number][] = [];
      for (const k of left) {
        const x = k % w, y = (k / w) | 0;
        let sum = 0, cnt = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const X = x + dx, Y = y + dy;
          if ((!dx && !dy) || X < 0 || Y < 0 || X >= w || Y >= h) continue;
          const v = Z[Y * w + X];
          if (!Number.isNaN(v)) { sum += v; cnt++; }
        }
        if (cnt) set.push([k, sum / cnt]); else next.push(k);
      }
      for (const [k, v] of set) Z[k] = v;
      left = next;
    }
  }
  return filled;
}

/**
 * A watertight solid from the height grid: the top surface, walls round the
 * outline and a flat bottom, closed BY CONSTRUCTION:
 *   top     the grid, simplified with its border locked, so every border point
 *           the walls attach to is still there;
 *   walls   one quad per open side of the footprint, never simplified;
 *   bottom  strips between grid lines using only the points the walls and the
 *           neighbouring strips need: a few triangles per row, not two per cell.
 * (Simplifying the whole solid in one go was tried first and left slivers and
 * doubled edges along the long straight runs of the walls and the base.)
 */
async function reliefSolid(g: ReliefGrid, backing: number, errMm: number, maxTris: number): Promise<{ mesh: Mesh; raw: number; simplified: boolean }> {
  const { w, h, z } = g;
  // never let the top touch the bottom: that would be a wall of zero thickness
  let minTop = Infinity;
  for (let i = 0; i < z.length; i++) if (z[i] < minTop) minTop = z[i];
  const base = Math.min(g.base - backing, minTop - 0.2);
  const qw = w - 1, qh = h - 1;
  const on = new Uint8Array(qw * qh);
  for (let y = 0; y < qh; y++) for (let x = 0; x < qw; x++) {
    const k = y * w + x;
    on[y * qw + x] = Number.isNaN(z[k]) || Number.isNaN(z[k + 1]) || Number.isNaN(z[k + w]) || Number.isNaN(z[k + w + 1]) ? 0 : 1;
  }
  const Q = (x: number, y: number) => (x < 0 || y < 0 || x >= qw || y >= qh ? 0 : on[y * qw + x]);
  // two quads touching only at a corner would make that corner non-manifold
  for (let pass = 0; pass < 8; pass++) {
    let changed = 0;
    for (let y = 0; y <= qh; y++) for (let x = 0; x <= qw; x++) {
      const bl = Q(x - 1, y - 1), br = Q(x, y - 1), tl = Q(x - 1, y), tr = Q(x, y);
      if (bl && tr && !br && !tl) { on[y * qw + x] = 0; changed++; }
      else if (br && tl && !bl && !tr) { on[(y - 1) * qw + x] = 0; changed++; }
    }
    if (!changed) break;
  }
  // ── top: the full grid, simplified later with its border locked
  const topId = new Int32Array(w * h).fill(-1);
  const TV: number[] = [], TF: number[] = [];
  const tv = (gx: number, gy: number) => {
    const k = gy * w + gx;
    if (topId[k] < 0) { topId[k] = TV.length / 3; TV.push(gx * g.cell, gy * g.cell, z[k]); }
    return topId[k];
  };
  let quads = 0;
  for (let y = 0; y < qh; y++) for (let x = 0; x < qw; x++) {
    if (!on[y * qw + x]) continue;
    quads++;
    const a = tv(x, y), b = tv(x + 1, y), c = tv(x + 1, y + 1), d = tv(x, y + 1);
    // split along the diagonal with less height change, which follows ridges better
    const za = z[y * w + x], zb = z[y * w + x + 1], zc = z[(y + 1) * w + x + 1], zd = z[(y + 1) * w + x];
    if (Math.abs(za - zc) <= Math.abs(zb - zd)) TF.push(a, b, c, a, c, d); else TF.push(a, b, d, b, c, d);
  }
  const nTop = TV.length / 3;
  // ── bottom vertices live after the top ones, so simplifying the top (which
  // only rewrites indices) never disturbs them
  const botId = new Int32Array(w * h).fill(-1);
  const BV: number[] = [];
  const bv = (gx: number, gy: number) => {
    const k = gy * w + gx;
    if (botId[k] < 0) { botId[k] = nTop + BV.length / 3; BV.push(gx * g.cell, gy * g.cell, base); }
    return botId[k];
  };
  // ── walls on open sides, quad edges taken anticlockwise from above
  const WF: number[] = [];
  const wall = (px: number, py: number, qx: number, qy: number) => {
    const pT = tv(px, py), qT = tv(qx, qy), pB = bv(px, py), qB = bv(qx, qy);
    WF.push(pT, pB, qB, pT, qB, qT);
  };
  for (let y = 0; y < qh; y++) for (let x = 0; x < qw; x++) {
    if (!on[y * qw + x]) continue;
    if (!Q(x, y - 1)) wall(x, y, x + 1, y);
    if (!Q(x + 1, y)) wall(x + 1, y, x + 1, y + 1);
    if (!Q(x, y + 1)) wall(x + 1, y + 1, x, y + 1);
    if (!Q(x - 1, y)) wall(x, y + 1, x, y);
  }
  // ── bottom: one strip per row of quads. Each grid line keeps only the
  // points something needs: the ends of the runs above and below it, and every
  // point along a wall. Neighbouring strips then share exactly the same edges.
  const mark = new Uint8Array(w * h);
  for (let L = 0; L <= qh; L++) {
    for (const r of [L - 1, L]) {
      if (r < 0 || r >= qh) continue;
      for (let x = 0; x < qw; x++) {
        if (!on[r * qw + x]) continue;
        if (x === 0 || !on[r * qw + x - 1]) mark[L * w + x] = 1;
        if (x === qw - 1 || !on[r * qw + x + 1]) mark[L * w + x + 1] = 1;
      }
    }
    for (let x = 0; x < qw; x++) if (Q(x, L - 1) !== Q(x, L)) { mark[L * w + x] = 1; mark[L * w + x + 1] = 1; }
  }
  const BF: number[] = [];
  const Bp: number[] = [], Tp: number[] = [];
  for (let r = 0; r < qh; r++) {
    for (let x = 0; x < qw; x++) {
      if (!on[r * qw + x] || (x > 0 && on[r * qw + x - 1])) continue;
      let x1 = x;
      while (x1 + 1 < qw && on[r * qw + x1 + 1]) x1++;
      Bp.length = 0; Tp.length = 0;
      for (let k = x; k <= x1 + 1; k++) { if (mark[r * w + k]) Bp.push(k); if (mark[(r + 1) * w + k]) Tp.push(k); }
      let i = 0, j = 0;
      while (i < Bp.length - 1 || j < Tp.length - 1) {
        const advB = j === Tp.length - 1 || (i < Bp.length - 1 && Bp[i + 1] <= Tp[j + 1]);
        if (advB) { BF.push(bv(Bp[i], r), bv(Tp[j], r + 1), bv(Bp[i + 1], r)); i++; }
        else { BF.push(bv(Bp[i], r), bv(Tp[j], r + 1), bv(Tp[j + 1], r + 1)); j++; }
      }
    }
  }
  const fixedTris = (WF.length + BF.length) / 3;
  const raw = TF.length / 3 + quads * 2 + WF.length / 3;     // what a plain grid solid would cost
  const topV = new Float32Array(TV);
  let topF = Uint32Array.from(TF);

  // ── simplify the top: flat and gently curved areas need far fewer triangles
  await MeshoptSimplifier.ready;
  const budget = Math.max(1000, maxTris - fixedTris);
  let [idx] = MeshoptSimplifier.simplify(topF, topV, 3, 3, errMm, ['ErrorAbsolute', 'LockBorder']);
  if (idx.length / 3 > budget) [idx] = MeshoptSimplifier.simplify(topF, topV, 3, budget * 3, Math.max(errMm, g.cell), ['ErrorAbsolute', 'LockBorder']);
  const zs = zipSlivers({ V: topV, F: idx });
  let simplified = false;
  if (!zs.left) { topF = dropFins(zs.F); simplified = true; }

  const V = new Float32Array(TV.length + BV.length);
  V.set(topV); V.set(BV, TV.length);
  const F = new Uint32Array(topF.length + WF.length + BF.length);
  F.set(topF); F.set(WF, topF.length); F.set(BF, topF.length + WF.length);
  let mesh = compact({ V, F }, null);
  if (simplified && !verifyClosed(mesh)) {
    // never trade a closed solid for a lighter one: rebuild with the full top
    const F2 = new Uint32Array(TF.length + WF.length + BF.length);
    F2.set(TF); F2.set(WF, TF.length); F2.set(BF, TF.length + WF.length);
    mesh = compact({ V, F: F2 }, null);
    simplified = false;
  }
  return { mesh, raw, simplified };
}

/**
 * Triangles of no height (all three corners on one line) are removed without
 * opening the surface: the face across the sliver's long edge is split at the
 * sliver's middle corner, which then takes the sliver's place. Vertex indices
 * are kept as they are. `left` counts slivers that could not be resolved.
 */
function zipSlivers(m: Mesh): { F: Uint32Array; left: number } {
  const V = m.V;
  let F = m.F;
  const floor = bounds(V).diag * 1e-10;
  const len = (p: number, q: number) => Math.hypot(V[p * 3] - V[q * 3], V[p * 3 + 1] - V[q * 3 + 1], V[p * 3 + 2] - V[q * 3 + 2]);
  const nv = V.length / 3;
  for (let pass = 0; pass < 12; pass++) {
    const nf = F.length / 3;
    const A = adjacency(nv, F);
    // border corners must not move: on an open surface (the relief's top) the
    // walls are attached to them
    const border = new Uint8Array(nv);
    for (let h = 0; h < F.length; h++) { const [s, o] = edgeCount(F, A, h); if (s + o === 1) { border[F[h]] = 1; border[F[nxt(h)]] = 1; } }
    const touched = new Uint8Array(nf), keep = new Uint8Array(nf).fill(1);
    const busy = new Uint8Array(nv);
    const remap = new Int32Array(nv).fill(-1);
    const add: number[] = [];
    let found = 0;
    for (let f = 0; f < nf; f++) {
      const a = F[f * 3], b = F[f * 3 + 1], c = F[f * 3 + 2];
      if (!isSliver(V, a, b, c, floor)) continue;
      found++;
      if (touched[f]) continue;
      if (a === b || b === c || a === c) { keep[f] = 0; touched[f] = 1; continue; }
      const opts = [[a, b, c], [b, c, a], [c, a, b]];
      // A needle (one edge next to nothing) is closed by merging that edge's
      // two corners. Splitting a needle only makes another needle.
      let short = opts[0];
      for (const o of opts) if (len(o[0], o[1]) < len(short[0], short[1])) short = o;
      let longest = 0;
      for (const o of opts) longest = Math.max(longest, len(o[0], o[1]));
      if (len(short[0], short[1]) < longest * 0.02) {
        const [u, v] = short;
        if (busy[u] || busy[v] || (border[u] && border[v])) continue;
        const [from, to] = border[u] ? [v, u] : [u, v];
        remap[from] = to; busy[u] = 1; busy[v] = 1;
        continue;
      }
      // A cap (a corner lying on the opposite edge): split the face across
      // that long edge p -> q at the middle corner.
      let best = opts[0];
      for (const o of opts) if (len(o[0], o[1]) > len(best[0], best[1])) best = o;
      const [p, q, mid] = best;
      let hx = -1;
      for (let k = A.start[q]; k < A.start[q + 1]; k++) { const h = A.he[k]; if (F[nxt(h)] === p) { hx = h; break; } }
      if (hx < 0) { keep[f] = 0; touched[f] = 1; continue; }          // long edge on the border: nothing to split
      const X = (hx / 3) | 0;
      if (touched[X] || X === f) continue;
      const r = F[nxt(nxt(hx))];
      keep[f] = 0; keep[X] = 0; touched[f] = 1; touched[X] = 1;
      if (r !== mid) add.push(q, mid, r, mid, p, r);
    }
    if (!found) return { F, left: 0 };
    const R = (v: number) => (remap[v] >= 0 ? remap[v] : v);
    const out: number[] = [];
    for (let f = 0; f < nf; f++) {
      if (!keep[f]) continue;
      const a = R(F[f * 3]), b = R(F[f * 3 + 1]), c = R(F[f * 3 + 2]);
      if (a === b || b === c || a === c) continue;               // the needle itself, gone with its edge
      out.push(a, b, c);
    }
    for (let i = 0; i < add.length; i += 3) {
      const a = R(add[i]), b = R(add[i + 1]), c = R(add[i + 2]);
      if (a !== b && b !== c && a !== c) out.push(a, b, c);
    }
    F = Uint32Array.from(out);
  }
  let left = 0;
  for (let f = 0; f < F.length / 3; f++) if (isSliver(V, F[f * 3], F[f * 3 + 1], F[f * 3 + 2], floor)) left++;
  return { F, left };
}

/**
 * Two triangles on the same three corners: back to back (a fold, both go) or
 * the same face twice (one goes). Merging corners can make either. Indices kept.
 */
function dropFins(F: Uint32Array): Uint32Array {
  const nf = F.length / 3;
  const seen = new Map<string, number>();
  const keep = new Uint8Array(nf).fill(1);
  let gone = 0;
  for (let f = 0; f < nf; f++) {
    const a = F[f * 3], b = F[f * 3 + 1], c = F[f * 3 + 2];
    const s = [a, b, c].sort((x, y) => x - y);
    const k = `${s[0]},${s[1]},${s[2]}`;
    const g = seen.get(k);
    if (g === undefined) { seen.set(k, f); continue; }
    const x = F[g * 3], y = F[g * 3 + 1];
    const same = (x === a && y === b) || (x === b && y === c) || (x === c && y === a);
    keep[f] = 0; gone++;
    if (!same && keep[g]) { keep[g] = 0; gone++; seen.delete(k); }
  }
  if (!gone) return F;
  const out = new Uint32Array((nf - gone) * 3);
  let o = 0;
  for (let f = 0; f < nf; f++) if (keep[f]) { out[o++] = F[f * 3]; out[o++] = F[f * 3 + 1]; out[o++] = F[f * 3 + 2]; }
  return out;
}

// ── decimation ───────────────────────────────────────────────────────────

async function simplify(m: Mesh, targetTris: number, errorMm: number): Promise<Mesh> {
  await MeshoptSimplifier.ready;
  const [idx] = MeshoptSimplifier.simplify(m.F, m.V, 3, Math.max(3, targetTris * 3), errorMm, ['ErrorAbsolute']);
  // simplifying can leave triangles of no height along straight runs
  return compact({ V: m.V, F: dropFins(zipSlivers({ V: m.V, F: idx }).F) }, null);
}

/** A light copy for the 3D preview, built for looks only. */
export async function previewOf(m: Mesh, maxTris = 160_000): Promise<{ pos: Float32Array; nrm: Float32Array }> {
  let F = m.F;
  if (F.length / 3 > maxTris) {
    await MeshoptSimplifier.ready;
    [F] = MeshoptSimplifier.simplifySloppy(m.F, m.V, 3, null, maxTris * 3, 1);
  }
  const V = m.V;
  const nf = F.length / 3;
  const pos = new Float32Array(nf * 9), nrm = new Float32Array(nf * 9);
  for (let f = 0; f < nf; f++) {
    const a = F[f * 3], b = F[f * 3 + 1], c = F[f * 3 + 2];
    const ux = V[b * 3] - V[a * 3], uy = V[b * 3 + 1] - V[a * 3 + 1], uz = V[b * 3 + 2] - V[a * 3 + 2];
    const vx = V[c * 3] - V[a * 3], vy = V[c * 3 + 1] - V[a * 3 + 1], vz = V[c * 3 + 2] - V[a * 3 + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (let k = 0; k < 3; k++) {
      const v = F[f * 3 + k];
      pos[f * 9 + k * 3] = V[v * 3]; pos[f * 9 + k * 3 + 1] = V[v * 3 + 1]; pos[f * 9 + k * 3 + 2] = V[v * 3 + 2];
      nrm[f * 9 + k * 3] = nx; nrm[f * 9 + k * 3 + 1] = ny; nrm[f * 9 + k * 3 + 2] = nz;
    }
  }
  return { pos, nrm };
}

// ── outputs ──────────────────────────────────────────────────────────────

export function toSTL(m: Mesh): ArrayBuffer {
  const nf = m.F.length / 3;
  const buf = new ArrayBuffer(84 + nf * 50);
  const dv = new DataView(buf);
  const head = 'Repaired by DigitalChiselCo STL Auto-Repair (digitalchiselco.com/tools/stl-repair)';
  for (let i = 0; i < 80; i++) dv.setUint8(i, i < head.length ? head.charCodeAt(i) : 32);
  dv.setUint32(80, nf, true);
  let o = 84;
  const V = m.V;
  for (let f = 0; f < nf; f++) {
    const a = m.F[f * 3], b = m.F[f * 3 + 1], c = m.F[f * 3 + 2];
    const ux = V[b * 3] - V[a * 3], uy = V[b * 3 + 1] - V[a * 3 + 1], uz = V[b * 3 + 2] - V[a * 3 + 2];
    const vx = V[c * 3] - V[a * 3], vy = V[c * 3 + 1] - V[a * 3 + 1], vz = V[c * 3 + 2] - V[a * 3 + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    dv.setFloat32(o, nx / l, true); dv.setFloat32(o + 4, ny / l, true); dv.setFloat32(o + 8, nz / l, true);
    o += 12;
    for (const v of [a, b, c]) { dv.setFloat32(o, V[v * 3], true); dv.setFloat32(o + 4, V[v * 3 + 1], true); dv.setFloat32(o + 8, V[v * 3 + 2], true); o += 12; }
    o += 2;
  }
  return buf;
}

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(parts: Uint8Array[]) { let c = 0xffffffff; for (const p of parts) for (let i = 0; i < p.length; i++) c = CRC[(c ^ p[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

/** 8-bit greyscale PNG with its print size (pHYs) set, so laser software imports it at the right size. */
export async function toPNG(gray: Uint8Array, w: number, h: number, dpi: number): Promise<ArrayBuffer> {
  const raw = new Uint8Array((w + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w + 1)] = 0; raw.set(gray.subarray(y * w, (y + 1) * w), y * (w + 1) + 1); }
  const z = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
  const chunk = (type: string, data: Uint8Array) => {
    const t = new TextEncoder().encode(type);
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    out.set(t, 4); out.set(data, 8);
    dv.setUint32(8 + data.length, crc32([t, data]));
    return out;
  };
  const ihdr = new Uint8Array(13); const di = new DataView(ihdr.buffer);
  di.setUint32(0, w); di.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const phys = new Uint8Array(9); const dp = new DataView(phys.buffer);
  const ppm = Math.round(dpi / 0.0254); dp.setUint32(0, ppm); dp.setUint32(4, ppm); phys[8] = 1;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('pHYs', phys), chunk('IDAT', z), chunk('IEND', new Uint8Array(0))];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const png = new Uint8Array(total);
  let o = 0; for (const p of parts) { png.set(p, o); o += p.length; }
  return png.buffer;
}

/** Depth map: high = white, low = black (darker burns deeper). Rows top-down. */
function depthImage(g: ReliefGrid, dpi: number, background: 'white' | 'black', invert: boolean) {
  const pxPerMm = dpi / 25.4;
  const widthMm = (g.w - 1) * g.cell, heightMm = (g.h - 1) * g.cell;
  let W = Math.max(2, Math.round(widthMm * pxPerMm)), H = Math.max(2, Math.round(heightMm * pxPerMm));
  const cap = 6000;
  let realDpi = dpi;
  if (Math.max(W, H) > cap) { const k = cap / Math.max(W, H); W = Math.round(W * k); H = Math.round(H * k); realDpi = dpi * k; }
  const out = new Uint8Array(W * H);
  const span = g.top - g.base || 1;
  for (let y = 0; y < H; y++) {
    const gy = ((H - 1 - y) / (H - 1)) * (g.h - 1);   // image rows run top-down, the grid bottom-up
    for (let x = 0; x < W; x++) {
      const gx = (x / (W - 1)) * (g.w - 1);
      const x0 = Math.floor(gx), y0 = Math.floor(gy), x1 = Math.min(g.w - 1, x0 + 1), y1 = Math.min(g.h - 1, y0 + 1);
      const fx = gx - x0, fy = gy - y0;
      const s = [g.z[y0 * g.w + x0], g.z[y0 * g.w + x1], g.z[y1 * g.w + x0], g.z[y1 * g.w + x1]];
      const wts = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
      let acc = 0, wsum = 0;
      for (let i = 0; i < 4; i++) if (!Number.isNaN(s[i])) { acc += s[i] * wts[i]; wsum += wts[i]; }
      let v: number;
      if (wsum < 0.5) v = background === 'white' ? 255 : 0;
      else v = Math.round(((acc / wsum - g.base) / span) * 255);
      if (invert) v = 255 - v;
      out[y * W + x] = Math.max(0, Math.min(255, v));
    }
  }
  return { gray: out, w: W, h: H, dpi: realDpi };
}

// ── the whole repair ─────────────────────────────────────────────────────

export type Options = {
  mode: Mode;
  unitFactor: number;
  removeDebris: boolean;
  relief: 'auto' | 'on' | 'off';     // print modes: rebuild as a solid relief
  detail: 'standard' | 'fine' | 'max';
  backing: number;                    // mm under the relief
  laser: { dpi: number; background: 'white' | 'black'; invert: boolean };
};

export type Result = {
  mesh: Mesh;
  actions: string[];
  notes: string[];
  rebuilt: boolean;
  png: { data: ArrayBuffer; w: number; h: number; dpi: number } | null;
};

const DETAIL = { standard: 1000, fine: 1600, max: 2400 };

export async function repair(orig: Mesh, opts: Options, origReport: Report, progress: Progress = noop): Promise<Result> {
  const rule = MODES[opts.mode];
  const actions: string[] = [], notes: string[] = [];
  let m: Mesh = { V: orig.V.slice(), F: orig.F.slice() };
  if (opts.unitFactor !== 1) {
    for (let i = 0; i < m.V.length; i++) m.V[i] *= opts.unitFactor;
    actions.push(opts.unitFactor === 25.4 ? 'Converted from inches to millimetres (x25.4).' : `Scaled by x${opts.unitFactor} to millimetres.`);
  }

  progress(0.05, 'Removing broken and repeated triangles…');
  const c = cleanFaces(m);
  m = c.mesh;
  if (c.bad) actions.push(`Removed ${c.bad.toLocaleString('en-US')} broken triangles with no area.`);
  if (c.dup) actions.push(`Removed ${c.dup.toLocaleString('en-US')} repeated triangles.`);
  if (!m.F.length) throw new Error('Nothing is left after removing the broken triangles: the file holds no usable surface.');

  progress(0.12, 'Closing hairline cracks…');
  const st = stitch(m, Math.max(bounds(m.V).diag * 1e-5, 0.0005));
  m = st.mesh;
  if (st.merged) { actions.push(`Closed ${st.merged.toLocaleString('en-US')} hairline cracks between triangles.`); m = cleanFaces(m).mesh; }

  progress(0.2, 'Untangling edges…');
  const sp = splitNonManifold(m);
  m = sp.mesh;
  if (sp.split) actions.push(`Separated ${sp.split.toLocaleString('en-US')} points where surfaces met badly (non-manifold).`);

  progress(0.3, 'Pointing every face outwards…');
  let A = adjacency(m.V.length / 3, m.F);
  let G = buildGrid(m);
  let S = orientShells(m, A, G);
  if (S.flipped) { m = applyFlips(m, S.flip); actions.push(`Turned ${S.flipped.toLocaleString('en-US')} inside-out faces the right way.`); }

  if (opts.removeDebris) {
    const keep = new Uint8Array(m.F.length / 3).fill(1);
    const b = bounds(m.V);
    const boxVol = Math.max(1e-9, b.size[0] * b.size[1] * b.size[2]);
    let gone = 0;
    const dead = new Uint8Array(S.n);
    for (let s = 0; s < S.n; s++) if (isDebris(S, s, b.diag, boxVol) && S.n > 1) { dead[s] = 1; gone++; }
    if (gone) {
      for (let f = 0; f < keep.length; f++) if (dead[S.shell[f]]) keep[f] = 0;
      m = compact(m, keep);
      actions.push(`Removed ${gone.toLocaleString('en-US')} loose fragments too small to make.`);
    }
  }

  const reliefWanted = rule.relief || opts.relief === 'on'
    || (opts.relief === 'auto' && origReport.sheet);
  let png: Result['png'] = null;

  if (reliefWanted) {
    // which way is up for a relief: the flat back goes down; an open relief
    // surface (no back at all) faces the way most of its area faces
    const ff = flatFaces(m, null);
    let dir = 0;
    const best = reliefBack(ff);
    if (best > 0 && ff.area[0] < ff.area[best] * 0.9) dir = best;
    else if (best < 0) {
      const nsum = [0, 0, 0];
      const nf = m.F.length / 3;
      for (let f = 0; f < nf; f++) {
        const a = m.F[f * 3], b = m.F[f * 3 + 1], cc = m.F[f * 3 + 2];
        const ux = m.V[b * 3] - m.V[a * 3], uy = m.V[b * 3 + 1] - m.V[a * 3 + 1], uz = m.V[b * 3 + 2] - m.V[a * 3 + 2];
        const vx = m.V[cc * 3] - m.V[a * 3], vy = m.V[cc * 3 + 1] - m.V[a * 3 + 1], vz = m.V[cc * 3 + 2] - m.V[a * 3 + 2];
        nsum[0] += uy * vz - uz * vy; nsum[1] += uz * vx - ux * vz; nsum[2] += ux * vy - uy * vx;
      }
      if (origReport.sheet) {
        // An open relief surface: the axis it faces along is the one most of
        // its area faces. Which SIDE is the front cannot be read from the
        // winding of an open surface, so it is read from the shape: a relief
        // rises away from its outline, so the front is the side the surface
        // bulges towards, compared with the edge of the open boundary.
        const ax = [0, 1, 2].reduce((p, k) => (Math.abs(nsum[k]) > Math.abs(nsum[p]) ? k : p), 2);
        const up = bulgeSign(m, ax);
        dir = ax === 2 ? (up >= 0 ? 0 : 1) : ax === 1 ? (up >= 0 ? 2 : 3) : (up >= 0 ? 4 : 5);
      }
    }
    if (dir) { m = { V: rotateDown(m.V, dir), F: m.F }; actions.push(`Turned it so the carved side faces up (it was ${dir === 1 ? 'upside down' : 'on its side'}).`); }
    if (best < 0 && !origReport.sheet) notes.push('This is a full 3D model. The rebuild keeps what a cutter or laser can reach from above; anything under an overhang is filled in.');

    progress(0.45, 'Rebuilding as a solid relief…');
    const target = DETAIL[opts.detail];
    const g = rasterTop(m, target, 0.05, origReport.holes > 0);
    if (g.gaps) actions.push(`Filled ${g.gaps.toLocaleString('en-US')} missing patch${g.gaps === 1 ? '' : 'es'} in the surface from the surface around ${g.gaps === 1 ? 'it' : 'them'}.`);
    let backing = Math.max(0, opts.backing);
    if (origReport.sheet && backing < 1) { backing = 2; notes.push('The file was an open surface with no back, so 2 mm of backing was added under it. Change it under Options.'); }
    actions.push(`Rebuilt as a solid relief from what can be reached from above, sampled every ${g.cell.toFixed(2)} mm: watertight, no undercuts, flat back${backing > 0 ? `, ${backing} mm backing added` : ''}.`);
    progress(0.6, 'Building the solid and lightening flat areas…');
    const err = Math.min(0.02, Math.max(0.004, g.cell * 0.08));
    const rs = await reliefSolid(g, backing, err, rule.maxTris);
    const nOut = rs.mesh.F.length / 3;
    if (nOut < rs.raw) actions.push(`Merged flat areas into fewer triangles: ${rs.raw.toLocaleString('en-US')} to ${nOut.toLocaleString('en-US')}${rs.simplified ? `, staying within ${err.toFixed(3)} mm of the surface` : ''}.`);
    if (!rs.simplified) notes.push('The top surface was kept at full detail: lightening it would have opened the solid.');
    m = rs.mesh;
    if (opts.mode === 'laser') {
      progress(0.8, 'Drawing the depth map…');
      const img = depthImage(g, opts.laser.dpi, opts.laser.background, opts.laser.invert);
      png = { data: await toPNG(img.gray, img.w, img.h, img.dpi), w: img.w, h: img.h, dpi: img.dpi };
      actions.push(`Drew a ${img.w} x ${img.h} greyscale depth map at ${Math.round(img.dpi)} DPI (white = highest, black = deepest).`);
      if (img.dpi < opts.laser.dpi - 1) notes.push(`The depth map was capped at 6000 pixels, so it is ${Math.round(img.dpi)} DPI instead of ${opts.laser.dpi}.`);
    }
    place(m.V, false);
    m = settle(m);
    return { mesh: m, actions, notes, rebuilt: true, png };
  }

  // ── a true 3D repair for printing ──
  progress(0.45, 'Closing holes…');
  const fh = fillHoles(m);
  m = fh.mesh;
  if (fh.filled) actions.push(`Closed ${fh.filled.toLocaleString('en-US')} holes.`);

  // filling can join pieces whose winding disagreed: settle orientation again
  A = adjacency(m.V.length / 3, m.F);
  G = buildGrid(m);
  S = orientShells(m, A, G);
  if (S.flipped) m = applyFlips(m, S.flip);

  progress(0.6, 'Putting it on the bed…');
  const ff = flatFaces(m, null);
  const bestC = [...ff.area.keys()].reduce((p, d) => (ff.area[d] > ff.area[p] ? d : p), 0);
  if (ff.area[0] < ff.area[bestC] * 0.8 && ff.area[bestC] > 25) {
    m = { V: rotateDown(m.V, bestC), F: m.F };
    actions.push(`Turned it to stand on its largest flat face (the ${DIR_NAME[bestC]}).`);
  }
  place(m.V, true);
  actions.push('Placed it on the bed at the centre.');

  const nf = m.F.length / 3;
  if (nf > rule.maxTris) {
    progress(0.75, 'Reducing the triangle count…');
    const b = bounds(m.V);
    const lighter = await simplify(m, rule.maxTris, b.diag * 0.002);
    const okBefore = verifyClosed(m), okAfter = verifyClosed(lighter);
    if (!okBefore || okAfter) {
      m = lighter;
      actions.push(`Reduced ${nf.toLocaleString('en-US')} triangles to ${(m.F.length / 3).toLocaleString('en-US')} (the ${rule.label} limit here is ${rule.maxTris.toLocaleString('en-US')}), keeping the shape.`);
    } else notes.push('Reducing the triangle count would have opened the mesh again, so the full count was kept.');
  }
  m = settle(m);
  if (origReport.selfX > 0) notes.push('Faces that pass through each other are left as they are. Slicers merge overlapping volumes when they slice, so they print fine; they are counted so you know they are there.');
  if (origReport.thin.checked && origReport.thin.pct >= 1) notes.push(`About ${origReport.thin.pct}% of the surface is thinner than ${rule.thin} mm. That cannot be thickened automatically without changing the design: scale it up or check those areas in your slicer.`);
  return { mesh: m, actions, notes, rebuilt: false, png };
}

/**
 * Moving a part shifts every coordinate by float rounding, which can flatten a
 * nearly flat triangle into a sliver. Run last, after the part is in place.
 */
function settle(m: Mesh): Mesh {
  const z = zipSlivers(m);
  return z.F === m.F ? m : compact({ V: m.V, F: dropFins(z.F) }, null);
}

/** +1 if the surface bulges towards +axis compared with its open outline, else -1. */
function bulgeSign(m: Mesh, ax: number) {
  const A = adjacency(m.V.length / 3, m.F);
  let bs = 0, bn = 0, all = 0;
  const nv = m.V.length / 3;
  for (let h = 0; h < m.F.length; h++) {
    const [s, o] = edgeCount(m.F, A, h);
    if (s + o === 1) { bs += m.V[m.F[h] * 3 + ax]; bn++; }
  }
  for (let v = 0; v < nv; v++) all += m.V[v * 3 + ax];
  if (!bn) return 1;
  return all / nv >= bs / bn ? 1 : -1;
}

function verifyClosed(m: Mesh) {
  const A = adjacency(m.V.length / 3, m.F);
  for (let h = 0; h < m.F.length; h++) { const [s, o] = edgeCount(m.F, A, h); if (s !== 1 || o !== 1) return false; }
  return true;
}

export function maxDim(m: Mesh) { return Math.max(...bounds(m.V).size); }

/** For scripts/stl-repair/test_engine.ts only. */
export const __internals = { cleanFaces, fillHoles, stitch, simplify, rasterTop, reliefSolid, adjacency, edgeCount, verifyClosed, zipSlivers };
