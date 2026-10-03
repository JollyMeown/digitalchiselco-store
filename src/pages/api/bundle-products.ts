// Every design that can go in a Pick 5, for the builder's search. The page
// itself lists the 600 newest so it opens fast; this fills in the rest of the
// catalogue the first time someone searches (owner, 2026-10-03: the banner
// says "any five from the whole catalogue", so the search must cover it).
import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../lib/supabase';
import { bundle5Filter } from '../../lib/bundle5';
import { img } from '../../lib/img';

export const prerender = false;

// Compact rows [id, title, price, image] (about half the size of objects):
// a thumbnail that follows the usual pattern is sent as the part that differs,
// and the builder puts `pre` and `suf` back round it.
export const GET: APIRoute = async () => {
  const rows: [string, string, number, string][] = [];
  let pre = '', suf = '';
  try {
    for (let from = 0; from < 20000; from += 1000) {
      const { data, error } = await bundle5Filter(supabaseAdmin().from('products').select('id, title, price_usd, image_url'))
        .order('created_at', { ascending: false }).range(from, from + 999);
      if (error) break;
      for (const p of data || []) {
        const full = p.image_url ? img(p.image_url, { w: 300, square: true, q: 75 }) : '';
        const m = full.match(/^(.*\/render\/image\/public\/)(.*?)(\?.*)$/);
        if (m && !pre) { pre = m[1]; suf = m[3]; }
        rows.push([p.id, String(p.title || '').split('|')[0].trim(), Number(p.price_usd), m && m[1] === pre && m[3] === suf ? m[2] : full]);
      }
      if (!data || data.length < 1000) break;
    }
  } catch { /* an empty list leaves the builder with its own 600 */ }
  return new Response(JSON.stringify({ pre, suf, rows }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=600, s-maxage=3600' },
  });
};
