/* shapes.js — pure parametric shade profiles.
 * surf(P, u, v, ctx) -> [x, y, z]  (z = vertical / print axis, up)
 * No THREE dependency, so it runs in the meshing worker.
 * Ported & cleaned from the original "Ogee + Stepped Weave" single-file app,
 * preserving the full library of ~43 profiles.
 */

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const mix = (a, b, t) => a * (1 - t) + b * t;

/* Superformula radius + running average (for normalized gain) */
export function superf(phi, m, n1, n2, n3) {
  const t1 = Math.pow(Math.abs(Math.cos(m * phi / 4)), Math.max(1e-6, n2));
  const t2 = Math.pow(Math.abs(Math.sin(m * phi / 4)), Math.max(1e-6, n3));
  return Math.pow(t1 + t2, -1 / Math.max(1e-6, n1));
}
export function superAvg(P) {
  let s = 0, N = 720;
  for (let i = 0; i < N; i++) s += superf(i / N * 2 * Math.PI, P.sf_m, P.sf_n1, P.sf_n2, P.sf_n3);
  return s / N;
}

/* Value-noise + fBm for the Organic FBM profile */
const h2 = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
const fade = t => t * t * (3 - 2 * t);
export const noise2 = (x, y) => {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const a = h2(i, j), b = h2(i + 1, j), c = h2(i, j + 1), d = h2(i + 1, j + 1);
  const ux = fade(fx), uy = fade(fy);
  return a * (1 - ux) * (1 - uy) + b * ux * (1 - uy) + c * (1 - ux) * uy + d * ux * uy;
};
const fbm2 = (x, y, oct, lac, gain) => {
  let v = 0, amp = 1, sum = 0, f = 1;
  for (let o = 0; o < oct; o++) { v += amp * noise2(x * f, y * f); sum += amp; amp *= gain; f *= lac; }
  return sum ? v / sum : 0;
};

/* Vertical-wave end taper so wavy profiles close cleanly at both rims */
function zEnv(v) {
  const w = 0.08;
  let e = Math.min(1, v / Math.max(1e-6, w)) * Math.min(1, (1 - v) / Math.max(1e-6, w));
  e = clamp(e, 0, 1);
  return e * e * (3 - 2 * e);
}

/* Build a context object once per rebuild (avoids recomputing sfAvg per vertex) */
export function makeCtx(P) { return { sfAvg: superAvg(P) }; }

/* Public entry: base profile + optional two-tone blend + global modifiers. */
export function surf(P, u, v, ctx) {
  let p = surfBase(P, u, v, ctx);
  if (P.shape === 'Wavy Torus' || P.shape === 'Möbius Ribbon') return p; // non-radial
  // two-tone / stacked blend: morph toward a second shape as we rise
  if (P.blendShape && P.blendShape !== 'off' && (P.blendAmt || 0) > 0 && P.blendShape !== P.shape) {
    const pB = surfBase({ ...P, shape: P.blendShape }, u, v, ctx);
    const w = clamp(P.blendAmt, 0, 1) * clamp(v, 0, 1);
    p = [mix(p[0], pB[0], w), mix(p[1], pB[1], w), mix(p[2], pB[2], w)];
  }
  return applyMods(P, p, u, v);
}

/* Global deformation modifiers, applied on TOP of any profile. Each is 0/off by
 * default. They compose, and because they run inside surf(), the vase-mode
 * validator (min radius / overhang) automatically accounts for them. */
function applyMods(P, p, u, v) {
  let x = p[0], y = p[1]; const z = p[2], t = clamp(v, 0, 1);
  let r = Math.hypot(x, y), ang = Math.atan2(y, x);
  if (P.mod_taper) r *= 1 + P.mod_taper * (2 * t - 1);                               // linear taper
  if (P.mod_pinch) r *= 1 - P.mod_pinch * Math.sin(Math.PI * t);                     // waist / barrel
  if (P.mod_bulge) { const w = 0.16; const g = Math.exp(-0.5 * Math.pow((t - (P.mod_bulgePos ?? .5)) / w, 2)); r *= 1 + P.mod_bulge * g; }
  if (P.mod_ribs) r *= 1 + P.mod_ribs * Math.sin(2 * Math.PI * Math.max(1, Math.floor(P.mod_ribsN || 8)) * t); // horizontal ribs
  if (P.mod_flute2) r *= 1 + P.mod_flute2 * Math.cos(Math.max(2, Math.floor(P.mod_flute2N || 18)) * ang);      // 2nd flute set
  if (P.mod_weave) {                                                                                             // over-under basket interlace
    const a = Math.max(2, Math.floor(P.mod_weaveU || 12)) * ang, b = 2 * Math.PI * Math.max(1, Math.floor(P.mod_weaveV || 8)) * t;
    r *= 1 + P.mod_weave * Math.sin(a) * Math.sin(b);   // checkerboard: adjacent cells push out/in = woven look; 0 at cell edges -> watertight
  }
  if (P.mod_facet) { const N = Math.max(3, Math.floor(P.mod_facetN || 6)), seg = 2 * Math.PI / N; let a = ((ang % seg) + seg) % seg - seg / 2; const pf = Math.cos(seg / 2) / Math.max(1e-3, Math.cos(a)); r *= (1 - P.mod_facet) + P.mod_facet * pf; }
  if (P.mod_emboss) { const f = P.mod_embossFreq || 6; r *= 1 + P.mod_emboss * (noise2(u * f + 1.7, v * f * 2 + 0.3) - 0.5) * 2; }
  x = r * Math.cos(ang); y = r * Math.sin(ang);
  if (P.mod_squash) { const s = P.mod_squash; x *= 1 + s; y *= 1 / (1 + s); }        // elliptical cross-section
  if (P.mod_twist) { const a = P.mod_twist * Math.PI / 180 * t, c = Math.cos(a), s = Math.sin(a); const nx = c * x - s * y, ny = s * x + c * y; x = nx; y = ny; }
  if (P.mod_lean) { x += P.mod_lean * (2 * t - 1); }
  return [x, y, z];
}

