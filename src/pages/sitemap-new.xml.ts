// Designs that have not sold anywhere yet. Kept in their own sitemap so
// Search Console reports their indexed count separately: if Google keeps
// declining this segment while the proven one climbs, that is the answer, and
// this file can be dropped from the index without touching the pages.
import { SITE, entry, urlset, allProducts, isProven, productPriority } from '../lib/sitemap';

export const prerender = false;

export async function GET() {
  const urls: string[] = [];
  try {
    for (const p of await allProducts()) {
      if (isProven(p)) continue;
      urls.push(entry(`${SITE}/product/${p.slug}`, p.updated_at, 'monthly', productPriority(p)));
    }
  } catch (e) { console.error('sitemap-new failed:', e); }
  return urlset(urls);
}
