/* mesh-core.js — pure geometry builders (no THREE).
 * Produces raw {positions, indices} in Z-up, print-ready orientation
 * (bottom of the part sits on z = 0).
 *
 *  - buildShade():  single continuous wall for VASE MODE. Welded seam,
 *                   optional flat base, computes printability stats.
 *  - buildFitter(): E27/E14 hub + radial spokes + seating rim, each part a
 *                   closed manifold, merged into one solid.
 */
import { surf, makeCtx, WRAP_V_SHAPES } from './shapes.js';
import { orientComponentsOutward } from './exporters.js';

/* ---------------------------------------------------------------- shade --- */
export function buildShade(P) {
  // Wall thickness > 0 -> a genuine watertight thin-walled SHELL with real
  // openings (fitter/light) that a slicer accepts with zero non-manifold edges.
  // 0 -> a single-wall surface for Spiralize / Vase mode.
  if ((P.wallThickness || 0) > 0 && !WRAP_V_SHAPES.has(P.shape) && P.shape !== 'Möbius Ribbon') return buildShadeSolid(P);
  const U = Math.max(24, Math.floor(P.uSegments));
  const V = Math.max(8, Math.floor(P.vSegments));
  const ctx = makeCtx(P);
  const wrapV = WRAP_V_SHAPES.has(P.shape);
  const rows = V + 1;

  // Sample the surface. Columns 0..U-1 only (seam is welded by wrapping u).
  const nUcols = U;                      // welded: column U === column 0
  const vertCount = nUcols * rows;
  const pos = new Float32Array(vertCount * 3);
  let minZ = Infinity, maxZ = -Infinity, minR = Infinity, maxR = -Infinity;

  for (let i = 0; i < nUcols; i++) {
    const u = i / U;                     // note /U so column U-1 -> just before seam
    for (let j = 0; j < rows; j++) {
      const v = j / V;
      const p = surf(P, u, v, ctx);
      const idx = (i * rows + j) * 3;
      pos[idx] = p[0]; pos[idx + 1] = p[1]; pos[idx + 2] = p[2];
      const r = Math.hypot(p[0], p[1]);
      if (p[2] < minZ) minZ = p[2]; if (p[2] > maxZ) maxZ = p[2];
      if (r < minR) minR = r; if (r > maxR) maxR = r;
    }
  }

  const idxArr = [];
  const col = rows;
  // Side wall (outward winding). u wraps; v wraps only for torus topology.
  const jMax = wrapV ? V : V - 1;
  for (let i = 0; i < nUcols; i++) {
    const iN = (i + 1) % nUcols;
    for (let j = 0; j <= jMax; j++) {
      if (!wrapV && j >= V) break;
      const jN = wrapV ? (j + 1) % rows : j + 1;
      const a = i * col + j, b = iN * col + j, c = iN * col + jN, d = i * col + jN;
      idxArr.push(a, b, c, a, c, d);
    }
  }

  // Vertical placement. The shade's BOTTOM (the `bottomRadius` opening, sampled
  // at v=1) must sit on the build-plate grid (z=0). By default we flip so that
  // happens; z' = maxZ - z both flips and floors. Flipping is a reflection, so
  // the side-wall winding is reversed to keep normals pointing outward.
  const flip = P.flipVertical !== false;
  const zt = z => flip ? (maxZ - z) : (z - minZ);
  for (let i = 2; i < pos.length; i += 3) pos[i] = zt(pos[i]);
  if (flip) for (let i = 0; i < idxArr.length; i += 3) { const t = idxArr[i + 1]; idxArr[i + 1] = idxArr[i + 2]; idxArr[i + 2] = t; }

  // Optional flat caps, built AFTER the transform so winding is chosen directly
  // for outward normals (grid cap faces -z, top cap faces +z). Skipped for torus.
  const extra = [];
  let vc = vertCount;
  const ringZfinal = jr => { let s = 0; for (let i = 0; i < nUcols; i++) s += pos[(i * col + jr) * 3 + 2]; return s / nUcols; };
  const gridRow = flip ? V : 0, topRow = flip ? 0 : V;   // which param-row is at the grid / at the top
  const addCap = (jr, faceUp) => {
    const ci = vc++; extra.push(0, 0, ringZfinal(jr));
    for (let i = 0; i < nUcols; i++) {
      const iN = (i + 1) % nUcols, a = i * col + jr, b = iN * col + jr;
      if (faceUp) idxArr.push(ci, a, b); else idxArr.push(ci, b, a);
    }
  };
  if (!wrapV && P.closeBottom) addCap(gridRow, false);   // flat base on the grid, faces down
  if (!wrapV && P.closeTop) addCap(topRow, true);        // top cap, faces up

  // Assemble final position buffer (with any center verts appended).
  let outPos = pos;
  if (extra.length) {
    outPos = new Float32Array(pos.length + extra.length);
    outPos.set(pos); outPos.set(extra, pos.length);
  }

  const indices = toIndexArray(idxArr, outPos.length / 3);
  const stats = shadeStats(P, ctx, U, V, zt);
  // Geometric top = higher z end; geometric bottom = grid end. With flip, v=0 is
  // the top and v=1 is the bottom (grid).
  const topRing = openingCurve(P, ctx, flip ? 0 : 1, zt);
  const bottomRing = openingCurve(P, ctx, flip ? 1 : 0, zt);
  return {
    positions: outPos, indices,
    meta: {
      height: maxZ - minZ, minRadius: minR, maxRadius: maxR,
      topRadius: ringRadius(pos, col, flip ? 0 : V, nUcols), bottomRadius: ringRadius(pos, col, flip ? V : 0, nUcols),
      topRing, bottomRing, wrapV, tris: idxArr.length / 3, stats
    }
  };
}

