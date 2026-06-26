// Dynamic sitemap covering: static marketing pages + every active product +
// every category. Served at /sitemap.xml. Cached at the edge for 1 hour.

import { supabase } from '../lib/supabase';

export const prerender = false;

const SITE = process.env.PUBLIC_SITE_URL || (import.meta as any).env?.PUBLIC_SITE_URL || 'https://digitalchiselco.com';

// Static pages we want indexed (marketing / legal / commerce surfaces).
const STATIC_PATHS: Array<{ path: string; priority: number; changefreq: string }> = [
  { path: '/',            priority: 1.0, changefreq: 'daily' },
  { path: '/catalog',     priority: 0.9, changefreq: 'daily' },
  { path: '/collections', priority: 0.8, changefreq: 'weekly' },
  { path: '/pricing',     priority: 0.7, changefreq: 'weekly' },
  { path: '/membership',  priority: 0.7, changefreq: 'weekly' },
  { path: '/free',        priority: 0.6, changefreq: 'monthly' },
  { path: '/about',       priority: 0.5, changefreq: 'monthly' },
  { path: '/blog',        priority: 0.6, changefreq: 'weekly' },
  { path: '/terms',       priority: 0.2, changefreq: 'yearly' },
  { path: '/privacy',     priority: 0.2, changefreq: 'yearly' },
  { path: '/refunds',     priority: 0.2, changefreq: 'yearly' },
];

const xmlEsc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

function entry(loc: string, lastmod?: string | null, changefreq = 'weekly', priority = 0.5) {
  const parts = [
    '  <url>',
    `    <loc>${xmlEsc(loc)}</loc>`,
  ];
  if (lastmod) parts.push(`    <lastmod>${new Date(lastmod).toISOString().slice(0, 10)}</lastmod>`);
  parts.push(`    <changefreq>${changefreq}</changefreq>`);
  parts.push(`    <priority>${priority.toFixed(1)}</priority>`);
  parts.push('  </url>');
  return parts.join('\n');
}

export async function GET() {
  const urls: string[] = [];

  for (const s of STATIC_PATHS) {
    urls.push(entry(`${SITE}${s.path}`, null, s.changefreq, s.priority));
  }

  try {
    const { data: cats } = await supabase.from('categories').select('slug, created_at').limit(500);
    for (const c of cats || []) {
      urls.push(entry(`${SITE}/collections/${c.slug}`, c.created_at, 'weekly', 0.7));
    }
  } catch (e) { console.error('sitemap categories failed:', e); }

  try {
    // Paginate products in chunks so we don't trip Supabase's 1000-row cap.
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('products')
        .select('slug, updated_at')
        .eq('active', true)
        .order('slug')
        .range(from, from + 999);
      if (error) { console.error('sitemap products page failed:', error); break; }
      const rows = data || [];
      for (const p of rows) urls.push(entry(`${SITE}/product/${p.slug}`, p.updated_at, 'weekly', 0.6));
      if (rows.length < 1000) break;
    }
  } catch (e) { console.error('sitemap products failed:', e); }

  // Blog posts
  try {
    const { data: posts } = await supabase
      .from('posts')
      .select('slug, updated_at, published_at')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(500);
    for (const p of posts || []) {
      urls.push(entry(`${SITE}/blog/${p.slug}`, p.updated_at || p.published_at, 'monthly', 0.7));
    }
  } catch (e) { console.error('sitemap posts failed:', e); }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;

  return new Response(xml, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}
