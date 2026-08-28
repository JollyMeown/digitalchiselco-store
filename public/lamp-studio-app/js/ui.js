/* ui.js — the step-wise wizard. Generated from state.js metadata so the
 * layout never hard-codes individual sliders.
 */
import { CONTROLS, sizeKeys, PRESETS, DEFAULTS } from './state.js';
import { SHAPE_GROUPS, SHAPE_PANELS, SHAPE_LIST, surf, makeCtx } from './shapes.js';

/* tiny SVG silhouette of a shape for the gallery chips */
const thumbCache = new Map();
function thumbSVG(name) {
  if (thumbCache.has(name)) return thumbCache.get(name);
  let svg;
  try {
    const tp = { ...DEFAULTS, shape: name, ripple: 0, verticalAmp: 0, lobes: 4 }, ctx = makeCtx(tp), N = 24, pts = [];
    let maxR = 1e-6, minZ = 1e9, maxZ = -1e9;
    for (let i = 0; i <= N; i++) { const p = surf(tp, 0.001, i / N, ctx); const r = Math.hypot(p[0], p[1]); pts.push([r, p[2]]); if (r > maxR) maxR = r; if (p[2] < minZ) minZ = p[2]; if (p[2] > maxZ) maxZ = p[2]; }
    const H = (maxZ - minZ) || 1, W = 28, Hh = 30, cx = 16;
    const X = r => cx + (r / maxR) * 13, Y = z => 1 + (1 - (z - minZ) / H) * (Hh - 2);
    let d = 'M' + pts.map(([r, z]) => X(r).toFixed(1) + ',' + Y(z).toFixed(1)).join(' L');
    for (let i = pts.length - 1; i >= 0; i--) { const [r, z] = pts[i]; d += ' L' + (cx - (r / maxR) * 13).toFixed(1) + ',' + Y(z).toFixed(1); }
    d += ' Z';
    svg = `<svg viewBox="0 0 ${W + 4} ${Hh + 2}" width="30" height="30" class="thumb"><path d="${d}"/></svg>`;
  } catch (_) { svg = '<svg width="30" height="30" class="thumb"></svg>'; }
  thumbCache.set(name, svg); return svg;
}

/* transient file picker */
function pickFile(accept) { return new Promise(res => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = accept; inp.onchange = () => res(inp.files && inp.files[0]); inp.click(); }); }

const PANEL_TITLES = {
  ripples: 'Flutes / ripples', aperture: 'Openings', torus: 'Torus', bell: 'Bell curve', superformula: 'Superformula',
  bulge: 'Bulge', tulip: 'Tulip', twist: 'Twist', superellipse: 'Superellipse', semorph: 'Superellipse morph',
  mobius: 'Möbius', louvers: 'Louvers', petal: 'Petals', hyperboloid: 'Hyperboloid', ogee: 'Ogee S-curve',
  polygon: 'Polygon', weave: 'Basket weave', nautilus: 'Nautilus', catenary: 'Catenary', pagoda: 'Pagoda tiers',
  star: 'Star / rosette', gourd: 'Gourd', bezier: 'Bézier profile', spline: 'Spline profile', hourglass: 'Hourglass',
  bellow: 'Bellows', crownflutes: 'Crown flutes', twiststar: 'Twisted star', shellribs: 'Shell ribs', ellipse: 'Ellipse',
  tilt: 'Lean', scallop: 'Scalloped hem', fresnel: 'Fresnel rings', asympetals: 'Asymmetric petals', truncdome: 'Truncated dome',
  helicalcrown: 'Helical crown', organic: 'Organic noise', conch: 'Conch', bloom: 'Bloom',
  modifiers: 'Global modifiers',
};

