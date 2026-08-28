/* main.js — scene, worker orchestration, rebuild pipeline, export.
 * Z-up throughout (matches slicer print orientation); the camera's up axis
 * is set to +Z so the model previews upright without rotating any geometry.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/OrbitControls';
import { DEFAULTS, PRESETS, loadFromURL, saveToURL, userPresets, saveUserPreset, deleteUserPreset } from './state.js';
import { FITTINGS } from './mesh-core.js';
import { toBinarySTL, toAsciiSTL, toOBJ, download, weld, to3MF, meshVolume } from './exporters.js';
import { buildGuidePDF } from './guide-pdf.js';
import { initUI } from './ui.js';

/* DEMO MODE — full design playground, but exports/print-guide open a purchase
 * modal instead of downloading. Enable with ?demo=1 or window.VLS_DEMO=true
 * (set by the embedding page on digitalchiselco.com). */
const DEMO = /[?&]demo=1/.test(location.search) || window.VLS_DEMO === true;
const ETSY_URL = new URLSearchParams(location.search).get('buy') || window.VLS_BUY_URL || 'https://www.digitalchiselco.com/lamp-studio';
function showUpsell() {
  let m = document.getElementById('upsell');
  if (!m) {
    m = document.createElement('div'); m.id = 'upsell';
    m.innerHTML = `<div class="up-card">
      <div class="up-glyph">◑</div>
      <h2>You designed it — now print it</h2>
      <p>This free playground includes all 105 shapes, modifiers, lithophane &amp; text.
      The full studio unlocks:</p>
      <ul>
        <li>Watertight <b>STL / OBJ / 3MF</b> export of your exact design</li>
        <li>The built-in <b>E27/E14 fitter</b> &amp; one-piece vase-mode files</li>
        <li>A tailored <b>PDF print guide</b> with computed slicer settings</li>
        <li>Offline desktop app + illustrated manual</li>
      </ul>
      <a class="up-buy" href="${ETSY_URL}" target="_blank" rel="noopener">Get the full studio →</a>
      <button class="up-close">Keep designing</button>
    </div>`;
    document.body.appendChild(m);
    m.addEventListener('click', e => { if (e.target === m || e.target.classList.contains('up-close')) m.style.display = 'none'; });
  }
  m.style.display = 'flex';
}

const viewport = document.getElementById('viewport');
const errEl = document.getElementById('errorMsg');
const showErr = m => { errEl.style.display = 'flex'; errEl.textContent = m; };
const clampi = (x, a, b) => Math.min(b, Math.max(a, Math.round(x)));

/* ---- three setup ---- */
let R, S, A, O, hemiL, keyL, fillL;
try {
  R = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  R.setPixelRatio(Math.min(2, devicePixelRatio || 1));
  R.setClearColor(0x0c1119, 1);
  viewport.appendChild(R.domElement);
  S = new THREE.Scene();
  A = new THREE.PerspectiveCamera(45, 1, 1, 6000);
  A.up.set(0, 0, 1);
  A.position.set(320, -340, 260);
  O = new OrbitControls(A, R.domElement);
  O.enableDamping = true; O.dampingFactor = 0.08;
  hemiL = new THREE.HemisphereLight(0xbcd0ff, 0x202430, 0.7); S.add(hemiL);
  keyL = new THREE.DirectionalLight(0xffffff, 1.1); keyL.position.set(300, -200, 500); S.add(keyL);
  fillL = new THREE.DirectionalLight(0x8899ff, 0.5); fillL.position.set(-300, 200, 100); S.add(fillL);
} catch (e) { showErr('WebGL init failed: ' + e.message); throw e; }

/* Build plate sized to the printer bed (updateBed rebuilds it): a rectangular
 * grid at z=0 plus a faint volume outline showing the printable height. */
let bedGroup = null;
export const BED_PRESETS = {
  'Ender 3 (220×220×250)': [220, 220, 250],
  'Ender 3 Max (300×300×340)': [300, 300, 340],
  'Prusa MK4 (250×210×220)': [250, 210, 220],
  'Bambu A1/P1/X1 (256×256×256)': [256, 256, 256],
  'Bambu A1 mini (180×180×180)': [180, 180, 180],
  'Kobra 2 (220×220×250)': [220, 220, 250],
  'CR-10 (300×300×400)': [300, 300, 400],
  'Custom': null,
};
function updateBed() {
  if (bedGroup) { bedGroup.traverse(o => o.geometry && o.geometry.dispose()); S.remove(bedGroup); }
  bedGroup = new THREE.Group();
  const X = Math.max(50, +P.bedX || 220), Y = Math.max(50, +P.bedY || 220), Z = Math.max(50, +P.bedZ || 250);
  const stepLines = [], hx = X / 2, hy = Y / 2, step = 20;
  for (let x = -hx; x <= hx + 0.01; x += step) stepLines.push(x, -hy, 0, x, hy, 0);
  for (let y = -hy; y <= hy + 0.01; y += step) stepLines.push(-hx, y, 0, hx, y, 0);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(stepLines, 3));
  bedGroup.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x1b2536 })));
  // bed border (brighter) + printable-height volume edges
  const border = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-hx, -hy, 0), new THREE.Vector3(hx, -hy, 0), new THREE.Vector3(hx, hy, 0), new THREE.Vector3(-hx, hy, 0), new THREE.Vector3(-hx, -hy, 0)]);
  bedGroup.add(new THREE.Line(border, new THREE.LineBasicMaterial({ color: 0x3b4f74 })));
  const vol = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(X, Y, Z)),
    new THREE.LineBasicMaterial({ color: 0x2b3a52, transparent: true, opacity: 0.4 }));
  vol.position.z = Z / 2; bedGroup.add(vol);
  S.add(bedGroup);
}
/* does the current model fit the bed? returns null or a warning string */
function bedFitWarning() {
  if (!shadeMeta) return null;
  const d = shadeMeta.maxRadius * 2, h = shadeMeta.height;
  const over = [];
  if (d > Math.min(+P.bedX, +P.bedY)) over.push(`Ø${d.toFixed(0)} mm footprint exceeds the ${P.bedX}×${P.bedY} mm bed`);
  if (h > +P.bedZ) over.push(`${h.toFixed(0)} mm height exceeds the ${P.bedZ} mm print height`);
  return over.length ? over.join('; ') + '.' : null;
}
const glow = new THREE.PointLight(0xffdca8, 0, 1200, 2); // warm bulb glow, lit when fitter present
S.add(glow);

