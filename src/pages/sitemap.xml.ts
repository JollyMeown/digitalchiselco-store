// Sitemap INDEX. The URL Search Console already has submitted, so the segments
// underneath are picked up without resubmitting anything.
//
// Segments and why they are split: see src/lib/sitemap.ts. In short, Google was
// indexing only 64% of the site and declining 431 product pages on crawl budget
// alone, so the catalogue is now presented in order of proven demand and each
// segment gets its own coverage number in Search Console.
export const prerender = false;

const SITE = process.env.PUBLIC_SITE_URL || (import.meta as any).env?.PUBLIC_SITE_URL || 'https://digitalchiselco.com';

const SEGMENTS = ['sitemap-pages.xml', 'sitemap-designs.xml', 'sitemap-new.xml', 'sitemap-blog.xml'];

export async function GET() {
  const today = new Date().toISOString().slice(0, 10);
  const body = SEGMENTS.map((s) => `  <sitemap>\n    <loc>${SITE}/${s}</loc>\n    <lastmod>${today}</lastmod>\n  </sitemap>`).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</sitemapindex>`;
  return new Response(xml, {
    headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600, s-maxage=3600' },
  });
}
