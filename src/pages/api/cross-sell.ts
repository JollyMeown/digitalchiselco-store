// Public cross-sell feed — used by the BRS download-PDF builder to append a
// "More from DigitalChiselCo" page to every bundle PDF. Read-only, no PII.
//
//   GET /api/cross-sell?theme=celtic+dragons&n=6
//
// Returns up to n active products; theme words are matched against titles
// first (most relevant designs), then random recent products fill the rest.
import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../lib/supabase';

export const prerender = false;

const SITE = 'https://digitalchiselco.com';

export const GET: APIRoute = async ({ url }) => {
  try {
    const n = Math.min(8, Math.max(1, Number(url.searchParams.get('n')) || 6));
    const theme = String(url.searchParams.get('theme') || '').slice(0, 120);
    const words = theme.toLowerCase().match(/[a-z]{4,}/g)?.slice(0, 4) || [];

    const db = supabaseAdmin();
    const base = () => db.from('products')
      .select('slug, title, price_usd, image_url')
      .eq('active', true).gt('price_usd', 0)
      .not('slug', 'like', 'gift-card-%')
      .not('slug', 'like', 'catalogue-%');

    const picked: any[] = [];
    const seen = new Set<string>();
    if (words.length) {
      const { data: themed } = await base()
        .or(words.map((w) => `title.ilike.%${w}%`).join(','))
        .limit(24);
      for (const p of themed || []) {
        if (!seen.has(p.slug)) { seen.add(p.slug); picked.push(p); }
        if (picked.length >= n) break;
      }
    }
    if (picked.length < n) {
      const { data: pool } = await base().order('created_at', { ascending: false }).limit(80);
      const rest = (pool || []).filter((p) => !seen.has(p.slug));
      // light shuffle so every PDF doesn't advertise the same 6 designs
      for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rest[i], rest[j]] = [rest[j], rest[i]];
      }
      for (const p of rest) {
        picked.push(p);
        if (picked.length >= n) break;
      }
    }

    return new Response(JSON.stringify({
      products: picked.map((p) => ({
        title: String(p.title || '').split('|')[0].trim(),
        price: Number(p.price_usd),
        image: p.image_url || null,
        url: `${SITE}/product/${p.slug}`,
      })),
    }), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ products: [], error: e.message }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
};