/* Watertight thin-walled shell: outer surface + inner surface (radial inset by
 * the wall thickness) + rim bands at each opening; a closed end also gets an
 * inner disk (solid floor). Openings stay OPEN so the fitter/light pass through.
 * Every face is oriented outward at the end. */
function buildShadeSolid(P) {
  const U = Math.max(24, Math.floor(P.uSegments));
  const V = Math.max(8, Math.floor(P.vSegments));
  const ctx = makeCtx(P), rows = V + 1, nU = U, base2 = nU * rows;
  const outer = new Float32Array(base2 * 3);
  let minZ = Infinity, maxZ = -Infinity, minR = Infinity, maxR = -Infinity;
  for (let i = 0; i < nU; i++) {
    const u = i / U;
    for (let j = 0; j < rows; j++) {
      const p = surf(P, u, j / V, ctx), b = (i * rows + j) * 3;
      outer[b] = p[0]; outer[b + 1] = p[1]; outer[b + 2] = p[2];
      const r = Math.hypot(p[0], p[1]);
      if (p[2] < minZ) minZ = p[2]; if (p[2] > maxZ) maxZ = p[2]; if (r < minR) minR = r; if (r > maxR) maxR = r;
    }
  }
  const flip = P.flipVertical !== false, zt = z => flip ? (maxZ - z) : (z - minZ);
  for (let i = 2; i < outer.length; i += 3) outer[i] = zt(outer[i]);
  const th = Math.min(Math.max(0.2, P.wallThickness), Math.max(0.4, minR * 0.6));  // never exceed the opening
  // ---- text emboss (a band of wrapped text) ----
  const txt = (P.textOn && P.textData && P.textData.data) ? P.textData : null;
  const tLo = Math.max(0, (P.textV ?? .5) - (P.textBand ?? .2) / 2), tHi = Math.min(1, (P.textV ?? .5) + (P.textBand ?? .2) / 2);
  const tDepth = P.textDepth || 1.4, tRep = Math.max(1, Math.floor(P.textRepeat || 1)), tStyle = P.textStyle || 'Glow';
  const textLumAt = (u, v) => { if (!txt || v < tLo || v > tHi) return 0; const tv = (v - tLo) / Math.max(1e-6, tHi - tLo), uu = ((u * tRep) % 1 + 1) % 1; return txt.data[Math.min(txt.h - 1, Math.round((1 - tv) * (txt.h - 1))) * txt.w + Math.min(txt.w - 1, Math.round(uu * (txt.w - 1)))]; };
  // Raised / engraved text moves the OUTER surface (visible unlit).
  if (txt && tStyle !== 'Glow') {
    for (let i = 0; i < nU; i++) for (let j = 0; j < rows; j++) {
      const a = i * rows + j, lum = textLumAt(i / nU, j / V); if (lum < 0.5) continue;
      const bx = a * 3, r = Math.hypot(outer[bx], outer[bx + 1]) || 1e-6, s = Math.max(0.05, (r + (tStyle === 'Raised' ? 1 : -1) * tDepth * lum) / r);
      outer[bx] *= s; outer[bx + 1] *= s;
    }
  }
  // ---- lithophane: modulate wall thickness by an image (dark = thick, bright = thin)
  // so it glows when lit. Only the INNER surface moves. Modes: Wrap / Tile / Front.
  const litho = (P.lithoOn && P.lithoData && P.lithoData.data && P.lithoData.w) ? P.lithoData : null;
  const lithoAmp = Math.max(0, P.lithoAmp || 0), lMode = P.lithoMode || 'Wrap', lTile = Math.max(1, Math.floor(P.lithoTile || 2));
  const lithoDepthAt = (u, v) => {
    if (!litho) return 0; let uu;
    if (lMode === 'Tile') uu = ((u * lTile) % 1 + 1) % 1;
    else if (lMode === 'Front') { if (u < 0.25 || u > 0.75) return 0; uu = (u - 0.25) / 0.5; }
    else uu = u;
    const lum = litho.data[Math.min(litho.h - 1, Math.round((1 - v) * (litho.h - 1))) * litho.w + Math.min(litho.w - 1, Math.round(uu * (litho.w - 1)))];
    return P.lithoInvert ? lum : (1 - lum);
  };
  const inner = new Float32Array(base2 * 3);
  for (let a = 0; a < base2; a++) {
    const x = outer[a * 3], y = outer[a * 3 + 1], r = Math.hypot(x, y) || 1e-6;
    const i = (a / rows) | 0, j = a % rows, u = i / nU, v = j / V;
    let t = th;
    if (litho) t += lithoAmp * lithoDepthAt(u, v);
    if (txt && tStyle === 'Glow') { const lum = textLumAt(u, v); if (lum > 0) t = Math.max(0.4, t - tDepth * lum); }
    t = Math.min(t, r * 0.75);
    const s = Math.max(0.02, (r - t) / r);
    inner[a * 3] = x * s; inner[a * 3 + 1] = y * s; inner[a * 3 + 2] = outer[a * 3 + 2];
  }
  const o = (i, j) => i * rows + j, ii = (i, j) => base2 + i * rows + j;
  const idx = [];
  for (let i = 0; i < nU; i++) {
    const iN = (i + 1) % nU;
    for (let j = 0; j < V; j++) {
      idx.push(o(i, j), o(iN, j), o(iN, j + 1), o(i, j), o(iN, j + 1), o(i, j + 1));          // outer
      idx.push(ii(i, j), ii(iN, j + 1), ii(iN, j), ii(i, j), ii(i, j + 1), ii(iN, j + 1));     // inner (reversed)
    }
  }
  // Close the wall surface at BOTH openings with a rim band (outer<->inner). The
  // result is a watertight solid tube open at both ends (the lampshade). Caps
  // (solid base) are handled in single-wall/vase mode; a thick shell stays a
  // clean open tube so there are no 3-face (non-manifold) edges.
  const gridRow = flip ? V : 0, topRow = flip ? 0 : V;
  for (const e of [gridRow, topRow]) for (let i = 0; i < nU; i++) { const iN = (i + 1) % nU; idx.push(o(i, e), o(iN, e), ii(iN, e), o(i, e), ii(iN, e), ii(i, e)); }
  const pos = new Float32Array(base2 * 2 * 3);
  pos.set(outer, 0); pos.set(inner, base2 * 3);
  const indices = toIndexArray(idx, pos.length / 3);
  orientComponentsOutward(pos, indices);
  const topRing = openingCurve(P, ctx, flip ? 0 : 1, zt), bottomRing = openingCurve(P, ctx, flip ? 1 : 0, zt);
  const meanR = ring => { let s = 0; for (const r of ring.R) s += r; return s / ring.R.length; };
  return {
    positions: pos, indices,
    meta: { height: maxZ - minZ, minRadius: minR, maxRadius: maxR, topRadius: meanR(topRing), bottomRadius: meanR(bottomRing), topRing, bottomRing, wrapV: false, tris: idx.length / 3, stats: shadeStats(P, ctx, U, V, zt), solid: true, wall: th }
  };
}

