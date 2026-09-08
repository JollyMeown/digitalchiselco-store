// One source of truth for every sitemap the site serves.
//
// Why segments (2026-09-09): Google had indexed only 1,074 of 1,679 URLs, and
// 598 of the misses were product pages, 431 of them "Discovered, currently not
// indexed", which is Google declining to spend crawl budget rather than judging
// the page badly. A single flat list of 1,600+ near-identical product URLs, all
// at priority 0.6, gives Google nothing to prioritise by.
//
// Measured on the same day: products with Etsy sales are 72% indexed, products
// with none are 50% indexed. Google is already ranking our catalogue by proven
// demand, so the sitemap now says the same thing out loud:
//
//   /sitemap.xml            index of the four below
//   /sitemap-pages.xml      home, commerce, collections, landing pages
//   /sitemap-designs.xml    designs with real Etsy demand, priority by tier
//   /sitemap-new.xml        designs not yet proven, kept separate
//   /sitemap-blog.xml       guides
//
// Splitting also buys diagnosis: Search Console reports indexed counts PER
// sitemap, so "which half is Google refusing" becomes a number we can read
// instead of a guess. Nothing is removed from the site; every design stays
// live, linked from its collection, and crawlable.
import { supabase } from './supabase';
import { LANDING_TOPICS } from './landing';

export const SITE = process.env.PUBLIC_SITE_URL || (import.meta as any).env?.PUBLIC_SITE_URL || 'https://digitalchiselco.com';

export const xmlEsc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export function entry(loc: string, lastmod?: string | null, changefreq = 'weekly', priority = 0.5) {
  const parts = ['  <url>', `    <loc>${xmlEsc(loc)}</loc>`];
  if (lastmod) parts.push(`    <lastmod>${new Date(lastmod).toISOString().slice(0, 10)}</lastmod>`);
  parts.push(`    <changefreq>${changefreq}</changefreq>`);
  parts.push(`    <priority>${priority.toFixed(1)}</priority>`);
  parts.push('  </url>');
  return parts.join('\n');
}

export function urlset(urls: string[]): Response {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;
  return new Response(xml, {
    headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600, s-maxage=3600' },
  });
}

// Static pages we want indexed (marketing / legal / commerce surfaces).
export const STATIC_PATHS: Array<{ path: string; priority: number; changefreq: string }> = [
  { path: '/',            priority: 1.0, changefreq: 'daily' },
  { path: '/catalog',     priority: 0.9, changefreq: 'daily' },
  { path: '/collections', priority: 0.8, changefreq: 'weekly' },
  { path: '/bundle-builder', priority: 0.8, changefreq: 'weekly' },
  { path: '/gift-cards',  priority: 0.6, changefreq: 'monthly' },
  { path: '/requests',    priority: 0.5, changefreq: 'weekly' },
  { path: '/custom-design', priority: 0.7, changefreq: 'monthly' },
  { path: '/pricing',     priority: 0.7, changefreq: 'weekly' },
  { path: '/membership',  priority: 0.7, changefreq: 'weekly' },
  { path: '/laser-studio', priority: 0.8, changefreq: 'weekly' },
  { path: '/lamp-studio',  priority: 0.8, changefreq: 'weekly' },
  { path: '/bundle-of-week', priority: 0.7, changefreq: 'weekly' },
  { path: '/quiz',         priority: 0.5, changefreq: 'monthly' },
  { path: '/free',        priority: 0.6, changefreq: 'monthly' },
  { path: '/faq',         priority: 0.6, changefreq: 'monthly' },
  { path: '/about',       priority: 0.5, changefreq: 'monthly' },
  { path: '/blog',        priority: 0.6, changefreq: 'weekly' },
  { path: '/terms',       priority: 0.2, changefreq: 'yearly' },
  { path: '/privacy',     priority: 0.2, changefreq: 'yearly' },
  { path: '/refunds',     priority: 0.2, changefreq: 'yearly' },
];

/** Every product page, split by proven demand. Etsy sales are the only honest
 *  demand signal we have for a design, since the website itself has almost no
 *  traffic yet to judge by. */
export type ProductRow = { slug: string; updated_at: string | null; etsy_sales_365: number | null; rating_count: number | null };
export async function allProducts(): Promise<ProductRow[]> {
  const out: ProductRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('products')
      .select('slug, updated_at, etsy_sales_365, rating_count')
      .eq('active', true)
      .order('slug')
      .range(from, from + 999);
    if (error) { console.error('sitemap products page failed:', error); break; }
    const rows = (data || []) as ProductRow[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

/** Proven = it has sold on Etsy in the last year, or someone reviewed it here. */
export const isProven = (p: ProductRow) => Number(p.etsy_sales_365 || 0) >= 1 || Number(p.rating_count || 0) > 0;

/** Priority reflects demand, so Google has something to rank the list by. */
export function productPriority(p: ProductRow): number {
  const sales = Number(p.etsy_sales_365 || 0);
  if (sales >= 10) return 0.9;
  if (sales >= 3) return 0.8;
  if (sales >= 1) return 0.7;
  if (Number(p.rating_count || 0) > 0) return 0.7;
  return 0.4;
}
