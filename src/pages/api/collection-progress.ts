// "Complete the collection" progress: how many designs in a category does this
// email already own? Powers the progress bar on collection pages. Returns only
// COUNTS (no titles or ids) so probing someone else's email reveals almost
// nothing; rate-limited per IP on top.
import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../lib/supabase';
import { rateLimit, clientIp } from '../../lib/rate-limit';

export const prerender = false;
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export const POST: APIRoute = async ({ request }) => {
  try {
    if (!(await rateLimit(`collprog:ip:${clientIp(request)}`, 60, 3600))) return json({ ok: false }, 200);
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || '').toLowerCase().trim();
    const slug = String(body.slug || '').trim().slice(0, 120);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !slug) return json({ ok: false }, 200);

    const db = supabaseAdmin();
    const { data: cat } = await db.from('categories').select('id').eq('slug', slug).maybeSingle();
    if (!cat) return json({ ok: false }, 200);

    const { data: pcs } = await db.from('product_categories')
      .select('product_id, products!inner(active, price_usd)')
      .eq('category_id', cat.id).limit(1000);
    const ids = (pcs || []).filter((r: any) => r.products?.active && Number(r.products.price_usd) > 0).map((r: any) => r.product_id);
    if (!ids.length) return json({ ok: false }, 200);

    const { data: ents } = await db.from('entitlements').select('product_id').eq('email', email).in('product_id', ids);
    const owned = new Set((ents || []).map((e: any) => e.product_id)).size;
    return json({ ok: true, owned, total: ids.length });
  } catch {
    return json({ ok: false }, 200);
  }
};