/* Sample the actual opening boundary (radius + z per angle) so the fitter rim
 * can follow the scalloped/fluted edge instead of being a flat circle. */
function openingCurve(P, ctx, vv, zt, RES = 200) {
  const R = new Float32Array(RES), Z = new Float32Array(RES), TH = new Float32Array(RES);
  for (let i = 0; i < RES; i++) {
    const p = surf(P, i / RES, vv, ctx);
    R[i] = Math.hypot(p[0], p[1]);
    TH[i] = Math.atan2(p[1], p[0]);   // ACTUAL angle (may differ from i/RES when twisted/leaned/squashed)
    Z[i] = zt(p[2]);
  }
  return { R, Z, TH, res: RES };
}

/* Interpolate the opening radius at an arbitrary angle using the real per-sample
 * angles, so a twisted/leaned/squashed opening is followed exactly (no breach). */
function radiusAtAngle(ring, theta) {
  const TH = ring.TH, R = ring.R, n = R.length, TAU = 2 * Math.PI;
  theta = ((theta % TAU) + TAU) % TAU;
  for (let i = 0; i < n; i++) {
    const t0 = ((TH[i] % TAU) + TAU) % TAU;
    let dt = TH[(i + 1) % n] - TH[i]; dt = ((dt % TAU) + TAU) % TAU; if (dt < 1e-9) dt = TAU;
    let d = theta - t0; d = ((d % TAU) + TAU) % TAU;
    if (d <= dt) { const g = d / dt; return R[i] * (1 - g) + R[(i + 1) % n] * g; }
  }
  return R[0];
}