/* ---- state ---- */
const P = { ...DEFAULTS };
const hadURL = new URLSearchParams(location.search).toString().length > 0;
loadFromURL(P);
if (!hadURL) Object.assign(P, PRESETS['Ogee pendant']);   // default preset on a fresh load
if (P.textOn && P.textStr) P.textData = textToLum(P.textStr);   // regenerate embossed text after reload

/* ---- materials ---- */
const shadeMat = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(P.color), roughness: .72, metalness: .02, side: THREE.DoubleSide, transmission: 0, thickness: 2, ior: 1.45 });
const fitMat = new THREE.MeshStandardMaterial({ color: 0x9fb2c9, roughness: .5, metalness: .3, side: THREE.DoubleSide, flatShading: true });

let shadeMesh = null, shadeMeta = null;
let fitterMeshes = [], fitterParts = [];   // parts = {positions,indices} in each fitter's own z0 frame

/* ---- bulb-clearance + seam preview ---- */
const BULBS = { none: null, A15: { d: 47, l: 90 }, A19: { d: 60, l: 112 }, ST64: { d: 64, l: 140 }, G25: { d: 80, l: 120 }, G95: { d: 95, l: 135 } };
const bulbMat = new THREE.MeshStandardMaterial({ color: 0xffe6a8, emissive: 0xffb84d, emissiveIntensity: .5, transparent: true, opacity: .28, roughness: .3 });
let bulbMesh = null, seamLine = null;
function updateBulb() {
  if (bulbMesh) { bulbMesh.geometry.dispose(); S.remove(bulbMesh); bulbMesh = null; }
  const b = BULBS[P.bulb]; if (!b || !shadeMeta) return;
  const g = new THREE.SphereGeometry(1, 32, 24); g.scale(b.d / 2, b.d / 2, b.l / 2);
  bulbMesh = new THREE.Mesh(g, bulbMat);
  const H = shadeMeta.height, atBottom = P.fitPosition === 'bottom';
  bulbMesh.position.set(0, 0, atBottom ? (b.l / 2 + 6) : (H - b.l / 2 - 6));  // base at the fitter, extends into shade
  S.add(bulbMesh);
}
function updateSeam() {
  if (seamLine) { seamLine.geometry.dispose(); S.remove(seamLine); seamLine = null; }
  if (!P.seamHint || !shadeMeta) return;
  const n = Math.max(1, Math.floor(P.lobes)), a = Math.PI / n;   // a flute valley angle
  const H = shadeMeta.height, r = shadeMeta.maxRadius * 1.02;
  const pts = [new THREE.Vector3(r * Math.cos(a), r * Math.sin(a), 0), new THREE.Vector3(r * Math.cos(a), r * Math.sin(a), H)];
  seamLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x57d38c }));
  S.add(seamLine);
}
function bulbClearance() {
  const b = BULBS[P.bulb]; if (!b || !shadeMeta) return null;
  return (shadeMeta.stats.minRadius - (P.wallThickness || 0) - b.d / 2);
}

/* ---- image helpers (lithophane + silhouette trace) ---- */
function fileToImage(file) { return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = URL.createObjectURL(file); }); }
function imageToLum(img, w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const cx = c.getContext('2d'); cx.drawImage(img, 0, 0, w, h);
  const d = cx.getImageData(0, 0, w, h).data, lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) lum[i] = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
  return { w, h, data: lum };
}
function lumToProfile(lum, N) {
  const { w, h, data } = lum, prof = new Float32Array(N);
  for (let n = 0; n < N; n++) {
    const t = n / (N - 1), y = Math.min(h - 1, Math.round((1 - t) * (h - 1)));
    let minX = w, maxX = -1;
    for (let x = 0; x < w; x++) if (data[y * w + x] < 0.5) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
    prof[n] = maxX >= minX ? (maxX - minX) / 2 : 0;
  }
  let mx = 0; for (const r of prof) if (r > mx) mx = r;
  const scale = mx > 0 ? (P.bottomRadius / mx) : 1, out = [];
  for (let i = 0; i < N; i++) out.push(Math.max(3, prof[i] * scale));
  return out;
}
function textToLum(str) {
  const s = String(str || ''), H = 200, font = '700 84px Inter, Arial, sans-serif';
  const spacing = P.textSpacing || 0, arc = P.textArc || 0;
  const meas = document.createElement('canvas').getContext('2d'); meas.font = font;
  const ws = [...s].map(ch => meas.measureText(ch).width);
  const total = ws.reduce((a, b) => a + b, 0) + spacing * Math.max(0, s.length - 1);
  const W = Math.max(160, Math.min(2000, Math.ceil(total) + 90));
  const c = document.createElement('canvas'); c.width = W; c.height = H; const cx = c.getContext('2d');
  cx.fillStyle = '#000'; cx.fillRect(0, 0, W, H);
  cx.fillStyle = '#fff'; cx.font = font; cx.textAlign = 'center'; cx.textBaseline = 'middle';
  const arcA = arc * H * 0.34;                       // baseline arch amplitude (px)
  let x = (W - total) / 2;
  for (let i = 0; i < s.length; i++) {
    const cxp = x + ws[i] / 2, f = cxp / W, u = 2 * (f - 0.5);   // -1..1 across width
    const yoff = -arcA * (1 - u * u);                            // parabolic arch, peak at centre
    cx.save(); cx.translate(cxp, H / 2 + yoff); cx.rotate(Math.atan2(-arcA * 2 * u, W / 2)); cx.fillText(s[i], 0, 0); cx.restore();
    x += ws[i] + spacing;
  }
  const d = cx.getImageData(0, 0, W, H).data, lum = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) lum[i] = d[i * 4] / 255;
  return { w: W, h: H, data: lum };
}
/* Lit-glow preview: make the shade translucent + a bright inner bulb, so
 * lithophane/text relief shows as brightness (transmission = thinner is brighter). */
