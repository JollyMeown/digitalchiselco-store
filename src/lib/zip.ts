// Minimal ZIP writer using only Node Buffer + crc32. Stores files
// uncompressed (method 0) — fine for already-compressed JPEGs and small
// text manifests. No external dependency.
//
// Spec: https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT

import { Buffer } from 'node:buffer';

// Precompute the CRC-32 lookup table (Bzip2 polynomial, IEEE 802.3).
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

type Entry = { name: string; data: Uint8Array; crc: number; size: number; offset: number };

export class ZipBuilder {
  private parts: Buffer[] = [];
  private entries: Entry[] = [];
  private cursor = 0;

  add(name: string, body: Uint8Array | string): void {
    const data = typeof body === 'string' ? Buffer.from(body, 'utf8') : Buffer.from(body);
    const crc = crc32(data);
    const size = data.length;
    const offset = this.cursor;
    const nameBuf = Buffer.from(name, 'utf8');

    // Local file header
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);     // signature
    lfh.writeUInt16LE(20, 4);             // version needed
    lfh.writeUInt16LE(0, 6);              // general purpose
    lfh.writeUInt16LE(0, 8);              // method: stored
    lfh.writeUInt16LE(0, 10);             // mod time
    lfh.writeUInt16LE(0, 12);             // mod date
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(size, 18);          // compressed size
    lfh.writeUInt32LE(size, 22);          // uncompressed size
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28);             // extra field length

    this.parts.push(lfh, nameBuf, data);
    this.cursor += lfh.length + nameBuf.length + data.length;
    this.entries.push({ name, data, crc, size, offset });
  }

  finalize(): Buffer {
    const cdStart = this.cursor;
    const cdBuffers: Buffer[] = [];
    for (const e of this.entries) {
      const nameBuf = Buffer.from(e.name, 'utf8');
      const cdh = Buffer.alloc(46);
      cdh.writeUInt32LE(0x02014b50, 0);   // signature
      cdh.writeUInt16LE(20, 4);           // version made by
      cdh.writeUInt16LE(20, 6);           // version needed
      cdh.writeUInt16LE(0, 8);            // general purpose
      cdh.writeUInt16LE(0, 10);           // method
      cdh.writeUInt16LE(0, 12);           // mod time
      cdh.writeUInt16LE(0, 14);           // mod date
      cdh.writeUInt32LE(e.crc, 16);
      cdh.writeUInt32LE(e.size, 20);
      cdh.writeUInt32LE(e.size, 24);
      cdh.writeUInt16LE(nameBuf.length, 28);
      cdh.writeUInt16LE(0, 30);           // extra
      cdh.writeUInt16LE(0, 32);           // comment
      cdh.writeUInt16LE(0, 34);           // disk #
      cdh.writeUInt16LE(0, 36);           // internal attrs
      cdh.writeUInt32LE(0, 38);           // external attrs
      cdh.writeUInt32LE(e.offset, 42);
      cdBuffers.push(cdh, nameBuf);
    }
    const cdSize = cdBuffers.reduce((s, b) => s + b.length, 0);

    // End of central directory
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);    // signature
    eocd.writeUInt16LE(0, 4);             // disk
    eocd.writeUInt16LE(0, 6);             // disk with cd
    eocd.writeUInt16LE(this.entries.length, 8);
    eocd.writeUInt16LE(this.entries.length, 10);
    eocd.writeUInt32LE(cdSize, 12);
    eocd.writeUInt32LE(cdStart, 16);
    eocd.writeUInt16LE(0, 20);            // comment length

    return Buffer.concat([...this.parts, ...cdBuffers, eocd]);
  }
}