/* The base profile function. Returns [x, y, z]; z is the vertical print axis. */
function surfBase(P, u, v, ctx) {
  const sfAvg = ctx ? ctx.sfAvg : 1;
  const U = u * 2 * Math.PI, V = v * 2 * Math.PI;
  const n = Math.max(1, Math.floor(P.lobes)), k = P.ripple;
  const Amp = P.verticalAmp * zEnv(v);
  const ap = R => {
    if (P.shape === 'Wavy Torus' || P.shape === 'Möbius Ribbon') return R;
    const H = Math.max(1e-6, P.height);
    const ft = clamp(P.apertureTopFade / H, 0, 1), fb = clamp(P.apertureBottomFade / H, 0, 1);
    const wt = clamp(1 - (v / Math.max(1e-6, ft)), 0, 1), wb = clamp((v - (1 - fb)) / Math.max(1e-6, fb), 0, 1);
    const mn = Math.max(P.apertureTop * wt, P.apertureBottom * wb);
    return Math.max(R, mn);
  };
  // terse tail shared by the extended library: apply global flute ripple + build xyz
  const H0 = P.height, Rt = P.topRadius, Rb = P.bottomRadius, Bs = P.baseRadius;
  const rad = (R, uu, tt) => { const RR = ap(Math.max(1e-3, R) * (1 + k * Math.cos(n * uu))); return [RR * Math.cos(uu), RR * Math.sin(uu), (tt - .5) * H0 + Amp * Math.sin(n * uu)]; };
  const tri = x => 2 / Math.PI * Math.asin(Math.sin(x));     // triangle wave in [-1,1]
  const saw = x => 2 * (x / (2 * Math.PI) - Math.floor(0.5 + x / (2 * Math.PI))); // sawtooth
  const sq = x => Math.tanh(4 * Math.sin(x));                // soft square

  if (P.shape === 'Wavy Torus') {
    const R = P.majorRadius, r = P.tubeRadius, re = r * (1 + k * Math.cos(n * U)), z = Amp * Math.sin(n * U);
    return [(R + re * Math.cos(V)) * Math.cos(U), (R + re * Math.cos(V)) * Math.sin(U), z + re * Math.sin(V)];
  }
  if (P.shape === 'Fluted Cone') {
    const H = P.height, Rt = P.topRadius, Rb = P.bottomRadius, t = clamp(v, 0, 1), s = Math.pow(t, Math.max(.2, P.bellCurve));
    let R = (Rt + (Rb - Rt) * s) * (1 + k * Math.cos(n * U)); R = ap(R);
    return [R * Math.cos(U), R * Math.sin(U), (t - .5) * H + Amp * Math.sin(n * U)];
  }
  if (P.shape === 'Pleated Cylinder') {
    const H = P.height; let R = P.baseRadius * (1 + k * Math.cos(n * U)); R = ap(R);
    return [R * Math.cos(U), R * Math.sin(U), (v - .5) * H + Amp * Math.sin(n * U)];
  }
  if (P.shape === 'Lantern Bulge') {
    const H = P.height, w = .35 - .27 * clamp(P.bulgeSharpness, 0, 1), g = Math.exp(-.5 * Math.pow((v - clamp(P.bulgePos, 0, 1)) / Math.max(.05, w), 2));
    let R = P.baseRadius * (1 + clamp(P.bulge, 0, 1) * g) * (1 + k * Math.cos(n * U)); R = ap(R);
    return [R * Math.cos(U), R * Math.sin(U), (v - .5) * H + Amp * Math.sin(n * U)];
  }
  if (P.shape === 'Bell Shade') {
    const H = P.height, t = clamp(v, 0, 1), s = Math.pow(t, Math.max(.2, P.bellCurve));
    let R = (P.topRadius + (P.bottomRadius - P.topRadius) * s) * (1 + k * Math.cos(n * U)); R = ap(R);
    return [R * Math.cos(U), R * Math.sin(U), (t - .5) * H + Amp * Math.sin(n * U)];
  }
  if (P.shape === 'Tulip Flare') {
    const H = P.height, pn = clamp(P.tulipPinch, 0, .95), fp = Math.max(.2, P.flarePower);
    let R = P.baseRadius; R *= 1 - pn * Math.sin(Math.PI * clamp(v, 0, 1));
    R += P.baseRadius * (clamp(P.flareTop, 0, 1) * Math.pow(1 - v, fp) + clamp(P.flareBottom, 0, 1) * Math.pow(v, fp));
    R = Math.max(1e-3, R) * (1 + k * Math.cos(n * U)); R = ap(R);
    return [R * Math.cos(U), R * Math.sin(U), (v - .5) * H + Amp * Math.sin(n * U)];
  }
  if (P.shape === 'Twisted Ribbon') {
    const H = P.height, T = P.twistTurns * 2 * Math.PI, U2 = U + T * v;
    let R = P.baseRadius * (1 + k * Math.cos(n * U2)); R = ap(R);
    return [R * Math.cos(U2), R * Math.sin(U2), (v - .5) * H + Amp * Math.sin(n * U2)];
  }
  if (P.shape === 'Möbius Ribbon') {
    const R = P.baseRadius, w = (v - .5) * Math.max(1e-3, P.mobiusWidth), a = P.mobiusTwist * U / 2, rc = R + w * Math.cos(a);
    return [rc * Math.cos(U), rc * Math.sin(U), w * Math.sin(a)];
  }
  if (P.shape === 'Spiral Louvers') {
    const H = P.height, ph = 2 * Math.PI * P.louverTurns * v, Rb = mix(P.topRadius, P.bottomRadius, clamp(v, 0, 1));
    let R = Rb * (1 + P.louverDepth * Math.cos(P.louverCount * U + ph)); R = ap(R);
    return [R * Math.cos(U), R * Math.sin(U), (v - .5) * H];
  }
  if (P.shape === 'Petal Shade') {
    const H = P.height, et = Math.pow(1 - v, Math.max(.1, P.petalFalloff)), eb = Math.pow(v, Math.max(.1, P.petalFalloff));
    const env = mix(et, eb, clamp(P.petalBias, 0, 1)), Rb = mix(P.topRadius, P.bottomRadius, clamp(v, 0, 1));
    let R = Rb * (1 + P.petalAmp * env * Math.cos(n * U)); R = ap(R);
    return [R * Math.cos(U), R * Math.sin(U), (v - .5) * H];
  }
  if (P.shape === 'Hyperboloid (ruled)') {
    const H = P.height, t = clamp(v, 0, 1), a = P.hy_twist * 2 * Math.PI;
    const Rt = P.topRadius * (1 + k * Math.cos(n * U)), Rb = P.bottomRadius * (1 + k * Math.cos(n * (U + a)));
    let x = (1 - t) * Rt * Math.cos(U) + t * Rb * Math.cos(U + a), y = (1 - t) * Rt * Math.sin(U) + t * Rb * Math.sin(U + a);
    const r = Math.hypot(x, y), rr = ap(r); if (rr > r) { const s = rr / (r || 1e-6); x *= s; y *= s; }
    return [x, y, (t - .5) * H + Amp * Math.sin(n * U)];
  }
  if (P.shape === 'Ogee Bell') {
    const H = P.height, t = clamp(v, 0, 1), p = Math.max(.2, P.og_pow), tt = clamp(t + P.og_bias, 0, 1);
    const a1 = Math.pow(tt, p), a2 = Math.pow(1 - tt, p), s = a1 / (a1 + a2 + 1e-6);
    let R = (P.topRadius + (P.bottomRadius - P.topRadius) * s) * (1 + k * Math.cos(n * U)); R = ap(R);
    return [R * Math.cos(U), R * Math.sin(U), (t - .5) * H + Amp * Math.sin(n * U)];
  }
  if (P.shape === 'Polygon Drum') {
    const H = P.height, t = clamp(v, 0, 1), Rt = P.topRadius, Rb = P.bottomRadius, Rlin = Rt + (Rb - Rt) * t;
    const pn = Math.max(3, Math.floor(P.poly_sides)), q = Math.max(.5, P.poly_round);
    let phi = ((U * pn + Math.PI / 2) % Math.PI) - Math.PI / 2;
    const c = Math.pow(Math.abs(Math.cos(phi)), q), s = Math.pow(Math.abs(Math.sin(phi)), q), f = Math.pow(c + s, -1 / q);
    let R = Rlin * f * (1 + k * Math.cos(n * U)); R = ap(R);
    return [R * Math.cos(U), R * Math.sin(U), (t - .5) * H + Amp * Math.sin(n * U)];
  }
  if (P.shape === 'Weave (basket)') {
    const H = P.height, t = clamp(v, 0, 1), Rt = P.topRadius, Rb = P.bottomRadius, Rlin = Rt + (Rb - Rt) * t;
    const a = clamp(P.weave_amp, 0, 0.8), uTerm = Math.sin(P.weave_nu * U + P.weave_phase), vTerm = Math.sin(2 * Math.PI * P.weave_mv * v);
    let R = Rlin * (1 + a * uTerm * vTerm); R *= (1 + k * Math.cos(n * U)); R = ap(R);
    return [R * Math.cos(U), R * Math.sin(U), (t - .5) * H + Amp * Math.sin(n * U)];
  }
  if (P.shape === 'Nautilus Spiral') {
    const H = P.height, t = clamp(v, 0, 1), Rt = P.topRadius, Rb = P.bottomRadius;
    let R = (Rt + (Rb - Rt) * t) * Math.exp(P.na_gain * (t - 0.5 + P.na_bias));
    const U2 = U + 2 * Math.PI * P.na_turns * t; R *= (1 + k * Math.cos(n * U2)); R = ap(R);
    return [R * Math.cos(U2), R * Math.sin(U2), (t - .5) * H + Amp * Math.sin(n * U2)];
  }
  if (P.shape === 'Catenary Bell') {
    const H = P.height, t = clamp(v, 0, 1), Rt = P.topRadius, Rb = P.bottomRadius;
    let R = (Rt + (Rb - Rt) * t); const a = Math.max(.05, P.cat_a), c = Math.cosh((t - 0.5 + P.cat_bias) / a) - 1;
    R = Math.max(1e-3, R + P.cat_gain * P.baseRadius * c); R *= (1 + k * Math.cos(n * U)); R = ap(R);
    return [R * Math.cos(U), R * Math.sin(U), (t - .5) * H + Amp * Math.sin(n * U)];
  }
  if (P.shape === 'Tiered Pagoda') {
    const H = P.height, t = clamp(v, 0, 1), Rt = P.topRadius, Rb = P.bottomRadius;
    const tiers = Math.max(2, Math.floor(P.pag_tiers)), bias = clamp(t + P.pag_bias, 0, 1);
    let x = bias * tiers, i = Math.floor(x), frac = x - i;
    const s0 = i / tiers, s1 = (i + 1) / tiers, f = clamp(P.pag_fillet, 0, 0.49);
    const w = clamp((frac - (1 - f)) / Math.max(1e-6, f), 0, 1), s = s0 * (1 - w) + s1 * w;
    let R = (Rt + (Rb - Rt) * s); const tri = 1 - Math.abs(frac - 0.5) * 2; R += P.baseRadius * P.pag_gain * tri;
    R *= (1 + k * Math.cos(n * U)); R = ap(R);
    return [R * Math.cos(U), R * Math.sin(U), (t - .5) * H + Amp * Math.sin(n * U)];
  }
  if (P.shape === 'Star Rosette') {
    const H = P.height, t = clamp(v, 0, 1), Rt = P.topRadius, Rb = P.bottomRadius, Rlin = Rt + (Rb - Rt) * t;
    const q = Math.max(1, P.star_pow), s = Math.pow(Math.abs(Math.cos(P.star_n * U)), q), m = 2 * s - 1;
    let R = Rlin * (1 + P.star_amp * m); R *= (1 + k * Math.cos(n * U)); R = ap(R);
    return [R * Math.cos(U), R * Math.sin(U), (t - .5) * H + Amp * Math.sin(n * U)];
  }
  if (P.shape === 'Gourd/Pumpkin') {
    const H = P.height, t = clamp(v, 0, 1), Rt = P.topRadius, Rb = P.bottomRadius;
    let R = Rt + (Rb - Rt) * t; const rings = Math.max(1, Math.floor(P.g_rings)), sig = Math.max(0.02, P.g_sigma);
    let E = 0; for (let i = 0; i < rings; i++) { const c = (i + .5) / rings, dv = t - c; E += Math.exp(-0.5 * (dv * dv) / (sig * sig)); }
    R *= (1 + clamp(P.g_amp, 0, 0.9) * (E / rings)); R *= (1 + clamp(P.g_petamp, 0, 0.9) * Math.cos(P.g_petn * U));
    R *= (1 + k * Math.cos(n * U)); R = ap(R);
    return [R * Math.cos(U), R * Math.sin(U), (t - .5) * H + Amp * Math.sin(n * U)];
  }
  if (P.shape === 'Bezier (custom)') {
    const H = P.height, t0 = clamp(v, 0, 1), Rt = P.topRadius, Rb = P.bottomRadius, r1 = P.bz_r1, r2 = P.bz_r2;
    let p1 = clamp(P.bz_p1, 0, 1), p2 = clamp(P.bz_p2, 0, 1); if (p2 <= p1) p2 = Math.min(1, p1 + 0.01);
    const bez = (s, a, b, c, d) => { const q = 1 - s; return q * q * q * a + 3 * q * q * s * b + 3 * q * s * s * c + s * s * s * d; };
    const dbez = (s, a, b, c, d) => { const q = 1 - s; return 3 * q * q * (b - a) + 6 * q * s * (c - b) + 3 * s * s * (d - c); };
    let s = t0; for (let it = 0; it < 5; it++) { const x = bez(s, 0, p1, p2, 1), dx = dbez(s, 0, p1, p2, 1) || 1e-6; s = clamp(s - (x - t0) / dx, 0, 1); }
    let R = bez(s, Rt, r1, r2, Rb); R *= (1 + k * Math.cos(n * U)); R = ap(R);
    return [R * Math.cos(U), R * Math.sin(U), (t0 - .5) * H + Amp * Math.sin(n * U)];
  }
  if (P.shape === 'Spline (5-pt)') {
    const H = P.height, t = clamp(v, 0, 1), Rt = P.topRadius, Rb = P.bottomRadius, r = [Rt, P.sp_r1, P.sp_r2, P.sp_r3, Rb];
    let x = t * 4, seg = Math.min(3, Math.max(0, Math.floor(x))), s = x - seg;
    const p0 = r[Math.max(0, seg - 1)], p1 = r[seg], p2 = r[seg + 1], p3 = r[Math.min(4, seg + 2)];
    const tens = clamp(P.sp_tens, 0, 1), m1 = (1 - tens) * (p2 - p0) / 2, m2 = (1 - tens) * (p3 - p1) / 2;
    const s2 = s * s, s3 = s2 * s;
    let R = (2 * s3 - 3 * s2 + 1) * p1 + (s3 - 2 * s2 + s) * m1 + (-2 * s3 + 3 * s2) * p2 + (s3 - s2) * m2;
    R *= (1 + k * Math.cos(n * U)); R = ap(R);
    return [R * Math.cos(U), R * Math.sin(U), (t - .5) * H + Amp * Math.sin(n * U)];
  }
  if (P.shape === 'Twisted Polygon') {
    const H = P.height, t = clamp(v, 0, 1), Rt = P.topRadius, Rb = P.bottomRadius, Rlin = Rt + (Rb - Rt) * t;
    const pn = Math.max(3, Math.floor(P.poly_sides)), q = Math.max(.5, P.poly_round), tw = P.twistTurns * 2 * Math.PI, U2 = U + tw * t;
    let phi = ((U2 * pn + Math.PI / 2) % Math.PI) - Math.PI / 2;
    const c = Math.pow(Math.abs(Math.cos(phi)), q), s = Math.pow(Math.abs(Math.sin(phi)), q), f = Math.pow(c + s, -1 / q);
    let R = Rlin * f * (1 + k * Math.cos(n * U2)); R = ap(R);
    return [R * Math.cos(U2), R * Math.sin(U2), (t - .5) * H + Amp * Math.sin(n * U2)];
  }
  if (P.shape === 'Hourglass') {
    const H = P.height, t = clamp(v, 0, 1), Rt = P.topRadius, Rb = P.bottomRadius;
    const W = Math.min(Rt, Rb) * clamp(P.hg_waist, 0.05, 1.0), pw = Math.max(0.2, P.hg_pow); let R;
    if (t <= .5) { const s = Math.pow(t / .5, pw); R = Rt + (W - Rt) * s; } else { const s = Math.pow((t - .5) / .5, pw); R = W + (Rb - W) * s; }
    R *= (1 + k * Math.cos(n * U)); R = ap(R);
    return [R * Math.cos(U), R * Math.sin(U), (t - .5) * H + Amp * Math.sin(n * U)];
  }
  if (P.shape === 'Bellowed Cylinder') {
    const H = P.height, t = clamp(v, 0, 1), Rt = P.topRadius, Rb = P.bottomRadius;
    let R = (Rt + (Rb - Rt) * t) * (1 + clamp(P.bel_amp, 0, 0.6) * Math.sin(2 * Math.PI * clamp(P.bel_mv, 1, 64) * t));
    R *= (1 + k * Math.cos(n * U)); R = ap(R);
    return [R * Math.cos(U), R * Math.sin(U), (t - .5) * H + Amp * Math.sin(n * U)];
  }
  if (P.shape === 'Crown Flutes') {
    const H = P.height, t = clamp(v, 0, 1), Rt = P.topRadius, Rb = P.bottomRadius; let R = Rt + (Rb - Rt) * t;
    const ft = P.cf_fade > 0 ? Math.max(0, 1 - t / Math.max(1e-6, P.cf_fade)) : 0;
    const fb = P.cf_fade_bottom > 0 ? Math.max(0, 1 - (1 - t) / Math.max(1e-6, P.cf_fade_bottom)) : 0, env = Math.max(ft, fb);
    R *= (1 + clamp(P.cf_depth, 0, 0.8) * env * Math.cos(Math.max(2, Math.floor(P.cf_count)) * U)); R *= (1 + k * Math.cos(n * U)); R = ap(R);
    return [R * Math.cos(U), R * Math.sin(U), (t - .5) * H + Amp * Math.sin(n * U)];
  }
  if (P.shape === 'Twisted Star') {
    const H = P.height, t = clamp(v, 0, 1), Rt = P.topRadius, Rb = P.bottomRadius; let R = Rt + (Rb - Rt) * t;
    const mid = clamp(P.ts_mid, 0, 1), w = Math.max(0.05, P.ts_width), env = Math.exp(-0.5 * Math.pow((t - mid) / w, 2));
    const U2 = U + 2 * Math.PI * clamp(P.twistTurns, 0, 10) * t, q = Math.max(1, P.star_pow);
    const s = Math.pow(Math.abs(Math.cos(Math.max(3, P.star_n) * U2)), q), m = 2 * s - 1;
    R *= (1 + clamp(P.star_amp, 0, 0.9) * env * m); R *= (1 + k * Math.cos(n * U2)); R = ap(R);
    return [R * Math.cos(U2), R * Math.sin(U2), (t - .5) * H + Amp * Math.sin(n * U2)];
  }
  if (P.shape === 'Shell Ribs') {
    const H = P.height, t = clamp(v, 0, 1), Rt = P.topRadius, Rb = P.bottomRadius;
    let R = (Rt + (Rb - Rt) * t) * Math.exp(P.na_gain * (t - 0.5));
    const rib = Math.sin(2 * Math.PI * Math.max(1, Math.floor(P.sh_rib_mv)) * t); R *= (1 + clamp(P.sh_rib_amp, 0, 0.8) * rib);
    const U2 = U + 2 * Math.PI * P.na_turns * t; R *= (1 + k * Math.cos(n * U2)); R = ap(R);
    return [R * Math.cos(U2), R * Math.sin(U2), (t - .5) * H + Amp * Math.sin(n * U2)];
  }
  if (P.shape === 'Elliptical Drum') {
    const H = P.height, t = clamp(v, 0, 1), Rt = P.topRadius, Rb = P.bottomRadius, Rlin = Rt + (Rb - Rt) * t;
    let R = ap(Rlin) * (1 + k * Math.cos(n * U)), x = R * Math.cos(U), y = R * Math.sin(U);
    const ex = Math.max(1, P.ell_ecc || 1), ey = 1 / ex, ang = 2 * Math.PI * (P.ell_rot || 0) * t, ca = Math.cos(ang), sa = Math.sin(ang);
    const xr = ca * x - sa * y, yr = sa * x + ca * y;
    return [xr * ex, yr * ey, (t - .5) * H + Amp * Math.sin(n * U)];
  }
  if (P.shape === 'Leaned Drum') {
    const H = P.height, t = clamp(v, 0, 1), Rt = P.topRadius, Rb = P.bottomRadius;
    let R = ap(Rt + (Rb - Rt) * t) * (1 + k * Math.cos(n * U)), x = R * Math.cos(U), y = R * Math.sin(U);
    const ox = (P.tiltX || 0) * (t - .5) * 2, oy = (P.tiltY || 0) * (t - .5) * 2;
    return [x + ox, y + oy, (t - .5) * H + Amp * Math.sin(n * U)];
  }
  if (P.shape === 'Scalloped Hem') {
    const H = P.height, t = clamp(v, 0, 1), Rt = P.topRadius, Rb = P.bottomRadius, R0 = Rt + (Rb - Rt) * t;
    const w = Math.max(0.01, P.sc_width || 0.1), env = Math.exp(-0.5 * Math.pow((1 - t) / w, 2));
    let R = Math.max(1e-3, ap(R0) * (1 + (P.sc_amp || 0) * env * Math.cos(Math.max(3, Math.floor(P.sc_n || 12)) * U)));
    R *= (1 + k * Math.cos(n * U));
    return [R * Math.cos(U), R * Math.sin(U), (t - .5) * H + Amp * Math.sin(n * U)];
  }
  if (P.shape === 'Fresnel Rings') {
    const H = P.height, t = clamp(v, 0, 1), Rt = P.topRadius, Rb = P.bottomRadius, steps = Math.max(3, Math.floor(P.fr_steps || 12));
    const frac = (t * steps) % 1, tri = 1 - Math.abs(frac * 2 - 1);
    let R = ap(Rt + (Rb - Rt) * t) * (1 + (P.fr_amp || 0.18) * (tri - 0.5) * 2); R *= (1 + k * Math.cos(n * U));
    return [R * Math.cos(U), R * Math.sin(U), (t - .5) * H + Amp * Math.sin(n * U)];
  }
  if (P.shape === 'Elliptical Superellipse') {
    const H = P.height, t = clamp(v, 0, 1), Rt = P.topRadius, Rb = P.bottomRadius, p = Math.max(2, P.se_power);
    const c = Math.pow(Math.abs(Math.cos(U)), p), s = Math.pow(Math.abs(Math.sin(U)), p), f = Math.pow(c + s, -1 / p);
    let R = (Rt + (Rb - Rt) * t) * (1 + k * Math.cos(n * U)); R = ap(R);
    let x = R * f * Math.cos(U), y = R * f * Math.sin(U);
    const ex = Math.max(1, P.ell_ecc || 1), ey = 1 / ex, ang = 2 * Math.PI * (P.ell_rot || 0) * t, ca = Math.cos(ang), sa = Math.sin(ang);
    const xr = ca * x - sa * y, yr = sa * x + ca * y;
    return [xr * ex, yr * ey, (t - .5) * H + Amp * Math.sin(n * U)];
  }
  if (P.shape === 'Asymmetric Petals') {
    const H = P.height, t = clamp(v, 0, 1), Rt = P.topRadius, Rb = P.bottomRadius;
    const nT = Math.max(1, Math.floor(P.ap_topN || 8)), nB = Math.max(1, Math.floor(P.ap_botN || 12)), m = nT + (nB - nT) * t;
    const et = Math.pow(1 - t, Math.max(.1, P.petalFalloff)), eb = Math.pow(t, Math.max(.1, P.petalFalloff)), env = mix(et, eb, clamp(P.petalBias, 0, 1));
    let R = (Rt + (Rb - Rt) * t) * (1 + P.petalAmp * env * Math.cos(m * U)); R *= (1 + k * Math.cos(n * U)); R = ap(R);
    return [R * Math.cos(U), R * Math.sin(U), (t - .5) * H + Amp * Math.sin(n * U)];
  }
  if (P.shape === 'Truncated Dome') {
    const H = P.height, t = clamp(v, 0, 1), Rt = P.topRadius, Rb = P.bottomRadius;
    const dh = clamp(P.td_h || 0.35, 0.01, 0.95), bul = clamp(P.td_bulge || 0, 0, 0.8); let R = Rt + (Rb - Rt) * t;
    if (t <= dh) { const s = t / dh; R += bul * Rt * (1 - Math.cos(Math.PI * s)) / 2; }
    R *= (1 + k * Math.cos(n * U)); R = ap(R);
    return [R * Math.cos(U), R * Math.sin(U), (t - .5) * H + Amp * Math.sin(n * U)];
  }
  if (P.shape === 'Helical Crown') {
    const H = P.height, t = clamp(v, 0, 1), Rt = P.topRadius, Rb = P.bottomRadius; let R = Rt + (Rb - Rt) * t;
    const w = Math.max(0.02, P.hc_width || 0.25), env = Math.exp(-0.5 * (t / w) * (t / w)), U2 = U + 2 * Math.PI * (P.hc_turns || 1) * t;
    R *= (1 + (P.hc_amp || 0.18) * env * Math.cos(U2)); R *= (1 + k * Math.cos(n * U2)); R = ap(R);
    return [R * Math.cos(U2), R * Math.sin(U2), (t - .5) * H + Amp * Math.sin(n * U2)];
  }
  if (P.shape === 'Organic FBM') {
    const H = P.height, t = clamp(v, 0, 1), Rt = P.topRadius, Rb = P.bottomRadius; let R = Rt + (Rb - Rt) * t;
    let x = P.org_u * u, y = P.org_v * v; const warp = clamp(P.org_warp, 0, 1);
    if (warp > 0) { const wx = noise2(x + 5.2, y + 1.3), wy = noise2(x - 3.7, y - 7.1); x += warp * wx; y += warp * wy; }
    const f = fbm2(x, y, Math.max(1, Math.floor(P.org_oct)), Math.max(1.1, P.org_lac), clamp(P.org_gain, 0.1, 0.95));
    const mid = clamp(P.org_mid, 0, 1), w = Math.max(0.02, P.org_width), env = Math.exp(-0.5 * Math.pow((t - mid) / w, 2));
    R *= (1 + clamp(P.org_amp, 0, 0.9) * (f - 0.5) * 2 * env);
    R *= (1 + P.ripple * Math.cos(Math.max(1, Math.floor(P.lobes)) * u * 2 * Math.PI)); R = ap(R);
    return [R * Math.cos(u * 2 * Math.PI), R * Math.sin(u * 2 * Math.PI), (t - .5) * H + P.verticalAmp * Math.sin(P.lobes * u * 2 * Math.PI)];
  }
  if (P.shape === 'Conch Shell') {
    const H = P.height, t = clamp(v, 0, 1);
    let R = (P.topRadius + (P.bottomRadius - P.topRadius) * t) * Math.exp((P.cs_gain || 0) * (t - 0.5));
    const U2 = u * 2 * Math.PI + 2 * Math.PI * (P.cs_turns || 0) * t, rib = Math.sin(2 * Math.PI * Math.max(0, Math.floor(P.cs_ribs || 0)) * t);
    const env = Math.exp(-0.5 * Math.pow((1 - t) / Math.max(0.02, P.cs_width || 0.25), 2));
    R *= (1 + (P.cs_amp || 0) * env * rib); R *= (1 + P.ripple * Math.cos(P.lobes * U2)); R = ap(R);
    return [R * Math.cos(U2), R * Math.sin(U2), (t - .5) * H + P.verticalAmp * Math.sin(P.lobes * U2)];
  }
  if (P.shape === 'Bloom Bell') {
    const H = P.height, t = clamp(v, 0, 1);
    let R = (P.topRadius + (P.bottomRadius - P.topRadius) * Math.pow(t, Math.max(.2, P.bellCurve)));
    const env = Math.exp(-0.5 * Math.pow((1 - t) / Math.max(0.02, P.bl_width || 0.2), 2));
    R *= (1 + clamp(P.bl_amp, 0, 0.9) * env * Math.cos(Math.max(3, Math.floor(P.bl_n || 12)) * u * 2 * Math.PI));
    R *= (1 + P.ripple * Math.cos(P.lobes * u * 2 * Math.PI)); R = ap(R);
    return [R * Math.cos(u * 2 * Math.PI), R * Math.sin(u * 2 * Math.PI), (t - .5) * H + P.verticalAmp * Math.sin(P.lobes * u * 2 * Math.PI)];
  }
  if (P.shape === 'Superellipse Drum' || P.shape === 'Squared Drum') {
    const H = P.height, p = Math.max(2, P.se_power);
    const c = Math.pow(Math.abs(Math.cos(U)), p), s = Math.pow(Math.abs(Math.sin(U)), p), f = Math.pow(c + s, -1 / p);
    let R = P.baseRadius * f * (1 + k * Math.cos(n * U)); R = ap(R);
    return [R * Math.cos(U), R * Math.sin(U), (v - .5) * H + Amp * Math.sin(n * U)];
  }
  if (P.shape === 'Superellipse Morph') {
    const H = P.height, p = Math.max(2, mix(P.seTop, P.seBottom, clamp(v, 0, 1)));
    const c = Math.pow(Math.abs(Math.cos(U)), p), s = Math.pow(Math.abs(Math.sin(U)), p), f = Math.pow(c + s, -1 / p);
    let R = P.baseRadius * f * (1 + k * Math.cos(n * U)); R = ap(R);
    return [R * Math.cos(U), R * Math.sin(U), (v - .5) * H];
  }
  if (P.shape === 'Superformula Cylinder') {
    const H = P.height, sf = superf(U, P.sf_m, P.sf_n1, P.sf_n2, P.sf_n3), sn = sf / Math.max(1e-6, sfAvg);
    let R = P.baseRadius * (1 + P.sf_gain * (sn - 1)) * (1 + k * Math.cos(n * U)); R = ap(R);
    return [R * Math.cos(U), R * Math.sin(U), (v - .5) * H + Amp * Math.sin(n * U)];
  }
  if (P.shape === 'Onion Dome') {
    const H = P.height, t = clamp(v, 0, 1);
    const bulge = Math.pow(Math.sin(Math.PI * t), 0.7), spire = Math.pow(1 - t, 0.5);
    let R = (P.topRadius + (P.bottomRadius - P.topRadius) * (0.35 * bulge + 0.65 * spire)) * (1 + k * Math.cos(n * U)); R = ap(R);
    return [R * Math.cos(U), R * Math.sin(U), (t - .5) * H + Amp * Math.sin(n * U)];
  }
  if (P.shape === 'Trumpet Flare') {
    const H = P.height, t = clamp(v, 0, 1), e = Math.pow(t, 1 / Math.max(.3, P.bellCurve));
    let R = (P.bottomRadius + (P.topRadius - P.bottomRadius) * e) * (1 + k * Math.cos(n * U)); R = ap(R);
    return [R * Math.cos(U), R * Math.sin(U), (t - .5) * H + Amp * Math.sin(n * U)];
  }
  if (P.shape === 'Egg') {
    const H = P.height, t = clamp(v, 0, 1), e = Math.pow(Math.sin(Math.PI * t), 0.75) * (1 + 0.25 * (0.5 - t));
    let R = (P.topRadius + (P.bottomRadius - P.topRadius) * e) * (1 + k * Math.cos(n * U)); R = ap(Math.max(1e-3, R));
    return [R * Math.cos(U), R * Math.sin(U), (t - .5) * H + Amp * Math.sin(n * U)];
  }
  if (P.shape === 'Chalice') {
    const H = P.height, t = clamp(v, 0, 1);
    const cup = Math.pow(clamp((t - 0.45) / 0.55, 0, 1), 0.6), foot = Math.pow(clamp((0.15 - t) / 0.15, 0, 1), 0.6);
    const stemR = Math.max(P.topRadius * 0.18, 6);
    let R = (stemR + (P.bottomRadius - stemR) * cup + P.topRadius * 0.6 * foot) * (1 + k * Math.cos(n * U)); R = ap(R);
    return [R * Math.cos(U), R * Math.sin(U), (t - .5) * H + Amp * Math.sin(n * U)];
  }
  if (P.shape === 'Barrel') {
    const H = P.height, t = clamp(v, 0, 1), belly = Math.sin(Math.PI * t);
    let R = (mix(P.topRadius, P.bottomRadius, t) * (1 + 0.28 * belly)) * (1 + k * Math.cos(n * U)); R = ap(R);
    return [R * Math.cos(U), R * Math.sin(U), (t - .5) * H + Amp * Math.sin(n * U)];
  }
  if (P.shape === 'Diabolo') {
    const H = P.height, t = clamp(v, 0, 1), waist = Math.abs(2 * t - 1);
    let R = (mix(P.topRadius, P.bottomRadius, t) * (0.25 + 0.75 * Math.pow(waist, 1.3))) * (1 + k * Math.cos(n * U)); R = ap(R);
    return [R * Math.cos(U), R * Math.sin(U), (t - .5) * H + Amp * Math.sin(n * U)];
  }
  if (P.shape === 'Custom Profile') {
    const H = P.height, t = clamp(v, 0, 1), prof = P.customProfile;
    let R;
    if (prof && prof.length > 1) { const x = t * (prof.length - 1), i = Math.floor(x), f = x - i; R = prof[i] * (1 - f) + prof[Math.min(prof.length - 1, i + 1)] * f; }
    else R = mix(P.topRadius, P.bottomRadius, t);
    R = Math.max(1e-3, R) * (1 + k * Math.cos(n * U)); R = ap(R);
    return [R * Math.cos(U), R * Math.sin(U), (t - .5) * H + Amp * Math.sin(n * U)];
  }
  /* ---- extended library (56 families) ---- t = height fraction, Rlin = tapered base ---- */
  {
    const t = clamp(v, 0, 1), Rlin = Rt + (Rb - Rt) * t;
    const sN = Math.max(3, Math.floor(P.star_n)), sA = clamp(P.star_amp, 0, 0.9), sP = Math.max(1, P.star_pow);
    const pS = Math.max(3, Math.floor(P.poly_sides)), bM = Math.max(1, Math.floor(P.bel_mv)), tw = P.twistTurns * 2 * Math.PI;
    switch (P.shape) {
      // --- vessels & vases (profile silhouettes) ---
      case 'Cosine Bell': return rad(mix(Rt, Rb, 0.5 - 0.5 * Math.cos(Math.PI * t)), U, t);
      case 'Gaussian Bell': return rad(Rt + (Rb - Rt) * Math.exp(-3.5 * t * t), U, t);
      case 'Parabolic Flare': return rad(mix(Rt, Rb, 1 - (1 - t) * (1 - t)), U, t);
      case 'Concave Taper': return rad(Rb + (Rt - Rb) * Math.sqrt(t), U, t);
      case 'Convex Taper': return rad(Rb + (Rt - Rb) * t * t, U, t);
      case 'Logistic S': return rad(mix(Rb, Rt, 1 / (1 + Math.exp(-9 * (t - 0.5)))), U, t);
      case 'Double Ogee': return rad(mix(Rt, Rb, t) + (Rb - Rt) * 0.14 * Math.sin(2 * Math.PI * t), U, t);
      case 'Amphora': { let R = Bs * (0.55 + 0.45 * Math.sin(Math.PI * (0.12 + 0.76 * t))); R *= (1 - 0.34 * Math.exp(-26 * (t - 0.82) ** 2)); return rad(R, U, t); }
      case 'Urn': { let R = Bs * (0.45 + 0.55 * Math.sin(Math.PI * Math.pow(t, 0.8))); R *= (1 - 0.32 * Math.exp(-30 * (t - 0.88) ** 2)); R += Bs * 0.25 * Math.exp(-45 * (t - 0.97) ** 2); return rad(R, U, t); }
      case 'Baluster': return rad(Bs * (0.28 + 0.6 * Math.exp(-9 * (t - 0.22) ** 2) + 0.18 * t), U, t);
      case 'Classic Vase': return rad(mix(Rt, Rb, 0.5 - 0.5 * Math.cos(Math.PI * Math.pow(t, 1.3))), U, t);
      case 'Beaker': return rad(Bs * (1 + 0.14 * Math.max(0, (t - 0.85)) / 0.15), U, t);
      case 'Round Flask': return rad(Bs * (0.25 + 0.95 * Math.exp(-7 * (t - 0.3) ** 2)), U, t);
      case 'Bottle': { const sh = t < 0.6 ? 1 : Math.max(0.28, 1 - 2 * (t - 0.6)); return rad(Bs * sh, U, t); }
      case 'Carafe': return rad(Bs * (0.25 + 0.75 * (1 - t)) + Bs * 0.15, U, t);
      case 'Teardrop': return rad(Rb * Math.pow(Math.sin(Math.PI * t), 0.65), U, t);
      case 'Pear': return rad(Rb * (0.15 + 0.9 * Math.exp(-5 * (t - 0.28) ** 2)), U, t);
      case 'Light Bulb': return rad(Bs * Math.max(0.26, Math.sqrt(Math.max(0, 1 - ((t - 0.32) / 0.42) ** 2))), U, t);
      case 'Mushroom': return rad(Bs * (0.32 + (t > 0.5 ? Math.sin(Math.PI * (t - 0.5)) * 0.9 : 0)), U, t);
      case 'Open Bowl': return rad(Rb * Math.sqrt(Math.max(0.02, 1 - (1 - t) ** 2)), U, t);
      case 'Deep Bowl': return rad(Rb * Math.sqrt(Math.max(0.02, 1 - (1 - t) ** 3)), U, t);
      case 'Coupe': return rad(Rb * Math.pow(t, 0.4), U, t);
      case 'Saucer': return rad(Bs * (0.4 + 0.6 * Math.sin(Math.PI * t)), U, t);
      case 'Dome': return rad(Math.max(1e-2, Rb * Math.cos(Math.PI / 2 * t)), U, t);
      case 'Bell Jar': return rad(t < 0.6 ? Bs : Math.max(1e-2, Bs * Math.cos(Math.PI / 2 * ((t - 0.6) / 0.4))), U, t);
      case 'Capsule': return rad(Bs * Math.pow(Math.sin(Math.PI * t), 0.25), U, t);
      case 'Lens': return rad(Bs * Math.sin(Math.PI * t), U, t);
      case 'Oblate': return rad(Bs * 1.25 * Math.sqrt(Math.max(0.02, 1 - (2 * t - 1) ** 2)), U, t);
      case 'Spinning Top': return rad(Bs * Math.pow(1 - Math.abs(2 * t - 1), 0.7), U, t);
      case 'Bicone': return rad(Bs * (1 - Math.abs(2 * t - 1)) + Bs * 0.06, U, t);
      // --- columns & twists (angular) ---
      case 'Reeded Column': return rad(Rlin * (1 + 0.05 * Math.cos(Math.max(8, sN * 2) * U)), U, t);
      case 'Barley Twist': { const U2 = U + tw * t; return rad(Rlin * (1 + sA * 0.4 * Math.cos(sN * U2)), U2, t); }
      case 'Rope Twist': { const U2 = U + tw * t; return rad(Rlin * (1 + sA * 0.35 * Math.abs(Math.cos(sN * U2))), U2, t); }
      case 'Cable Column': return rad(Rlin * (1 + sA * 0.35 * Math.cos(sN * U + tw * t)), U, t);
      case 'Gear Column': return rad(Rlin * (1 + sA * 0.4 * sq(pS * U)), U, t);
      case 'Sprocket': return rad(Rlin * (1 + sA * 0.5 * Math.pow(Math.max(0, Math.cos(pS * U)), 3)), U, t);
      case 'Fan Pleats': return rad(Rlin * (1 + sA * 0.4 * tri(sN * U)), U, t);
      case 'Sawtooth Flutes': return rad(Rlin * (1 + sA * 0.35 * saw(sN * U)), U, t);
      case 'Star Column': return rad(Rlin * (1 + sA * (2 * Math.pow(Math.abs(Math.cos(sN * U)), sP) - 1)), U, t);
      case 'Trefoil': return rad(Rlin * (1 + 0.18 * Math.cos(3 * U)), U, t);
      case 'Quatrefoil': return rad(Rlin * (1 + 0.16 * Math.cos(4 * U)), U, t);
      case 'Cinquefoil': return rad(Rlin * (1 + 0.14 * Math.cos(5 * U)), U, t);
      case 'Plus Column': return rad(Rlin * (0.72 + 0.5 * Math.pow(Math.abs(Math.cos(2 * U)), 8)), U, t);
      case 'Heart Column': return rad(Rlin * 0.72 * (1 - 0.5 * Math.sin(U)), U, t);
      case 'Wave Column': return rad(Rlin * (1 + sA * 0.5 * Math.sin(sN * U)), U, t);
      case 'Twisted Reed': { const U2 = U + tw * 1.5 * t; return rad(Rlin * (1 + 0.06 * Math.cos(Math.max(12, sN * 3) * U2)), U2, t); }
      // --- textures & patterns (2D fields) ---
      case 'Waffle': return rad(Rlin * (1 + sA * 0.4 * Math.sin(sN * U) * Math.sin(2 * Math.PI * bM * t)), U, t);
      case 'Basket Weave': return rad(Rlin * (1 + sA * 0.45 * Math.sin(Math.max(6, sN) * U) * Math.sin(2 * Math.PI * bM * t)), U, t);
      case 'Diamond Quilt': return rad(Rlin * (1 + sA * 0.35 * 0.5 * (Math.cos(sN * U + 2 * Math.PI * bM * t) + Math.cos(sN * U - 2 * Math.PI * bM * t))), U, t);
      case 'Honeycomb': return rad(Rlin * (1 + sA * 0.3 * (Math.cos(sN * U) + Math.cos(sN * U + 2 * Math.PI * bM * t) + Math.cos(sN * U - 2 * Math.PI * bM * t)) / 3), U, t);
      case 'Pinecone': return rad(Rlin * (1 + sA * 0.35 * Math.cos(sN * U + 3.5 * Math.PI * t) * Math.cos(bM * Math.PI * t)), U, t);
      case 'Bamboo': { const node = Math.exp(-40 * (((t * bM) % 1) - 0.5) ** 2); return rad(Rlin * (1 + 0.07 * node), U, t); }
      case 'Coral': return rad(Rlin * (1 + 0.16 * (noise2(8 * u + 3.1, 8 * v + 1.7) - 0.5)), U, t);
      case 'Sea Urchin': return rad(Rlin * (1 + sA * 0.5 * Math.pow(Math.max(0, Math.sin(sN * U) * Math.sin(2 * Math.PI * bM * t)), 3)), U, t);
      case 'Cactus Ribs': return rad(Rlin * (1 + sA * 0.4 * Math.pow(Math.abs(Math.cos(pS * U / 2)), 1.5)), U, t);
      case 'Sunburst': return rad(Rlin * (1 + sA * 0.6 * Math.pow(Math.abs(Math.cos(sN * U)), 10)), U, t);
    }
  }
  /* default: Wavy Torus */
  const R0 = P.majorRadius, r = P.tubeRadius, re = r * (1 + k * Math.cos(n * U)), z = Amp * Math.sin(n * U);
  return [(R0 + re * Math.cos(V)) * Math.cos(U), (R0 + re * Math.cos(V)) * Math.sin(U), z + re * Math.sin(V)];
}

