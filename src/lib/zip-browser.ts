// Browser-safe minimal ZIP writer (mirrors src/lib/zip.ts but uses Uint8Array
// instead of Node Buffer). Store method only — fine for already-compressed
// JPEGs and small text manifests. Zero external dependency.

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  CRC_TABLE[n] = c >>> 0;
}
function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const encoder = new TextEncoder();

type Entry = { name: string; nameBytes: Uint8Array; data: Uint8Array; crc: number; size: number; offset: number };

export class ZipBuilderBrowser {
  private parts: Uint8Array[] = [];
  private entries: Entry[] = [];
  private cursor = 0;

  add(name: string, body: Uint8Array | string): void {
    const data = typeof body === 'string' ? encoder.encode(body) : body;
    const nameBytes = encoder.encode(name);
    const crc = crc32(data);
    const size = data.length;
    const offset = this.cursor;

    const lfh = new Uint8Array(30);
    const v = new DataView(lfh.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);   // version needed
    v.setUint16(6, 0, true);    // flags
    v.setUint16(8, 0, true);    // method = stored
    v.setUint16(10, 0, true);   // mod time
    v.setUint16(12, 0, true);   // mod date
    v.setUint32(14, crc, true);
    v.setUint32(18, size, true);
    v.setUint32(22, size, true);
    v.setUint16(26, nameBytes.length, true);
    v.setUint16(28, 0, true);

    this.parts.push(lfh, nameBytes, data);
    this.cursor += lfh.length + nameBytes.length + data.length;
    this.entries.push({ name, nameBytes, data, crc, size, offset });
  }

  build(): Blob {
    const cdStart = this.cursor;
    const cdParts: Uint8Array[] = [];
    let cdSize = 0;
    for (const e of this.entries) {
      const cdh = new Uint8Array(46);
      const v = new DataView(cdh.buffer);
      v.setUint32(0, 0x02014b50, true);
      v.setUint16(4, 20, true);   // version made by
      v.setUint16(6, 20, true);   // version needed
      v.setUint16(8, 0, true);    // flags
      v.setUint16(10, 0, true);   // method
      v.setUint16(12, 0, true);   // mod time
      v.setUint16(14, 0, true);   // mod date
      v.setUint32(16, e.crc, true);
      v.setUint32(20, e.size, true);
      v.setUint32(24, e.size, true);
      v.setUint16(28, e.nameBytes.length, true);
      v.setUint16(30, 0, true);   // extra
      v.setUint16(32, 0, true);   // comment
      v.setUint16(34, 0, true);   // disk #
      v.setUint16(36, 0, true);   // internal
      v.setUint32(38, 0, true);   // external
      v.setUint32(42, e.offset, true);
      cdParts.push(cdh, e.nameBytes);
      cdSize += cdh.length + e.nameBytes.length;
    }

    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, this.entries.length, true);
    ev.setUint16(10, this.entries.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, cdStart, true);
    ev.setUint16(20, 0, true);

    return new Blob([...this.parts, ...cdParts, eocd], { type: 'application/zip' });
  }
}
