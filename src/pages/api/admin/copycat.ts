// Admin: Copycat Watch (lib/copycat.ts).
//   GET                         -> matches (with our design), watch coverage
//   POST { id, status }         -> mark a match: new | reported | ignored | removed
//   POST { run: true }          -> check the 3 longest-unchecked designs now
import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../../lib/supabase';

export const prerender = false;
const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY!;
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const STATUSES = ['new', 'reported', 'ignored', 'removed'];

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

export const GET: APIRoute = async ({ request }) => {
  if (!(await isCallerAdmin(request))) return json({ error: 'Admin authentication required.' }, 401);
  const db = supabaseAdmin();
  const [{ data: matches }, { data: checks }] = await Promise.all([
    db.from('copycat_matches').select('*').order('status').order('last_seen', { ascending: false }).limit(500),
    db.from('copycat_checks').select('product_id, checked_at, results, matches').order('checked_at', { ascending: false }).limit(500),
  ]);
  const ids = [...new Set((matches || []).map((m: any) => m.product_id))];
  const { data: prods } = ids.length ? await db.from('products').select('id, title, slug, image_url').in('id', ids) : { data: [] as any[] };
  const byId = new Map((prods || []).map((p: any) => [p.id, p]));
  const C = checks || [];
  return json({
    matches: (matches || []).map((m: any) => ({ ...m, ours: byId.get(m.product_id) ? { title: String(byId.get(m.product_id).title).split('|')[0].trim(), slug: byId.get(m.product_id).slug, image: byId.get(m.product_id).image_url } : null })),
    coverage: {
      designsChecked: C.length,
      lastCheck: C[0]?.checked_at || null,
      oldestCheck: C.length ? C[C.length - 1].checked_at : null,
      listingsSeen: C.reduce((s: number, c: any) => s + (c.results || 0), 0),
    },
  });
};

export const POST: APIRoute = async ({ request }) => {
  if (!(await isCallerAdmin(request))) return json({ error: 'Admin authentication required.' }, 401);
  const body = await request.json().catch(() => ({}));
  const db = supabaseAdmin();
  if (body.run) {
    const { runCopycatBatch } = await import('../../../lib/copycat');
    const r = await runCopycatBatch(db, { limit: 3, deadlineMs: 20_000 });
    return json({ ok: true, run: r });
  }
  const id = Number(body.id), status = String(body.status || '');
  if (!id || !STATUSES.includes(status)) return json({ error: 'Bad request.' }, 400);
  const { error } = await db.from('copycat_matches').update({ status }).eq('id', id);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
};
