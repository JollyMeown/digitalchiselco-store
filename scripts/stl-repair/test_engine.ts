// Regression checks for src/lib/stl-repair.ts on meshes broken on purpose.
// Run: npx esbuild scripts/stl-repair/test_engine.ts --bundle --platform=node --format=esm --outfile=scripts/stl-repair/.test.mjs && node scripts/stl-repair/.test.mjs
import { weld, check, repair, toSTL, readModel, type Mesh, type Mode, type Options } from '../../src/lib/stl-repair';

let failures = 0;
const ok = (cond: boolean, msg: string) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };

// cube as a triangle soup, outward winding
function cube(x = 0, y = 0, z = 0, s = 10): number[] {
  const p = [[0, 0, 0], [s, 0, 0], [s, s, 0], [0, s, 0], [0, 0, s], [s, 0, s], [s, s, s], [0, s, s]].map(([a, b, c]) => [a + x, b + y, c + z]);
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  return f.flatMap((t) => t.flatMap((i) => p[i]));
}

const opts = (mode: Mode, extra: Partial<Options> = {}): Options => ({
  mode, unitFactor: 1, removeDebris: true, relief: 'auto', detail: 'standard', backing: 0,
  laser: { dpi: 254, background: 'white', invert: false }, ...extra,
});

async function run(name: string, soup: number[], mode: Mode, extra: Partial<Options> = {}) {
  const mesh: Mesh = weld(new Float32Array(soup));
  const ctx = { mode, unitKnown: null, fileMaxDim: Math.max(...[0, 1, 2].map((k) => { let lo = Infinity, hi = -Infinity; for (let i = k; i < soup.length; i += 3) { lo = Math.min(lo, soup[i]); hi = Math.max(hi, soup[i]); } return hi - lo; })) };
  const before = check(mesh, ctx);
  const r = await repair(mesh, opts(mode, extra), before);
  const after = check(r.mesh, { mode, unitKnown: 'chosen', fileMaxDim: 100, selfX: r.rebuilt ? false : undefined });
  console.log(`\n== ${name} [${mode}]  before ${before.total} issues -> after ${after.total}`);
  console.log('   before', JSON.stringify({ holes: before.holes, nm: before.nonManifold, dup: before.duplicates, bad: before.bad, flip: before.flipped, selfX: before.selfX, sheet: before.sheet, units: before.units.suspect, orient: before.orient.ok, debris: before.debris, tris: before.triangles }));
  console.log('   after ', JSON.stringify({ holes: after.holes, nm: after.nonManifold, dup: after.duplicates, bad: after.bad, flip: after.flipped, selfX: after.selfX, sheet: after.sheet, orient: after.orient.ok, base: after.base.ok, tris: after.triangles, vol: after.volume.toFixed(3) }));
  for (const a of r.actions) console.log('   +', a);
  for (const n of r.notes) console.log('   !', n);
  return { before, after, r };
}

// 1. cube with a missing face, a flipped face, a repeated face and a sliver
{
  const s = cube();
  const broken = s.slice(9);                                // drop one triangle: a hole
  const t = broken.slice(0, 9); broken.splice(0, 9, ...t.slice(0, 3), ...t.slice(6, 9), ...t.slice(3, 6)); // flip one
  broken.push(...broken.slice(18, 27));                      // repeat one
  broken.push(0, 0, 0, 5, 0, 0, 10, 0, 0);                   // zero-area sliver
  const { before, after, r } = await run('cube: hole + flipped + repeated + sliver', broken, 'fdm');
  ok(before.holes === 1, 'finds the hole');
  ok(before.flipped >= 1, 'finds the flipped face');
  ok(before.duplicates === 1, 'finds the repeated face');
  ok(before.bad === 1, 'finds the sliver');
  ok(after.holes === 0 && after.nonManifold === 0 && after.flipped === 0 && after.bad === 0 && after.duplicates === 0, 'repaired cube is clean');
  ok(Math.abs(after.volume - 1) < 0.01, `volume is 1 cm3 (got ${after.volume.toFixed(4)})`);
  ok(r.mesh.F.length / 3 === 12, `12 triangles again (got ${r.mesh.F.length / 3})`);
}

