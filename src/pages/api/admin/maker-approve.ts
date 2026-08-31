// Admin: set a maker's status and, on first approval, send the welcome email
// (dashboard link + founding credits). Idempotent via makers.welcomed_at.
import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../../lib/supabase';
import { sendMakerWelcome } from '../../../lib/marketplace';

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
  const id = String(body?.id || '');
  const status = ['approved', 'rejected', 'suspended', 'pending'].includes(body?.status) ? body.status : '';
  if (!id || !status) return json({ error: 'id and valid status required' }, 400);

  const db = supabaseAdmin();
  const { data: m } = await db.from('makers').select('*').eq('id', id).maybeSingle();
  if (!m) return json({ error: 'Maker not found.' }, 404);
  await db.from('makers').update({ status, reviewed_at: new Date().toISOString() }).eq('id', id);

  let welcomed = false;
  if (status === 'approved' && !m.welcomed_at) {
    try { await sendMakerWelcome({ email: m.email, maker_name: m.maker_name, credits: m.credits ?? 5 }); await db.from('makers').update({ welcomed_at: new Date().toISOString() }).eq('id', id); welcomed = true; }
    catch (e) { console.error('[maker-approve] welcome failed:', (e as any)?.message); }
  }
  return json({ ok: true, welcomed });
};
