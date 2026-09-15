// Admin: what a seasonal collection will show, and a product search for
// adding to it by hand. The matching lives in getSeasonalProducts so the
// preview here is exactly what the public page and the homepage row render.
//   GET ?id=<collection id>          -> { members: [...], words: [...] }
//   GET ?id=<collection id>&q=deer   -> { results: [...] }  (title search)
import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../../lib/supabase';
import { getSeasonalProducts, seasonSubjectWords } from '../../../lib/queries';

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

export const GET: APIRoute = async ({ request, url }) => {
  if (!(await isCallerAdmin(request))) return json({ error: 'Admin authentication required.' }, 401);
  const db = supabaseAdmin();
  const q = String(url.searchParams.get('q') || '').trim();
  if (q) {
    const { data } = await db.from('products').select('id, title, slug, image_url, etsy_sales_365')
      .eq('active', true).ilike('title', `%${q.replace(/[%_,()*]/g, '')}%`)
      .order('etsy_sales_365', { ascending: false, nullsFirst: false }).limit(12);
    return json({ results: data || [] });
  }
  const id = String(url.searchParams.get('id') || '');
  const { data: col } = await db.from('seasonal_collections').select('*').eq('id', id).maybeSingle();
  if (!col) return json({ error: 'Collection not found.' }, 404);
  const members = await getSeasonalProducts(col, 120);
  const include = new Set((col.include_ids || []).map(String));
  return json({
    words: seasonSubjectWords(col.keywords),
    members: members.map((m: any) => ({ id: m.id, title: String(m.title).split('|')[0].trim(), slug: m.slug, image_url: m.image_url, sales: Number(m.etsy_sales_365) || 0, pinned: include.has(String(m.id)) })),
  });
};
