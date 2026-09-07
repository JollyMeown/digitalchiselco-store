// Admin: delete BRS automation summaries from the owner_alerts feed.
//   POST {}            → delete every brs_* alert (one click "Clear all")
//   POST { id: 123 }   → delete one alert (must be a brs_* kind)
// Sales alerts (cults_sale, website_order, ...) are never touched here.
import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../../lib/supabase';

export const prerender = false;

const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY!;
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });

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

export const POST: APIRoute = async ({ request }) => {
  if (!(await isCallerAdmin(request))) return json({ error: 'Admin authentication required.' }, 401);
  const body = await request.json().catch(() => ({}));
  const db = supabaseAdmin();
  const id = Number(body?.id || 0);
  let q = db.from('owner_alerts').delete({ count: 'exact' }).like('kind', 'brs_%');
  if (id) q = q.eq('id', id);
  const { error, count } = await q;
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, deleted: count ?? 0 });
};