/* Shapes whose V wraps around (torus topology) — no bottom/top caps */
export const WRAP_V_SHAPES = new Set(['Wavy Torus']);

export const SHAPE_LIST = [
  'Onion Dome', 'Trumpet Flare', 'Egg', 'Chalice', 'Barrel', 'Diabolo',
  'Fluted Cone', 'Bell Shade', 'Ogee Bell', 'Catenary Bell', 'Tulip Flare', 'Bloom Bell',
  'Pleated Cylinder', 'Bellowed Cylinder', 'Crown Flutes', 'Polygon Drum', 'Twisted Polygon',
  'Elliptical Drum', 'Leaned Drum', 'Superellipse Drum', 'Superellipse Morph', 'Elliptical Superellipse',
  'Superformula Cylinder', 'Squared Drum', 'Lantern Bulge', 'Gourd/Pumpkin', 'Hourglass',
  'Tiered Pagoda', 'Truncated Dome', 'Fresnel Rings', 'Star Rosette', 'Twisted Star',
  'Petal Shade', 'Asymmetric Petals', 'Scalloped Hem', 'Spiral Louvers', 'Helical Crown',
  'Twisted Ribbon', 'Hyperboloid (ruled)', 'Nautilus Spiral', 'Shell Ribs', 'Conch Shell',
  'Weave (basket)', 'Organic FBM', 'Bezier (custom)', 'Spline (5-pt)', 'Möbius Ribbon', 'Wavy Torus',
  // extended library (56)
  'Cosine Bell', 'Gaussian Bell', 'Parabolic Flare', 'Concave Taper', 'Convex Taper', 'Logistic S', 'Double Ogee',
  'Amphora', 'Urn', 'Baluster', 'Classic Vase', 'Beaker', 'Round Flask', 'Bottle', 'Carafe', 'Teardrop', 'Pear',
  'Light Bulb', 'Mushroom', 'Open Bowl', 'Deep Bowl', 'Coupe', 'Saucer', 'Dome', 'Bell Jar', 'Capsule', 'Lens',
  'Oblate', 'Spinning Top', 'Bicone', 'Reeded Column', 'Barley Twist', 'Rope Twist', 'Cable Column', 'Gear Column',
  'Sprocket', 'Fan Pleats', 'Sawtooth Flutes', 'Star Column', 'Trefoil', 'Quatrefoil', 'Cinquefoil', 'Plus Column',
  'Heart Column', 'Wave Column', 'Twisted Reed', 'Waffle', 'Basket Weave', 'Diamond Quilt', 'Honeycomb', 'Pinecone',
  'Bamboo', 'Coral', 'Sea Urchin', 'Cactus Ribs', 'Sunburst',
  'Custom Profile'
];

