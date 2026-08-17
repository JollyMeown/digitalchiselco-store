// Resend event webhook → email_events table (admin "Email performance" panel).
//
// Setup (one-time, in the Resend dashboard → Webhooks):
//   endpoint  https://digitalchiselco.com/api/resend/webhook
//   events    email.sent / delivered / opened / clicked / bounced / complained
//   then copy the signing secret (whsec_…) into Netlify env RESEND_WEBHOOK_SECRET.
//
// Security: Resend signs with the Svix scheme — HMAC-SHA256 over
// "<svix-id>.<svix-timestamp>.<raw body>" keyed by base64-decode(secret minus
// the whsec_ prefix). We verify timing-safely and fail CLOSED when the secret
// is unset, so nobody can spoof stats.
import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { supabaseAdmin } from '../../../lib/supabase';

export const prerender = false;

function env(name: string): string | undefined {
  return process.env[name] ?? (import.meta as any).env?.[name];
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

function verifySvix(rawBody: string, headers: Headers, secret: string): boolean {
  const id = headers.get('svix-id') || '';
  const ts = headers.get('svix-timestamp') || '';
  const sigHeader = headers.get('svix-signature') || '';
  if (!id || !ts || !sigHeader) return false;
  // reject stale/future timestamps (±5 min)
  const now = Math.floor(Date.now() / 1000);
  const t = Number(ts);
  if (!Number.isFinite(t) || Math.abs(now - t) > 300) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = crypto.createHmac('sha256', key).update(`${id}.${ts}.${rawBody}`).digest('base64');
  // header holds space-separated "v1,<base64>" entries
  for (const part of sigHeader.split(' ')) {
    const sig = part.startsWith('v1,') ? part.slice(3) : '';
    if (!sig) continue;
    const a = Buffer.from(sig), b = Buffer.from(expected);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  }
  return false;
}

const EVENT_MAP: Record<string, string> = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'delayed',
  'email.opened': 'opened',
  'email.clicked': 'clicked',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
};

export const POST: APIRoute = async ({ request }) => {
  const secret = env('RESEND_WEBHOOK_SECRET') || '';
  if (!secret) return json({ error: 'RESEND_WEBHOOK_SECRET not configured' }, 503);
  const rawBody = await request.text();
  if (!verifySvix(rawBody, request.headers, secret)) return json({ error: 'invalid signature' }, 401);

  let payload: any;
  try { payload = JSON.parse(rawBody); } catch { return json({ error: 'bad json' }, 400); }
  const event = EVENT_MAP[payload?.type];
  if (!event) return json({ ok: true, ignored: payload?.type });   // ack unknown types

  const d = payload.data || {};
  // tags arrive either as an object {kind: 'weekly'} or an array [{name,value}]
  let kind: string | null = null, week: string | null = null;
  const tags = d.tags;
  if (Array.isArray(tags)) {
    for (const t of tags) {
      if (t?.name === 'kind') kind = String(t.value).slice(0, 40);
      if (t?.name === 'week') week = String(t.value).slice(0, 20);
    }
  } else if (tags && typeof tags === 'object') {
    if (tags.kind) kind = String(tags.kind).slice(0, 40);
    if (tags.week) week = String(tags.week).slice(0, 20);
  }

  try {
    await supabaseAdmin().from('email_events').insert({
      provider_id: d.email_id || null,
      event,
      email: Array.isArray(d.to) ? String(d.to[0] || '').toLowerCase().slice(0, 200) : null,
      kind,
      week,
      url: event === 'clicked' ? String(d.click?.link || '').slice(0, 500) || null : null,
    });
  } catch (e: any) {
    console.error('[resend-webhook] insert failed:', e?.message);
    return json({ error: 'db error' }, 500);   // Resend retries
  }

  // ── Auto-suppress on hard bounce / spam complaint ─────────────────
  // Deliverability protection: keep mailing a bouncing or complaining address
  // and Gmail/Yahoo start spam-foldering the whole domain. Mark the subscriber
  // suppressed and stop their drip; every sender honours suppressed_at.
  // (Soft bounces — mailbox full etc. — are left alone: Resend reports the
  // bounce type; only 'hard'/'permanent' or a complaint suppresses.)
  try {
    const em = Array.isArray(d.to) ? String(d.to[0] || '').toLowerCase().trim() : '';
    const bounceType = String(d.bounce?.type || d.bounce?.subType || '').toLowerCase();
    const hard = event === 'bounced' && (!bounceType || /hard|permanent|suppress|invalid|no.?such|unknown/i.test(bounceType));
    if (em && (hard || event === 'complained')) {
      const db = supabaseAdmin();
      await db.from('subscribers').update({ suppressed_at: new Date().toISOString() }).eq('email', em).is('suppressed_at', null);
      await db.from('subscriber_drip').update({ status: 'stopped' }).eq('email', em).eq('status', 'active');
      console.log(`[resend-webhook] suppressed ${em} (${event}${bounceType ? ':' + bounceType : ''})`);
    }
  } catch (e: any) { console.error('[resend-webhook] suppression failed (event still logged):', e?.message); }
  return json({ ok: true });
};
