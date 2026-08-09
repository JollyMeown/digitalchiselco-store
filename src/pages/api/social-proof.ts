// Public feed for the storefront social-proof popup. TRUTHFUL and RECENT only:
// real purchases from the last 7 days ("just grabbed"), topped up with real
// recent product views from the last 3 days ("is viewing"). We never fabricate
// a recent timestamp on a stale event — if nothing is recent, the popup simply
// stays quiet. Cached at the edge for a minute.
import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../lib/supabase';

export const prerender = false;
const DAY = 86400000;
const title1 = (t: string) => String(t || '').split('|')[0].trim().slice(0, 60);

export const GET: APIRoute = async () => {
  const db = supabaseAdmin();
  const items: any[] = [];
  const usedProducts = new Set<string>();

  // ── recent purchases (last 7 days) ──
  const { data: orders } = await db.from('orders')
    .select('id, created_at').is('deleted_at', null)
    .gte('created_at', new Date(Date.now() - 7 * DAY).toISOString())
    .order('created_at', { ascending: false }).limit(30);
  const timeById = new Map((orders || []).map((o) => [o.id, o.created_at]));
  if (orders?.length) {
    const { data: oi } = await db.from('order_items').select('order_id, product_id, title').in('order_id', orders.map((o) => o.id)).limit(120);
    for (const it of oi || []) {
      const key = String(it.product_id || it.title);
      if (usedProducts.has(key)) continue; usedProducts.add(key);
      items.push({ type: 'sale', title: title1(it.title), product_id: it.product_id, at: timeById.get(it.order_id) });
      if (items.filter((x) => x.type === 'sale').length >= 8) break;
    }
  }

  // ── recent views (last 3 days) to keep it lively and honest ──
  const { data: views } = await db.from('browse_events')
    .select('product_id, created_at').gte('created_at', new Date(Date.now() - 3 * DAY).toISOString())
    .order('created_at', { ascending: false }).limit(120);
  for (const v of views || []) {
    const key = String(v.product_id);
    if (!v.product_id || usedProducts.has(key)) continue; usedProducts.add(key);
    items.push({ type: 'view', product_id: v.product_id, at: v.created_at });
    if (items.length >= 14) break;
  }

  // attach slug + image + title
  const pids = items.map((i) => i.product_id).filter(Boolean);
  if (pids.length) {
    const { data: prods } = await db.from('products').select('id, slug, title, image_url').in('id', pids);
    const meta = new Map((prods || []).map((p) => [p.id, p]));
    for (const i of items) { const m = meta.get(i.product_id); if (m) { i.slug = m.slug; i.image_url = m.image_url; if (!i.title) i.title = title1(m.title); } }
  }

  return new Response(JSON.stringify({ items: items.filter((i) => i.slug) }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60, s-maxage=60' },
  });
};