/* Grouped for the wizard's profile picker */
export const SHAPE_GROUPS = [
  { group: 'Classic shades', items: ['Fluted Cone', 'Bell Shade', 'Ogee Bell', 'Catenary Bell', 'Tulip Flare', 'Bloom Bell', 'Truncated Dome', 'Trumpet Flare', 'Chalice'] },
  { group: 'Drums & cylinders', items: ['Pleated Cylinder', 'Bellowed Cylinder', 'Crown Flutes', 'Polygon Drum', 'Twisted Polygon', 'Elliptical Drum', 'Leaned Drum', 'Superellipse Drum', 'Superellipse Morph', 'Elliptical Superellipse', 'Superformula Cylinder', 'Squared Drum', 'Fresnel Rings'] },
  { group: 'Bulges & waists', items: ['Lantern Bulge', 'Gourd/Pumpkin', 'Hourglass', 'Tiered Pagoda', 'Onion Dome', 'Egg', 'Barrel', 'Diabolo'] },
  { group: 'Petals & stars', items: ['Star Rosette', 'Twisted Star', 'Petal Shade', 'Asymmetric Petals', 'Scalloped Hem'] },
  { group: 'Spirals & twists', items: ['Spiral Louvers', 'Helical Crown', 'Twisted Ribbon', 'Hyperboloid (ruled)', 'Nautilus Spiral', 'Shell Ribs', 'Conch Shell'] },
  { group: 'Textured & exotic', items: ['Weave (basket)', 'Organic FBM', 'Bezier (custom)', 'Spline (5-pt)', 'Möbius Ribbon', 'Wavy Torus'] },
  { group: 'Custom', items: ['Custom Profile'] },
  { group: 'Vessels & vases', items: ['Cosine Bell', 'Gaussian Bell', 'Parabolic Flare', 'Concave Taper', 'Convex Taper', 'Logistic S', 'Double Ogee', 'Amphora', 'Urn', 'Baluster', 'Classic Vase', 'Beaker', 'Round Flask', 'Bottle', 'Carafe', 'Teardrop', 'Pear', 'Light Bulb', 'Mushroom', 'Open Bowl', 'Deep Bowl', 'Coupe', 'Saucer', 'Dome', 'Bell Jar', 'Capsule', 'Lens', 'Oblate', 'Spinning Top', 'Bicone'] },
  { group: 'Columns & twists', items: ['Reeded Column', 'Barley Twist', 'Rope Twist', 'Cable Column', 'Gear Column', 'Sprocket', 'Fan Pleats', 'Sawtooth Flutes', 'Star Column', 'Trefoil', 'Quatrefoil', 'Cinquefoil', 'Plus Column', 'Heart Column', 'Wave Column', 'Twisted Reed'] },
  { group: 'Textures & patterns', items: ['Waffle', 'Basket Weave', 'Diamond Quilt', 'Honeycomb', 'Pinecone', 'Bamboo', 'Coral', 'Sea Urchin', 'Cactus Ribs', 'Sunburst'] }
];