// 2. two cubes sharing one edge: a non-manifold edge
{
  const { before, after } = await run('two cubes touching on an edge', [...cube(), ...cube(10, 10, 0)], 'fdm');
  ok(before.nonManifold >= 1, `finds the non-manifold edge (${before.nonManifold})`);
  ok(after.nonManifold === 0 && after.holes === 0, 'separated cleanly, still closed');
  ok(after.selfX === 0, `touching is not counted as crossing (${after.selfX})`);
}

// 3. cube inside a cube (a hollow part): the inner shell must face inwards
{
  const inner = cube(3, 3, 3, 4);
  const { before, after } = await run('hollow cube (cavity)', [...cube(), ...inner.map((v, i) => v)].flat(), 'resin');
  // inner given with outward winding = wrong for a cavity
  ok(before.flipped === 12, `inner cavity faces counted as flipped (${before.flipped})`);
  ok(after.flipped === 0, 'cavity now faces inwards');
  ok(Math.abs(after.volume - (1 - 0.064)) < 0.01, `volume = outer minus cavity (${after.volume.toFixed(3)} cm3)`);
}

// 4. inches
{
  const tiny = cube(0, 0, 0, 2);
  const { before, after } = await run('2 inch cube saved without units', tiny, 'fdm', { unitFactor: 25.4 });
  ok(before.units.suspect && before.units.suggest === 25.4, 'suspects inches');
  ok(Math.abs(after.size[0] - 50.8) < 0.01, `scaled to 50.8 mm (${after.size[0].toFixed(2)})`);
}

// 5. open relief surface (no back): a dome as a heightfield sheet
function sheet(n = 60, size = 100, h = 8, flip = false) {
  const out: number[] = [];
  const z = (i: number, j: number) => { const x = i / n - 0.5, y = j / n - 0.5; return Math.max(0, h * (1 - (x * x + y * y) * 6)); };
  const P = (i: number, j: number) => [i / n * size, j / n * size, z(i, j)];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
    if (flip) out.push(...a, ...c, ...b, ...a, ...d, ...c); else out.push(...a, ...b, ...c, ...a, ...c, ...d);
  }
  return out;
}
{
  const { before, after, r } = await run('open relief surface', sheet(), 'cnc');
  ok(before.sheet, 'sees an open surface with no thickness');
  ok(r.rebuilt && after.holes === 0 && after.nonManifold === 0 && after.flipped === 0 && after.bad === 0 && after.total === 0, 'rebuilt solid is watertight, 0 issues');
  ok(after.orient.ok && after.base.ok, 'flat back down');
  ok(Math.abs(after.size[2] - 10) < 0.3, `height = 8 mm relief + 2 mm backing (${after.size[2].toFixed(2)})`);
}
{
  const { after, r } = await run('open relief surface, wound backwards', sheet(60, 100, 8, true), 'cnc');
  // front must still face up: the top of the dome is the highest point
  ok(r.rebuilt && after.holes === 0, 'rebuilt');
  ok(Math.abs(after.size[2] - 10) < 0.3, 'still dome-up whatever the winding');
}

// 6. laser: depth map
{
  const { r } = await run('laser depth map', sheet(), 'laser');
  ok(!!r.png && r.png.w > 900 && new Uint8Array(r.png.data)[1] === 80, `PNG made (${r.png?.w} x ${r.png?.h})`);
}

