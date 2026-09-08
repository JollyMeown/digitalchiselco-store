// Designs with proven demand: sold on Etsy in the last year, or reviewed here.
// This is the segment we want Google to spend its crawl budget on.
import { SITE, entry, urlset, allProducts, isProven, productPriority } from '../lib/sitemap';

export const prerender = false;

export async function GET() {
  const urls: string[] = [];
  try {
    for (const p of await allProducts()) {
      if (!isProven(p)) continue;
      urls.push(entry(`${SITE}/product/${p.slug}`, p.updated_at, 'weekly', productPriority(p)));
    }
  } catch (e) { console.error('sitemap-designs failed:', e); }
  return urlset(urls);
}
