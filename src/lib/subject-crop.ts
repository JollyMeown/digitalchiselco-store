// Trim the studio backdrop around a carving, without ever touching the design.
//
// Product heroes are shot on cream cloth, so a grid of them reads as four
// different amounts of fabric rather than four designs. This finds where the
// cloth ends and returns a RECTANGLE around everything else. Because the result
// is only ever a rectangular crop, no element inside the design can be lost,
// which is the standing rule for every marketing image we build.
//
// Method: flood-fill inward from the border across pixels close in colour to the
// border itself, then take the bounding box of whatever the fill could not
// reach. A ragged mask is fine: only the extents matter.

export type Box = { left: number; top: number; width: number; height: number };

function boundingBox(data: Buffer | Uint8Array, w: number, h: number, ch: number): Box | null {
  const at = (x: number, y: number) => (y * w + x) * ch;
  const seeds: [number, number][] = [];
  for (let x = 0; x < w; x += 3) { seeds.push([x, 0], [x, h - 1]); }
  for (let y = 0; y < h; y += 3) { seeds.push([0, y], [w - 1, y]); }

  let sr = 0, sg = 0, sb = 0;
  for (const [x, y] of seeds) { const i = at(x, y); sr += data[i]; sg += data[i + 1]; sb += data[i + 2]; }
  const n = seeds.length;
  const br = sr / n, bg = sg / n, bb = sb / n;
  // Cloth backdrops sit around luminance 200-255 and vary with folds, so the
  // tolerance is generous; the bounding box absorbs any over-reach.
  const TOL = 44;
  const near = (i: number) => Math.abs(data[i] - br) < TOL && Math.abs(data[i + 1] - bg) < TOL && Math.abs(data[i + 2] - bb) < TOL;

  const isBg = new Uint8Array(w * h);
  const stack: number[] = [];
  for (const [x, y] of seeds) {
    const p = y * w + x;
    if (!isBg[p] && near(at(x, y))) { isBg[p] = 1; stack.push(p); }
  }
  while (stack.length) {
    const p = stack.pop() as number;
    const x = p % w, y = (p / w) | 0;
    if (x > 0 && !isBg[p - 1] && near(at(x - 1, y))) { isBg[p - 1] = 1; stack.push(p - 1); }
    if (x < w - 1 && !isBg[p + 1] && near(at(x + 1, y))) { isBg[p + 1] = 1; stack.push(p + 1); }
    if (y > 0 && !isBg[p - w] && near(at(x, y - 1))) { isBg[p - w] = 1; stack.push(p - w); }
    if (y < h - 1 && !isBg[p + w] && near(at(x, y + 1))) { isBg[p + w] = 1; stack.push(p + w); }
  }

  let x0 = w, y0 = h, x1 = -1, y1 = -1, subject = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (isBg[y * w + x]) continue;
      subject++;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  const frac = subject / (w * h);
  // Nothing found, or the fill ate the carving: caller keeps the whole image.
  if (x1 < 0 || frac > 0.96 || frac < 0.06) return null;
  return { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/**
 * Return the image cropped to the carving, or the original when the backdrop
 * cannot be identified confidently. `sharp` is passed in so this stays free of
 * a top-level dependency in edge contexts.
 */
export async function cropToSubject(sharp: any, buf: Buffer, pad = 0.02): Promise<Buffer> {
  try {
    const meta = await sharp(buf).metadata();
    if (!meta.width || !meta.height) return buf;
    const SCAN = 320;
    const { data, info } = await sharp(buf).resize(SCAN, null, { fit: 'inside' }).removeAlpha().raw()
      .toBuffer({ resolveWithObject: true });
    const box = boundingBox(data, info.width, info.height, info.channels);
    if (!box) return buf;
    const sx = meta.width / info.width, sy = meta.height / info.height;
    const px = info.width * pad, py = info.height * pad;
    const left = Math.max(0, Math.round((box.left - px) * sx));
    const top = Math.max(0, Math.round((box.top - py) * sy));
    const right = Math.min(meta.width, Math.round((box.left + box.width + px) * sx));
    const bottom = Math.min(meta.height, Math.round((box.top + box.height + py) * sy));
    const width = right - left, height = bottom - top;
    if (width < 80 || height < 80) return buf;
    return await sharp(buf).extract({ left, top, width, height }).toBuffer();
  } catch {
    return buf;   // marketing art must never fail because of a crop
  }
}