/* Tooltips shown on hover (title attr). Keyed by param key. */
const TIPS = {
  shape: 'The base silhouette. Pick a family, then refine it in Detail.',
  uSegments: 'Facets around the shade. Higher = smoother, heavier mesh.',
  vSegments: 'Rings up the height. Higher = smoother curves, heavier mesh.',
  height: 'Overall height of the shade in mm.',
  topRadius: 'Radius of the TOP opening (away from the grid).',
  bottomRadius: 'Radius of the BOTTOM opening — the one that sits on the grid.',
  baseRadius: 'Nominal radius of the shade wall.',
  lobes: 'Number of vertical flutes/ripples around the shade.',
  ripple: 'Depth of the flutes. 0 = smooth.',
  verticalAmp: 'Adds a vertical wave to the surface.',
  flipVertical: 'Keeps the wider bottom opening on the build plate for a stable print.',
  wallThickness: 'Wall thickness in mm. >0 = watertight thin-walled solid with open ends (normal-mode print, fitter fits). 0 = single-wall surface for Spiralize / Vase mode.',
  closeBottom: 'Fills the bottom opening with a solid floor (table lamp). Off = open for light.',
  closeTop: 'Caps the top opening. Off = open so the fitter/socket passes through.',
  fitEnable: 'Generate a lamp-holder fitter that seats into the shade opening.',
  fitType: 'Bulb-holder standard. Sets the ring bore (E27=40, E14=28, GU10=36 mm).',
  fitPosition: 'Which opening the fitter mounts into.',
  spokeStyle: 'Shape of the arms joining the bulb ring to the shade rim.',
  spokeCount: 'How many arms support the bulb holder.',
  spokeW: 'Width of each arm.',
  spokeT: 'Thickness (height) of each arm.',
  rimWall: 'Thickness of the seating rim band.',
  rimClearance: 'Gap between the rim and the shade wall so it seats without splitting the print.',
  mod_twist: 'Spins the profile around its axis as it rises — a helical twist.',
  mod_taper: 'Narrows (−) or widens (+) the top relative to the bottom.',
  mod_pinch: 'Pinches a waist (+) or swells a barrel (−) at mid-height.',
  mod_bulge: 'Pushes a local band out (+) or in (−) — set its height with Bulge pos.',
  mod_bulgePos: 'Height of the bulge, 0 = bottom, 1 = top.',
  mod_ribs: 'Horizontal ribs/rings up the height (like bellows).',
  mod_ribsN: 'Number of horizontal ribs.',
  mod_flute2: 'A second set of vertical flutes on top of the profile.',
  mod_flute2N: 'Number of flutes in the extra set.',
  bedPreset: 'Pick your printer to size the build-plate grid; choose Custom to edit the dimensions freely.',
  bedX: 'Printable bed length (X). The grid and oversize warning follow it.',
  bedY: 'Printable bed width (Y).',
  bedZ: 'Maximum print height (Z), shown as the faint volume box.',
  layerH: 'Your slicer’s layer height. The guide uses it to compute the exact solid Bottom-layer count for the one-piece vase print (ring height ÷ layer height).',
  textArc: 'Curves the text baseline into an arch (up) or valley (down); letters rotate to follow it.',
  textSpacing: 'Extra space between letters.',
  mod_weave: 'Over-under basket interlace — adjacent cells bulge out/in like woven strands.',
  mod_weaveU: 'Weave cells around the circumference.',
  mod_weaveV: 'Weave cells up the height.',
  mod_facet: 'Blends the round cross-section toward a faceted polygon.',
  mod_facetN: 'Number of facets when Facet > 0.',
  mod_squash: 'Squashes the circle into an oval cross-section.',
  mod_emboss: 'Organic noise embossed into the surface.',
  mod_embossFreq: 'Scale of the emboss noise.',
  mod_lean: 'Leans the shade sideways (mm of offset top-to-bottom).',
};

const h = (tag, attrs = {}, kids = []) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  (Array.isArray(kids) ? kids : [kids]).forEach(c => c != null && e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
  return e;
};

