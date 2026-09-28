// Numbers for the stepover guide: ridge (scallop) height and finishing time
// for each ball size and stepover, on the real leaping-bass STL at 300 mm.
// Scallop is exact geometry: r - sqrt(r^2 - (s/2)^2). Time uses the same
// cutTime model as /tools/will-it-cut and the ball-nose guide.
import fs from 'node:fs';
import { parseSTL, analyse, cutTime, CLASSES, SANDING_MM } from '../../../src/lib/stl-analyse.ts';
const STL = 'D:/BUNDLES/bass-fishing-largemouth-bass-leaping-with-lure-l/1/Leaping Largemouth Bass Fishing CNC Relief STL.stl';
const MID = CLASSES[1];
const raw = parseSTL(fs.readFileSync(STL).buffer.slice(0));
let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;
for (let i = 0; i < raw.length; i += 3) { mnx = Math.min(mnx, raw[i]); mxx = Math.max(mxx, raw[i]); mny = Math.min(mny, raw[i + 1]); mxy = Math.max(mxy, raw[i + 1]); }
const out = { design: 'Leaping largemouth bass', machine: MID, sandingMm: SANDING_MM, sizes: {} };
for (const size of [300, 450]) {
  const k = size / Math.max(mxx - mnx, mxy - mny), pos = new Float32Array(raw.length); for (let i = 0; i < raw.length; i++) pos[i] = raw[i] * k;
  const a = analyse(pos);
  const rows = [];
  for (const dia of [1.5, 3, 6]) for (const so of [5, 8, 10, 12, 15, 20, 25, 30, 40]) {
    const r = dia / 2, s = dia * so / 100, sc = r - Math.sqrt(r * r - (s / 2) ** 2);
    const t = cutTime(a, MID, dia, so);
    rows.push({ dia, so, stepMm: +s.toFixed(3), scallopMm: +sc.toFixed(4), finishH: +(t.finishMin / 60).toFixed(2), roughH: +(t.roughMin / 60).toFixed(2) });
  }
  out.sizes[size] = { mm: { x: +a.size.x.toFixed(0), y: +a.size.y.toFixed(0), depth: +a.reliefDepth.toFixed(1) }, rows };
  console.log(`\n${size} mm (${a.size.x.toFixed(0)} x ${a.size.y.toFixed(0)}, depth ${a.reliefDepth.toFixed(1)}), roughing ${rows[0].roughH} h`);
  for (const dia of [1.5, 3, 6]) console.log(`  ${dia} mm: ` + rows.filter((x) => x.dia === dia).map((x) => `${x.so}%=${x.scallopMm}mm/${x.finishH}h`).join('  '));
}
fs.writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify(out, null, 1));