function ringRadius(pos, col, j, nUcols) {
  let s = 0; for (let i = 0; i < nUcols; i++) { const b = (i * col + j) * 3; s += Math.hypot(pos[b], pos[b + 1]); } return s / nUcols;
}

/* Printability analysis for vase mode: steepest outward overhang + min wall
 * radius, measured in the ACTUAL print-up direction (after any flip via zt). */
function shadeStats(P, ctx, U, V, zt) {
  let maxOverhang = 0, overhangAtV = 0, minR = Infinity;
  const uSamp = 0;
  for (let j = 0; j <= V; j++) {
    const p = surf(P, uSamp, j / V, ctx); const r = Math.hypot(p[0], p[1]);
    if (r < minR) minR = r;
  }
  for (let j = 0; j < V; j++) {
    const p0 = surf(P, uSamp, j / V, ctx), p1 = surf(P, uSamp, (j + 1) / V, ctx);
    const r0 = Math.hypot(p0[0], p0[1]), r1 = Math.hypot(p1[0], p1[1]);
    const z0 = zt(p0[2]), z1 = zt(p1[2]);
    const up = z1 - z0;                        // + when this step goes upward in print space
    const dr = (r1 - r0) * Math.sign(up || 1); // radius change per upward step
    const dz = Math.abs(z1 - z0) || 1e-6;
    if (dr > 0) {                              // widening while rising = overhang
      const ang = Math.atan2(dr, dz) * 180 / Math.PI;
      if (ang > maxOverhang) { maxOverhang = ang; overhangAtV = j / V; }
    }
  }
  return { minRadius: minR, maxOverhangDeg: maxOverhang, overhangAtV, printsClean: minR > 1.0 && maxOverhang < 55 };
}

/* --------------------------------------------------------------- fitter --- */
/* Standard lamp-holder shade-ring bores (inner diameter, mm) */
export const FITTINGS = { 'E27': 40, 'E14': 28, 'B22': 40, 'GU10': 36, 'Custom': 40 };

