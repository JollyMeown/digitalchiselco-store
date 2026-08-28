/* state.js — single source of truth for parameters + control metadata.
 * The wizard UI is generated from CONTROLS/PANELS so adding a slider never
 * means touching the layout code.
 */

export const DEFAULTS = {
  // profile
  shape: 'Ogee Bell',
  uSegments: 256, vSegments: 140,
  color: '#e9d8a6',
  // dimensions (mm)
  height: 214, topRadius: 120, bottomRadius: 20, baseRadius: 70, majorRadius: 60, tubeRadius: 18,
  // ripples
  lobes: 10, ripple: 0.10, verticalAmp: 0,
  // aperture
  apertureTop: 0, apertureTopFade: 12, apertureBottom: 0, apertureBottomFade: 12,
  // wall / caps / orientation
  wallThickness: 1.6, closeBottom: false, closeTop: false, flipVertical: true,
  // global deformation modifiers (0 = off)
  mod_twist: 0, mod_taper: 0, mod_pinch: 0, mod_bulge: 0, mod_bulgePos: 0.5, mod_ribs: 0, mod_ribsN: 8,
  mod_flute2: 0, mod_flute2N: 18, mod_weave: 0, mod_weaveU: 12, mod_weaveV: 8,
  mod_facet: 0, mod_facetN: 6, mod_squash: 0, mod_emboss: 0, mod_embossFreq: 6, mod_lean: 0,
  // shape-specific
  bellCurve: 1.5, tulipPinch: .3, flareTop: .2, flareBottom: .4, flarePower: 1.2, bulge: .35, bulgePos: .5, bulgeSharpness: .5,
  twistTurns: 1.0, se_power: 4, seTop: 2, seBottom: 8, mobiusWidth: 30, mobiusTwist: 1,
  louverCount: 16, louverTurns: 1, louverDepth: .2, petalAmp: .35, petalBias: .5, petalFalloff: 1.2,
  sf_m: 6, sf_n1: .3, sf_n2: 1.7, sf_n3: 1.7, sf_gain: .6, hy_twist: .75, og_pow: 1.6, og_bias: 0,
  poly_sides: 6, poly_round: 4, weave_amp: .25, weave_nu: 10, weave_mv: 6, weave_phase: 0,
  na_gain: .4, na_turns: 1.25, na_bias: 0, cat_a: .35, cat_gain: .35, cat_bias: 0,
  pag_tiers: 4, pag_gain: .2, pag_fillet: .08, pag_bias: 0, star_amp: .25, star_n: 8, star_pow: 4,
  g_amp: .35, g_rings: 3, g_sigma: .18, g_petn: 8, g_petamp: .2,
  bz_r1: 80, bz_r2: 40, bz_p1: 0.33, bz_p2: 0.66, sp_r1: 60, sp_r2: 55, sp_r3: 65, sp_tens: 0,
  hg_waist: .4, hg_pow: 1.0, bel_amp: .2, bel_mv: 8, cf_count: 12, cf_depth: .25, cf_fade: .35, cf_fade_bottom: 0,
  ts_mid: .5, ts_width: .35, sh_rib_amp: .2, sh_rib_mv: 8, ell_ecc: 1.4, ell_rot: .25, tiltX: 0, tiltY: 0,
  sc_amp: .25, sc_n: 16, sc_width: .12, fr_steps: 12, fr_amp: .18, ap_topN: 8, ap_botN: 12,
  td_h: .35, td_bulge: .3, hc_amp: .18, hc_turns: 1.0, hc_width: .25,
  org_amp: .25, org_u: 12, org_v: 10, org_oct: 4, org_lac: 2.0, org_gain: 0.5, org_warp: .3, org_mid: .55, org_width: .35,
  cs_gain: .45, cs_turns: 1.4, cs_ribs: 18, cs_amp: .18, cs_width: .25, bl_amp: .28, bl_n: 12, bl_width: .22,
  // fitter
  fitEnable: true, fitType: 'E27', bore: 40, hubWall: 3, hubH: 12,
  spokeCount: 3, spokeW: 6, spokeT: 4, rimWall: 3, rimH: 8, rimClearance: 0.4, fitSeg: 72,
  fitPosition: 'bottom', spokeStyle: 'Straight', spokeTurns: 0.5, bayonet: false,
  // custom profile (draw / image-trace), two-tone blend, lithophane, bulb clearance, seam
  customProfile: null, blendShape: 'off', blendAmt: 0,
  lithoOn: false, lithoAmp: 2.2, lithoInvert: false, lithoData: null, lithoMode: 'Wrap', lithoTile: 2,
  textOn: false, textStr: '', textData: null, textV: 0.5, textBand: 0.2, textDepth: 1.4, textStyle: 'Glow', textRepeat: 1, textArc: 0, textSpacing: 0,
  bulb: 'none', seamHint: false, litPreview: false, layerH: 0.2,
  // printer bed (mm) — drives the build-plate grid and oversize warnings
  bedPreset: 'Ender 3 (220×220×250)', bedX: 220, bedY: 220, bedZ: 250,
};

