// Admin: one Cut Local request in full, which makers can take it, and a way to
// email the ones who were not told yet.
//
// Owner, 2026-09-30: "why can't I see the cut local request?" The Live
// marketplace card showed a one-line row per request with no way to open it.
// The same day the matching rules changed (maker-reach.ts), and the first
// request had to be sent again to makers near the border. That has to happen
// HERE, on the live site: maker sign-in links in the email are signed with the
// server's secret, and a link signed on another machine is rejected.
//
//   POST { id }                   -> { ok, request, quotes, makers: [{ name, place, kind, km, sure, told }] }
//   POST { id, notify: true }     -> emails the matching makers not told yet -> { ok, sent }
import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../../lib/supabase';
import { matchMakers, notifyMakersOfJob } from '../../../lib/marketplace';
import { placeLabel } from '../../../lib/place';

export const prerender = false;
const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY!;
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

async function callerAdmin(request: Request): Promise<boolean> {
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
  if (!(await callerAdmin(request))) return json({ error: 'Admins only.' }, 403);
  const b = await request.json().catch(() => ({} as any));
  const id = String(b.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'Missing request.' }, 400);
  const db = supabaseAdmin();

  const { data: req } = await db.from('maker_requests').select('*').eq('id', id).maybeSingle();
  if (!req) return json({ error: 'Request not found.' }, 404);

  const makers = await matchMakers(db, req);
  const { data: sent } = await db.from('email_send_log').select('recipient').like('batch_key', `mp-job:${id}:%`);
  const told = new Set((sent || []).map((s: any) => String(s.recipient).toLowerCase()));
  // makers who were told under the old rules but no longer match stay visible, so nothing is hidden
  const { data: toldRows } = told.size
    ? await db.from('makers').select('id, maker_name, email, city, region, country').in('email', [...told])
    : { data: [] as any[] };

  if (b.notify) {
    if (req.status !== 'open') return json({ error: `This request is ${req.status}; only open requests can be sent to makers.` }, 400);
    const fresh = makers.filter((m: any) => !told.has(String(m.email).toLowerCase()));
    if (!fresh.length) return json({ ok: true, sent: 0 });
    await notifyMakersOfJob(fresh, req);
    try {
      const { telegramOwner } = await import('../../../lib/notify');
      await telegramOwner(`🔨 <b>Cut Local request sent to ${fresh.length} more maker(s)</b>\n${(req.product_title || '').split('|')[0].trim()}\n${fresh.map((m: any) => m.maker_name).join(', ')}`);
    } catch {}
    return json({ ok: true, sent: fresh.length, names: fresh.map((m: any) => m.maker_name) });
  }

  const { data: quotes } = await db.from('maker_quotes').select('price, lead_days, message, status, created_at, makers(maker_name)').eq('request_id', id).order('created_at');
  const row = (m: any, kind: string, km: number | null, sure: boolean) => ({
    id: m.id, name: m.maker_name, place: placeLabel(m, { withCountry: true }), kind, km, sure,
    told: told.has(String(m.email).toLowerCase()),
  });
  const list = makers.map((m: any) => row(m, m._reach.kind, m._reach.km, m._reach.sure));
  for (const m of toldRows || []) if (!list.some((x: any) => x.id === m.id)) list.push(row(m, 'out of reach now', null, false));
  const { product_image, ...r } = req;
  return json({ ok: true, request: { ...r, place: placeLabel(req, { withCountry: true }) }, quotes: quotes || [], makers: list });
};
