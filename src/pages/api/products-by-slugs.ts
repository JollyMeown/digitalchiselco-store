// POST { slugs: string[] } -> { products: ProductCard[] } in the SAME order as
// requested (so "recently viewed" keeps most-recent-first). Public, read-only.
import type { APIRoute } from 'astro';
import { supabase } from '../../lib/supabase';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const slugs = (Array.isArray(body.slugs) ? body.slugs : [])
      .filter((s: any) => typeof s === 'string' && s.length < 200).slice(0, 12);
    if (!slugs.length) return json({ products: [] });
    const { data } = await supabase
      .from('products')
      .select('id, title, slug, price_usd, image_url, is_bundle')
      .in('slug', slugs).eq('active', true).not('image_url', 'is', null);
    const bySlug = new Map((data || []).map((p: any) => [p.slug, p]));
    const ordered = slugs.map((s: string) => bySlug.get(s)).filter(Boolean);
    return json({ products: ordered });
  } catch (e) {
    console.error('products-by-slugs failed:', e);
    return json({ products: [] });
  }
};

const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