export function buildFitter(F) {
  const seg = Math.max(24, Math.floor(F.seg || 72));
  const ri = Math.max(2, (F.bore || 40) / 2);
  const ro = ri + Math.max(1, F.hubWall || 3);
  const hubH = Math.max(2, F.hubH || 12);
  const rimWall = Math.max(1, F.rimWall || 3);
  const clear = Math.max(0, F.rimClearance ?? 0.4);
  const spokeCount = Math.max(2, Math.floor(F.spokeCount || 3));
  const spokeW = Math.max(1, F.spokeW || 6);
  const spokeT = Math.max(1, F.spokeT || 4);
  const rimH = spokeT;   // ring thickness == web/spoke thickness (uniform flat spider)
  const ring = F.ring;                       // {R,Z,res} opening curve, or null
  const dir = F.dir || -1;                   // skirt direction into the shade (-1 top mount, +1 bottom)

  // Sample the shade wall radius by ACTUAL angle (handles twist/lean/squash so
  // the rim can never cross the boundary).
  const sampR = f => ring ? radiusAtAngle(ring, f * 2 * Math.PI) : (F.rimOuter || 60);
  // Narrowest opening radius — the rim's smooth inner edge and every spoke tip
  // stop here, so nothing can ever cross the shade wall at a scallop.
  let minOpen = Infinity, maxOpen = 0;
  if (ring) { for (const r of ring.R) { if (r < minOpen) minOpen = r; if (r > maxOpen) maxOpen = r; } }
  else minOpen = maxOpen = (F.rimOuter || 60);

  // FIT CHECK: if the mounting opening is smaller than the bulb-holder ring,
  // the fitter can't physically fit — return null so it vanishes (and the UI warns).
  if (minOpen - clear < ro + 1.0) return null;

  // Smooth constant inner circle. The rim band must be wide enough that a spoke's
  // half-width (radial at a spiral tip) still lands within it — otherwise a wide
  // spoke could poke past the wall. So the effective inner wall covers spokeW/2.
  const rimWallEff = Math.max(rimWall, spokeW / 2 + 0.6);
  const rimInner = Math.max(ro + 1.0, minOpen - clear - rimWallEff);

  // Reference plane: mean opening height. Hub + spokes lie flat here; the rim's
  // top edge is coplanar and its skirt drops into the shade.
  let zRef = 0;
  if (ring) { let s = 0; for (const z of ring.Z) s += z; zRef = s / ring.Z.length; }
  const V = [], I = [];
  const zTop = zRef;
  // hub — annular collar hanging into the shade
  cylTube(V, I, ri, ro, Math.min(zTop, zTop + dir * hubH), Math.max(zTop, zTop + dir * hubH), seg);
  // bayonet / retention bumps: small nibs protruding into the bore to grip the socket
  if (F.bayonet) {
    const zc = zTop + dir * hubH * 0.6, bump = 1.2, bw = 4;
    for (let s = 0; s < 3; s++) { const a = s * 2 * Math.PI / 3; boxPrism(V, I, (ri) * Math.cos(a), (ri) * Math.sin(a), zc, 2 * bump, bw, Math.min(hubH * 0.5, 5), a); }
  }

  // rim — fluted OUTER edge (sampR-clear, hugs the wall) + smooth constant INNER
  // edge (rimInner). Band is >= rimWall thick everywhere.
  const rimN = ring ? ring.res : seg;
  wavyRim(V, I, rimN, sampR, rimInner, zTop, rimH, clear, dir);

  // spokes — top face coplanar with the hub top; all terminate on the smooth
  // rim inner circle (rimInner), so they always connect and never breach.
  const zSpk = zTop + dir * spokeT / 2;
  const style = F.spokeStyle || 'Straight';
  const turns = F.spokeTurns ?? 0.5;
  const gap = 2 * Math.PI / spokeCount;
  const hubAttach = Math.max(ri + spokeW / 2, ro - 0.8);
  for (let s = 0; s < spokeCount; s++) {
    const a = s * gap;
    for (const seg of spokeSegments(style, a, hubAttach, rimInner, gap, turns))
      strut(V, I, seg[0], seg[1], seg[2], seg[3], spokeW, spokeT, zSpk);
  }

  const positions = new Float32Array(V);
  const indices = toIndexArray(I, positions.length / 3);
  orientComponentsOutward(positions, indices);   // outward normals per component (hub/rim/each spoke)
  return { positions, indices, meta: { bore: F.bore, ri, ro, rimInner, minOpen, spokeCount, zRef, dir, tris: I.length / 3 } };
}

