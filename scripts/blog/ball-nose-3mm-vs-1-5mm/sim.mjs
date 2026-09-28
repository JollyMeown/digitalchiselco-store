// Real numbers for the "3 mm vs 1.5 mm ball nose" guide, from the same engine
// that runs /tools/will-it-cut (src/lib/stl-analyse.ts), on real designs from
// the catalogue, each scaled so its long side is SIZE mm (depth scales too).
// Writes results.json beside this file so every number in the article is
// traceable. Run: node --import tsx scripts/blog/ball-nose-3mm-vs-1-5mm/sim.mjs
import fs from 'node:fs';
import path from 'node:path';
import { parseSTL, analyse, cutTime, CLASSES } from '../../../src/lib/stl-analyse.ts';
import { restZone } from '../3mm-vs-1-5mm-ball-nose-relief-carving/restzone.mjs';

const B = 'D:/BUNDLES/bass-fishing-largemouth-bass-leaping-with-lure-l';
// Only designs whose local STL was checked against the website picture
// (2026-09-28). Folder 14 'Jesus Condemned' did NOT match its product, so it is out.
const DESIGNS = [
  ['Leaping largemouth bass', `${B}/1/Leaping Largemouth Bass Fishing CNC Relief STL.stl`],
  ['Feathered fishing lure', `${B}/105/Ornate Feathered Fishing Lure CNC Relief STL.stl`],
  ['Coiled dragon medallion', `${B}/132/Coiled Medieval Dragon Medallion CNC Relief STL.stl`],
  ['Mallard duck arch', `${B}/127/Mallard Duck Landing Arch Keystone CNC Relief STL.stl`],
  ['Rustic cross wreath', `${B}/117/Rustic Cross Wreath CNC Relief STL.stl`],
];
const SIZES = [300, 450];
const MID = CLASSES[1];   // Shapeoko / X-Carve / Onefinity class

function scaleTo(pos, longSide) {
  let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;
  for (let i = 0; i < pos.length; i += 3) { mnx = Math.min(mnx, pos[i]); mxx = Math.max(mxx, pos[i]); mny = Math.min(mny, pos[i + 1]); mxy = Math.max(mxy, pos[i + 1]); }
  const k = longSide / Math.max(mxx - mnx, mxy - mny);
  const out = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i++) out[i] = pos[i] * k;
  return out;
}

const results = [];
for (const [name, file] of DESIGNS) {
  if (!fs.existsSync(file)) { console.log('missing', file); continue; }
  const raw = parseSTL(fs.readFileSync(file).buffer.slice(0));
  for (const size of SIZES) {
    // grid cell of size/1800 mm: 0.17 mm at 300 mm, so the 1.5 mm ball spans 4+ cells
    const a = analyse(scaleTo(raw, size), undefined, { target: 1800 });
    const loss = Object.fromEntries(a.detailLoss.map((d) => [d.radius, d]));
    const t = (dia, so) => cutTime(a, MID, dia, so).totalMin;
    const fin = (dia, so) => cutTime(a, MID, dia, so).finishMin;
    const row = {
      name, file: path.basename(file), size,
      mm: { x: +a.size.x.toFixed(0), y: +a.size.y.toFixed(0), depth: +a.reliefDepth.toFixed(1) },
      triangles: a.triangles,
      detail: { 1.5: loss[1.5], 3: loss[3], 6: loss[6] },
      minutes: {
        rough: +cutTime(a, MID, 3, 10).roughMin.toFixed(0),
        finish_3_10: +fin(3, 10).toFixed(0), finish_1_5_10: +fin(1.5, 10).toFixed(0),
        finish_6_10: +fin(6, 10).toFixed(0),
        total_3_10: +t(3, 10).toFixed(0), total_1_5_10: +t(1.5, 10).toFixed(0), total_6_10: +t(6, 10).toFixed(0),
      },
    };
    // REST MACHINING (owner, 2026-09-28): 3 mm over everything, then automatic
    // rest machining sends the 1.5 mm ONLY into restZone (the same zone the
    // article's diagram draws). Finishing time is proportional to the area
    // rastered, so the zone share applies directly. An estimate, labelled so.
    const z = restZone(a);
    const share = z.zonePct / 100;
    row.rest = {
      visibleLoss3mmPct: +z.visiblePct.toFixed(1),
      restAreaPct: +z.zonePct.toFixed(1),
      finish_rest: +(fin(3, 10) + fin(1.5, 10) * share).toFixed(0),
      savedVsFull15: +(fin(1.5, 10) - (fin(3, 10) + fin(1.5, 10) * share)).toFixed(0),
    };
    results.push(row);
    const d = (k) => row.detail[k]?.measurable ? `${row.detail[k].max}mm/${row.detail[k].areaAffected}%` : 'n/a';
    console.log(`rest: 3mm visible-loss ${row.rest.visibleLoss3mmPct}% -> 1.5mm on ${row.rest.restAreaPct}% | finish 3+rest ${row.rest.finish_rest} min vs 1.5 everywhere ${row.minutes.finish_1_5_10} (saves ${row.rest.savedVsFull15})`);
    console.log(`${name.padEnd(40)} ${size}mm  depth ${row.mm.depth}  lost p99/area  6:${d(6)}  3:${d(3)}  1.5:${d(1.5)}  | finish min 6:${row.minutes.finish_6_10} 3:${row.minutes.finish_3_10} 1.5:${row.minutes.finish_1_5_10}  rough ${row.minutes.rough}`);
  }
}
fs.writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify({ machine: MID, stepoverPct: 10, generated: new Date().toISOString(), results }, null, 1));
