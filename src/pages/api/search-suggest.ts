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
  const items = (data || []).map((p) => ({ slug: p.slug, title: String(p.title || '').split('|')[0].trim(), image_url: p.image_url, price: Number(p.price_usd) || 0 }));
  return new Response(JSON.stringify({ items }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60, s-maxage=120' },
  });
};
