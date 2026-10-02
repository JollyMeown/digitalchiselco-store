// Broken sample files for trying /tools/stl-repair locally. Written to
// public/_test/ (never committed).
import { mkdirSync, writeFileSync } from 'node:fs';

function stl(soup: number[]) {
  const n = soup.length / 9;
  const b = Buffer.alloc(84 + n * 50);
  b.write('broken sample', 0);
  b.writeUInt32LE(n, 80);
  let o = 84;
  for (let t = 0; t < n; t++) {
    o += 12;
    for (let k = 0; k < 9; k++) { b.writeFloatLE(soup[t * 9 + k], o); o += 4; }
    o += 2;
  }
  return b;
}
function cube(x = 0, y = 0, z = 0, s = 10): number[] {
  const p = [[0, 0, 0], [s, 0, 0], [s, s, 0], [0, s, 0], [0, 0, s], [s, 0, s], [s, s, s], [0, s, s]].map(([a, b, c]) => [a + x, b + y, c + z]);
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  return f.flatMap((t) => t.flatMap((i) => p[i]));
}
// a relief panel as an open surface with a missing patch and some flipped faces
function sheet(n = 160, size = 120, h = 9) {
  const out: number[] = [];
  const z = (i: number, j: number) => {
    const x = i / n - 0.5, y = j / n - 0.5;
    return 1.5 + h * Math.exp(-((x * x + y * y) * 9)) + 0.8 * Math.sin(x * 40) * Math.cos(y * 30);
  };
  const P = (i: number, j: number) => [i / n * size, j / n * size, z(i, j)];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    if (i > 60 && i < 66 && j > 70 && j < 74) continue;                 // a hole
    const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
    if ((i * 7 + j * 13) % 97 === 0) out.push(...a, ...c, ...b, ...a, ...d, ...c);   // inside-out
    else out.push(...a, ...b, ...c, ...a, ...c, ...d);
  }
  return out;
}
mkdirSync('public/_test', { recursive: true });
// cube in inches, with a hole, a flipped face, a repeated face and two touching cubes
const c = cube(0, 0, 0, 2).slice(9);
c.push(...c.slice(18, 27));
const flip = c.slice(27, 36); c.splice(27, 9, ...flip.slice(0, 3), ...flip.slice(6, 9), ...flip.slice(3, 6));
writeFileSync('public/_test/repair-cube-inches.stl', stl([...c, ...cube(2, 2, 0, 2)]));
writeFileSync('public/_test/repair-open-relief.stl', stl(sheet()));
// standing on its side, as a 3MF would not need: rotate the relief about X
const s = sheet(120, 100, 7);
const side: number[] = [];
for (let i = 0; i < s.length; i += 3) side.push(s[i], -s[i + 2], s[i + 1]);
writeFileSync('public/_test/repair-relief-on-side.stl', stl(side));
console.log('written');
