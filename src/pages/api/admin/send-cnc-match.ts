// Admin: announce CNC Match to the people who own a CNC.
//
// Same shape as the other senders: { preview } returns the HTML, { test } sends
// one to the shop inbox, { audience } sends the real thing.
//
// The audience split is the point of this endpoint. The list is 2,222 mailable
// addresses and 2,035 of them are imported Etsy buyers who have never opened
// anything. Mailing all of them at once is how a sending domain earns spam
// complaints, and the complaints cost deliverability on the people who DO read.
// So:
//
//   audience: 'warm'  everyone except imported addresses that have never
//                     engaged. Anyone who has ever opened or clicked counts as
//                     warm whatever their source, which is the same definition
//                     lib/resend already uses for its cold throttle.
//   audience: 'cold'  the remainder, to be sent only after the warm send's
//                     complaint rate has been read.
//   audience: 'all'   both, for when that has been decided.
//
// Every send is written to the central ledger keyed cnc-match:<audience>, so a
// second press reaches only people who have not had it, and the cold send never
// re-mails the warm half.
import type { APIRoute } from 'astro';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../../lib/supabase';
import { send as sendEmail, sendBatch } from '../../../lib/resend';
import { cncMatchEmail, unsubHeaders } from '../../../lib/marketing-emails';

export const prerender = false;
const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY!;
const OPS_INBOX = 'jolly@digitalchiselco.com';
const CAMPAIGN = 'cnc-match';
const COLD_SOURCES = ['etsy-buyer', 'Etsy', 'import'];
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

/** Paged, because PostgREST caps a plain select and a missed row means a
 *  second email to someone who already had one. */
async function page<T>(db: any, table: string, cols: string, tweak?: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    let q = db.from(table).select(cols).range(from, from + 999);
    if (tweak) q = tweak(q);
    const { data, error } = await q;
    if (error || !data?.length) break;
    out.push(...(data as T[]));
    if (data.length < 1000) break;
  }
  return out;
}

type Sub = { email: string; name: string | null; source: string | null; unsubscribed_at: string | null; suppressed_at: string | null };

async function segments(db: any) {
  const subs = await page<Sub>(db, 'subscribers', 'email, name, source, unsubscribed_at, suppressed_at');
  const live = subs.filter((s) => s.email && !s.unsubscribed_at && !s.suppressed_at);

  const maybeCold = live.filter((s) => COLD_SOURCES.includes(String(s.source || '')));
  const coldSet = new Set(maybeCold.map((s) => s.email.toLowerCase().trim()));

  // anyone who has EVER opened or clicked is warm, whatever their source
  const ids = [...coldSet];
  for (let i = 0; i < ids.length; i += 200) {
    const { data: ev } = await db.from('email_events')
      .select('email').in('email', ids.slice(i, i + 200)).in('event', ['opened', 'clicked']).limit(4000);
    for (const e of ev || []) coldSet.delete(String(e.email).toLowerCase().trim());
  }

  const byEmail = new Map<string, Sub>();
  for (const s of live) byEmail.set(s.email.toLowerCase().trim(), s);
  const warm = [...byEmail.keys()].filter((e) => !coldSet.has(e));
  // 'core' is narrower than 'warm' on purpose. Warm includes ~1,065 imported
  // Etsy buyers who have opened something at some point, which is a real
  // signal but still a 1,200 person send. Core is the people who came to us
  // directly: the free pack, buyers, members. About 180, small enough to read
  // a complaint rate from before committing the rest.
  const DIRECT = new Set(['free-pack', 'buyer', 'membership', 'custom-ask', 'mailerlite']);
  const core = warm.filter((e) => DIRECT.has(String(byEmail.get(e)?.source || '')));
  return { byEmail, warm, core, cold: [...coldSet], total: live.length };
}

/** Who has already had this, from the central ledger. */
async function already(db: any): Promise<Set<string>> {
  const out = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('email_send_log').select('recipient')
      .eq('status', 'sent').like('batch_key', `${CAMPAIGN}:%`).range(from, from + 999);
    if (error || !data?.length) break;
    for (const r of data) if (r.recipient) out.add(String(r.recipient).toLowerCase().trim());
    if (data.length < 1000) break;
  }
  return out;
}

export const POST: APIRoute = async ({ request }) => {
  if (!(await isCallerAdmin(request))) return json({ error: 'Admin authentication required.' }, 401);
  const b = await request.json().catch(() => ({} as any));
  const db = supabaseAdmin();

  if (b?.preview) {
    const { subject, html } = cncMatchEmail({ email: 'preview@example.com', name: null });
    return json({ ok: true, subject, html });
  }

  const seg = await segments(db);
  const done = await already(db);

  if (b?.stats) {
    return json({
      ok: true, total: seg.total,
      core: seg.core.length, coreRemaining: seg.core.filter((e) => !done.has(e)).length,
      warm: seg.warm.length, warmRemaining: seg.warm.filter((e) => !done.has(e)).length,
      cold: seg.cold.length, coldRemaining: seg.cold.filter((e) => !done.has(e)).length,
      sent: done.size,
    });
  }

  if (b?.test) {
    const { subject, html, text } = cncMatchEmail({ email: OPS_INBOX, name: null });
    const r: any = await sendEmail({
      to: OPS_INBOX, subject: `TEST: ${subject}`, html, text, headers: unsubHeaders(OPS_INBOX),
      idempotencyKey: `${CAMPAIGN}-test:${Date.now()}`,
      tags: [{ name: 'kind', value: 'cncMatch' }],
    });
    return json({ ok: !!r?.ok, sent: r?.ok ? 1 : 0, total: 1, error: r?.error });
  }

  const audience = String(b?.audience || '');
  if (!['core', 'warm', 'cold', 'all'].includes(audience)) {
    return json({ error: 'Pass preview, stats, test, or audience "core" | "warm" | "cold" | "all".' }, 400);
  }
  const pool = audience === 'core' ? seg.core : audience === 'warm' ? seg.warm : audience === 'cold' ? seg.cold : [...seg.warm, ...seg.cold];
  const recipients = pool.filter((e) => !done.has(e));
  const skipped = pool.length - recipients.length;

  if (!recipients.length) {
    return json({ ok: true, sent: 0, total: 0, skipped, message: skipped ? `Everyone in the ${audience} segment has already had this (${skipped}).` : 'Nobody in that segment.' });
  }

  let sent = 0;
  const errors: string[] = [];
  for (let i = 0; i < recipients.length; i += 100) {
    const slice = recipients.slice(i, i + 100);
    const batch = slice.map((to) => {
      const sub = seg.byEmail.get(to);
      const { subject, html, text } = cncMatchEmail({ email: to, name: sub?.name || null });
      return { to, subject, html, text, headers: unsubHeaders(to), tags: [{ name: 'kind', value: 'cncMatch' }] };
    });
    const who = createHash('sha1').update(slice.join(',')).digest('hex').slice(0, 12);
    const r = await sendBatch(batch, `${CAMPAIGN}:${audience}:${who}`);
    if (r.ok) sent += r.sent || slice.length;
    else {
      errors.push(String(r.error || 'batch failed').slice(0, 140));
      if ((r as any).quota) { errors.push('stopped: daily budget reached, press again tomorrow'); break; }
    }
  }
  return json({ ok: !errors.length, sent, total: recipients.length, skipped, audience, errors });
};
