// Guides. Small, high value, and the single best performing section in Search
// Console, so it gets its own sitemap and its own coverage number.
import { supabase } from '../lib/supabase';
import { SITE, entry, urlset } from '../lib/sitemap';

export const prerender = false;

export async function GET() {
  const urls: string[] = [];
  try {
    const { data: posts } = await supabase
      .from('posts')
      .select('slug, updated_at, published_at')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(500);
    for (const p of posts || []) {
      urls.push(entry(`${SITE}/blog/${p.slug}`, p.updated_at || p.published_at, 'monthly', 0.8));
    }
  } catch (e) { console.error('sitemap-blog failed:', e); }
  return urlset(urls);
}
