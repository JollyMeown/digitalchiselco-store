// Admin: mail a Sawdust Cinema film to subscribers.
//
// Same shape as the other senders: { preview } returns the HTML, { test } sends
// one to the shop inbox, { emails } sends the real thing. Recipients are read
// from `subscribers` when `audience: 'all'` so the owner never pastes 300
// addresses by hand.
//
// Guard rails that matter for a blast this size:
//   * unsubscribed and inactive subscribers are excluded,
//   * one send per address per film (idempotency key holds the film id), so a
//     double click cannot mail anyone twice,
//   * the throttle in lib/resend handles Resend's rate limit and daily cap.
import type { APIRoute } from 'astro';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../../lib/supabase';
import { send as sendEmail, sendBatch } from '../../../lib/resend';
import { filmEmail, unsubHeaders } from '../../../lib/marketing-emails';

export const prerender = false;
const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY!;
const SITE = (process.env.PUBLIC_SITE_URL || 'https://digitalchiselco.com').replace(/\/$/, '');
const OPS_INBOX = 'jolly@digitalchiselco.com';
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

/**
 * Who has already had this film.
 *
 * Every send is written to the central ledger with batch_key = the idempotency
 * key, which carries the film id, so the ledger already knows this and no new
 * table is needed. Resend's own idempotency key expires after a day, so it
 * stops a double click and nothing more: without this the second campaign click
 * a week later would mail all 313 people again.
 *
 * Paged deliberately. PostgREST caps a plain select, and silently missing rows
 * here would mean mailing someone a second time.
 */
async function sentRecipients(db: any, filmId: string): Promise<Set<string>> {
  const out = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('email_send_log').select('recipient')
      .eq('status', 'sent').like('batch_key', `film:${filmId}:%`)
      .range(from, from + 999);
    if (error || !data?.length) break;
    for (const r of data) if (r.recipient) out.add(String(r.recipient).toLowerCase().trim());
    if (data.length < 1000) break;
  }
  return out;
}

/** Eligible subscribers: everyone who has not unsubscribed or been suppressed. */
async function eligible(db: any): Promise<string[]> {
  const out: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('subscribers').select('email, unsubscribed_at, suppressed_at').range(from, from + 999);
    if (error || !data?.length) break;
    for (const s of data) {
      if (s.email && !s.unsubscribed_at && !s.suppressed_at) out.push(String(s.email).toLowerCase().trim());
    }
    if (data.length < 1000) break;
  }
  return [...new Set(out)];
}

/** Per-film send status for the admin panel: who has had it, and who is left. */
async function campaignStats(db: any) {
  const list = await eligible(db);
  const films: Record<string, { sent: number; last: string | null; remaining: number }> = {};
  const seen: Record<string, Set<string>> = {};
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('email_send_log').select('batch_key, recipient, sent_at')
      .eq('kind', 'filmCampaign').eq('status', 'sent').range(from, from + 999);
    if (error || !data?.length) break;
    for (const r of data) {
      // test sends use a film-test: prefix, so they never count as delivered
      const m = /^film:([^:]+):/.exec(String(r.batch_key || ''));
      if (!m) continue;
      const id = m[1];
      const f = (films[id] ||= { sent: 0, last: null, remaining: 0 });
      (seen[id] ||= new Set()).add(String(r.recipient || '').toLowerCase().trim());
      f.sent = seen[id].size;
      if (!f.last || String(r.sent_at) > f.last) f.last = String(r.sent_at);
    }
    if (data.length < 1000) break;
  }
  for (const [id, f] of Object.entries(films)) f.remaining = list.filter((e) => !seen[id].has(e)).length;
  return { subscribers: list.length, films };
}

/** The film to mail: the one asked for, else the first active one. */
async function loadFilm(db: any, id?: string) {
  // The per-film email columns arrive in migration 093. Fall back to the base
  // columns so this endpoint keeps working whichever lands first.
  const BASE = 'id, video_url, poster_url, title, caption, products(slug, title, price_usd)';
  const FULL = `id, video_url, poster_url, title, caption, email_intro, email_subject, runtime_seconds, products(slug, title, price_usd)`;
  for (const cols of [FULL, BASE]) {
    let q = db.from('showcase_videos').select(cols).eq('active', true);
    q = id ? q.eq('id', id) : q.order('sort_order').limit(1);
    const { data, error } = await q.maybeSingle();
    if (!error) return data;
    if (cols === BASE) return null;
  }
  return null;
}

