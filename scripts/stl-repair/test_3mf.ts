// Builds a small 3MF (a zip, deflated) in inches with a component and a
// build transform, and checks the reader gets size and placement right.
import { readModel, weld, check } from '../../src/lib/stl-repair';

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (u: Uint8Array) => { let c = 0xffffffff; for (let i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
async function deflateRaw(u: Uint8Array) { return new Uint8Array(await new Response(new Blob([u]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()); }

async function zip(files: Record<string, string>) {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [], central: Uint8Array[] = [];
  let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = enc.encode(text), data = await deflateRaw(raw), nm = enc.encode(name), crc = crc32(raw);
    const lh = new Uint8Array(30 + nm.length); const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(8, 8, true); lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true); lv.setUint32(22, raw.length, true); lv.setUint16(26, nm.length, true); lh.set(nm, 30);
    const ch = new Uint8Array(46 + nm.length); const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(10, 8, true); cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true); cv.setUint32(24, raw.length, true); cv.setUint16(28, nm.length, true); cv.setUint32(42, off, true); ch.set(nm, 46);
    parts.push(lh, data); central.push(ch); off += lh.length + data.length;
  }
  const cd = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22); const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, central.length, true); ev.setUint16(10, central.length, true); ev.setUint32(12, cd, true); ev.setUint32(16, off, true);
  const all = [...parts, ...central, end]; const total = all.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total); let o = 0; for (const p of all) { out.set(p, o); o += p.length; }
  return out.buffer;
}

const verts = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
const tris = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="inch" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <resources>
  <object id="1" type="model"><mesh><vertices>${verts.map(([x, y, z]) => `<vertex x="${x}" y="${y}" z="${z}" />`).join('')}</vertices>
  <triangles>${tris.map(([a, b, c]) => `<triangle v1="${a}" v2="${b}" v3="${c}" />`).join('')}</triangles></mesh></object>
  <object id="2" type="model"><components><component objectid="1" transform="2 0 0 0 1 0 0 0 1 0 0 0" /></components></object>
 </resources>
 <build><item objectid="2" transform="1 0 0 0 1 0 0 0 1 10 0 0" /></build>
</model>`;
const buf = await zip({ '[Content_Types].xml': '<Types/>', '3D/3dmodel.model': model });
const r = await readModel(buf, 'part.3mf');
const m = weld(r.soup);
const rep = check(m, { mode: 'fdm', unitKnown: r.unit, fileMaxDim: 50.8 });
let minX = Infinity; for (let i = 0; i < m.V.length; i += 3) minX = Math.min(minX, m.V[i]);
const okSize = Math.abs(rep.size[0] - 50.8) < 1e-3 && Math.abs(rep.size[1] - 25.4) < 1e-3;
console.log(r.format, r.unit, 'size', rep.size.map((v) => v.toFixed(2)).join(' x '), 'minX', minX.toFixed(2), 'issues', rep.total);
console.log(okSize && Math.abs(minX - 254) < 1e-3 && rep.total === 0 ? 'PASS 3MF: units, component scale and build placement' : 'FAIL 3MF');
