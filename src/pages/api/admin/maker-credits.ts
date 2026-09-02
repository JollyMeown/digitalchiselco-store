// Admin: give makers free quote credits.
//
// Three shapes, all admin-only and all recorded in maker_ledger so every free
// credit is auditable:
//   { id, credits, reason?, notify? }        → one maker
//   { audience: 'approved', credits, ... }   → every approved maker (launch gift)
//   { founding: N }                          → change the credits new makers get
//
// Negative amounts are allowed for corrections but never take a maker below 0.
import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../../lib/supabase';
import { sendMakerCreditsGranted } from '../../../lib/marketplace';

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
  const b = await request.json().catch(() => ({} as any));
  const db = supabaseAdmin();

  // ── change the founding grant for future makers ───────────────────────
  if (b?.founding !== undefined) {
    const n = Math.max(0, Math.min(200, Math.round(Number(b.founding) || 0)));
    await db.from('growth_settings').update({ founding_credits: n }).eq('id', 1);
    return json({ ok: true, founding_credits: n });
  }

  const credits = Math.round(Number(b?.credits) || 0);
  if (!credits || Math.abs(credits) > 500) return json({ error: 'credits must be a non-zero whole number up to 500.' }, 400);
  const reason = String(b?.reason || '').slice(0, 200) || (credits > 0 ? 'Gift from DigitalChiselCo' : 'Adjustment');
  const notify = b?.notify !== false && credits > 0;   // only ever email about a gift

  // ── who gets it ───────────────────────────────────────────────────────
  let makers: any[] = [];
  if (b?.audience === 'approved') {
    const { data } = await db.from('makers').select('id, email, maker_name, credits').eq('status', 'approved').limit(2000);
    makers = data || [];
  } else if (b?.id) {
    const { data } = await db.from('makers').select('id, email, maker_name, credits').eq('id', String(b.id)).maybeSingle();
    if (!data) return json({ error: 'Maker not found.' }, 404);
    makers = [data];
  } else {
    return json({ error: 'Pass an id, or audience "approved".' }, 400);
  }
  if (!makers.length) return json({ error: 'No makers matched.' }, 400);

  const results: { email: string; ok: boolean; balance?: number; error?: string }[] = [];
  for (const m of makers) {
    const before = Number(m.credits) || 0;
    const after = Math.max(0, before + credits);          // never negative
    const delta = after - before;                          // what actually moved
    if (delta === 0) { results.push({ email: m.email, ok: true, balance: after }); continue; }
    const { error } = await db.from('makers').update({ credits: after }).eq('id', m.id);
    if (error) { results.push({ email: m.email, ok: false, error: error.message }); continue; }
    await db.from('maker_ledger').insert({ maker_id: m.id, kind: 'credit_grant', credits_delta: delta, note: reason });
    if (notify) {
      try { await sendMakerCreditsGranted({ email: m.email, maker_name: m.maker_name, credits: delta, balance: after, reason }); }
      catch (e) { console.error('[maker-credits] email failed:', (e as any)?.message); }
    }
    results.push({ email: m.email, ok: true, balance: after });
  }
  const granted = results.filter((r) => r.ok).length;
  return json({ ok: true, granted, notified: notify, results });
};
