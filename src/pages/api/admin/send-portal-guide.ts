// Admin: send the "How your portal works" PDF to any recipients.
//   POST { emails: string[] }            → send to each (guide attached)
//   POST { emails: [...], test: true }   → same email but to the OPS inbox
//   POST { preview: true }               → returns { subject, html } only
// Guard rails: dedupe, format check, 300-recipient cap, once per address per
// day (idempotency key), per-recipient result list. Kind 'portalGuide' sends
// without unsubscribe headers (it is a help email) but does NOT bypass the
// daily reserve, so a big send can never starve real buyer emails.
import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../../lib/supabase';
import { send as sendEmail } from '../../../lib/resend';
import { portalGuideEmail } from '../../../lib/marketing-emails';
import { PORTAL_GUIDE_URL, PORTAL_GUIDE_FILENAME } from '../../../lib/order-email';

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
  const { subject, html, text } = portalGuideEmail();
  if (body?.preview) return json({ ok: true, subject, html });

  const raw: string[] = Array.isArray(body?.emails) ? body.emails : [];
  const emails = [...new Set(raw.map((e) => String(e).toLowerCase().trim()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))];
  if (body?.test) {
    const r = await sendEmail({ to: OPS_INBOX, subject: 'TEST: ' + subject, html, text, idempotencyKey: 'portal-guide-admintest-' + Date.now(), tags: [{ name: 'kind', value: 'portalGuide' }], attachments: [{ filename: PORTAL_GUIDE_FILENAME, path: PORTAL_GUIDE_URL }] });
    return json({ ok: r.ok, results: [{ email: OPS_INBOX, ok: r.ok, error: r.error }] });
  }
  if (!emails.length) return json({ error: 'No valid email addresses.' }, 400);
  if (emails.length > 300) return json({ error: `Too many recipients (${emails.length}); cap is 300 per send.` }, 400);

  const day = new Date().toISOString().slice(0, 10);
  const results: { email: string; ok: boolean; error?: string }[] = [];
  for (const to of emails) {
    const r = await sendEmail({
      to, subject, html, text,
      idempotencyKey: `portal-guide:${to}:${day}`,   // once per address per day
      tags: [{ name: 'kind', value: 'portalGuide' }],
      attachments: [{ filename: PORTAL_GUIDE_FILENAME, path: PORTAL_GUIDE_URL }],
    });
    results.push({ email: to, ok: !!(r.ok && !r.skipped), error: r.error });
    if (!r.ok && r.quota) {   // reserve/quota reached: stop burning attempts
      for (const rest of emails.slice(emails.indexOf(to) + 1)) results.push({ email: rest, ok: false, error: 'daily quota reached, try tomorrow' });
      break;
    }
  }
  const sent = results.filter((r) => r.ok).length;
  return json({ ok: sent > 0, sent, failed: results.length - sent, results });
};
