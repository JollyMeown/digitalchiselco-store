// Admin: broadcast an announcement to APPROVED makers (a separate audience
// from subscribers). POST { subject, message, audience?, emails?, test?, preview? }
//   audience 'approved' (default) → all approved makers
//   emails:[...]                  → a specific subset
// Budget-capped like other bulk sends; kind 'makerNews' (no unsub footer).
import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../../lib/supabase';
import { send as sendEmail } from '../../../lib/resend';
import { makerNewsEmail } from '../../../lib/marketing-emails';

export const prerender = false;
const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY!;
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

export const POST: APIRoute = async ({ request }) => {
  if (!(await isCallerAdmin(request))) return json({ error: 'Admin authentication required.' }, 401);
  const body = await request.json().catch(() => ({}));
  const subject = String(body?.subject || '').trim().slice(0, 200);
  const message = String(body?.message || '').trim().slice(0, 8000);
  if (!subject || !message) return json({ error: 'Add a subject and a message.' }, 400);

  const built = makerNewsEmail({ subject, message });
  if (body?.preview) return json({ ok: true, subject: built.subject, html: built.html });

  const db = supabaseAdmin();
  if (body?.test) {
    const r = await sendEmail({ to: OPS_INBOX, subject: 'TEST: ' + built.subject, html: built.html, text: built.text, idempotencyKey: 'maker-news-test-' + Date.now(), tags: [{ name: 'kind', value: 'makerNews' }] });
    return json({ ok: r.ok, results: [{ email: OPS_INBOX, ok: r.ok, error: r.error }] });
  }

  // recipients: explicit list, else all approved makers
  let emails: string[] = [];
  if (Array.isArray(body?.emails) && body.emails.length) {
    emails = body.emails.map((e: any) => String(e).toLowerCase().trim());
  } else {
    const { data } = await db.from('makers').select('email').eq('status', 'approved').limit(5000);
    emails = (data || []).map((m: any) => String(m.email).toLowerCase().trim());
  }
  emails = [...new Set(emails.filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))];
  if (!emails.length) return json({ error: 'No approved makers to email yet.' }, 400);
  if (emails.length > 2000) return json({ error: `Too many recipients (${emails.length}).` }, 400);

  const key = 'maker-news:' + new Date().toISOString().slice(0, 16);
  const results: { email: string; ok: boolean; error?: string }[] = [];
  for (const to of emails) {
    const r = await sendEmail({ to, subject: built.subject, html: built.html, text: built.text, idempotencyKey: `${key}:${to}`, tags: [{ name: 'kind', value: 'makerNews' }] });
    const ok = !!(r.ok && !r.skipped);
    results.push({ email: to, ok, error: r.error });
    if (!r.ok && r.quota) { for (const rest of emails.slice(emails.indexOf(to) + 1)) results.push({ email: rest, ok: false, error: 'daily budget reached, try tomorrow' }); break; }
  }
  const sent = results.filter((r) => r.ok).length;
  return json({ ok: sent > 0, sent, failed: results.length - sent, results });
};