function applyLitPreview() {
  const on = !!P.litPreview;
  shadeMat.transmission = on ? 0.9 : 0;
  shadeMat.thickness = Math.max(0.6, P.wallThickness || 1.6);
  shadeMat.roughness = on ? 0.35 : 0.72;
  shadeMat.needsUpdate = true;
  if (hemiL) hemiL.intensity = on ? 0.1 : 0.7;
  if (keyL) keyL.intensity = on ? 0.22 : 1.1;
  if (fillL) fillL.intensity = on ? 0.08 : 0.5;
  glow.intensity = on ? 3.4 : ((P.fitEnable && shadeMeta) ? 1.1 : 0);
  R.setClearColor(on ? 0x04060a : 0x0c1119, 1);
}

/* ---- worker ---- */
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
let jobId = 0;
const pending = new Map();
worker.onmessage = (e) => {
  const { id, ok } = e.data;
  const cb = pending.get(id); if (!cb) return; pending.delete(id);
  cb(e.data);
};
function build(type, payload) {
  return new Promise((res, rej) => {
    const id = ++jobId;
    pending.set(id, d => d.ok ? res(d) : rej(new Error(d.error)));
    worker.postMessage({ id, type, ...payload });
  });
}

function geomFrom(positions, indices) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setIndex(new THREE.BufferAttribute(indices, 1));
  g.computeVertexNormals();
  g.computeBoundingBox();
  return g;
}

/* ---- rebuild shade ---- */
let uiRef = null;
let buildGen = 0;   // guards against stale async builds landing out of order
async function rebuildShade() {
  const gen = ++buildGen;
  try {
    const r = await build('shade', { P: { ...P } });
    if (gen !== buildGen) return;                    // superseded by a newer rebuild
    if (shadeMesh) { shadeMesh.geometry.dispose(); S.remove(shadeMesh); }
    const g = geomFrom(r.positions.slice(), r.indices.slice());
    shadeMesh = new THREE.Mesh(g, shadeMat);
    S.add(shadeMesh);
    shadeMeta = r.meta;
    shadeMeta._raw = { positions: r.positions, indices: r.indices };
    frameCamera(r.meta.height, r.meta.maxRadius);
    await rebuildFitter(gen);
    if (gen !== buildGen) return;
    updateBulb(); updateSeam();
    if (P.litPreview) applyLitPreview();
    reportStats();
  } catch (e) { showErr('Shade build failed: ' + e.message); }
}

/* ---- rebuild fitter ---- */
function fitterConfigs() {
  if (!P.fitEnable || !shadeMeta) return [];
  const bore = FITTINGS[P.fitType] ?? P.bore;
  const base = { bore, hubWall: P.hubWall, hubH: P.hubH, spokeCount: P.spokeCount, spokeW: P.spokeW, spokeT: P.spokeT, rimWall: P.rimWall, rimH: P.rimH, rimClearance: P.rimClearance, seg: P.fitSeg, spokeStyle: P.spokeStyle, spokeTurns: P.spokeTurns, bayonet: P.bayonet };
  const list = [];
  const wantBot = P.fitPosition === 'bottom';
  const wantTop = !wantBot;   // top or bottom only
  // rim follows the opening curve; hub+spokes stay flat/horizontal (toward base plane).
  const minR = ring => { let m = Infinity; for (const r of ring.R) if (r < m) m = r; return m; };
  if (wantTop) list.push({ ...base, ring: shadeMeta.topRing, dir: -1, _where: 'top', _openR: minR(shadeMeta.topRing) });
  if (wantBot) list.push({ ...base, ring: shadeMeta.bottomRing, dir: +1, _where: 'bottom', _openR: minR(shadeMeta.bottomRing) });
  return list;
}
let fitterWarning = '';
async function rebuildFitter(gen) {
  if (gen == null) gen = ++buildGen;
  fitterMeshes.forEach(m => { m.geometry.dispose(); S.remove(m); });
  fitterMeshes = []; fitterParts = []; fitterWarning = '';
  const cfgs = fitterConfigs();
  for (const F of cfgs) {
    const r = await build('fitter', { F });
    if (gen !== buildGen) return;                   // superseded — never add a stale fitter
    if (r.vanished) {                               // opening too small for the bulb holder
      fitterWarning = `The ${F._where} opening (Ø${(2 * F._openR).toFixed(0)} mm) is smaller than the ${P.fitType} holder ring (Ø${(2 * (F.bore / 2 + F.hubWall)).toFixed(0)} mm) — fitter omitted there.`;
      continue;
    }
    const g = geomFrom(r.positions.slice(), r.indices.slice());
    const m = new THREE.Mesh(g, fitMat);            // already in world coords
    S.add(m); fitterMeshes.push(m);
    fitterParts.push({ positions: r.positions, indices: r.indices, zRef: r.meta.zRef, dir: r.meta.dir });
  }
  glow.intensity = (P.fitEnable && shadeMeta) ? 1.1 : 0;
  if (shadeMeta) glow.position.set(0, 0, shadeMeta.height * 0.5);
}