// 7. relief on its side (flat back facing +X)
{
  const s = cube(0, 0, 0, 10);
  const slab: number[] = [];
  for (let i = 0; i < s.length; i += 3) slab.push(s[i] * 0.2, s[i + 1] * 8, s[i + 2] * 6);   // 2 x 80 x 60
  const { before, after } = await run('slab standing on its edge', slab, 'cnc');
  ok(!before.orient.ok, 'sees it is on its side');
  ok(after.size[2] < 2.5 && Math.max(after.size[0], after.size[1]) > 70, `laid flat (${after.size.map((v) => v.toFixed(1)).join(' x ')})`);
}

// 8. two overlapping cubes: self-intersection found, left for the slicer
{
  const { before, after } = await run('two overlapping cubes', [...cube(), ...cube(5, 5, 5)], 'fdm');
  ok(before.selfX > 0, `finds faces passing through each other (${before.selfX})`);
  ok(after.holes === 0 && after.nonManifold === 0, 'otherwise clean');
}

// 9. found in the browser 2026-10-02: a hole next to a flipped face was not
//    counted, and a whole small part with a hole was deleted as "debris"
{
  const c = cube(0, 0, 0, 2).slice(9);                       // hole in the bottom
  const t = c.slice(0, 9); c.splice(0, 9, ...t.slice(0, 3), ...t.slice(6, 9), ...t.slice(3, 6));   // flip its neighbour
  const { before, after, r } = await run('hole beside a flipped face, plus a second part', [...c, ...cube(5, 0, 0, 2)], 'fdm');
  ok(before.holes === 1, `hole counted although its edge directions disagree (${before.holes})`);
  ok(before.debris === 0, 'a real part with a hole is not debris');
  ok(r.mesh.F.length / 3 === 24 && after.shells === 2, `both parts kept (${r.mesh.F.length / 3} triangles, ${after.shells} parts)`);
  ok(after.holes === 0 && after.flipped === 0, 'and both closed and outward');
}

// 10. a missing patch in an open relief must be filled, not cut through
{
  const s = sheet(60, 100, 8);
  const holed: number[] = [];
  for (let t = 0; t < s.length; t += 18) {
    const q = t / 18, i = q % 60, j = Math.floor(q / 60);
    if (i >= 28 && i < 31 && j >= 28 && j < 30) continue;
    holed.push(...s.slice(t, t + 18));
  }
  const { r } = await run('open relief with a missing patch', holed, 'cnc');
  const chi = r.mesh.V.length / 3 - r.mesh.F.length / 3 / 2;     // V - E + F for a closed mesh
  ok(chi === 2, `no hole through the rebuilt relief (Euler characteristic ${chi}, 2 = solid)`);
  ok(r.actions.some((a) => /missing patch/.test(a)), 'says it filled the patch');
}

// 11. found in the browser 2026-10-02: a hole at the corner where two parts
//     touch along an edge was filled with a fan through a fake slit
{
  const c = cube(0, 0, 0, 2).slice(9);
  c.push(...c.slice(18, 27));
  const fl = c.slice(27, 36); c.splice(27, 9, ...fl.slice(0, 3), ...fl.slice(6, 9), ...fl.slice(3, 6));
  const { after, r } = await run('hole where two parts touch on an edge', [...c, ...cube(2, 2, 0, 2)], 'fdm');
  ok(r.mesh.F.length / 3 === 24, `24 triangles, no stray fan (${r.mesh.F.length / 3})`);
  ok(after.total === 0 && after.thin.pct === 0, `clean, no fake thin wall (${after.total} issues, thin ${after.thin.pct}%)`);
}

// 12. STL round trip and 3MF/OBJ reading
{
  const m = weld(new Float32Array(cube()));
  const stl = toSTL(m);
  const back = await readModel(stl, 'x.stl');
  ok(back.soup.length === 12 * 9, 'binary STL round trip');
  const obj = 'v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n';
  const o = await readModel(new TextEncoder().encode(obj).buffer as ArrayBuffer, 'x.obj');
  ok(o.soup.length === 18, 'OBJ quad becomes two triangles');
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
