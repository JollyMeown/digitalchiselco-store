// Admin: mail any published article to subscribers, and keep its email copy.
//
// One endpoint for every guide the shop publishes:
//   { list }                       every published post + who has had it
//   { save, slug, ...fields }      subject / opener / inside photo / drip flag
//   { preview, slug }              the HTML
//   { test, slug }                 one to the shop inbox
//   { audience: 'all', slug }      everyone who has NOT had it, in batches
//
// The send goes through Resend's batch endpoint (100 per call) with a
// content-hash key per batch, and the already-sent set is read from the send
// ledger, so a second press reaches only people who joined since. The finishing
// guide went out under older kinds before this existed; those count too.
import type { APIRoute } from 'astro';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../../lib/supabase';
import { sendBatch, send as sendOne } from '../../../lib/resend';
import { articleEmail, unsubHeaders, type ArticlePost } from '../../../lib/marketing-emails';
import { fetchAll } from '../../../lib/fetch-all';

export const prerender = false;
const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY!;
const OPS_INBOX = 'jolly@digitalchiselco.com';
const KIND = 'articleCampaign';
const ALL_KINDS = ['articleCampaign', 'articleDrip', 'guideCampaign', 'drip6'];
// Sends made before this endpoint existed, mapped to the article they were.
const LEGACY: Record<string, string> = { guideCampaign: 'how-to-finish-cnc-relief-carvings', drip6: 'how-to-finish-cnc-relief-carvings' };
const COLS = 'slug, title, excerpt, body, cover_image_url, published_at, email_subject, email_intro, email_image_url, email_in_drip';
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

const eligible = async (db: any): Promise<string[]> => {
  const rows = await fetchAll((a, b) => db.from('subscribers').select('email, unsubscribed_at, suppressed_at').range(a, b));
  return [...new Set(rows.filter((s: any) => s.email && !s.unsubscribed_at && !s.suppressed_at).map((s: any) => String(s.email).toLowerCase().trim()))] as string[];
};

/** slug -> set of recipients who have had it, from every kind that ever carried an article. */
async function sentBySlug(db: any): Promise<Map<string, Set<string>>> {
  const rows = await fetchAll((a, b) => db.from('email_send_log').select('kind, batch_key, recipient').in('kind', ALL_KINDS).eq('status', 'sent').range(a, b));
  const out = new Map<string, Set<string>>();
  for (const r of rows) {
    const m = /^article:([^:]+):/.exec(String(r.batch_key || ''));
    const slug = m ? m[1] : LEGACY[r.kind];
    if (!slug) continue;
    if (!out.has(slug)) out.set(slug, new Set());
    out.get(slug)!.add(String(r.recipient || '').toLowerCase().trim());
  }
  return out;
}

export const POST: APIRoute = async ({ request }) => {
  if (!(await isCallerAdmin(request))) return json({ error: 'Admin authentication required.' }, 401);
  const b = await request.json().catch(() => ({} as any));
  const db = supabaseAdmin();

  if (b?.list) {
    const [posts, list, sent] = await Promise.all([
      fetchAll((a, c) => db.from('posts').select(COLS).eq('status', 'published').order('published_at', { ascending: false }).range(a, c)),
      eligible(db), sentBySlug(db),
    ]);
    return json({
      ok: true, subscribers: list.length,
      posts: posts.map((p: any) => {
        const had = sent.get(p.slug) || new Set();
        const { body, ...rest } = p;
        return { ...rest, sent: had.size, remaining: list.filter((e) => !had.has(e)).length };
      }),
    });
  }

  const slug = String(b?.slug || '').trim();
  if (!slug) return json({ error: 'slug required' }, 400);

  if (b?.save) {
    const patch: any = {};
    for (const k of ['email_subject', 'email_intro', 'email_image_url']) if (k in b) patch[k] = String(b[k] || '').trim() || null;
    if ('email_in_drip' in b) patch.email_in_drip = !!b.email_in_drip;
    const { error } = await db.from('posts').update(patch).eq('slug', slug);
    return error ? json({ error: error.message }, 400) : json({ ok: true });
  }

  const { data: post } = await db.from('posts').select(COLS).eq('slug', slug).eq('status', 'published').maybeSingle();
  if (!post) return json({ error: 'No published article with that slug.' }, 404);
  const build = (to: string) => articleEmail({ email: to, post: post as ArticlePost });

  if (b?.preview) { const { subject, html } = build('preview@example.com'); return json({ ok: true, subject, html }); }

  if (b?.test) {
    const { subject, html, text } = build(OPS_INBOX);
    const r = await sendOne({ to: OPS_INBOX, subject: `TEST: ${subject}`, html, text, headers: unsubHeaders(OPS_INBOX),
      idempotencyKey: `article-test:${slug}:${Date.now()}`, tags: [{ name: 'kind', value: 'articleTest' }] });
    return json({ ok: !!(r as any)?.ok, sent: (r as any)?.ok ? 1 : 0, error: (r as any)?.error });
  }

  if (b?.audience !== 'all') return json({ error: 'Nothing to send: pass list, save, preview, test, or audience "all".' }, 400);

  const [list, sent] = await Promise.all([eligible(db), sentBySlug(db)]);
  const had = sent.get(slug) || new Set<string>();
  const recipients = list.filter((e) => !had.has(e));
  const skipped = list.length - recipients.length;
  if (!recipients.length) return json({ ok: true, sent: 0, skipped, message: `Everyone on the list has already had this one (${skipped} sent). Nothing to do.` });

  let done = 0;
  const errors: string[] = [];
  for (let i = 0; i < recipients.length; i += 100) {
    const slice = recipients.slice(i, i + 100);
    const batch = slice.map((to) => { const { subject, html, text } = build(to); return { to, subject, html, text, headers: unsubHeaders(to), tags: [{ name: 'kind', value: KIND }] }; });
    const who = createHash('sha1').update(slice.join(',')).digest('hex').slice(0, 12);
    const r = await sendBatch(batch, `article:${slug}:${who}`);
    if (r.ok) done += r.sent || slice.length;
    else { errors.push(String(r.error || 'batch failed').slice(0, 140)); if (r.quota) { errors.push('stopped: daily budget reached, press again tomorrow'); break; } }
  }
  return json({ ok: true, sent: done, skipped, total: recipients.length, errors: errors.slice(0, 5) });
};
