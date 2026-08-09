// Quiz recommender: given selected theme slugs, return matching designs. Themes
// map to the same title keywords the SEO landing pages use.
import type { APIRoute } from 'astro';
import { supabase } from '../../lib/supabase';
import { LANDING_TOPICS } from '../../lib/landing';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const themes = (url.searchParams.get('themes') || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 6);
  const kws = new Set<string>();
  for (const slug of themes) {
    const t = LANDING_TOPICS.find((x) => x.slug === slug);
    for (const k of t?.keywords || []) kws.add(k);
  }
  let q = supabase.from('products').select('id, slug, title, price_usd, image_url, is_bundle').eq('active', true).not('image_url', 'is', null);
  if (kws.size) q = q.or([...kws].map((k) => `title.ilike.%${k}%`).join(','));
  q = q.order('is_bestseller', { ascending: false }).limit(12);
  const { data } = await q;
  return new Response(JSON.stringify({ items: data || [] }), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
};