/* control descriptor: [key, label, min, max, step]  (booleans/selects handled separately) */
export const CONTROLS = {
  torus: [['majorRadius', 'Major radius', 20, 200, 1], ['tubeRadius', 'Tube radius', 4, 60, .5]],
  ripples: [['lobes', 'Flute count', 2, 64, 1], ['ripple', 'Flute depth', 0, .8, .01], ['verticalAmp', 'Vertical wave', 0, 60, .5]],
  aperture: [['apertureTop', 'Top opening min', 0, 150, 1], ['apertureTopFade', 'Top fade', 0, 100, 1], ['apertureBottom', 'Bottom opening min', 0, 150, 1], ['apertureBottomFade', 'Bottom fade', 0, 100, 1]],
  bell: [['bellCurve', 'Bell curve', .2, 4, .05]],
  superformula: [['sf_m', 'Symmetry m', 1, 20, 1], ['sf_n1', 'n1', .1, 10, .05], ['sf_n2', 'n2', .1, 10, .05], ['sf_n3', 'n3', .1, 10, .05], ['sf_gain', 'Gain', 0, 1.5, .01]],
  bulge: [['bulge', 'Bulge', 0, 1, .01], ['bulgePos', 'Bulge position', 0, 1, .01], ['bulgeSharpness', 'Sharpness', 0, 1, .01]],
  tulip: [['tulipPinch', 'Waist pinch', 0, .95, .01], ['flareTop', 'Top flare', 0, 1, .01], ['flareBottom', 'Bottom flare', 0, 1, .01], ['flarePower', 'Flare power', .2, 4, .05]],
  twist: [['twistTurns', 'Twist turns', 0, 3, .01]],
  superellipse: [['se_power', 'Squareness', 2, 16, .1]],
  semorph: [['seTop', 'Top squareness', 2, 12, .1], ['seBottom', 'Bottom squareness', 2, 12, .1]],
  mobius: [['mobiusWidth', 'Band width', 10, 100, 1], ['mobiusTwist', 'Twist', .5, 3, .1]],
  louvers: [['louverCount', 'Louvers', 3, 64, 1], ['louverTurns', 'Turns', 0, 6, .05], ['louverDepth', 'Depth', 0, .45, .01]],
  petal: [['petalAmp', 'Petal depth', 0, .8, .01], ['petalBias', 'Bias', 0, 1, .01], ['petalFalloff', 'Falloff', .1, 4, .05]],
  hyperboloid: [['hy_twist', 'Twist turns', 0, 2, .01]],
  ogee: [['og_pow', 'S power', .2, 5, .05], ['og_bias', 'Bias', -.5, .5, .01]],
  polygon: [['poly_sides', 'Sides', 3, 24, 1], ['poly_round', 'Roundness', .5, 20, .1]],
  weave: [['weave_amp', 'Amplitude', 0, .6, .01], ['weave_nu', 'Horizontal freq', 1, 48, 1], ['weave_mv', 'Vertical freq', 1, 24, 1], ['weave_phase', 'Phase', 0, 6.283, .01]],
  nautilus: [['na_gain', 'Growth', -1, 1, .01], ['na_turns', 'Turns', 0, 4, .01], ['na_bias', 'Bias', -.5, .5, .01]],
  catenary: [['cat_a', 'Curve a', .05, 1, .01], ['cat_gain', 'Gain', -1, 1, .01], ['cat_bias', 'Bias', -.4, .4, .01]],
  pagoda: [['pag_tiers', 'Tiers', 2, 12, 1], ['pag_gain', 'Ledge', -.5, .8, .01], ['pag_fillet', 'Fillet', 0, .3, .005], ['pag_bias', 'Bias', -.4, .4, .01]],
  star: [['star_amp', 'Amplitude', 0, .9, .01], ['star_n', 'Points', 3, 48, 1], ['star_pow', 'Point power', 1, 16, .1]],
  gourd: [['g_amp', 'Bulge', 0, .9, .01], ['g_rings', 'Rings', 1, 8, 1], ['g_sigma', 'Width', .02, .5, .01], ['g_petn', 'Petal lobes', 0, 24, 1], ['g_petamp', 'Petal amp', 0, .9, .01]],
  bezier: [['bz_r1', 'Control r1', 5, 300, 1], ['bz_r2', 'Control r2', 5, 300, 1], ['bz_p1', 'Position 1', 0, 1, .01], ['bz_p2', 'Position 2', 0, 1, .01]],
  spline: [['sp_r1', 'R @25%', 5, 300, 1], ['sp_r2', 'R @50%', 5, 300, 1], ['sp_r3', 'R @75%', 5, 300, 1], ['sp_tens', 'Tension', 0, 1, .01]],
  hourglass: [['hg_waist', 'Waist ratio', .05, 1, .01], ['hg_pow', 'Curve power', .2, 3, .01]],
  bellow: [['bel_amp', 'Amplitude', 0, .6, .01], ['bel_mv', 'Rings', 1, 24, 1]],
  crownflutes: [['cf_count', 'Flutes', 2, 64, 1], ['cf_depth', 'Depth', 0, .6, .01], ['cf_fade', 'Top fade', 0, 1, .01], ['cf_fade_bottom', 'Bottom fade', 0, 1, .01]],
  twiststar: [['ts_mid', 'Mid', 0, 1, .01], ['ts_width', 'Width', .05, .8, .01]],
  shellribs: [['sh_rib_amp', 'Rib amp', 0, .6, .01], ['sh_rib_mv', 'Rib freq', 1, 48, 1]],
  ellipse: [['ell_ecc', 'Eccentricity', 1, 3, .01], ['ell_rot', 'Rotation turns', 0, 2, .01]],
  tilt: [['tiltX', 'Lean X', -120, 120, 1], ['tiltY', 'Lean Y', -120, 120, 1]],
  scallop: [['sc_amp', 'Amplitude', 0, .6, .01], ['sc_n', 'Lobes', 3, 96, 1], ['sc_width', 'Width', .01, .4, .01]],
  fresnel: [['fr_steps', 'Steps', 3, 64, 1], ['fr_amp', 'Amplitude', 0, .6, .01]],
  asympetals: [['ap_topN', 'Top lobes', 1, 24, 1], ['ap_botN', 'Bottom lobes', 1, 24, 1]],
  truncdome: [['td_h', 'Cut height', .05, .95, .01], ['td_bulge', 'Bulge', 0, .8, .01]],
  helicalcrown: [['hc_amp', 'Amplitude', 0, .6, .01], ['hc_turns', 'Turns', 0, 3, .01], ['hc_width', 'Width', .05, .6, .01]],
  organic: [['org_amp', 'Amplitude', 0, .9, .01], ['org_u', 'Horizontal freq', 1, 48, 1], ['org_v', 'Vertical freq', 1, 48, 1], ['org_oct', 'Octaves', 1, 8, 1], ['org_lac', 'Lacunarity', 1.1, 3.5, .01], ['org_gain', 'Gain', .1, .95, .01], ['org_warp', 'Warp', 0, 1, .01], ['org_mid', 'Mid', 0, 1, .01], ['org_width', 'Width', .02, .6, .01]],
  conch: [['cs_gain', 'Growth', 0, 1, .01], ['cs_turns', 'Turns', 0, 4, .01], ['cs_ribs', 'Ribs', 0, 48, 1], ['cs_amp', 'Rib amp', 0, .9, .01], ['cs_width', 'Width', .02, .6, .01]],
  bloom: [['bl_amp', 'Amplitude', 0, .9, .01], ['bl_n', 'Lobes', 3, 48, 1], ['bl_width', 'Width', .02, .6, .01]],
  fitter: [['hubWall', 'Hub wall', 1, 10, .5], ['hubH', 'Hub height', 4, 40, 1], ['spokeCount', 'Spokes', 2, 8, 1], ['spokeW', 'Spoke width', 1, 20, .5], ['spokeT', 'Web thickness', 1, 12, .5], ['rimWall', 'Rim wall', 1, 10, .5], ['rimClearance', 'Seat clearance', 0, 2, .05]],
  blend: [['blendAmt', 'Blend amount', 0, 1, .01]],
  litho: [['lithoAmp', 'Relief depth (mm)', 0.5, 5, .1]],
  text: [['textV', 'Height', 0, 1, .01], ['textBand', 'Band height', 0.05, 0.6, .01], ['textDepth', 'Depth (mm)', 0.3, 3, .1], ['textArc', 'Curve baseline', -1, 1, .02], ['textSpacing', 'Letter spacing', 0, 40, 1], ['textRepeat', 'Repeat around', 1, 8, 1]],
  modifiers: [['mod_twist', 'Twist °', -360, 360, 1], ['mod_taper', 'Taper', -0.8, 0.8, .01], ['mod_pinch', 'Waist / barrel', -0.6, 0.8, .01], ['mod_bulge', 'Bulge', -0.5, 0.8, .01], ['mod_bulgePos', 'Bulge pos', 0, 1, .01], ['mod_ribs', 'Horizontal ribs', 0, 0.4, .01], ['mod_ribsN', 'Rib count', 1, 40, 1], ['mod_flute2', 'Extra flutes', 0, 0.4, .01], ['mod_flute2N', 'Flute count', 2, 64, 1], ['mod_weave', 'Weave interlace', 0, 0.4, .01], ['mod_weaveU', 'Weave around', 2, 48, 1], ['mod_weaveV', 'Weave up', 1, 48, 1], ['mod_facet', 'Facet', 0, 1, .01], ['mod_facetN', 'Facet sides', 3, 20, 1], ['mod_squash', 'Squash (oval)', 0, 0.8, .01], ['mod_emboss', 'Emboss', 0, 0.5, .01], ['mod_embossFreq', 'Emboss freq', 1, 24, 1], ['mod_lean', 'Lean (mm)', -100, 100, 1]],
};

