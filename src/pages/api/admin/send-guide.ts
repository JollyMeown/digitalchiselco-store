// Admin: mail the finishing guide to subscribers.
//
// Two differences from send-film, both learned the hard way:
//
//  1. It sends through Resend's BATCH endpoint, 100 per call. The film
//     campaigns went out one email at a time behind a 2/second throttle, so
//     each run reached exactly 118-119 people before the serverless function
//     hit its 60 second ceiling and died mid-loop. Four batch calls cover the
//     whole list in seconds.
//
//  2. Recipients already sent this are excluded, read from the send ledger, so
//     a second press reaches only people who joined since. That also makes the
//     send safely resumable if it ever is cut short again.
import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../../lib/supabase';
import { sendBatch, send as sendOne } from '../../../lib/resend';
import { guideEmail, unsubHeaders } from '../../../lib/marketing-emails';

export const prerender = false;
const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY!;
const OPS_INBOX = 'jolly@digitalchiselco.com';
const CAMPAIGN = 'finishing-guide';
const KIND = 'guideCampaign';
const CHUNK = 100;                       // Resend's batch cap
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

/** Everyone who has not unsubscribed or been suppressed. Paged: a silent row
 *  cap here would mean quietly missing people. */
async function eligible(db: any): Promise<string[]> {
  const out: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('subscribers')
      .select('email, unsubscribed_at, suppressed_at').range(from, from + 999);
    if (error || !data?.length) break;
    for (const s of data) {
      if (s.email && !s.unsubscribed_at && !s.suppressed_at) out.push(String(s.email).toLowerCase().trim());
    }
    if (data.length < 1000) break;
  }
  return [...new Set(out)];
}

/** Who has already had the guide, from the central send ledger. */
async function alreadySent(db: any): Promise<Set<string>> {
  const out = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('email_send_log')
      .select('recipient').eq('kind', KIND).eq('status', 'sent').range(from, from + 999);
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
    const { subject, html } = guideEmail({ email: 'preview@example.com' });
    return json({ ok: true, subject, html });
  }

  if (b?.stats) {
    const [list, done] = await Promise.all([eligible(db), alreadySent(db)]);
    return json({ ok: true, subscribers: list.length, sent: done.size, remaining: list.filter((e) => !done.has(e)).length });
  }

  if (b?.test) {
    const { subject, html, text } = guideEmail({ email: OPS_INBOX });
    const r = await sendOne({
      to: OPS_INBOX, subject: `TEST: ${subject}`, html, text,
      headers: unsubHeaders(OPS_INBOX),
      idempotencyKey: `guide-test:${CAMPAIGN}:${Date.now()}`,
      tags: [{ name: 'kind', value: 'guideTest' }],
    });
    return json({ ok: !!(r as any)?.ok, sent: (r as any)?.ok ? 1 : 0, error: (r as any)?.error });
  }

  if (b?.audience !== 'all') return json({ error: 'Nothing to send: pass preview, test, stats, or audience "all".' }, 400);

  const [list, done] = await Promise.all([eligible(db), alreadySent(db)]);
  const recipients = list.filter((e) => !done.has(e));
  const skipped = list.length - recipients.length;
  if (!recipients.length) {
    return json({ ok: true, sent: 0, skipped, message: `Everyone on the list has already had the guide (${skipped} sent). Nothing to do.` });
  }

  let sent = 0;
  const errors: string[] = [];
  for (let i = 0; i < recipients.length; i += CHUNK) {
    const slice = recipients.slice(i, i + CHUNK);
    const batch = slice.map((to) => {
      const { subject, html, text } = guideEmail({ email: to });
      return { to, subject, html, text, headers: unsubHeaders(to), tags: [{ name: 'kind', value: KIND }] };
    });
    // The batch key carries the campaign and the chunk, so the ledger rows this
    // writes are what the dedupe above reads on the next press.
    const r = await sendBatch(batch, `guide:${CAMPAIGN}:${i / CHUNK}`);
    if (r.ok) sent += r.sent || slice.length;
    else {
      errors.push(r.error || 'batch failed');
      if (r.quota) { errors.push('stopped: daily budget reached, press again tomorrow'); break; }
    }
  }
  return json({ ok: true, sent, skipped, total: recipients.length, errors: errors.slice(0, 5) });
};
