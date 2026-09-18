// Admin refunds (migration 140), so the owner never has to open Paddle.
//   GET                                  -> charges for designs the buyer already owned
//   POST {action:'refund', orderId, mode:'duplicate'|'full', reason?}
//   POST {action:'dismiss', orderId}     -> "not a mistake", hide it
import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../../lib/supabase';
import { findDuplicateCharges, refundOrder } from '../../../lib/refunds';

export const prerender = false;
const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY!;
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function callerAdmin(request: Request): Promise<{ ok: boolean; email?: string }> {
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return { ok: false };
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: who } = await userClient.auth.getUser();
  if (!who?.user?.id) return { ok: false };
  const { data: prof } = await supabaseAdmin().from('profiles').select('is_admin').eq('id', who.user.id).maybeSingle();
  return { ok: !!prof?.is_admin, email: who.user.email || undefined };
}

export const GET: APIRoute = async ({ request }) => {
  if (!(await callerAdmin(request)).ok) return json({ error: 'Admins only.' }, 403);
  try { return json({ duplicates: await findDuplicateCharges(supabaseAdmin()) }); }
  catch (e: any) { return json({ error: e?.message || 'Could not check for double charges.' }, 500); }
};

export const POST: APIRoute = async ({ request }) => {
  const who = await callerAdmin(request);
  if (!who.ok) return json({ error: 'Admins only.' }, 403);
  const b = await request.json().catch(() => ({} as any));
  const orderId = String(b.orderId || '');
  if (!UUID.test(orderId)) return json({ error: 'Missing order.' }, 400);
  const db = supabaseAdmin();
  try {
    if (b.action === 'dismiss') {
      await db.from('orders').update({ duplicate_dismissed_at: new Date().toISOString() }).eq('id', orderId);
      return json({ ok: true });
    }
    if (b.action === 'refund') {
      const mode = b.mode === 'full' ? 'full' : 'duplicate';
      const r = await refundOrder(db, orderId, { mode, reason: typeof b.reason === 'string' ? b.reason : undefined, by: who.email });
      return json({ ok: true, ...r });
    }
    return json({ error: 'Unknown action.' }, 400);
  } catch (e: any) {
    // Paddle's own words are the most useful thing to show (e.g. a key without refund permission).
    return json({ error: e?.message || 'Refund failed.' }, 400);
  }
};
