// Admin: send a one-off email to a single member or broadcast to a segment.
// Mirrors the standalone app's "Custom Emails" screen. Body is wrapped in the
// DigitalChiselCo brand shell; {{first_name}} is personalised per recipient.
// Throttled in batches to stay within Resend limits. Admin-gated.

import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../../../lib/supabase';
import { send as sendEmail } from '../../../../lib/resend';

export const prerender = false;

const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY!;
const SITE = (process.env.PUBLIC_SITE_URL || 'https://digitalchiselco.com').replace(/\/$/, '');
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

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

function esc(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

// Wrap the admin's HTML body in the same cream/bronze shell as every other email.
function shell(bodyHtml: string, logoUrl: string | null): string {
  const logo = logoUrl ? `<img src="${esc(logoUrl)}" alt="DigitalChiselCo" width="48" height="48" style="display:block;margin:0 auto 12px;border-radius:8px;">` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5EFE3;font-family:Helvetica,Arial,sans-serif;color:#2A1A0E;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5EFE3;padding:32px 12px;"><tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #E5DDD0;">
      <tr><td style="background:#5E380A;color:#F5EFE3;padding:28px 24px;text-align:center;">${logo}<div style="font-size:11px;letter-spacing:2px;color:#FAC775;text-transform:uppercase;">DigitalChiselCo</div></td></tr>
      <tr><td style="padding:26px 28px;font-size:15px;line-height:1.6;color:#2A1A0E;">${bodyHtml}</td></tr>
      <tr><td style="background:#F5EFE3;padding:16px 28px;text-align:center;font-size:12px;color:#8a7a68;"><a href="${SITE}" style="color:#854F0B;text-decoration:underline;">digitalchiselco.com</a></td></tr>
    </table>
  </td></tr></table></body></html>`;
}

type Recipient = { email: string; name: string | null };

export const POST: APIRoute = async ({ request }) => {
  if (!(await isCallerAdmin(request))) return json({ error: 'Admin authentication required.' }, 401);
  const body = await request.json().catch(() => ({}));
  const segment = String(body.segment || '').trim();
  const subject = String(body.subject || '').trim();
  const bodyHtml = String(body.html || '').trim();
  const singleEmail = body.email ? String(body.email).toLowerCase().trim() : '';
  if (!subject) return json({ error: 'Subject is required.' }, 400);
  if (!bodyHtml) return json({ error: 'Message body is required.' }, 400);

  const db = supabaseAdmin();
  let recipients: Recipient[] = [];

  if (segment === 'single') {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(singleEmail)) return json({ error: 'Valid recipient email required.' }, 400);
    recipients = [{ email: singleEmail, name: null }];
  } else if (segment === 'free_leads') {
    const { data } = await db.from('subscribers').select('email').limit(5000);
    recipients = (data || []).map((r: any) => ({ email: r.email, name: null }));
  } else {
    // member segments — dedupe by email, keep the most recent name
    const statusFilter = segment === 'active' ? ['active'] : segment === 'expired' ? ['expired', 'cancelled'] : ['active', 'paused', 'expired', 'cancelled'];
    const { data } = await db.from('member_subscriptions').select('email, customer_name, created_at').in('status', statusFilter).order('created_at', { ascending: false }).limit(5000);
    const seen = new Map<string, Recipient>();
    for (const r of (data || []) as any[]) { const e = String(r.email).toLowerCase(); if (!seen.has(e)) seen.set(e, { email: e, name: r.customer_name || null }); }
    recipients = [...seen.values()];
  }

  if (!recipients.length) return json({ error: 'No recipients match that segment.' }, 400);

  const { data: settings } = await db.from('site_settings').select('logo_image_url').eq('id', 1).maybeSingle();
  const logoUrl = settings?.logo_image_url || null;

  // Send in throttled batches of 10.
  let sent = 0, failed = 0;
  for (let i = 0; i < recipients.length; i += 10) {
    const batch = recipients.slice(i, i + 10);
    await Promise.all(batch.map(async (r) => {
      const first = (r.name || '').trim().split(/\s+/)[0] || 'there';
      const personalised = bodyHtml.replace(/\{\{\s*first_name\s*\}\}/g, esc(first));
      const res = await sendEmail({ to: r.email, subject, html: shell(personalised, logoUrl) });
      if (res.ok) sent++; else failed++;
    }));
    if (i + 10 < recipients.length) await new Promise((res) => setTimeout(res, 600));
  }

  return json({ ok: true, recipients: recipients.length, sent, failed });
};