/* ---- camera framing ---- */
let framedOnce = false;
function frameCamera(h, r) {
  O.target.set(0, 0, h / 2);
  const d = Math.max(h, r * 2) * 1.6;
  O.maxDistance = d * 4;
  if (!framedOnce) { A.position.set(d * .8, -d * .9, h * .7 + d * .3); framedOnce = true; }
  O.update();
}

/* ---- stats to UI ---- */
function reportStats() {
  if (!uiRef || !shadeMeta) return;
  uiRef.updateStats({
    height: shadeMeta.height, top: shadeMeta.topRadius * 2, bottom: shadeMeta.bottomRadius * 2,
    tris: shadeMeta.tris + fitterParts.reduce((a, p) => a + p.indices.length / 3, 0),
    minRadius: shadeMeta.stats.minRadius, overhang: shadeMeta.stats.maxOverhangDeg, clean: shadeMeta.stats.printsClean,
    fitter: fitterParts.length, bore: FITTINGS[P.fitType] ?? P.bore, warning: fitterWarning,
    fitterThin: fitterParts.length > 0 && (P.spokeT < 3 || P.hubH < 6),
    bulb: P.bulb, clearance: bulbClearance(),
    bedWarn: bedFitWarning(), bed: `${P.bedX}×${P.bedY}×${P.bedZ}`,
    ...estimateCost(),
  });
}

/* ---- material / cost estimate (PLA ≈ 1.24 g/cm³) ---- */
function estimateCost() {
  if (!shadeMeta || !shadeMeta._raw) return { grams: 0, hours: 0 };
  let mm3 = meshVolume(shadeMeta._raw);
  for (const p of fitterParts) mm3 += meshVolume(p);
  const grams = mm3 / 1000 * 1.24;
  return { grams, hours: grams / 11 };   // rough: ~11 g/h for a thin-walled print
}

/* ---- export ---- */
function shadePart() { return shadeMeta && shadeMeta._raw ? [shadeMeta._raw] : []; }
/* Orient a top-mount fitter (dir<0) so its coplanar face lands on the bed and
 * every part rises from it -> prints support-free. 180° rotation about X through
 * zRef (proper rotation, preserves winding). Bottom-mount fitters print as-is. */
function printOrientFitter() {
  return fitterParts.map(p => {
    const pos = p.positions.slice();
    if (p.dir < 0) { const zr = p.zRef; for (let i = 0; i < pos.length; i += 3) { pos[i + 1] = -pos[i + 1]; pos[i + 2] = 2 * zr - pos[i + 2]; } }
    return { positions: pos, indices: p.indices };
  });
}
function floorParts(parts) {
  // shift a set of parts together so their lowest point sits on z = 0
  let minZ = Infinity;
  for (const p of parts) for (let i = 2; i < p.positions.length; i += 3) if (p.positions[i] < minZ) minZ = p.positions[i];
  if (!isFinite(minZ) || minZ === 0) return parts;
  return parts.map(p => { const pos = p.positions.slice(); for (let i = 2; i < pos.length; i += 3) pos[i] -= minZ; return { positions: pos, indices: p.indices }; });
}
function exportModel(which, fmt) {
  if (DEMO) { showUpsell(); return; }
  // The shade geometry is exactly what the preview shows: a watertight thin-walled
  // shell when Wall thickness > 0 (openings preserved), or a single-wall vase
  // surface when 0. weld() orients everything outward and removes redundant faces.
  let parts = [], name = 'lampshade';
  const solid = (P.wallThickness || 0) > 0;
  if (which === 'shade') { parts = shadePart(); name = solid ? 'shade' : 'shade_vase'; }
  else if (which === 'fitter') { parts = floorParts(printOrientFitter()); name = 'fitter_' + P.fitType; }
  else if (which === 'plated') {
    // shade + fitter side by side on the plate for a single print job, printed separately
    const shade = shadePart(), fit = floorParts(printOrientFitter());
    const dx = (shadeMeta ? shadeMeta.maxRadius : 60) + (shadeMeta ? shadeMeta.maxRadius : 60) + 30;
    const fitShift = fit.map(p => { const pos = p.positions.slice(); for (let i = 0; i < pos.length; i += 3) pos[i] += dx; return { positions: pos, indices: p.indices }; });
    parts = [...shade, ...fitShift]; name = 'lamp_plated';
  }
  else { parts = [...shadePart(), ...fitterParts.map(p => ({ positions: p.positions, indices: p.indices }))]; name = 'lamp_combined'; }
  if (!parts.length || !parts[0]) { showErr('Nothing to export yet.'); return; }
  if (fmt === '3mf') {                                   // keep each part a separate object
    const objs = parts.map(p => weld([p]));
    download(to3MF(objs, name), name + '.3mf'); return;
  }
  const clean = [weld(parts)];
  const blob = fmt === 'obj' ? toOBJ(clean, name) : fmt === 'ascii' ? toAsciiSTL(clean, name) : toBinarySTL(clean);
  download(blob, name + (fmt === 'obj' ? '.obj' : '.stl'));
}

