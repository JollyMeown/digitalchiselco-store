// Admin: send the maker-recruitment email to chosen recipients.
//   POST { emails:[...] }        → send (records maker_invites)
//   POST { test:true }           → send to the ops inbox
//   POST { preview:true }        → return { subject, html }
// Optional { applyUrl } points the CTA at a staging/preview link while testing.
// Kind 'makerRecruit' is transactional-styled (no unsub footer) and, like other
// bulk sends, is capped by the daily marketing budget so buyer emails stay safe.
import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../../lib/supabase';
import { send as sendEmail } from '../../../lib/resend';
import { makerRecruitEmail } from '../../../lib/marketing-emails';

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
  const applyUrl = typeof body?.applyUrl === 'string' && /^https?:\/\//.test(body.applyUrl) ? body.applyUrl : undefined;
  // Founding credits are an admin setting, so the invite promises the number
  // that approval actually grants rather than one baked in at build time.
  const { data: gsF } = await supabaseAdmin().from('growth_settings').select('founding_credits').eq('id', 1).maybeSingle();
  const founding: number | undefined = gsF?.founding_credits ?? undefined;

  if (body?.preview) {
    const { subject, html } = makerRecruitEmail({ email: 'you@email.com', applyUrl, founding });
    return json({ ok: true, subject, html });
  }
  const db = supabaseAdmin();
  if (body?.test) {
    const { subject, html, text } = makerRecruitEmail({ email: OPS_INBOX, applyUrl, founding });
    const r = await sendEmail({ to: OPS_INBOX, subject: 'TEST: ' + subject, html, text, idempotencyKey: 'maker-recruit-test-' + Date.now(), tags: [{ name: 'kind', value: 'makerRecruit' }] });
    return json({ ok: r.ok, results: [{ email: OPS_INBOX, ok: r.ok, error: r.error }] });
  }

  const raw: string[] = Array.isArray(body?.emails) ? body.emails : [];
  const emails = [...new Set(raw.map((e) => String(e).toLowerCase().trim()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))];
  if (!emails.length) return json({ error: 'No valid email addresses.' }, 400);
  if (emails.length > 500) return json({ error: `Too many recipients (${emails.length}); cap is 500.` }, 400);

  const day = new Date().toISOString().slice(0, 10);
  const results: { email: string; ok: boolean; error?: string }[] = [];
  for (const to of emails) {
    const { subject, html, text } = makerRecruitEmail({ email: to, applyUrl, founding });
    const r = await sendEmail({ to, subject, html, text, idempotencyKey: `maker-recruit:${to}:${day}`, tags: [{ name: 'kind', value: 'makerRecruit' }] });
    const ok = !!(r.ok && !r.skipped);
    results.push({ email: to, ok, error: r.error });
    if (ok) { try { await db.from('maker_invites').upsert({ email: to, source: 'recruit-email' }, { onConflict: 'email', ignoreDuplicates: true }); } catch {} }
    if (!r.ok && r.quota) { for (const rest of emails.slice(emails.indexOf(to) + 1)) results.push({ email: rest, ok: false, error: 'daily budget reached, try tomorrow' }); break; }
  }
  const sent = results.filter((r) => r.ok).length;
  return json({ ok: sent > 0, sent, failed: results.length - sent, results });
};
