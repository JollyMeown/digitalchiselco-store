import { supabase } from '../lib/supabase';

export const prerender = false;

export async function GET() {
  const site = import.meta.env.PUBLIC_SITE_URL || 'https://digitalchiselco.com';
  let products: { slug: string }[] = [];
  let cats: { slug: string }[] = [];
  try {
    const [p, c] = await Promise.all([
      supabase.from('products').select('slug').eq('active', true),
      supabase.from('categories').select('slug'),
    ]);
    products = p.data ?? [];
    cats = c.data ?? [];
  } catch (e) { console.error('sitemap query failed', e); }

  const staticPages = ['', 'catalog', 'collections', 'free', 'about', 'blog'];
  const urls = [
    ...staticPages,
    ...cats.map((c) => `collections/${c.slug}`),
    ...products.map((p) => `product/${p.slug}`),
  ];
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${site}/${u}</loc></url>`).join('\n')}
</urlset>`;
  return new Response(body, { headers: { 'content-type': 'application/xml; charset=utf-8' } });
}