/* which size controls a shape actually reads */
const BASE_SHAPES = new Set(['Pleated Cylinder', 'Lantern Bulge', 'Tulip Flare', 'Twisted Ribbon', 'Superellipse Drum', 'Squared Drum', 'Superellipse Morph', 'Superformula Cylinder',
  // extended vessels that use baseRadius
  'Amphora', 'Urn', 'Baluster', 'Beaker', 'Round Flask', 'Bottle', 'Carafe', 'Light Bulb', 'Mushroom', 'Saucer', 'Bell Jar', 'Capsule', 'Lens', 'Oblate', 'Spinning Top', 'Bicone']);
export function sizeKeys(shape) {
  if (shape === 'Wavy Torus') return [['majorRadius', 'Major radius', 20, 200, 1], ['tubeRadius', 'Tube radius', 4, 60, .5]];
  if (shape === 'Möbius Ribbon') return [['baseRadius', 'Radius', 10, 240, 1], ['mobiusWidth', 'Band width', 10, 100, 1]];
  const h = ['height', 'Height', 40, 400, 1];
  if (BASE_SHAPES.has(shape)) return [h, ['baseRadius', 'Radius', 10, 240, 1]];
  return [h, ['topRadius', 'Top radius', 5, 200, 1], ['bottomRadius', 'Bottom radius', 5, 300, 1]];
}

