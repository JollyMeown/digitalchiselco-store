// Runs the repair engine off the page's main thread, so a two-million-triangle
// file does not freeze the page. The parsed original stays here between runs:
// switching machine or changing an option repairs again without re-reading.
import { readModel, weld, check, repair, toSTL, previewOf, maxDim, type Mesh, type Options, type Report } from './stl-repair';

let orig: Mesh | null = null;
let meta: { name: string; format: string; unit: string | null; fileMaxDim: number; triangles: number } | null = null;
const checked = new Map<string, Report>();

const post = (msg: any, transfer: Transferable[] = []) => (self as any).postMessage(msg, transfer);
const stage = (from: number, span: number) => (p: number, label: string) => post({ type: 'progress', p: from + p * span, label });

const copyOverlay = (r: Report) => ({ holes: r.overlay.holes.slice(), nonManifold: r.overlay.nonManifold.slice(), selfX: r.overlay.selfX.slice() });
const plain = (r: Report) => ({ ...r, overlay: undefined });

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;
  try {
    if (msg.type === 'load') {
      post({ type: 'progress', p: 0.02, label: 'Reading the file…' });
      const loaded = await readModel(msg.buf, msg.name);
      post({ type: 'progress', p: 0.4, label: 'Joining corners…' });
      orig = weld(loaded.soup);
      meta = { name: msg.name, format: loaded.format, unit: loaded.unit, fileMaxDim: maxDim(orig), triangles: orig.F.length / 3 };
      checked.clear();
      post({ type: 'progress', p: 0.7, label: 'Preparing the preview…' });
      const pv = await previewOf(orig);
      post({ type: 'loaded', meta, preview: pv }, [pv.pos.buffer, pv.nrm.buffer]);
      return;
    }
    if (msg.type === 'run') {
      if (!orig || !meta) throw new Error('Load a file first.');
      const opts: Options = msg.opts;
      const key = `${opts.mode}|${opts.unitFactor}`;
      let before = checked.get(key);
      if (!before) {
        // checked at the chosen scale, so sizes and wall thickness are real millimetres
        const src = opts.unitFactor === 1 ? orig : { V: orig.V.map((v) => v * opts.unitFactor), F: orig.F };
        before = check(src, { mode: opts.mode, unitKnown: meta.unit, fileMaxDim: meta.fileMaxDim }, stage(0, 0.3));
        checked.set(key, before);
      }
      const r = await repair(orig, opts, before, stage(0.3, 0.45));
      const after = check(r.mesh, { mode: opts.mode, unitKnown: 'chosen', fileMaxDim: maxDim(r.mesh), selfX: r.rebuilt ? false : undefined }, stage(0.75, 0.17));
      post({ type: 'progress', p: 0.94, label: 'Preparing the download…' });
      const pv = await previewOf(r.mesh);
      const stl = toSTL(r.mesh);
      const bo = copyOverlay(before), ao = copyOverlay(after);
      const transfer: Transferable[] = [pv.pos.buffer, pv.nrm.buffer, stl, bo.holes.buffer, bo.nonManifold.buffer, bo.selfX.buffer, ao.holes.buffer, ao.nonManifold.buffer, ao.selfX.buffer];
      if (r.png) transfer.push(r.png.data);
      post({
        type: 'done', id: msg.id,
        before: plain(before), after: plain(after), beforeOverlay: bo, afterOverlay: ao,
        actions: r.actions, notes: r.notes, rebuilt: r.rebuilt, preview: pv, stl, png: r.png,
      }, transfer);
    }
  } catch (err: any) {
    post({ type: 'error', id: msg?.id, message: err?.message || String(err) });
  }
};
