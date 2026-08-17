// Lightweight typeahead for the header search box. Returns a handful of
// matching designs with thumbnails. Cached briefly at the edge.
import type { APIRoute } from 'astro';
import { supabase } from '../../lib/supabase';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const q = (url.searchParams.get('q') || '').trim().slice(0, 60);
  if (q.length < 2) return new Response(JSON.stringify({ items: [] }), { headers: { 'content-type': 'application/json' } });
  const { data } = await supabase
    .from('products')
    .select('slug, title, image_url, price_usd')
    .eq('active', true).ilike('title', `%${q}%`).not('image_url', 'is', null)
    .order('is_bestseller', { ascending: false }).limit(6);
  let rows = data || [];
  let via: string | null = null;
  // Nothing for the literal string → try synonym alternatives so the dropdown
  // still helps ("kitty" → cat, "xmas" → christmas, "us flag" → american flag).
  if (!rows.length) {
    const { expand } = await import('../../lib/search-smart');
    const alts = expand(q).map((t) => t.replace(/[,()*]/g, '')).filter((t) => t.length >= 2 && t !== q.toLowerCase()).slice(0, 10);
    if (alts.length) {
      const { data: d2 } = await supabase.from('products').select('slug, title, image_url, price_usd')
        .eq('active', true).not('image_url', 'is', null)
        .or(alts.map((t) => `title.ilike.*${t}*`).join(','))
        .order('is_bestseller', { ascending: false }).limit(6);
      rows = d2 || [];
      if (rows.length) via = alts[0];
    }
  }
  const items = rows.map((p) => ({ slug: p.slug, title: String(p.title || '').split('|')[0].trim(), image_url: p.image_url, price: Number(p.price_usd) || 0 }));
  return new Response(JSON.stringify({ items, via }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60, s-maxage=120' },
  });
};
