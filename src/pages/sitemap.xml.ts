import { supabase } from '../lib/supabase';

export const prerender = false;

export async function GET() {
  const site = import.meta.env.PUBLIC_SITE_URL || 'https://digitalchiselco.com';
  let products: { slug: string }[] = [];
  let cats: { slug: string }[] = [];
  try {
    const { data: c } = await supabase.from('categories').select('slug');
    cats = c ?? [];
    // paginate past Supabase's 1000-row cap so every product is in the sitemap
    for (let from = 0; ; from += 1000) {
      const { data } = await supabase.from('products').select('slug').eq('active', true).range(from, from + 999);
      if (!data || data.length === 0) break;
      products.push(...data);
      if (data.length < 1000) break;
    }
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