/* Which parameter sub-panels each shape needs (drives the wizard's Detail step) */
export const SHAPE_PANELS = {
  'Wavy Torus': ['torus', 'ripples'], 'Fluted Cone': ['bell', 'ripples', 'aperture'], 'Pleated Cylinder': ['ripples', 'aperture'],
  'Superformula Cylinder': ['superformula', 'ripples'], 'Lantern Bulge': ['bulge', 'ripples', 'aperture'], 'Bell Shade': ['bell', 'ripples', 'aperture'],
  'Tulip Flare': ['tulip', 'ripples', 'aperture'], 'Twisted Ribbon': ['twist', 'ripples'], 'Superellipse Drum': ['superellipse', 'ripples'],
  'Squared Drum': ['superellipse', 'ripples'], 'Möbius Ribbon': ['mobius'], 'Spiral Louvers': ['louvers'], 'Petal Shade': ['petal'],
  'Superellipse Morph': ['semorph'], 'Hyperboloid (ruled)': ['hyperboloid', 'ripples'], 'Ogee Bell': ['ogee', 'ripples', 'aperture'],
  'Polygon Drum': ['polygon', 'ripples'], 'Weave (basket)': ['weave', 'ripples'], 'Nautilus Spiral': ['nautilus', 'ripples'],
  'Catenary Bell': ['catenary', 'ripples', 'aperture'], 'Tiered Pagoda': ['pagoda', 'ripples', 'aperture'], 'Star Rosette': ['star', 'ripples'],
  'Gourd/Pumpkin': ['gourd', 'ripples'], 'Bezier (custom)': ['bezier', 'ripples'], 'Spline (5-pt)': ['spline', 'ripples'],
  'Twisted Polygon': ['polygon', 'twist', 'ripples'], 'Hourglass': ['hourglass', 'ripples'], 'Bellowed Cylinder': ['bellow', 'ripples'],
  'Crown Flutes': ['crownflutes', 'ripples'], 'Twisted Star': ['twiststar', 'star', 'twist', 'ripples'], 'Shell Ribs': ['shellribs', 'nautilus', 'ripples'],
  'Elliptical Drum': ['ellipse', 'ripples'], 'Leaned Drum': ['tilt', 'ripples'], 'Scalloped Hem': ['scallop', 'ripples'],
  'Fresnel Rings': ['fresnel', 'ripples'], 'Elliptical Superellipse': ['superellipse', 'ellipse', 'ripples'], 'Asymmetric Petals': ['asympetals', 'petal'],
  'Truncated Dome': ['truncdome', 'ripples'], 'Helical Crown': ['helicalcrown', 'twist', 'ripples'], 'Organic FBM': ['organic', 'ripples'],
  'Conch Shell': ['conch', 'nautilus', 'ripples'], 'Bloom Bell': ['bloom', 'ripples'],
  'Onion Dome': ['ripples', 'aperture'], 'Trumpet Flare': ['bell', 'ripples', 'aperture'], 'Egg': ['ripples', 'aperture'],
  'Chalice': ['ripples', 'aperture'], 'Barrel': ['ripples', 'aperture'], 'Diabolo': ['ripples', 'aperture'],
  // extended library panels
  'Cosine Bell': ['ripples', 'aperture'], 'Gaussian Bell': ['ripples', 'aperture'], 'Parabolic Flare': ['ripples', 'aperture'],
  'Concave Taper': ['ripples', 'aperture'], 'Convex Taper': ['ripples', 'aperture'], 'Logistic S': ['ripples', 'aperture'],
  'Double Ogee': ['ripples', 'aperture'], 'Amphora': ['ripples', 'aperture'], 'Urn': ['ripples', 'aperture'],
  'Baluster': ['ripples', 'aperture'], 'Classic Vase': ['ripples', 'aperture'], 'Beaker': ['ripples', 'aperture'],
  'Round Flask': ['ripples', 'aperture'], 'Bottle': ['ripples', 'aperture'], 'Carafe': ['ripples', 'aperture'],
  'Teardrop': ['ripples', 'aperture'], 'Pear': ['ripples', 'aperture'], 'Light Bulb': ['ripples', 'aperture'],
  'Mushroom': ['ripples', 'aperture'], 'Open Bowl': ['ripples', 'aperture'], 'Deep Bowl': ['ripples', 'aperture'],
  'Coupe': ['ripples', 'aperture'], 'Saucer': ['ripples', 'aperture'], 'Dome': ['ripples', 'aperture'],
  'Bell Jar': ['ripples', 'aperture'], 'Capsule': ['ripples', 'aperture'], 'Lens': ['ripples', 'aperture'],
  'Oblate': ['ripples', 'aperture'], 'Spinning Top': ['ripples', 'aperture'], 'Bicone': ['ripples', 'aperture'],
  'Reeded Column': ['star', 'ripples'], 'Barley Twist': ['twist', 'star', 'ripples'], 'Rope Twist': ['twist', 'star', 'ripples'],
  'Cable Column': ['twist', 'star', 'ripples'], 'Gear Column': ['polygon', 'star', 'ripples'], 'Sprocket': ['polygon', 'star', 'ripples'],
  'Fan Pleats': ['star', 'ripples'], 'Sawtooth Flutes': ['star', 'ripples'], 'Star Column': ['star', 'ripples'],
  'Trefoil': ['ripples', 'aperture'], 'Quatrefoil': ['ripples', 'aperture'], 'Cinquefoil': ['ripples', 'aperture'],
  'Plus Column': ['ripples', 'aperture'], 'Heart Column': ['ripples', 'aperture'], 'Wave Column': ['star', 'ripples'],
  'Twisted Reed': ['twist', 'star', 'ripples'], 'Waffle': ['star', 'bellow', 'ripples'], 'Basket Weave': ['star', 'bellow', 'ripples'],
  'Diamond Quilt': ['star', 'bellow', 'ripples'], 'Honeycomb': ['star', 'bellow', 'ripples'], 'Pinecone': ['star', 'bellow', 'ripples'],
  'Bamboo': ['bellow', 'ripples'], 'Coral': ['ripples', 'aperture'], 'Sea Urchin': ['star', 'bellow', 'ripples'],
  'Cactus Ribs': ['polygon', 'star', 'ripples'], 'Sunburst': ['star', 'ripples'],
  'Custom Profile': ['ripples', 'aperture']
};
