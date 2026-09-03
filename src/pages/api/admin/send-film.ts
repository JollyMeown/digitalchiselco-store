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
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../../lib/supabase';
import { send as sendEmail } from '../../../lib/resend';
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

/** The film to mail: the one asked for, else the first active one. */
async function loadFilm(db: any, id?: string) {
  let q = db.from('showcase_videos')
    .select('id, video_url, poster_url, title, caption, products(slug, title, price_usd)')
    .eq('active', true);
  q = id ? q.eq('id', id) : q.order('sort_order').limit(1);
  const { data } = await q.maybeSingle();
  return data;
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
    subject,
  });
}

export const POST: APIRoute = async ({ request }) => {
  if (!(await isCallerAdmin(request))) return json({ error: 'Admin authentication required.' }, 401);
  const b = await request.json().catch(() => ({} as any));
  const db = supabaseAdmin();

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
  if (b?.test) {
    recipients = [OPS_INBOX];
  } else if (Array.isArray(b?.emails) && b.emails.length) {
    recipients = b.emails.map((e: any) => String(e).toLowerCase().trim()).filter(Boolean);
  } else if (b?.audience === 'all') {
    const { data: subs } = await db.from('subscribers').select('email, unsubscribed_at, suppressed_at').limit(20000);
    recipients = (subs || [])
      .filter((s: any) => s.email && !s.unsubscribed_at && !s.suppressed_at)
      .map((s: any) => String(s.email).toLowerCase().trim());
    recipients = [...new Set(recipients)];
  } else {
    return json({ error: 'Nothing to send: pass test, emails, or audience "all".' }, 400);
  }
  if (!recipients.length) return json({ error: 'No eligible recipients.' }, 400);

  const results: { email: string; ok: boolean; error?: string }[] = [];
  for (const to of recipients) {
    try {
      const { subject: s, html, text } = build(film, to, subject);
      const r = await sendEmail({
        to,
        subject: b?.test ? `TEST: ${s}` : s,
        html, text,
        headers: unsubHeaders(to),
        // one per address per film: a double click cannot mail anyone twice
        idempotencyKey: b?.test ? `film-test:${film.id}:${Date.now()}` : `film:${film.id}:${to}`,
        tags: [{ name: 'kind', value: 'filmCampaign' }],
      });
      results.push({ email: to, ok: !!(r as any)?.ok, error: (r as any)?.error });
    } catch (e: any) {
      results.push({ email: to, ok: false, error: String(e?.message || e).slice(0, 140) });
    }
  }
  const sent = results.filter((r) => r.ok).length;
  return json({ ok: true, sent, total: results.length, results: results.slice(0, 60) });
};
