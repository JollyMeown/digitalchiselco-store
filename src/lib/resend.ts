// Resend transactional email helper. Used by the Paddle webhook to deliver
// the branded download-link receipt after a successful purchase.
//
// Required env vars:
//   RESEND_API_KEY    — secret key (re_...)
//   RESEND_FROM       — e.g. `DigitalChiselCo <orders@digitalchiselco.com>`
//                       falls back to `DigitalChiselCo <onboarding@resend.dev>`
//                       (Resend's default sandbox sender) when unset
//   RESEND_REPLY_TO   — optional; the address customers' replies go to
//
// If RESEND_API_KEY is missing, send() is a no-op that logs + returns
// { ok: true, skipped: true }. Lets storefront work without credentials.

function env(name: string): string | undefined {
  return process.env[name] ?? (import.meta as any).env?.[name];
}

type SendOptions = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  /** Optional override; falls back to RESEND_FROM env. */
  from?: string;
  /** Optional Reply-To; falls back to RESEND_REPLY_TO env. */
  replyTo?: string;
  /** Optional idempotency key — Resend dedupes by this. */
  idempotencyKey?: string;
  /** Optional Resend tags (surfaced back on webhook events → email stats). */
  tags?: { name: string; value: string }[];
};

export function isResendConfigured(): boolean {
  return !!env('RESEND_API_KEY');
}

export async function send(opts: SendOptions): Promise<{ ok: boolean; id?: string; skipped?: boolean; error?: string }> {
  const key = env('RESEND_API_KEY');
  if (!key) {
    console.warn('[resend] RESEND_API_KEY not set — skipping send to', opts.to);
    return { ok: true, skipped: true };
  }
  const from = opts.from || env('RESEND_FROM') || 'DigitalChiselCo <onboarding@resend.dev>';
  const replyTo = opts.replyTo || env('RESEND_REPLY_TO');

  const body: any = {
    from,
    to: Array.isArray(opts.to) ? opts.to : [opts.to],
    subject: opts.subject,
    html: opts.html,
  };
  if (opts.text) body.text = opts.text;
  if (replyTo) body.reply_to = replyTo;
  if (opts.tags?.length) body.tags = opts.tags;

  const headers: Record<string, string> = {
    authorization: `Bearer ${key}`,
    'content-type': 'application/json',
  };
  if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;

  try {
    const res = await fetch('https://api.resend.com/emails', { method: 'POST', headers, body: JSON.stringify(body) });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('[resend] send failed', res.status, data?.message || data);
      return { ok: false, error: data?.message || `HTTP ${res.status}` };
    }
    return { ok: true, id: data?.id };
  } catch (e: any) {
    console.error('[resend] send threw', e);
    return { ok: false, error: e.message || 'network error' };
  }
}

/** Broadcast helper — Resend's batch endpoint accepts up to 100 emails per
 *  call, so a full subscriber send is a handful of HTTP requests instead of
 *  hundreds (no serverless-timeout risk, no per-message rate-limit dance).
 *  Resend queues + throttles actual delivery on their side.
 *  One idempotency key per batch call → safe against cron retries. */
export async function sendBatch(
  emails: SendOptions[],
  idempotencyKey?: string,
): Promise<{ ok: boolean; sent: number; skipped?: boolean; error?: string }> {
  const key = env('RESEND_API_KEY');
  if (!key) {
    console.warn(`[resend] RESEND_API_KEY not set — skipping batch of ${emails.length}`);
    return { ok: true, sent: 0, skipped: true };
  }
  if (!emails.length) return { ok: true, sent: 0 };
  const from = env('RESEND_FROM') || 'DigitalChiselCo <onboarding@resend.dev>';
  const replyTo = env('RESEND_REPLY_TO');
  const payload = emails.slice(0, 100).map((e) => {
    const item: any = {
      from: e.from || from,
      to: Array.isArray(e.to) ? e.to : [e.to],
      subject: e.subject,
      html: e.html,
    };
    if (e.text) item.text = e.text;
    if (e.replyTo || replyTo) item.reply_to = e.replyTo || replyTo;
    if (e.tags?.length) item.tags = e.tags;
    return item;
  });
  const headers: Record<string, string> = { authorization: `Bearer ${key}`, 'content-type': 'application/json' };
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
  try {
    const res = await fetch('https://api.resend.com/emails/batch', { method: 'POST', headers, body: JSON.stringify(payload) });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('[resend] batch failed', res.status, data?.message || data);
      return { ok: false, sent: 0, error: data?.message || `HTTP ${res.status}` };
    }
    return { ok: true, sent: Array.isArray(data?.data) ? data.data.length : payload.length };
  } catch (e: any) {
    console.error('[resend] batch threw', e);
    return { ok: false, sent: 0, error: e.message || 'network error' };
  }
}
