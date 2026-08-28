/* exporters.js — build STL (binary + ascii) and OBJ from raw {positions, indices}.
 * Works with one part or several parts merged into one file.
 * Pure: takes typed arrays, returns Blobs.
 */

/* Make the mesh CONSISTENTLY oriented and OUTWARD. First a flood-fill across
 * shared edges flips individual faces so every interior edge is traversed in
 * opposite directions by its two faces (fixes hand-wound rim bands, caps, etc.).
 * Then each connected component whose signed volume is negative is reversed as a
 * whole, so all normals point outward. Bulletproof against any winding mistake. */
export function orientComponentsOutward(pos, idx) {
  const nf = idx.length / 3;
  const ek = (a, b) => a < b ? a * 4294967296 + b : b * 4294967296 + a;   // undirected edge key
  const em = new Map();
  for (let f = 0; f < nf; f++) { const a = idx[3 * f], b = idx[3 * f + 1], c = idx[3 * f + 2]; for (const [u, v] of [[a, b], [b, c], [c, a]]) { const k = ek(u, v); let l = em.get(k); if (!l) { l = []; em.set(k, l); } l.push(f); } }
  const dirHas = (f, u, v) => { const a = idx[3 * f], b = idx[3 * f + 1], c = idx[3 * f + 2]; return (a === u && b === v) || (b === u && c === v) || (c === u && a === v); };
  const flip = f => { const t = idx[3 * f + 1]; idx[3 * f + 1] = idx[3 * f + 2]; idx[3 * f + 2] = t; };
  const seen = new Uint8Array(nf), comp = new Int32Array(nf).fill(-1);
  let nc = 0;
  for (let s = 0; s < nf; s++) {
    if (seen[s]) continue;
    const stack = [s]; seen[s] = 1; comp[s] = nc;
    while (stack.length) {
      const f = stack.pop(), a = idx[3 * f], b = idx[3 * f + 1], c = idx[3 * f + 2];
      for (const [u, v] of [[a, b], [b, c], [c, a]]) {
        const l = em.get(ek(u, v)); if (!l) continue;
        for (const g of l) {
          if (g === f || seen[g]) continue;
          if (dirHas(g, u, v)) flip(g);       // same direction as f on shared edge -> flip to oppose
          seen[g] = 1; comp[g] = nc; stack.push(g);
        }
      }
    }
    nc++;
  }
  const vol = new Float64Array(nc);
  for (let f = 0; f < nf; f++) { const a = idx[3 * f], b = idx[3 * f + 1], c = idx[3 * f + 2]; vol[comp[f]] += (pos[a * 3] * (pos[b * 3 + 1] * pos[c * 3 + 2] - pos[b * 3 + 2] * pos[c * 3 + 1]) - pos[a * 3 + 1] * (pos[b * 3] * pos[c * 3 + 2] - pos[b * 3 + 2] * pos[c * 3]) + pos[a * 3 + 2] * (pos[b * 3] * pos[c * 3 + 1] - pos[b * 3 + 1] * pos[c * 3])); }
  for (let f = 0; f < nf; f++) if (vol[comp[f]] < 0) flip(f);
  return idx;
}

/* Weld coincident vertices across all parts and drop degenerate + duplicate
 * faces, producing one clean indexed mesh (shared vertices, no redundant tris),
 * with every component oriented outward. */
export function weld(parts, tol = 1e-4) {
  const map = new Map(), outPos = [], remaps = [];
  const key = (x, y, z) => Math.round(x / tol) + '_' + Math.round(y / tol) + '_' + Math.round(z / tol);
  for (const part of parts) {
    const p = part.positions, local = new Uint32Array(p.length / 3);
    for (let i = 0; i < p.length; i += 3) {
      const k = key(p[i], p[i + 1], p[i + 2]); let id = map.get(k);
      if (id === undefined) { id = outPos.length / 3; map.set(k, id); outPos.push(p[i], p[i + 1], p[i + 2]); }
      local[i / 3] = id;
    }
    remaps.push(local);
  }
  const seen = new Set(), outIdx = [];
  parts.forEach((part, pi) => {
    const idx = part.indices, local = remaps[pi];
    for (let i = 0; i < idx.length; i += 3) {
      const a = local[idx[i]], b = local[idx[i + 1]], c = local[idx[i + 2]];
      if (a === b || b === c || a === c) continue;                 // degenerate
      const fk = a < b ? (a < c ? a + '_' + (b < c ? b + '_' + c : c + '_' + b) : c + '_' + a + '_' + b)
        : (b < c ? b + '_' + (a < c ? a + '_' + c : c + '_' + a) : c + '_' + b + '_' + a);
      if (seen.has(fk)) continue;                                  // duplicate face (any winding)
      seen.add(fk); outIdx.push(a, b, c);
    }
  });
  const positions = new Float32Array(outPos);
  const Ctor = positions.length / 3 > 65535 ? Uint32Array : Uint16Array;
  const indices = Ctor.from(outIdx);
  orientComponentsOutward(positions, indices);   // guarantee outward normals per component
  return { positions, indices };
}

function faceNormal(p, ia, ib, ic) {
  const ax = p[ia], ay = p[ia + 1], az = p[ia + 2];
  const bx = p[ib], by = p[ib + 1], bz = p[ib + 2];
  const cx = p[ic], cy = p[ic + 1], cz = p[ic + 2];
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1; return [nx / l, ny / l, nz / l];
}

