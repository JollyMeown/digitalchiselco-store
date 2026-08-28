/* worker.js — off-main-thread meshing so the GUI stays responsive.
 * Runs the pure builders and transfers typed-array buffers back.
 */
import { buildShade, buildFitter } from './mesh-core.js';

self.onmessage = (e) => {
  const { id, type, P, F } = e.data;
  try {
    let r;
    if (type === 'shade') r = buildShade(P);
    else if (type === 'fitter') r = buildFitter(F);
    else throw new Error('unknown build type: ' + type);

    if (!r) { self.postMessage({ id, type, ok: true, vanished: true }); return; }  // fitter didn't fit
    const transfer = [r.positions.buffer, r.indices.buffer];
    self.postMessage({ id, type, ok: true, positions: r.positions, indices: r.indices, meta: r.meta }, transfer);
  } catch (err) {
    self.postMessage({ id, type, ok: false, error: (err && err.message) || String(err) });
  }
};