export function initUI(app) {
  const P = app.P;
  const panel = document.getElementById('panel');
  const bindings = [];   // {key, apply()} for refresh()

  /* -------- reusable controls -------- */
  function slider([key, label, min, max, step]) {
    const num = h('input', { type: 'number', class: 'num', min, max, step, value: P[key] });
    const rng = h('input', { type: 'range', min, max, step, value: P[key] });
    const commit = v => { v = Math.min(max, Math.max(min, +v)); num.value = v; rng.value = v; app.setParam(key, v); };
    rng.addEventListener('input', () => { num.value = rng.value; app.setParam(key, +rng.value); });
    num.addEventListener('change', () => commit(num.value));
    bindings.push({ key, apply: () => { num.value = P[key]; rng.value = P[key]; } });
    const tip = TIPS[key] ? { title: TIPS[key] } : {};
    return h('div', { class: 'ctl', ...tip }, [h('label', {}, label), h('div', { class: 'inp' }, [rng, num])]);
  }
  function selectCtrl(key, label, options) {
    const sel = h('select', { onchange: e => app.setParam(key, e.target.value) },
      options.map(o => h('option', { value: o, ...(String(P[key]) === o ? { selected: 'selected' } : {}) }, o)));
    bindings.push({ key, apply: () => { sel.value = P[key]; } });
    const tip = TIPS[key] ? { title: TIPS[key] } : {};
    return h('div', { class: 'ctl', ...tip }, [h('label', {}, label), h('div', { class: 'inp' }, [sel])]);
  }
  function toggle(key, label, onChange) {
    const cb = h('input', { type: 'checkbox', ...(P[key] ? { checked: 'checked' } : {}) });
    cb.addEventListener('change', () => { app.setParam(key, cb.checked); onChange && onChange(cb.checked); });
    bindings.push({ key, apply: () => { cb.checked = !!P[key]; } });
    const tip = TIPS[key] ? { title: TIPS[key] } : {};
    return h('label', { class: 'switch', ...tip }, [cb, h('span', {}, label)]);
  }
  function group(title, kids) { return h('div', { class: 'grp' }, [h('div', { class: 'grp-h' }, title), ...kids]); }

  /* -------- step 1: profile (preset + size + shape) -------- */
  function presetRow() {
    const g = app.presetGroups();
    const opt = n => h('option', { value: n }, n);
    const sel = h('select', { onchange: e => { if (e.target.value) app.applyPreset(e.target.value); } });
    sel.appendChild(h('option', { value: '' }, 'Load preset…'));
    if (g.builtin.length) sel.appendChild(h('optgroup', { label: 'Starter presets' }, g.builtin.map(opt)));
    if (g.user.length) sel.appendChild(h('optgroup', { label: 'Saved (history)' }, g.user.map(opt)));
    const saveBtn = h('button', { class: 'ex', title: 'Save the current settings as a named preset (kept in this browser).', onclick: () => { const n = prompt('Save preset as:'); if (n && n.trim()) { app.saveNamedPreset(n.trim()); renderBody(); } } }, '💾 Save');
    const importBtn = h('button', { class: 'ex', title: 'Import a preset .json file.', onclick: () => document.getElementById('presetFile').click() }, '📂 Import');
    return h('div', {}, [
      h('div', { class: 'ctl' }, [h('label', {}, 'Preset'), h('div', { class: 'inp' }, [sel])]),
      h('div', { class: 'exrow' }, [saveBtn, importBtn]),
    ]);
  }
  function stepProfile() {
    const wrap = h('div', { class: 'shape-groups' });
    SHAPE_GROUPS.forEach(g => {
      wrap.appendChild(h('div', { class: 'sg-title' }, g.group));
      const grid = h('div', { class: 'sg-grid' });
      g.items.forEach(name => {
        grid.appendChild(h('button', {
          class: 'chip' + (P.shape === name ? ' on' : ''), 'data-shape': name,
          html: thumbSVG(name) + '<span class="chip-l">' + name + '</span>',
          onclick: () => { P.shape = name; app.setParam('shape', name); renderBody(); }
        }));
      });
      wrap.appendChild(grid);
    });
    const saved = app.getUserPresets ? app.getUserPresets() : {}, savedNames = Object.keys(saved);
    const savedGal = savedNames.length ? group('Saved presets', [(() => {
      const grid = h('div', { class: 'sg-grid' });
      savedNames.forEach(nm => grid.appendChild(h('div', { class: 'saved-chip' }, [
        h('button', { class: 'chip', html: thumbSVG(saved[nm].shape || 'Ogee Bell') + '<span class="chip-l">' + nm + '</span>', onclick: () => app.applyPreset(nm) }),
        h('button', { class: 'del', title: 'Delete preset', onclick: () => { app.deletePreset(nm); renderBody(); } }, '×'),
      ])));
      return grid;
    })()]) : null;
    return h('div', {}, [
      group('Preset', [presetRow()]),
      ...(savedGal ? [savedGal] : []),
      group('Overall size (mm)', sizeKeys(P.shape).map(slider)),
      group('Orientation', [
        h('div', { class: 'row' }, [toggle('flipVertical', 'Bottom opening on the grid')]),
        h('p', { class: 'hint' }, 'Keeps the wider bottom opening on the build plate for a stable print. Turn off to flip the shade over.'),
      ]),
      group('Shape family', [wrap]),
    ]);
  }

  /* draggable radius-vs-height profile editor */
  function profileEditor() {
    const N = 16, W = 300, Hh = 180, pad = 14, RMAX = 160;
    let src = app.getCustomProfile(), prof = [];
    for (let i = 0; i < N; i++) { const x = i / (N - 1) * (src.length - 1), j = Math.floor(x), f = x - j; prof.push(src[j] * (1 - f) + src[Math.min(src.length - 1, j + 1)] * f); }
    const cv = h('canvas', { width: W, height: Hh, class: 'profed' }), cx = cv.getContext('2d');
    const py = i => Hh - pad - (i / (N - 1)) * (Hh - 2 * pad);
    const hx = r => (r / RMAX) * (W - 2 * pad) / 2;
    function draw() {
      cx.clearRect(0, 0, W, Hh); cx.strokeStyle = '#ffffff14'; cx.lineWidth = 1;
      for (let g = 0; g <= 4; g++) { const x = pad + g / 4 * (W - 2 * pad); cx.beginPath(); cx.moveTo(x, pad); cx.lineTo(x, Hh - pad); cx.stroke(); }
      cx.beginPath(); cx.moveTo(W / 2 + hx(prof[0]), py(0));
      for (let i = 1; i < N; i++) cx.lineTo(W / 2 + hx(prof[i]), py(i));
      for (let i = N - 1; i >= 0; i--) cx.lineTo(W / 2 - hx(prof[i]), py(i));
      cx.closePath(); cx.fillStyle = 'rgba(110,168,255,.18)'; cx.fill(); cx.strokeStyle = '#6ea8ff'; cx.stroke();
      for (let i = 0; i < N; i++) { cx.fillStyle = '#ffce6b'; cx.beginPath(); cx.arc(W / 2 + hx(prof[i]), py(i), 3.5, 0, 7); cx.fill(); }
    }
    draw();
    let drag = -1, tm = null;
    const toR = clientX => { const rc = cv.getBoundingClientRect(), x = (clientX - rc.left) * (W / rc.width); return Math.max(3, Math.min(RMAX, Math.abs((x - W / 2) / ((W - 2 * pad) / 2) * RMAX))); };
    const near = clientY => { const rc = cv.getBoundingClientRect(), y = (clientY - rc.top) * (Hh / rc.height); let b = 0, bd = 1e9; for (let i = 0; i < N; i++) { const d = Math.abs(py(i) - y); if (d < bd) { bd = d; b = i; } } return b; };
    const commit = () => { clearTimeout(tm); tm = setTimeout(() => app.setCustomProfile(prof.slice()), 40); };
    cv.addEventListener('pointerdown', e => { drag = near(e.clientY); prof[drag] = toR(e.clientX); draw(); commit(); cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', e => { if (drag < 0) return; prof[drag] = toR(e.clientX); draw(); commit(); });
    cv.addEventListener('pointerup', () => drag = -1);
    return h('div', {}, [cv, h('p', { class: 'hint' }, 'Drag the dots to shape the silhouette (radius vs height; bottom at the bottom).')]);
  }
  function blendGroup() {
    const opts = ['off', ...SHAPE_LIST.filter(s => !['Wavy Torus', 'Möbius Ribbon', 'Custom Profile'].includes(s))];
    return group('Two-tone / stacked blend', [selectCtrl('blendShape', 'Blend toward', opts), ...CONTROLS.blend.map(slider),
      h('p', { class: 'hint' }, 'Morphs from this profile (bottom) toward the chosen shape (top).')]);
  }
  function lithoGroup() {
    const kids = [h('div', { class: 'row' }, [toggle('lithoOn', 'Lithophane emboss', () => renderBody())])];
    if (P.lithoOn) {
      kids.push(h('div', { class: 'exrow' }, [
        h('button', { class: 'ex', onclick: async () => { const f = await pickFile('image/*'); if (f) app.loadLithoImage(f); } }, P.lithoData ? '🖼 Replace image' : '🖼 Upload image'),
        ...(P.lithoData ? [h('button', { class: 'ex', onclick: () => app.clearLitho() }, 'Clear')] : []),
      ]));
      if (P.lithoData) {
        kids.push(selectCtrl('lithoMode', 'Wrap mode', ['Wrap', 'Tile', 'Front']));
        if (P.lithoMode === 'Tile') kids.push(slider(['lithoTile', 'Tiles around', 1, 8, 1]));
        kids.push(...CONTROLS.litho.map(slider), h('div', { class: 'row' }, [toggle('lithoInvert', 'Invert')]));
      }
      kids.push(h('p', { class: 'hint' }, 'Dark = thick (blocks light), bright = thin (glows). Auto high resolution; keep base Wall thickness thin (~0.8 mm). Toggle “Lit preview” on the Export step to see it glow.'));
    }
    return group('Lithophane', kids);
  }
  function textGroup() {
    const inp = h('input', { type: 'text', class: 'txtin', value: P.textStr || '', placeholder: 'Name / date…', maxlength: '40' });
    inp.addEventListener('change', () => app.setText(inp.value));
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') app.setText(inp.value); });
    const kids = [h('div', { class: 'ctl' }, [h('label', {}, 'Text'), h('div', { class: 'inp' }, [inp])])];
    if (P.textOn) {
      kids.push(selectCtrl('textStyle', 'Style', ['Glow', 'Raised', 'Engraved']));
      kids.push(...CONTROLS.text.map(slider));
      kids.push(h('p', { class: 'hint' }, 'Wraps around the shade. Glow shows when lit; Raised/Engraved is visible unlit. Uses a solid wall (auto-set).'));
    }
    return group('Text emboss', kids);
  }

  /* -------- step 2: detail -------- */
  function stepDetail() {
    const panels = SHAPE_PANELS[P.shape] || ['ripples'];
    const blocks = [h('div', { class: 'sel-shape' }, [h('span', {}, 'Shape'), h('b', {}, P.shape)])];
    if (P.shape === 'Custom Profile') blocks.push(group('Draw profile', [profileEditor(), h('div', { class: 'exrow' }, [h('button', { class: 'ex', onclick: async () => { const f = await pickFile('image/*'); if (f) app.loadSilhouette(f); } }, '📷 Trace from image')])]));
    blocks.push(...panels.map(pk => {
      const ctrls = (CONTROLS[pk] || []).map(slider);
      return group(PANEL_TITLES[pk] || pk, ctrls.length ? ctrls : [h('p', { class: 'hint' }, 'No extra parameters.')]);
    }));
    if (P.shape !== 'Wavy Torus' && P.shape !== 'Möbius Ribbon') { blocks.push(blendGroup()); blocks.push(lithoGroup()); blocks.push(textGroup()); }
    // Global modifiers apply on top of every profile (skipped for torus/Möbius).
    if (P.shape !== 'Wavy Torus' && P.shape !== 'Möbius Ribbon') {
      blocks.push(group(PANEL_TITLES.modifiers, [
        h('div', { class: 'exrow', style: 'margin-bottom:10px' }, [
          h('button', { class: 'ex', title: 'Set every global modifier back to zero (off).', onclick: () => { app.resetModifiers(); renderBody(); } }, '↺ Reset modifiers'),
        ]),
        h('p', { class: 'hint' }, 'Stack these on any profile. The Export validator re-checks vase-mode printability live.'),
        ...CONTROLS.modifiers.map(slider),
      ]));
    }
    const wrap = h('div', {}, blocks);
    wrap.addEventListener('change', e => { if (e.target.tagName === 'SELECT') setTimeout(renderBody, 0); });   // reveal mode-dependent controls
    return wrap;
  }

  /* -------- step 4: fitter -------- */
  function stepFitter() {
    const body = h('div', {});
    const rebuild = () => {
      body.innerHTML = '';
      body.appendChild(group('Lamp fitting', [
        h('div', { class: 'row' }, [toggle('fitEnable', 'Generate fitter', () => rebuild())]),
        selectCtrl('fitType', 'Fitting', ['E27', 'E14', 'B22', 'GU10', 'Custom']),
        P.fitType === 'Custom' ? slider(['bore', 'Bore Ø', 10, 80, .5]) : h('p', { class: 'hint' }, `Bore Ø fixed to the ${P.fitType} standard (${{ E27: 40, E14: 28, B22: 40, GU10: 36 }[P.fitType]} mm).`),
        selectCtrl('fitPosition', 'Position', ['top', 'bottom']),
      ]));
      if (P.fitEnable) {
        const spokeBlock = [
          selectCtrl('spokeStyle', 'Spoke style', ['Straight', 'Y-branch', 'Spiral', 'Arc', 'Wavy', 'Cross-brace', 'Double', 'Concentric']),
          ...(P.spokeStyle === 'Spiral' || P.spokeStyle === 'Arc' ? [slider(['spokeTurns', P.spokeStyle === 'Spiral' ? 'Coil turns' : 'Arc sweep', 0.1, 2, 0.05])] : []),
          ...CONTROLS.fitter.map(slider),
        ];
        body.appendChild(group('Hub & spokes', spokeBlock));
        body.appendChild(group('Retention', [h('div', { class: 'row' }, [toggle('bayonet', 'Grip nibs in bore')]), h('p', { class: 'hint' }, 'Adds 3 small bumps inside the bore that grip an E27/E14 socket (light twist-lock).')]));
        body.appendChild(h('p', { class: 'hint' }, 'Ring thickness matches the web thickness. Hub, spokes and rim are coplanar and hang toward the base, so the fitter prints flat with no supports. Exports as its own watertight solid.'));
      }
    };
    // re-render only when a SELECT changes (reveals custom bore, etc.) — number
    // inputs also fire 'change' but must not trigger a re-render / focus loss.
    body.addEventListener('change', e => { if (e.target.tagName === 'SELECT') setTimeout(rebuild, 0); });
    rebuild();
    return body;
  }

  /* -------- step 5: print & export -------- */
  let statsEl;
  function stepExport() {
    statsEl = h('div', { class: 'stats' }, 'Building…');
    const exBtn = (label, which, fmt) => h('button', { class: 'ex', onclick: () => app.export(which, fmt) }, label);
    return h('div', {}, [
      statsEl,
      group('Print mode & wall', [
        slider(['wallThickness', 'Wall thickness (mm)', 0, 4, 0.1]),
        h('p', { class: 'hint', html: (P.wallThickness > 0
          ? '<b>Watertight shell</b> — a real thin-walled solid with open ends (top for the fitter, bottom for light). Print in <b>normal mode</b>: set 2 walls, 0% infill, 0 top layers, no supports. Slicer reports it as a clean closed solid.'
          : '<b>Vase / spiralize</b> — a single continuous wall (0 thickness). Print with <b>Spiralize / Vase mode ON</b>; the slicer makes the wall. Note: slicers list the open rim as "non-manifold" — that is normal for vase mode.') }),
        h('div', { class: 'row' }, [toggle('closeBottom', 'Solid base'), toggle('closeTop', 'Close top')]),
        h('div', { class: 'row' }, [toggle('wireframe', 'Wireframe', on => app.toggleWireframe(on)), toggle('__fitonly', 'Fitter only', on => app.showFitterOnly(on)), toggle('seamHint', 'Seam hint'), toggle('litPreview', '💡 Lit preview')]),
      ]),
      group('Printer bed', [
        selectCtrl('bedPreset', 'Printer', app.bedPresets ? app.bedPresets() : ['Custom']),
        slider(['bedX', 'Bed length X (mm)', 100, 500, 5]),
        slider(['bedY', 'Bed width Y (mm)', 100, 500, 5]),
        slider(['bedZ', 'Print height Z (mm)', 100, 600, 5]),
        h('p', { class: 'hint' }, 'The build-plate grid and the height box in the 3D view match these dimensions. If the model outgrows them, the validator warns you.'),
      ]),
      group('Bulb & clearance', [
        selectCtrl('bulb', 'Check bulb', ['none', 'A15', 'A19', 'ST64', 'G25', 'G95']),
        h('p', { class: 'hint' }, 'Shows the bulb envelope inside the shade and warns if it is too close to the wall. Use LED bulbs.'),
      ]),
      h('div', { class: 'validator', id: 'validator' }, ''),
      group('Print guide', [
        selectCtrl('layerH', 'Layer height (mm)', ['0.1', '0.12', '0.15', '0.2', '0.25', '0.3']),
        h('div', {
          class: 'guidebox', html: (P.fitEnable && P.fitPosition === 'bottom'
            ? `<b>Combined STL in VASE MODE ✓</b> — one continuous piece.<br>· Vase mode <b>ON</b> · Top layers 0 · Infill 0%<br>· <b>Bottom shell layers = ${Math.ceil((P.hubH || 12) / (+P.layerH || 0.2))}</b> ( ring ${P.hubH} mm ÷ ${P.layerH} mm layer ) — the slicer prints the fitter fully solid, then spiralizes the shade above it automatically.`
            : P.fitEnable
              ? '<b>Combined in vase mode</b> needs the fitter at the <b>bottom</b> (so the solid bottom layers cover it). Click below to set it up.'
              : '<b>No fitter</b> — the shade alone prints in vase mode: Vase ON, 3–5 bottom layers, 0 top, 0% infill.')
        }),
        ...(P.fitEnable && P.fitPosition === 'top' ? [h('div', { class: 'exrow' }, [h('button', { class: 'ex', title: 'Move the fitter to the bottom so the combined model prints in one piece, in vase mode, with no supports.', onclick: () => { app.setupCombined(); renderBody(); } }, '⚙ Set up one-piece vase print')])] : []),
        h('div', { class: 'guidebox', html: '<b>Separate parts (best quality):</b> Shade — ' + (P.wallThickness > 0 ? 'Normal, 2 walls, 0 top, 0% infill' : 'Vase/Spiralize ON') + '. Fitter — Normal, 3–4 walls, 3 top/3 bottom, no supports (never vase-mode a lone fitter).' }),
        h('div', { class: 'exrow' }, [h('button', { class: 'ex', title: 'Download a professional PDF settings guide (combined vase print + separate parts), with layer counts computed for this exact model.', onclick: () => app.downloadGuide() }, '📄 Download print guide (PDF)')]),
      ]),
      group('Mesh resolution', [
        slider(['uSegments', 'Around (U)', 64, 512, 1]),
        slider(['vSegments', 'Height (V)', 24, 300, 1]),
        h('p', { class: 'hint' }, 'Higher = smoother but heavier. 256 × 140 is a good print default.'),
      ]),
      group('Export shade' + (P.wallThickness > 0 ? '' : ' (vase)'), [h('div', { class: 'exrow' }, [exBtn('STL', 'shade', 'bin'), exBtn('OBJ', 'shade', 'obj'), exBtn('3MF', 'shade', '3mf')])]),
      group('Export fitter (solid)', [h('div', { class: 'exrow' }, [exBtn('STL', 'fitter', 'bin'), exBtn('OBJ', 'fitter', 'obj'), exBtn('3MF', 'fitter', '3mf')])]),
      group('Export combined', [h('div', { class: 'exrow' }, [exBtn('STL', 'combined', 'bin'), exBtn('OBJ', 'combined', 'obj'), exBtn('3MF', 'combined', '3mf')]), h('p', { class: 'hint' }, 'One fused piece. With the fitter at the bottom it prints in VASE MODE — see the guide for the computed Bottom-layer count.')]),
      group('Export plated (both, side-by-side)', [h('div', { class: 'exrow' }, [exBtn('STL', 'plated', 'bin'), exBtn('3MF', 'plated', '3mf')]), h('p', { class: 'hint' }, 'Shade + fitter apart on one plate. 3MF keeps them as two separate objects for the slicer.')]),
      group('Intelligent tune-up', [
        h('div', { class: 'exrow' }, [
          h('button', { class: 'ex', title: 'Auto-adjust resolution, base, overhang and fitting for a clean support-free vase print — without changing the silhouette.', onclick: () => app.optimize() }, '✨ Optimize for vase'),
        ]),
        h('p', { class: 'hint', id: 'optNote' }, 'Nudges resolution, wall radius, overhang and fitting to print-safe values.'),
      ]),
      group('Project', [h('div', { class: 'exrow' }, [
        h('button', { class: 'ex', title: 'Copy a shareable URL that restores every setting.', onclick: () => app.copyShareURL() }, 'Copy link'),
        h('button', { class: 'ex', title: 'Download the current settings as a JSON preset.', onclick: () => app.savePreset() }, 'Save preset'),
        h('button', { class: 'ex', title: 'Load a previously saved JSON preset.', onclick: () => document.getElementById('presetFile').click() }, 'Load preset'),
        h('button', { class: 'ex danger', title: 'Reset every parameter to defaults.', onclick: () => app.reset() }, 'Reset'),
      ])]),
    ]);
  }

  /* wire the __fitonly + wireframe pseudo-params so setParam doesn't choke */
  const origSet = app.setParam.bind(app);
  app.setParam = (k, v) => { if (k === 'wireframe' || k === '__fitonly') return; origSet(k, v); };

  /* -------- stepper shell -------- */
  const STEPS = [
    { name: 'Profile', render: stepProfile },
    { name: 'Detail', render: stepDetail },
    { name: 'Fitter', render: stepFitter },
    { name: 'Export', render: stepExport },
  ];
  let cur = 0;
  const nav = h('div', { class: 'steps' });
  const body = h('div', { class: 'step-body' });
  const foot = h('div', { class: 'step-foot' });
  const back = h('button', { class: 'nav', onclick: () => go(cur - 1) }, '← Back');
  const next = h('button', { class: 'nav primary', onclick: () => go(cur + 1) }, 'Next →');
  foot.append(back, next);

  function renderNav() {
    nav.innerHTML = '';
    STEPS.forEach((s, i) => nav.appendChild(h('button', {
      class: 'step' + (i === cur ? ' on' : '') + (i < cur ? ' done' : ''), onclick: () => go(i)
    }, [h('span', { class: 'n' }, String(i + 1)), h('span', { class: 'lbl' }, s.name)])));
  }
  function renderBody() { bindings.length = 0; body.innerHTML = ''; body.appendChild(STEPS[cur].render()); if (STEPS[cur].name === 'Export') renderStats(); }
  function go(i) { cur = Math.min(STEPS.length - 1, Math.max(0, i)); back.disabled = cur === 0; next.style.visibility = cur === STEPS.length - 1 ? 'hidden' : 'visible'; renderNav(); renderBody(); }
  function rebuildDynamic() { if (STEPS[cur].name === 'Detail' || STEPS[cur].name === 'Size') renderBody(); }

  panel.append(nav, body, foot);
  renderNav(); go(0);

  /* -------- public API -------- */
  let lastStats = null;
  function updateStats(s) { lastStats = s; renderStats(); }
  function renderStats() {
    const s = lastStats; if (!s) return;
    if (statsEl && statsEl.isConnected) {
      statsEl.innerHTML = `<div><b>${s.height.toFixed(0)}</b><span>mm tall</span></div>
        <div><b>${s.bottom.toFixed(0)}</b><span>Ø bottom</span></div>
        <div><b>${s.top.toFixed(0)}</b><span>Ø top</span></div>
        <div><b>${(s.tris / 1000).toFixed(0)}k</b><span>tris</span></div>`;
    }
    const val = document.getElementById('validator');
    if (val) {
      const ok = s.clean, warnMin = s.minRadius <= 1.0, warnOv = s.overhang >= 55;
      const anyWarn = !ok || s.warning || s.bedWarn;
      val.className = 'validator ' + (anyWarn ? 'warn' : 'good');
      val.innerHTML = `<div class="v-h">${anyWarn ? '⚠ Check before printing' : (P.wallThickness > 0 ? '✓ Watertight — print-ready' : '✓ Vase-mode ready')}</div>
        <ul>
          <li class="${warnMin ? 'bad' : ''}">Min wall radius: ${s.minRadius.toFixed(1)} mm ${warnMin ? '(too thin — walls may collide)' : ''}</li>
          <li class="${warnOv ? 'bad' : ''}">Steepest overhang: ${s.overhang.toFixed(0)}° from vertical ${warnOv ? '(steep for support-free vase mode)' : ''}</li>
          <li class="${s.warning ? 'bad' : ''}">Fitting: ${s.warning ? s.warning : (s.fitter ? `${s.bore} mm bore × ${s.fitter} fitter${s.fitter > 1 ? 's' : ''}` : 'none')}</li>
          ${s.fitterThin ? '<li class="bad">Fitter is thin — raise Spoke thickness (≥3 mm) / Hub height (≥6 mm) so it prints enough layers.</li>' : ''}
          ${s.bulb && s.bulb !== 'none' && s.clearance != null ? `<li class="${s.clearance < 5 ? 'bad' : ''}">Bulb clearance (${s.bulb}): ${s.clearance.toFixed(0)} mm ${s.clearance < 5 ? '— too close; widen the shade or use a smaller bulb' : 'to the wall'}</li>` : ''}
          ${s.bedWarn ? `<li class="bad">Printer bed (${s.bed} mm): ${s.bedWarn} Reduce the size or pick a larger printer.</li>` : `<li>Printer bed: fits ${s.bed} mm build volume</li>`}
          ${s.grams ? `<li>Material: ~${s.grams.toFixed(0)} g · ~${s.hours < 1 ? Math.round(s.hours * 60) + ' min' : s.hours.toFixed(1) + ' h'} (PLA, rough)</li>` : ''}
        </ul>`;
    }
  }
  function refresh() {
    // presets/reset/load changed P wholesale — re-render current step so every
    // control is recreated from the new P values.
    renderBody();
  }

  return { updateStats, refresh };
}
