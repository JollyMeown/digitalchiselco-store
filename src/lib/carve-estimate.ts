// Carve estimate at a reference size, for search filters (2026-09-26).
//
// The SAME model as components/CarveCard.astro (and the Will it cut tool):
// one raster finishing pass at half feed plus roughing 45% of the block, at a
// mid hobby feed. Change the two together. Search compares every design at
// one size, 12 in on the long side, because carving time is set far more by
// the size a buyer chooses than by the design; at a fixed size what remains
// is the design's own shape and depth, which is what a filter can honestly
// sort by.
const IN = 25.4, FEED = 1800, DOC = 3;
export const STOCK_IN = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4];
export const REF_LONG_IN = 12;

function bitsFor(longIn: number) {
  if (longIn <= 10) return { roughDia: 3.175, roughDoc: 1.5, finDia: 1.5875, step: 10 };
  if (longIn <= 20) return { roughDia: 6.35, roughDoc: DOC, finDia: 3.175, step: 10 };
  return { roughDia: 6.35, roughDoc: DOC, finDia: 6.35, step: 10 };
}

/** Hours and the thinnest standard board (inches) for a design scaled to longIn. */
export function carveAt(w: number, h: number, d: number, longIn = REF_LONG_IN): { hours: number; board: number | null } | null {
  if (!(w > 0 && h > 0 && d > 0)) return null;
  const s = (longIn * IN) / Math.max(w, h);
  const sx = w * s, sy = h * s, depth = d * s;
  const b = bitsFor(longIn);
  const stepover = b.finDia * (b.step / 100);
  const finishMin = (Math.ceil(Math.min(sx, sy) / stepover) * Math.max(sx, sy)) / (FEED * 0.5);
  const roughMin = (sx * sy * depth * 0.45) / (b.roughDoc * b.roughDia * 0.4 * FEED);
  const board = STOCK_IN.find((t) => t >= depth / IN + 0.25) ?? null;
  return { hours: (finishMin + roughMin) / 60, board };
}