/* ---- change routing (debounced) ---- */
const FIT_KEYS = new Set(['fitEnable', 'fitType', 'bore', 'hubWall', 'hubH', 'spokeCount', 'spokeW', 'spokeT', 'rimWall', 'rimH', 'rimClearance', 'fitSeg', 'fitPosition', 'spokeStyle', 'spokeTurns', 'bayonet']);
let shadeTimer = null, fitTimer = null;
function scheduleShade() { clearTimeout(shadeTimer); shadeTimer = setTimeout(rebuildShade, 60); }
function scheduleFit() { clearTimeout(fitTimer); fitTimer = setTimeout(() => { rebuildFitter().then(() => { updateBulb(); reportStats(); }); }, 40); }

/* Structured print-guide content. The KEY insight the guide teaches:
 * A combined shade+fitter STL CAN print in VASE MODE — put the fitter at the
 * bottom, set Bottom shell layers = ring height / layer height so the slicer
 * prints the fitter fully solid, then it spiralizes the shade above on its own.
 */
function guideSections() {
  const m = shadeMeta || {}, lh = +P.layerH || 0.2;
  const solid = (P.wallThickness || 0) > 0;
  const bore = FITTINGS[P.fitType] ?? P.bore;
  const ringH = P.hubH || 12;
  const botLayers = Math.ceil(ringH / lh);
  const perMM = Math.round(1 / lh);
  const spokeLayers = Math.round((P.spokeT || 4) / lh);
  const S = [];
  S.push({ type: 'h1', n: 'YOUR MODEL', text: 'Model summary' });
  S.push({ type: 'kv', labW: 150, rows: [
    ['SHADE', `${P.shape} - ${(m.height||0).toFixed(0)} mm tall, O ${((m.bottomRadius||0)*2).toFixed(0)} bottom / O ${((m.topRadius||0)*2).toFixed(0)} top`],
    ['WALL', solid ? `${(+P.wallThickness).toFixed(1)} mm watertight shell` : 'single wall (vase surface)'],
    ['FITTER', P.fitEnable && fitterParts.length ? `${P.fitType} (${bore} mm bore), ${P.spokeCount} x ${P.spokeStyle} spokes, at ${P.fitPosition}` : 'none'],
    ['RING HEIGHT', `${ringH} mm`],
    ['LAYER HEIGHT', `${lh} mm  (${perMM} layers per mm)`],
  ]});
  const hasFit = P.fitEnable && fitterParts.length > 0;

  if (hasFit && P.fitPosition === 'bottom') {
    S.push({ type: 'h1', n: 'OPTION A - RECOMMENDED', text: 'Combined STL in Vase mode (one piece)' });
    S.push({ type: 'p', text: 'The whole lamp prints as a single spiralized piece. This works because the fitter sits at the BOTTOM: the slicer prints the first stretch fully solid (covering the bulb-holder ring), then switches to the single-wall vase spiral for the shade above - automatically.' });
    S.push({ type: 'big', label: 'CALCULATED FOR THIS MODEL', text: `Bottom shell layers = ${ringH} mm / ${lh} mm = ${botLayers} layers` });
    S.push({ type: 'p', text: `At ${lh} mm layer height, ${perMM} layers make 1 mm - so the ${ringH} mm bulb-holder ring needs ${botLayers} solid bottom layers. Above layer ${botLayers}, Orca continues in vase mode by itself.` });
    S.push({ type: 'h2', text: 'Slicer settings (Orca / Bambu / Prusa / Cura)' });
    S.push({ type: 'kv', labW: 170, rows: [
      ['FILE', 'lamp_combined.stl'],
      ['MODE', 'Vase mode ON  (Orca: "Spiral vase" - Cura: "Spiralize Outer Contour")'],
      ['BOTTOM SHELL LAYERS', `${botLayers}   (= ring ${ringH} mm / ${lh} mm layer)`],
      ['TOP SHELL LAYERS', '0'],
      ['SPARSE INFILL', '0 %'],
      ['SUPPORTS', 'None - the fitter web sits flat on the plate'],
      ['BOTTOM SURFACE', '100 % density, Monotonic'],
    ]});
    S.push({ type: 'call', kind: 'note', label: 'Why this works', text: 'In vase mode the slicer still prints "Bottom shell layers" as fully solid layers before starting the spiral. Setting them to the exact height of the bulb-holder ring makes the whole fitter print solid, and the shade above prints as a clean single-wall spiral. No supports, no seams, one continuous print.' });
  } else if (hasFit) {
    S.push({ type: 'h1', n: 'OPTION A', text: 'Combined STL - move the fitter to the bottom first' });
    S.push({ type: 'p', text: 'Your fitter is at the TOP. A one-piece vase-mode print needs it at the BOTTOM (so the solid bottom layers can cover it). On the Fitter step set Position = bottom, re-export the combined STL, then re-download this guide for the exact numbers.' });
  }

  S.push({ type: 'h1', n: 'OPTION B', text: 'Separate parts (best surface quality)' });
  S.push({ type: 'h2', text: solid ? 'Shade - watertight shell' : 'Shade - vase surface' });
  S.push({ type: 'kv', labW: 170, rows: solid ? [
    ['MODE', 'Normal (Spiralize OFF)'],
    ['WALLS / PERIMETERS', '2'],
    ['TOP SHELL LAYERS', '0'],
    ['BOTTOM SHELL LAYERS', P.closeBottom ? '3 (solid base)' : '0 (open bottom)'],
    ['SPARSE INFILL', '0 %'],
    ['SUPPORTS', 'None'],
  ] : [
    ['MODE', 'Vase / Spiralize ON'],
    ['BOTTOM SHELL LAYERS', '3-5 (bed adhesion)'],
    ['TOP SHELL LAYERS', '0'],
    ['SPARSE INFILL', '0 %'],
    ['WALL', 'set by line width - 0.8-1.2 mm looks great'],
    ['SUPPORTS', 'None'],
  ]});
  if (hasFit) {
    S.push({ type: 'h2', text: 'Fitter - bulb holder' });
    S.push({ type: 'kv', labW: 170, rows: [
      ['MODE', 'Normal (never vase for a LONE fitter)'],
      ['WALLS / PERIMETERS', '3-4  (or 2 walls + 20 % infill)'],
      ['TOP / BOTTOM LAYERS', '3 / 3'],
      ['SUPPORTS', 'None (designed flat)'],
      ['SPOKE THICKNESS', `${P.spokeT} mm = ~${spokeLayers} layers${P.spokeT < 3 ? '  ! thin - raise to 3 mm+' : ''}`],
    ]});
    S.push({ type: 'call', kind: 'warn', label: 'Vase mode and the lone fitter', text: 'A fitter printed ON ITS OWN must use normal mode - in vase mode a flat solid only prints its first few layers. Vase mode is fine for the COMBINED file (Option A), because there the fitter is covered by the solid bottom layers.' });
  }

  S.push({ type: 'h1', n: 'FINISH', text: 'Assembly & safety' });
  S.push({ type: 'steps', items: [
    'If printed separately: drop the fitter into the shade opening - the shade rests on its rim.',
    'Thread the lamp socket through the hub ring and secure with the socket ring.',
    'Fit an LED bulb (LED only - incandescent and halogen run far too hot for printed plastic).',
    'Keep 30 mm or more between bulb and wall. Prefer PETG near any warmth.',
    'Use rated lamp hardware - the printed fitter carries the shade, not the electricity.',
  ]});
  return S;
}
function printGuideText() {   // plain-text fallback of the same content
  const NL = String.fromCharCode(10);
  return guideSections().map(s => {
    if (s.type === 'h1') return NL + '=== ' + s.text.toUpperCase() + ' ===';
    if (s.type === 'h2') return '-- ' + s.text;
    if (s.type === 'p' || s.type === 'call') return s.text;
    if (s.type === 'big') return '>> ' + s.text + ' <<';
    if (s.type === 'kv') return s.rows.map(r => '  ' + r[0] + ': ' + r[1]).join(NL);
    if (s.type === 'steps') return s.items.map((it, i) => '  ' + (i + 1) + '. ' + it).join(NL);
    return '';
  }).join(NL);
}

