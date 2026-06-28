// Supabase Storage URL transformer. Switches /storage/v1/object/public/...
// to /storage/v1/render/image/public/... and appends width + quality params
// so we can serve right-sized variants instead of the full upload (~4× smaller
// on average for product-card thumbnails).
//
// Falls back to the original URL untouched for non-Supabase hosts (e.g.
// legacy Etsy CDN URLs that never got migrated).

const SUPABASE_OBJECT_PREFIX = '/storage/v1/object/public/';
const SUPABASE_RENDER_PREFIX = '/storage/v1/render/image/public/';

export function img(url: string | null | undefined, opts: { w?: number; q?: number } = {}): string {
  if (!url) return '';
  if (!url.includes(SUPABASE_OBJECT_PREFIX)) return url; // non-Supabase host
  const transformed = url.replace(SUPABASE_OBJECT_PREFIX, SUPABASE_RENDER_PREFIX);
  const params: string[] = [];
  if (opts.w) params.push(`width=${opts.w}`);
  if (opts.q) params.push(`quality=${opts.q}`);
  return params.length ? `${transformed}?${params.join('&')}` : transformed;
}

// srcset helper for responsive images. Generates 1x/2x variants at the given
// CSS width so the browser picks the right one based on device pixel ratio.
export function imgSrcSet(url: string | null | undefined, cssWidth: number, q = 75): { src: string; srcset: string } {
  if (!url) return { src: '', srcset: '' };
  const src = img(url, { w: cssWidth, q });
  const x2 = img(url, { w: cssWidth * 2, q });
  return { src, srcset: `${src} 1x, ${x2} 2x` };
}
