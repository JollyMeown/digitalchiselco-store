// Admin: send a one-off email to a single member or broadcast to a segment.
// Mirrors the standalone app's "Custom Emails" screen. Body is wrapped in the
// DigitalChiselCo brand shell; {{first_name}} is personalised per recipient.
// Throttled in batches to stay within Resend limits. Admin-gated.

import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../../../lib/supabase';
import { send as sendEmail, sendBatch } from '../../../../lib/resend';
import { unsubUrl } from '../../../../lib/marketing-emails';
import { createHash } from 'node:crypto';

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
function shell(bodyHtml: string, logoUrl: string | null, unsubHref: string): string {
  const logo = logoUrl ? `<img src="${esc(logoUrl)}" alt="DigitalChiselCo" width="48" height="48" style="display:block;margin:0 auto 12px;border-radius:8px;">` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5EFE3;font-family:Helvetica,Arial,sans-serif;color:#2A1A0E;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5EFE3;padding:32px 12px;"><tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #E5DDD0;">
      <tr><td style="background:#5E380A;color:#F5EFE3;padding:28px 24px;text-align:center;">${logo}<div style="font-size:11px;letter-spacing:2px;color:#FAC775;text-transform:uppercase;">DigitalChiselCo</div></td></tr>
      <tr><td style="padding:26px 28px;font-size:15px;line-height:1.6;color:#2A1A0E;">${bodyHtml}</td></tr>
      <tr><td style="background:#F5EFE3;padding:16px 28px;text-align:center;font-size:12px;color:#8a7a68;"><a href="${SITE}" style="color:#854F0B;text-decoration:underline;">digitalchiselco.com</a> · <a href="${esc(unsubHref)}" style="color:#8a7a68;text-decoration:underline;">Unsubscribe</a></td></tr>
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
    // Only people who can legally receive marketing: confirmed, not
    // unsubscribed, not suppressed. (Was: every row in the table.)
    const { data } = await db.from('subscribers').select('email').not('confirmed_at', 'is', null).is('unsubscribed_at', null).is('suppressed_at', null).limit(5000);
    recipients = (data || []).map((r: any) => ({ email: r.email, name: null }));
  } else {
    // member segments — dedupe by email, keep the most recent name
    const statusFilter = segment === 'active' ? ['active'] : segment === 'expired' ? ['expired', 'cancelled'] : ['active', 'paused', 'expired', 'cancelled'];
    const { data } = await db.from('member_subscriptions').select('email, customer_name, created_at').in('status', statusFilter).order('created_at', { ascending: false }).limit(5000);
    const seen = new Map<string, Recipient>();
    for (const r of (data || []) as any[]) { const e = String(r.email).toLowerCase(); if (!seen.has(e)) seen.set(e, { email: e, name: r.customer_name || null }); }
    recipients = [...seen.values()];
    // Members are customers, but honour explicit opt-outs / suppression too.
    const { data: optOut } = await db.from('subscribers').select('email').or('unsubscribed_at.not.is.null,suppressed_at.not.is.null').in('email', recipients.map((r) => r.email)).limit(5000);
    const out = new Set((optOut || []).map((r: any) => String(r.email).toLowerCase()));
    recipients = recipients.filter((r) => !out.has(r.email.toLowerCase()));
  }

  if (!recipients.length) return json({ error: 'No recipients match that segment.' }, 400);

  const { data: settings } = await db.from('site_settings').select('logo_image_url').eq('id', 1).maybeSingle();
  const logoUrl = settings?.logo_image_url || null;

  // Batches of 100 via Resend's batch endpoint (one request per 100 instead of
  // 100 sequential sends — no serverless timeout), with a content-hash
  // idempotency key so a double-click / browser retry can't double-send.
  // Every email carries a per-recipient unsubscribe link, and the send helper
  // auto-attaches one-click List-Unsubscribe headers for kind='broadcast'.
  let sent = 0, failed = 0;
  const contentHash = createHash('sha256').update(subject + '|' + bodyHtml).digest('hex').slice(0, 16);
  for (let i = 0; i < recipients.length; i += 100) {
    const batch = recipients.slice(i, i + 100);
    const emails = batch.map((r) => {
      const first = (r.name || '').trim().split(/\s+/)[0] || 'there';
      const personalised = bodyHtml.replace(/\{\{\s*first_name\s*\}\}/g, esc(first));
      return { to: r.email, subject, html: shell(personalised, logoUrl, unsubUrl(r.email)), tags: [{ name: 'kind', value: 'broadcast' }] };
    });
    const key = 'broadcast:' + contentHash + ':' + createHash('sha256').update(batch.map((r) => r.email).sort().join(',')).digest('hex').slice(0, 20);
    if (batch.length === 1) {
      const res = await sendEmail({ ...emails[0], idempotencyKey: key });
      if (res.ok) sent++; else { failed++; if (res.quota) break; }
    } else {
      const res = await sendBatch(emails, key);
      if (res.ok) sent += res.sent; else { failed += batch.length; if (res.quota) break; }
    }
  }

  return json({ ok: true, recipients: recipients.length, sent, failed });
};
