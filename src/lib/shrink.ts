// Server-side image shrink for anything a visitor uploads.
//
// Owner, 2026-09-15: "whenever we upload any picture the resizer must take
// action first." Every public upload route was storing the raw bytes, so a
// phone photo arrived as 4000px and 6 MB and was then served at that size to
// whoever looked at it. This caps the long side and re-encodes as JPEG at a
// quality that is indistinguishable on screen. sharp is already a dependency
// (the /pin/ art uses it in this same function), so no new package.
//
// The cap is a parameter because the routes want different things: a review
// photo is decoration (1600 px is plenty); a custom-design photo is the SOURCE
// a relief gets modelled from, where detail is the whole point, so it keeps
// far more.
//
// Never throws. If sharp cannot read the file the original bytes are returned
// and the route behaves exactly as it did before.
export async function shrinkImage(
  buf: Buffer,
  opts: { max?: number; quality?: number } = {},
): Promise<{ buf: Buffer; contentType: string; ext: string; resized: boolean }> {
  const max = opts.max ?? 1600;
  const quality = opts.quality ?? 85;
  try {
    const sharp = (await import('sharp')).default;
    const img = sharp(buf, { failOn: 'none' }).rotate();   // honour EXIF orientation from phones
    const meta = await img.metadata();
    const w = meta.width || 0, h = meta.height || 0;
    const tooBig = Math.max(w, h) > max;
    // a small PNG may be a logo with transparency: leave it alone
    if (!tooBig && meta.format === 'png' && buf.length <= 400 * 1024) return { buf, contentType: 'image/png', ext: 'png', resized: false };
    if (!tooBig && meta.format === 'jpeg' && buf.length <= 600 * 1024) return { buf, contentType: 'image/jpeg', ext: 'jpg', resized: false };
    const out = await img
      .resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })   // JPEG has no alpha; white behind a transparent PNG
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    return { buf: out, contentType: 'image/jpeg', ext: 'jpg', resized: true };
  } catch {
    return { buf, contentType: 'application/octet-stream', ext: 'bin', resized: false };
  }
}