/* Return a list of [x0,y0,x1,y1] flat segments (in the web plane) that make up
 * one spoke of the requested style. All styles stay in-plane -> support-free.
 * `hubR` is the hub outer wall (inner attach); the rim-inner radius at each angle
 * is the hard outer bound so a spoke can NEVER cross the shade wall or the bore. */
function spokeSegments(style, a, hubR, outerR, gap, turns) {
  const TAU = 2 * Math.PI;
  const Pt = (r, ang) => [r * Math.cos(ang), r * Math.sin(ang)];
  outerR = Math.max(hubR + 1.5, outerR);      // smooth constant rim-inner target
  const rimIn = () => outerR;
  const clampR = r => Math.min(outerR, Math.max(hubR, r));
  const segs = [];
  if (style === 'Y-branch') {
    const dA = gap * 0.30, bR = hubR + (outerR - hubR) * 0.5;
    const [bx, by] = Pt(bR, a);
    segs.push([...Pt(hubR, a), bx, by]);
    for (const e of [a + dA, a - dA]) segs.push([bx, by, ...Pt(outerR, e)]);
  } else if (style === 'Cross-brace') {
    segs.push([...Pt(hubR, a), ...Pt(outerR, a)]);              // radial
    const dA = gap * 0.5, midR = (hubR + outerR) / 2;          // diagonal braces
    segs.push([...Pt(midR, a - dA), ...Pt(midR, a + dA)]);
  } else if (style === 'Spiral' || style === 'Arc' || style === 'Wavy') {
    const N = style === 'Wavy' ? 14 : style === 'Spiral' ? 16 : 8;
    const sweep = style === 'Spiral' ? turns * TAU : style === 'Arc' ? Math.min(gap * 0.9, turns * Math.PI) : 0;
    const wob = style === 'Wavy' ? gap * 0.22 : 0;
    let prev = Pt(hubR, a);
    for (let i = 1; i <= N; i++) {
      const t = i / N, ang = a + sweep * t + wob * Math.sin(Math.PI * 2 * (turns || 1) * t) * (1 - t);
      const cur = Pt(clampR(hubR + (outerR - hubR) * t), ang);
      segs.push([prev[0], prev[1], cur[0], cur[1]]); prev = cur;
    }
  } else if (style === 'Double') {
    const dA = Math.min(gap * 0.22, Math.atan2(3, hubR + 4));
    for (const e of [a + dA, a - dA]) segs.push([...Pt(hubR, e), ...Pt(outerR, e)]);
  } else if (style === 'Concentric') {
    segs.push([...Pt(hubR, a), ...Pt(outerR, a)]);                 // radial
    const midR = (hubR + outerR) / 2, steps = 20;                  // partial ring at mid radius
    for (let i = 0; i < steps; i++) {                             // arc spanning this sector
      const a0 = a - gap / 2 + gap * i / steps, a1 = a - gap / 2 + gap * (i + 1) / steps;
      segs.push([...Pt(midR, a0), ...Pt(midR, a1)]);
    }
  } else { // Straight
    segs.push([...Pt(hubR, a), ...Pt(outerR, a)]);
  }
  return segs;
}

/* A flat rectangular bar between two planar points, top face at z=zc+thick/2…
 * Uses a small bounded overlap (0.6 mm total) so joints fuse without a wide
 * spoke tip ever poking past the rim into the shade wall. */
function strut(V, I, x0, y0, x1, y1, w, thick, zc) {
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) + 0.6;
  if (len < 1e-3) return;
  boxPrism(V, I, (x0 + x1) / 2, (y0 + y1) / 2, zc, len, w, thick, Math.atan2(dy, dx));
}

/* linear-interpolate a per-angle array at fraction f (wraps) */
function sampleWrap(arr, f) {
  const n = arr.length, x = ((f % 1) + 1) % 1 * n, i = Math.floor(x), g = x - i;
  return arr[i % n] * (1 - g) + arr[(i + 1) % n] * g;
}

