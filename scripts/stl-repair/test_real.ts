// Run the repair on real files in every mode and time it.
// npx esbuild scripts/stl-repair/test_real.ts --bundle --platform=node --format=esm --outfile=scripts/stl-repair/.real.mjs && node scripts/stl-repair/.real.mjs <file> [modes]
import { readFileSync, writeFileSync } from 'node:fs';
import { readModel, weld, check, repair, toSTL, maxDim, type Mode } from '../../src/lib/stl-repair';

const file = process.argv[2];
const modes = (process.argv[3] || 'cnc,fdm,resin,laser').split(',') as Mode[];
const buf = readFileSync(file);
const t0 = Date.now();
const loaded = await readModel(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, file);
const mesh = weld(loaded.soup);
console.log(`${file}: ${loaded.format}, ${(mesh.F.length / 3).toLocaleString()} triangles, read+weld ${Date.now() - t0} ms`);
for (const mode of modes) {
  let t = Date.now();
  const ctx = { mode, unitKnown: loaded.unit, fileMaxDim: maxDim(mesh) };
  const before = check(mesh, ctx);
  const tc = Date.now() - t; t = Date.now();
  const r = await repair(mesh, { mode, unitFactor: 1, removeDebris: true, relief: 'auto', detail: 'standard', backing: 0, laser: { dpi: 254, background: 'white', invert: false } }, before);
  const tr = Date.now() - t; t = Date.now();
  const after = check(r.mesh, { mode, unitKnown: 'chosen', fileMaxDim: maxDim(r.mesh), selfX: r.rebuilt ? false : undefined });
  const ta = Date.now() - t;
  const pick = (x: any) => ({ total: x.total, holes: x.holes, nm: x.nonManifold, dup: x.duplicates, bad: x.bad, flip: x.flipped, selfX: x.selfX, debris: x.debris, sheet: x.sheet, thin: x.thin.pct, orient: x.orient.ok, base: x.base.ok, high: x.highPoly, tris: x.triangles, size: x.size.map((v: number) => +v.toFixed(1)) });
  console.log(`\n[${mode}] check ${tc} ms, repair ${tr} ms, re-check ${ta} ms`);
  console.log('  before', JSON.stringify(pick(before)));
  console.log('  after ', JSON.stringify(pick(after)));
  for (const a of r.actions) console.log('  +', a);
  for (const n of r.notes) console.log('  !', n);
  if (process.argv[4]) writeFileSync(`${process.argv[4]}-${mode}.stl`, Buffer.from(toSTL(r.mesh)));
}