const app = {
  P, PRESETS,
  setParam(key, val) {
    P[key] = val;
    if (key === 'color') { shadeMat.color.set(val); saveToURL(P); return; }
    if (key === 'bulb') { updateBulb(); reportStats(); saveToURL(P); return; }        // preview-only
    if (key === 'seamHint') { updateSeam(); saveToURL(P); return; }                    // preview-only
    if (key === 'litPreview') { applyLitPreview(); saveToURL(P); return; }             // preview-only
    if (key === 'layerH') { P.layerH = +val; uiRef && uiRef.refresh(); saveToURL(P); return; }  // guide-only
    if (key === 'bedPreset') { const d = BED_PRESETS[val]; if (d) { P.bedX = d[0]; P.bedY = d[1]; P.bedZ = d[2]; } updateBed(); reportStats(); uiRef && uiRef.refresh(); saveToURL(P); return; }
    if (key === 'bedX' || key === 'bedY' || key === 'bedZ') { P[key] = +val; P.bedPreset = 'Custom'; updateBed(); reportStats(); saveToURL(P); return; }
    if ((key === 'textArc' || key === 'textSpacing') && P.textOn && P.textStr) P.textData = textToLum(P.textStr);
    if (key === 'fitType') P.bore = FITTINGS[val] ?? P.bore;
    FIT_KEYS.has(key) ? scheduleFit() : scheduleShade();
    saveToURL(P);
  },
  applyPreset(name) {
    const user = userPresets();
    const pr = user[name] || PRESETS[name]; if (!pr) return;
    if (user[name]) Object.assign(P, DEFAULTS, pr);   // user preset = full snapshot
    else Object.assign(P, pr);                         // built-in = partial overrides
    shadeMat.color.set(P.color);
    uiRef && uiRef.refresh();
    rebuildShade(); saveToURL(P);
  },
  presetGroups() { return { builtin: Object.keys(PRESETS), user: Object.keys(userPresets()) }; },
  getUserPresets() { return userPresets(); },
  saveNamedPreset(name) { if (!name) return; const snap = { ...P }; delete snap.lithoData; delete snap.textData; saveUserPreset(name, snap); },
  deletePreset(name) { deleteUserPreset(name); },
  reset() { Object.assign(P, DEFAULTS); shadeMat.color.set(P.color); uiRef && uiRef.refresh(); rebuildShade(); saveToURL(P); },
  resetModifiers() { for (const k of Object.keys(P)) if (k.startsWith('mod_')) P[k] = DEFAULTS[k]; rebuildShade(); saveToURL(P); },
  optimize() {
    if (!shadeMeta) return;
    const notes = [];
    // 1) resolution scaled to size (smooth but not wasteful)
    const around = Math.round(clampi(shadeMeta.maxRadius * 3.2, 160, 400) / 8) * 8;
    if (P.uSegments !== around) { P.uSegments = around; notes.push(`resolution ${around}×${Math.max(120, Math.min(200, Math.round(shadeMeta.height / 1.1)))}`); }
    P.vSegments = clampi(Math.round(shadeMeta.height / 1.1), 120, 220);
    // 2) flat base + upright for a stable vase print
    P.flipVertical = true; if (!P.closeBottom) { P.closeBottom = true; notes.push('flat base on'); }
    // 3) heal thin walls (min radius) by scaling the radius params up
    if (shadeMeta.stats.minRadius < 8) {
      const f = 9 / Math.max(0.5, shadeMeta.stats.minRadius);
      for (const k of ['topRadius', 'bottomRadius', 'baseRadius', 'majorRadius']) P[k] = Math.min(300, P[k] * f);
      notes.push('widened thin walls');
    }
    // 4) ease steep overhang (support-free): relax global taper/bulge and deep flutes
    if (shadeMeta.stats.maxOverhangDeg > 55) {
      P.mod_taper *= 0.5; P.mod_bulge *= 0.5; P.ripple = Math.min(P.ripple, 0.15);
      notes.push('eased overhang');
    }
    // 5) make the fitter actually fit: pick the largest standard bore that fits, else shrink hub, else disable
    if (P.fitEnable) {
      const openR = Math.min(...shadeMeta.topRing.R, ...(P.fitPosition !== 'top' ? shadeMeta.bottomRing.R : [Infinity]));
      const holderOuter = t => (FITTINGS[t] / 2) + P.hubWall;
      const order = ['E27', 'GU10', 'E14'];
      const fit = order.find(t => openR - P.rimClearance >= holderOuter(t) + 2);
      if (fit) { if (P.fitType !== fit) { P.fitType = fit; P.bore = FITTINGS[fit]; notes.push(`fitting → ${fit}`); } }
      else if (openR - P.rimClearance >= FITTINGS.E14 / 2 + 1.5 + 2) { P.fitType = 'E14'; P.bore = FITTINGS.E14; P.hubWall = 1.5; notes.push('fitting → E14, slim hub'); }
      else { P.fitEnable = false; notes.push('fitter disabled (opening too small)'); }
    }
    shadeMat.color.set(P.color);
    uiRef && uiRef.refresh();
    rebuildShade(); saveToURL(P);
    const el = document.getElementById('optNote'); if (el) el.textContent = notes.length ? 'Optimized: ' + notes.join(', ') + '.' : 'Already print-optimal.';
  },
  export: exportModel,
  bedPresets() { return Object.keys(BED_PRESETS); },
  /* One click: widen the mounting opening just enough for the selected holder,
   * so a vanished fitter re-appears. Scales the radius of the mounting end. */
  fitOpening() {
    if (!shadeMeta) return;
    const bore = FITTINGS[P.fitType] ?? P.bore;
    const required = bore / 2 + P.hubWall + P.rimClearance + 4;   // ring outer + vanish-rule margin + rim room
    const ring = P.fitPosition === 'bottom' ? shadeMeta.bottomRing : shadeMeta.topRing;
    let cur = Infinity; for (const r of ring.R) if (r < cur) cur = r;
    if (!isFinite(cur) || cur < 1) cur = 1;
    if (cur >= required) { reportStats(); return; }
    const f = (required / cur) * 1.03;
    const keys = P.fitPosition === 'bottom' ? ['bottomRadius', 'baseRadius'] : ['topRadius', 'baseRadius'];
    for (const k of keys) P[k] = Math.min(300, Math.round(P[k] * f * 10) / 10);
    uiRef && uiRef.refresh(); rebuildShade(); saveToURL(P);
  },
  fitterMissing() { return P.fitEnable && fitterParts.length === 0 && !!shadeMeta; },
  printGuide: printGuideText,
  downloadGuide() {
    if (DEMO) { showUpsell(); return; }
    try {
      const meta = {
        title: 'Print Guide',
        subtitle: `${P.shape} lampshade` + (P.fitEnable && fitterParts.length ? ` with ${P.fitType} fitter` : ''),
        date: new Date().toISOString().slice(0, 10) + '  -  tailored to this model',
      };
      download(buildGuidePDF(guideSections(), meta), 'PRINT_GUIDE.pdf');
    } catch (e) { console.warn('PDF guide failed, falling back to txt', e); download(new Blob([printGuideText()], { type: 'text/plain' }), 'PRINT_GUIDE.txt'); }
  },
  async loadLithoImage(file) { try { const img = await fileToImage(file); const w = 220, hh = Math.max(40, Math.round(w * img.height / img.width)); P.lithoData = imageToLum(img, w, hh); P.lithoOn = true; if ((P.wallThickness || 0) <= 0) P.wallThickness = 0.9; if (P.uSegments < 300) P.uSegments = 360; if (P.vSegments < 200) P.vSegments = 220; uiRef && uiRef.refresh(); rebuildShade(); saveToURL(P); } catch (e) { showErr('Image load failed'); } },
  clearLitho() { P.lithoOn = false; P.lithoData = null; uiRef && uiRef.refresh(); rebuildShade(); saveToURL(P); },
  async loadSilhouette(file) { try { const img = await fileToImage(file); const lum = imageToLum(img, 140, 220); P.customProfile = lumToProfile(lum, 56); P.shape = 'Custom Profile'; uiRef && uiRef.refresh(); rebuildShade(); saveToURL(P); } catch (e) { showErr('Image load failed'); } },
  setCustomProfile(arr) { P.customProfile = arr.slice(); if (P.shape !== 'Custom Profile') { P.shape = 'Custom Profile'; uiRef && uiRef.refresh(); } rebuildShade(); saveToURL(P); },
  getCustomProfile() { if (P.customProfile && P.customProfile.length) return P.customProfile.slice(); const N = 24, a = []; for (let i = 0; i < N; i++) a.push(P.topRadius + (P.bottomRadius - P.topRadius) * (i / (N - 1))); return a; },
  setText(str) { P.textStr = str; P.textData = str ? textToLum(str) : null; P.textOn = !!str; if (P.textOn && (P.wallThickness || 0) <= 0) P.wallThickness = 1.6; uiRef && uiRef.refresh(); rebuildShade(); saveToURL(P); },
  setLitPreview(on) { P.litPreview = on; applyLitPreview(); saveToURL(P); },
  bulbClearance,
  setupCombined() { P.fitPosition = 'bottom'; if ((P.wallThickness || 0) <= 0) P.wallThickness = 1.6; shadeMat.color.set(P.color); uiRef && uiRef.refresh(); rebuildShade(); saveToURL(P); },
  copyShareURL() { const qs = saveToURL(P); navigator.clipboard?.writeText(location.origin + location.pathname + '?' + qs); },
  savePreset() { download(new Blob([JSON.stringify(P, null, 2)], { type: 'application/json' }), 'lamp-preset.json'); },
  loadPreset(obj) { for (const k in obj) if (k in P) P[k] = obj[k]; shadeMat.color.set(P.color); uiRef && uiRef.refresh(); rebuildShade(); saveToURL(P); },
  toggleWireframe(on) { shadeMat.wireframe = on; fitMat.wireframe = on; },
  showFitterOnly(on) { if (shadeMesh) shadeMesh.visible = !on; },
};