/* parts: [{positions, indices}] — concatenated into a single STL solid */
export function toBinarySTL(parts) {
  let triCount = 0;
  for (const p of parts) triCount += p.indices.length / 3;
  const buf = new ArrayBuffer(84 + triCount * 50);
  const dv = new DataView(buf);
  new Uint8Array(buf, 0, 80).fill(0);
  dv.setUint32(80, triCount, true);
  let o = 84;
  for (const part of parts) {
    const pos = part.positions, idx = part.indices;
    for (let i = 0; i < idx.length; i += 3) {
      const ia = idx[i] * 3, ib = idx[i + 1] * 3, ic = idx[i + 2] * 3;
      const n = faceNormal(pos, ia, ib, ic);
      dv.setFloat32(o, n[0], true); dv.setFloat32(o + 4, n[1], true); dv.setFloat32(o + 8, n[2], true); o += 12;
      for (const vi of [ia, ib, ic]) {
        dv.setFloat32(o, pos[vi], true); dv.setFloat32(o + 4, pos[vi + 1], true); dv.setFloat32(o + 8, pos[vi + 2], true); o += 12;
      }
      dv.setUint16(o, 0, true); o += 2;
    }
  }
  return new Blob([buf], { type: 'model/stl' });
}

export function toAsciiSTL(parts, name = 'lampshade') {
  let s = `solid ${name}\n`;
  for (const part of parts) {
    const pos = part.positions, idx = part.indices;
    for (let i = 0; i < idx.length; i += 3) {
      const ia = idx[i] * 3, ib = idx[i + 1] * 3, ic = idx[i + 2] * 3;
      const n = faceNormal(pos, ia, ib, ic);
      s += `facet normal ${n[0]} ${n[1]} ${n[2]}\nouter loop\n`;
      for (const vi of [ia, ib, ic]) s += `vertex ${pos[vi]} ${pos[vi + 1]} ${pos[vi + 2]}\n`;
      s += `endloop\nendfacet\n`;
    }
  }
  s += `endsolid ${name}\n`;
  return new Blob([s], { type: 'model/stl' });
}

export function toOBJ(parts, name = 'lampshade') {
  let s = `# ${name}\n`, base = 0;
  for (const part of parts) {
    const pos = part.positions, idx = part.indices;
    for (let i = 0; i < pos.length; i += 3) s += `v ${pos[i].toFixed(4)} ${pos[i + 1].toFixed(4)} ${pos[i + 2].toFixed(4)}\n`;
    for (let i = 0; i < idx.length; i += 3) s += `f ${idx[i] + 1 + base} ${idx[i + 1] + 1 + base} ${idx[i + 2] + 1 + base}\n`;
    base += pos.length / 3;
  }
  return new Blob([s], { type: 'text/plain' });
}

/* absolute mesh volume in mm³ (material volume of a closed shell) */
export function meshVolume(part) {
  const p = part.positions, idx = part.indices; let v = 0;
  for (let i = 0; i < idx.length; i += 3) { const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3; v += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6; }
  return Math.abs(v);
}

/* ---- minimal 3MF (keeps each part as its own object; STORED zip, no deps) ---- */
function crc32(b) { let c = ~0; for (let i = 0; i < b.length; i++) { c ^= b[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return ~c >>> 0; }
function zipStored(files) {
  const chunks = [], central = []; let off = 0;
  const u16 = n => [n & 255, (n >> 8) & 255], u32 = n => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255];
  for (const f of files) {
    const crc = crc32(f.data), lh = new Uint8Array([0x50, 0x4b, 3, 4, ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(f.data.length), ...u32(f.data.length), ...u16(f.name.length), ...u16(0)]);
    chunks.push(lh, f.name, f.data); central.push({ name: f.name, crc, size: f.data.length, off }); off += lh.length + f.name.length + f.data.length;
  }
  const cd = []; let cdSize = 0;
  for (const c of central) { const h = new Uint8Array([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(c.crc), ...u32(c.size), ...u32(c.size), ...u16(c.name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(c.off)]); cd.push(h, c.name); cdSize += h.length + c.name.length; }
  const end = new Uint8Array([0x50, 0x4b, 5, 6, ...u16(0), ...u16(0), ...u16(central.length), ...u16(central.length), ...u32(cdSize), ...u32(off), ...u16(0)]);
  return new Blob([...chunks, ...cd, end], { type: 'model/3mf' });
}
export function to3MF(parts, name = 'lamp') {
  const enc = new TextEncoder();
  const ct = '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>';
  const rels = '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>';
  let objs = '', build = '', id = 1;
  for (const part of parts) {
    const pos = part.positions, idx = part.indices; let v = '', t = '';
    for (let i = 0; i < pos.length; i += 3) v += `<vertex x="${pos[i].toFixed(4)}" y="${pos[i + 1].toFixed(4)}" z="${pos[i + 2].toFixed(4)}"/>`;
    for (let i = 0; i < idx.length; i += 3) t += `<triangle v1="${idx[i]}" v2="${idx[i + 1]}" v3="${idx[i + 2]}"/>`;
    objs += `<object id="${id}" type="model"><mesh><vertices>${v}</vertices><triangles>${t}</triangles></mesh></object>`;
    build += `<item objectid="${id}" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>`; id++;
  }
  const model = `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>${objs}</resources><build>${build}</build></model>`;
  return zipStored([{ name: enc.encode('[Content_Types].xml'), data: enc.encode(ct) }, { name: enc.encode('_rels/.rels'), data: enc.encode(rels) }, { name: enc.encode('3D/3dmodel.model'), data: enc.encode(model) }]);
}

export function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
