// Admin-only Category Manager API.
//   GET ?view=categories                      → categories + product counts
//   GET ?view=products&category_id=&page=      → products in a category (+ their category ids)
//   POST { product_id, move_to, move_from? }   → add move_to, remove move_from (i.e. move)
//   POST { product_id, remove }                → remove a single category
// Edits the product_categories join table. Caller must be an admin.
import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../../lib/supabase';

export const prerender = false;
const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY!;
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

async function isCallerAdmin(request: Request): Promise<boolean> {
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return false;
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: who } = await userClient.auth.getUser();
  if (!who?.user?.id) return false;
  const { data: prof } = await supabaseAdmin().from('profiles').select('is_admin').eq('id', who.user.id).maybeSingle();
  return !!prof?.is_admin;
}

const PAGE = 60;

export const GET: APIRoute = async ({ request, url }) => {
  if (!(await isCallerAdmin(request))) return json({ error: 'Admin authentication required.' }, 401);
  const db = supabaseAdmin();
  const view = url.searchParams.get('view') || 'categories';
  try {
    if (view === 'categories') {
      const { data: cats } = await db.from('categories').select('id, name, slug, sort_order').order('sort_order');
      const { data: links } = await db.from('product_categories').select('category_id').limit(100000);
      const counts: Record<string, number> = {};
      for (const l of links || []) counts[l.category_id] = (counts[l.category_id] || 0) + 1;
      return json({ ok: true, categories: (cats || []).map((c) => ({ ...c, count: counts[c.id] || 0 })) });
    }
    if (view === 'products') {
      const categoryId = url.searchParams.get('category_id') || '';
      const page = Math.max(0, Number(url.searchParams.get('page')) || 0);
      if (!categoryId) return json({ error: 'category_id required' }, 400);
      const { data: links, count } = await db.from('product_categories')
        .select('product_id', { count: 'exact' }).eq('category_id', categoryId).range(page * PAGE, page * PAGE + PAGE - 1);
      const ids = (links || []).map((l) => l.product_id);
      if (!ids.length) return json({ ok: true, products: [], total: count || 0, page });
      const { data: prods } = await db.from('products').select('id, slug, title, image_url, price_usd, active').in('id', ids);
      // each product's full set of category ids (so we can show/return chips)
      const { data: allLinks } = await db.from('product_categories').select('product_id, category_id').in('product_id', ids);
      const catsByProduct: Record<string, string[]> = {};
      for (const l of allLinks || []) (catsByProduct[l.product_id] ||= []).push(l.category_id);
      const products = (prods || []).map((p) => ({ ...p, category_ids: catsByProduct[p.id] || [] }));
      return json({ ok: true, products, total: count || 0, page, pageSize: PAGE });
    }
    return json({ error: 'unknown view' }, 400);
  } catch (e: any) { return json({ error: e?.message || 'failed' }, 500); }
};

export const POST: APIRoute = async ({ request }) => {
  if (!(await isCallerAdmin(request))) return json({ error: 'Admin authentication required.' }, 401);
  const db = supabaseAdmin();
  try {
    const body = await request.json().catch(() => ({}));
    const productId = String(body.product_id || '');
    if (!productId) return json({ error: 'product_id required' }, 400);
    const moveTo = body.move_to ? String(body.move_to) : '';
    const moveFrom = body.move_from ? String(body.move_from) : '';
    const remove = body.remove ? String(body.remove) : '';

    if (remove) {
      await db.from('product_categories').delete().eq('product_id', productId).eq('category_id', remove);
    }
    if (moveTo) {
      // add target (ignore if already there)
      await db.from('product_categories').upsert({ product_id: productId, category_id: moveTo }, { onConflict: 'product_id,category_id', ignoreDuplicates: true });
      // remove source if this was a move and they differ
      if (moveFrom && moveFrom !== moveTo) await db.from('product_categories').delete().eq('product_id', productId).eq('category_id', moveFrom);
    }
    // return the product's new category set
    const { data: links } = await db.from('product_categories').select('category_id').eq('product_id', productId);
    return json({ ok: true, category_ids: (links || []).map((l) => l.category_id) });
  } catch (e: any) { return json({ error: e?.message || 'failed' }, 500); }
};