/* Watertight rectangular-section ring swept around, following R(angle) but held
 * in one horizontal plane (z1 = zRef constant). The outer face sits `clear`
 * inside the opening; a short vertical skirt drops `rimH` into the shade
 * (dir=-1) or rises into it (dir=+1). Planar top/bottom + vertical walls =
 * prints flat with no supports. */
function wavyRim(V, I, n, sampR, rimInner, zTop, rimH, clear, dir) {
  const base = V.length / 3;
  const z1 = zTop, z0 = zTop + dir * rimH;
  for (let i = 0; i < n; i++) {
    const f = i / n, a = f * 2 * Math.PI, ca = Math.cos(a), sa = Math.sin(a);
    const Ro = Math.max(rimInner + 0.5, sampR(f) - clear);   // fluted outer, hugs wall
    const Ri = rimInner;                                     // smooth constant inner
    V.push(Ro * ca, Ro * sa, z1, Ro * ca, Ro * sa, z0, Ri * ca, Ri * sa, z1, Ri * ca, Ri * sa, z0);
  }
  const q = i => base + (i % n) * 4;
  for (let i = 0; i < n; i++) {
    const oA = q(i), oAb = oA + 1, iA = oA + 2, iAb = oA + 3;
    const j = q(i + 1), oB = j, oBb = j + 1, iB = j + 2, iBb = j + 3;
    I.push(oA, oB, oBb, oA, oBb, oAb);       // outer wall
    I.push(iA, iAb, iBb, iA, iBb, iB);       // inner wall
    I.push(oA, iA, iB, oA, iB, oB);          // edge face at z1
    I.push(oAb, oBb, iBb, oAb, iBb, iAb);    // edge face at z0
  }
}

/* Watertight annular prism (tube with inner+outer wall and both ring caps) */
function cylTube(V, I, ri, ro, z0, z1, seg) {
  const base = V.length / 3;
  for (let i = 0; i < seg; i++) {
    const a = i / seg * 2 * Math.PI, ca = Math.cos(a), sa = Math.sin(a);
    V.push(ro * ca, ro * sa, z0, ro * ca, ro * sa, z1, ri * ca, ri * sa, z0, ri * ca, ri * sa, z1);
  }
  const ring = i => base + (i % seg) * 4;
  for (let i = 0; i < seg; i++) {
    const o0 = ring(i), o0t = o0 + 1, ii0 = o0 + 2, ii0t = o0 + 3;
    const n = ring(i + 1), o1 = n, o1t = n + 1, ii1 = n + 2, ii1t = n + 3;
    // outer wall (normals out)
    I.push(o0, o1, o1t, o0, o1t, o0t);
    // inner wall (normals in)
    I.push(ii0, ii0t, ii1t, ii0, ii1t, ii1);
    // top annulus (normal +z)
    I.push(o0t, o1t, ii1t, o0t, ii1t, ii0t);
    // bottom annulus (normal -z)
    I.push(o0, ii0, ii1, o0, ii1, o1);
  }
}

/* Closed box, size (lx,ly,lz) centered at origin, rotated by `ang` about Z, moved to (cx,cy,cz) */
function boxPrism(V, I, cx, cy, cz, lx, ly, lz, ang) {
  const base = V.length / 3;
  const hx = lx / 2, hy = ly / 2, hz = lz / 2, ca = Math.cos(ang), sa = Math.sin(ang);
  const corners = [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, hy, -hz], [-hx, hy, -hz], [-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]];
  for (const c of corners) {
    const x = c[0] * ca - c[1] * sa, y = c[0] * sa + c[1] * ca;
    V.push(x + cx, y + cy, c[2] + cz);
  }
  const q = [[0, 1, 2, 3], [7, 6, 5, 4], [4, 5, 1, 0], [6, 7, 3, 2], [5, 6, 2, 1], [7, 4, 0, 3]]; // -z,+z,-y,+y,+x,-x (outward)
  for (const f of q) { I.push(base + f[0], base + f[1], base + f[2], base + f[0], base + f[2], base + f[3]); }
}

/* ------------------------------------------------------------- utility --- */
function toIndexArray(arr, vertCount) {
  const Ctor = vertCount > 65535 ? Uint32Array : Uint16Array;
  const out = new Ctor(arr.length);
  out.set(arr);
  return out;
}