uiRef = initUI(app);
/* Beauty render for marketing: transparent background, no grid/bed/gizmos,
 * dedicated camera + hi-res offscreen renderer. Returns a PNG data URL. */
window.__hero = (w = 1400, h = 1750, o = {}) => {
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setPixelRatio(1); r.setSize(w, h); r.setClearColor(0x000000, 0);
  const cam = new THREE.PerspectiveCamera(o.fov || 34, w / h, 1, 8000); cam.up.set(0, 0, 1);
  const H = shadeMeta ? shadeMeta.height : 150, R0 = shadeMeta ? shadeMeta.maxRadius : 80;
  const d = (o.dist || 2.45) * Math.max(H, R0 * 2);
  const az = (o.az ?? 35) * Math.PI / 180, el = (o.el ?? 16) * Math.PI / 180;
  cam.position.set(d * Math.cos(el) * Math.cos(az), d * Math.cos(el) * Math.sin(az), H * 0.46 + d * Math.sin(el));
  cam.lookAt(0, 0, H * 0.46);
  const hide = [bedGroup, seamLine, bulbMesh].filter(Boolean).map(ob => { const v = ob.visible; ob.visible = false; return [ob, v]; });
  const keep = { tr: shadeMat.transmission, ro: shadeMat.roughness, em: shadeMat.emissive.getHex(), ei: shadeMat.emissiveIntensity, gi: glow.intensity, hi: hemiL.intensity, ki: keyL.intensity };
  if (o.look === 'glow') {           // warm milky lantern look for marketing shots
    shadeMat.transmission = 0.72; shadeMat.roughness = 0.5;
    shadeMat.emissive.setHex(0xC98B26); shadeMat.emissiveIntensity = 0.42; shadeMat.needsUpdate = true;
    glow.intensity = 5.5; hemiL.intensity = 0.25; keyL.intensity = 0.5;
  }
  r.render(S, cam);
  const url = r.domElement.toDataURL('image/png');
  hide.forEach(([ob, v]) => ob.visible = v);
  shadeMat.transmission = keep.tr; shadeMat.roughness = keep.ro; shadeMat.emissive.setHex(keep.em);
  shadeMat.emissiveIntensity = keep.ei; shadeMat.needsUpdate = true;
  glow.intensity = keep.gi; hemiL.intensity = keep.hi; keyL.intensity = keep.ki;
  r.dispose();
  return url;
};
window.__capture = (maxW = 640) => {                       // downscaled PNG data URI for the manual
  R.render(S, A); const src = R.domElement, sc = Math.min(1, maxW / src.width);
  const c = document.createElement('canvas'); c.width = Math.round(src.width * sc); c.height = Math.round(src.height * sc);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', 0.82);
};

/* preset file loader */
const presetFile = document.getElementById('presetFile');
presetFile && presetFile.addEventListener('change', e => {
  const f = e.target.files && e.target.files[0]; if (!f) return;
  const rd = new FileReader();
  rd.onload = () => { try { app.loadPreset(JSON.parse(rd.result)); } catch (_) { showErr('Invalid preset JSON'); } };
  rd.readAsText(f); e.target.value = '';
});

/* ---- render loop + resize ---- */
function resize() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  R.setSize(w, h, false); A.aspect = w / Math.max(1, h); A.updateProjectionMatrix();
}
window.addEventListener('resize', resize); resize();
(function animate() { requestAnimationFrame(animate); O.update(); R.render(S, A); })();

updateBed();
rebuildShade();
applyLitPreview();
if (DEMO) {
  const hb = document.getElementById('hintbar');
  if (hb) hb.innerHTML = '<span class="demo-badge">FREE PLAYGROUND</span> <a class="demo-link" href="' + ETSY_URL + '" target="_blank" rel="noopener">Get the full studio with STL export →</a>';
}