export const PRESETS = {
  'Ogee pendant': { shape: 'Ogee Bell', height: 214, topRadius: 120, bottomRadius: 20, lobes: 12, ripple: 0.08, og_pow: 1.8, fitType: 'E27', bore: 40, spokeCount: 3 },
  'Fluted drum': { shape: 'Pleated Cylinder', height: 140, baseRadius: 80, lobes: 28, ripple: 0.06, fitType: 'E27', bore: 40, spokeCount: 4 },
  'Tulip uplight': { shape: 'Tulip Flare', height: 170, baseRadius: 60, tulipPinch: 0.35, flareTop: 0.5, flareBottom: 0.1, fitPosition: 'bottom', fitType: 'E14', bore: 28, spokeCount: 3 },
  'Faceted gem': { shape: 'Polygon Drum', height: 150, topRadius: 55, bottomRadius: 80, poly_sides: 8, poly_round: 3, ripple: 0, fitType: 'E27', bore: 40, spokeCount: 4 },
  'Nautilus': { shape: 'Nautilus Spiral', height: 150, topRadius: 45, bottomRadius: 85, na_gain: 0.5, na_turns: 1.6, lobes: 16, ripple: 0.05 },
  'Organic vase': { shape: 'Organic FBM', height: 180, topRadius: 55, bottomRadius: 70, org_amp: 0.3, org_u: 9, org_v: 7 },
};

/* User presets persisted in localStorage (a "history" of saved presets) */
const LSKEY = 'vls_user_presets';
export function userPresets() { try { return JSON.parse(localStorage.getItem(LSKEY) || '{}'); } catch (_) { return {}; } }
export function saveUserPreset(name, P) { const all = userPresets(); all[name] = { ...P }; try { localStorage.setItem(LSKEY, JSON.stringify(all)); } catch (_) { } }
export function deleteUserPreset(name) { const all = userPresets(); delete all[name]; try { localStorage.setItem(LSKEY, JSON.stringify(all)); } catch (_) { } }

/* URL <-> params */
export function loadFromURL(P) {
  const p = new URLSearchParams(location.search);
  if (![...p.keys()].length) return;
  for (const [k, v] of p.entries()) {
    if (!(k in P)) continue;
    if (P[k] !== null && typeof P[k] === 'object') continue;   // skip customProfile / lithoData
    if (typeof P[k] === 'boolean') P[k] = v === 'true';
    else if (typeof P[k] === 'number') P[k] = isFinite(+v) ? +v : P[k];
    else P[k] = v;
  }
}
export function saveToURL(P) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(P)) { if (v === null || typeof v === 'object') continue; p.set(k, v); }
  try { history.replaceState(null, '', '?' + p.toString()); } catch (_) { }
  return p.toString();
}