function build(film: any, email: string, subject?: string) {
  const p = film.products;
  // The email poster is a separate, taller crop with the play badge burned in;
  // it lives beside the film with an -email suffix. Fall back to the site poster.
  const emailPoster = String(film.poster_url || '').replace(/-poster\.jpg$/, '-email.jpg');
  return filmEmail({
    email,
    filmTitle: film.title || (p?.title || '').split('|')[0].trim() || 'A new film',
    posterUrl: emailPoster || film.poster_url,
    productUrl: p?.slug ? `${SITE}/product/${p.slug}` : SITE,
    productTitle: (p?.title || '').split('|')[0].trim() || 'the collection',
    price: p?.price_usd ?? null,
    blurb: film.caption || undefined,
    // the opener, the runtime and the subject belong to THIS film, not the template
    intro: film.email_intro || undefined,
    runtime: film.runtime_seconds ? `${film.runtime_seconds} seconds` : undefined,
    subject: subject || film.email_subject || undefined,
  });
}

export const POST: APIRoute = async ({ request }) => {
  if (!(await isCallerAdmin(request))) return json({ error: 'Admin authentication required.' }, 401);
  const b = await request.json().catch(() => ({} as any));
  const db = supabaseAdmin();

  // Panel asking who has already had what. No film needed.
  if (b?.stats) return json({ ok: true, ...(await campaignStats(db)) });

  const film = await loadFilm(db, b?.filmId);
  if (!film) return json({ error: 'No active film to send. Add one in Admin → Media → Sawdust Cinema.' }, 400);
  if (!film.products?.slug) return json({ error: 'That film is not linked to a design, so the email would have nowhere to send people.' }, 400);
  const subject = typeof b?.subject === 'string' && b.subject.trim() ? b.subject.trim().slice(0, 160) : undefined;

  if (b?.preview) {
    const { subject: s, html } = build(film, 'preview@example.com', subject);
    return json({ ok: true, subject: s, html });
  }

  // Who gets it.
  let recipients: string[] = [];
  let skipped = 0;
  if (b?.test) {
    recipients = [OPS_INBOX];
  } else if (Array.isArray(b?.emails) && b.emails.length) {
    // An explicit list is the manual override, for re-sending to someone who
    // says it never arrived. It is deliberately NOT filtered.
    recipients = b.emails.map((e: any) => String(e).toLowerCase().trim()).filter(Boolean);
  } else if (b?.audience === 'all') {
    // The campaign button always means "the people who have not had this yet",
    // so a second click after new subscribers join reaches only them.
    const all = await eligible(db);
    const done = await sentRecipients(db, film.id);
    recipients = all.filter((e) => !done.has(e));
    skipped = all.length - recipients.length;
  } else {
    return json({ error: 'Nothing to send: pass test, emails, or audience "all".' }, 400);
  }
  if (!recipients.length) {
    // Not an error: it is the normal state once a film has gone out.
    return json({
      ok: true, sent: 0, total: 0, skipped,
      message: skipped
        ? `Everyone on the list has already had this film (${skipped} previously sent). Nothing to do.`
        : 'No eligible subscribers.',
    });
  }

  // A test is one email, so it takes the simple path.
  if (b?.test) {
    const to = recipients[0];
    const { subject: s, html, text } = build(film, to, subject);
    const r = await sendEmail({
      to, subject: `TEST: ${s}`, html, text, headers: unsubHeaders(to),
      idempotencyKey: `film-test:${film.id}:${Date.now()}`,
      tags: [{ name: 'kind', value: 'filmCampaign' }],
    });
    return json({ ok: !!(r as any)?.ok, sent: (r as any)?.ok ? 1 : 0, total: 1, skipped, error: (r as any)?.error });
  }

  // The campaign goes through Resend's batch endpoint, 100 per call.
  //
  // Sending one at a time is what broke the first three campaigns: behind the
  // 2/second throttle each run reached 118 or 119 people in the 59 seconds the
  // serverless function gets, then died mid-loop. Nobody saw an error, and
  // roughly 195 subscribers simply never received them. Four batch calls carry
  // the whole list in seconds, and because the ledger records every recipient,
  // a run that is cut short can be finished by pressing the button again.
  let sent = 0;
  const errors: string[] = [];
  for (let i = 0; i < recipients.length; i += 100) {
    const slice = recipients.slice(i, i + 100);
    const batch = slice.map((to) => {
      const { subject: s, html, text } = build(film, to, subject);
      return { to, subject: s, html, text, headers: unsubHeaders(to), tags: [{ name: 'kind', value: 'filmCampaign' }] };
    });
    // Key = film id + a hash of who is in this batch. The film:<id>: prefix is
    // what the already-sent check reads; the hash stops Resend rejecting a
    // second press as "same key, different body" (a positional chunk index did
    // exactly that on the guide send).
    const who = createHash('sha1').update(slice.join(',')).digest('hex').slice(0, 12);
    const r = await sendBatch(batch, `film:${film.id}:${who}`);
    if (r.ok) sent += r.sent || slice.length;
    else {
      errors.push(String(r.error || 'batch failed').slice(0, 140));
      if (r.quota) { errors.push('stopped: daily budget reached, press again tomorrow'); break; }
    }
  }
  return json({ ok: true, sent, total: recipients.length, skipped, errors: errors.slice(0, 5) });
};
