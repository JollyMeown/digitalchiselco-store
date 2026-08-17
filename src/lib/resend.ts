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
  /** Optional ISO time to schedule delivery (Resend scheduled_at) — used by
   *  send-time optimization to deliver at each subscriber's best hour. */
  scheduledAt?: string;
};

export function isResendConfigured(): boolean {
  return !!env('RESEND_API_KEY');
}

// ── Central send ledger (email_send_log) ────────────────────────────
// Every send/sendBatch call records one row per recipient — kind, subject,
// status, provider id, batch key, timestamp. Written at the SOURCE so no
// email path can forget to log. Fire-and-forget: a ledger hiccup can never
// block or fail a real send. Supabase is lazy-loaded to keep this helper
// dependency-light for callers that only need send().
type LedgerRow = { kind?: string | null; week?: string | null; recipient: string; subject?: string; provider_id?: string | null; status: 'sent' | 'failed' | 'skipped'; error?: string | null; batch_key?: string | null };
function tagOf(tags: { name: string; value: string }[] | undefined, name: string): string | null {
  return tags?.find((t) => t.name === name)?.value ?? null;
}
function logSends(rows: LedgerRow[]) {
  if (!rows.length) return;
  (async () => {
    try {
      const { supabaseAdmin } = await import('./supabase');
      const db = supabaseAdmin();
      for (let i = 0; i < rows.length; i += 200) {
        const { error } = await db.from('email_send_log').insert(rows.slice(i, i + 200));
        if (error) console.error('[email_send_log]', error.message);
      }
    } catch (e: any) { console.error('[email_send_log] threw', e?.message); }
  })();
}

// ── Global rate limiter ──────────────────────────────────────────────
// Resend's API allows a fixed number of requests per second (default 2; raise
// RESEND_MAX_RPS if your account limit is higher). EVERY call to the Resend API
// funnels through resendFetch(), which (a) serializes calls, (b) spaces them so
// we never exceed that rate, and (c) auto-retries on HTTP 429 honoring the
// reset header. This holds whether the list is 100 or 100K: the batch loop just
// takes proportionally longer, it never trips the limit or drops mail.
const MAX_RPS = Math.max(1, Number(env('RESEND_MAX_RPS')) || 2);
const MIN_GAP_MS = Math.ceil(1000 / MAX_RPS);
const MAX_429_RETRIES = 6;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let chain: Promise<unknown> = Promise.resolve();
let lastCallAt = 0;

async function resendFetch(url: string, headers: Record<string, string>, body: string): Promise<{ res: Response; data: any }> {
  const task = chain.then(async () => {
    for (let attempt = 0; ; attempt++) {
      const gap = MIN_GAP_MS - (Date.now() - lastCallAt);
      if (gap > 0) await sleep(gap);
      lastCallAt = Date.now();
      const res = await fetch(url, { method: 'POST', headers, body });
      if (res.status !== 429 || attempt >= MAX_429_RETRIES) {
        const data = await res.json().catch(() => ({}));
        return { res, data };
      }
      // Rate limited: wait out the window (honor headers), then retry.
      const resetS = Number(res.headers.get('retry-after')) || Number(res.headers.get('ratelimit-reset')) || 1;
      await sleep(Math.min(30000, Math.max(1000, resetS * 1000)));
    }
  });
  // Keep the shared chain alive even if one call rejects.
  chain = task.then(() => undefined, () => undefined);
  return task;
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
  if (opts.scheduledAt) body.scheduled_at = opts.scheduledAt;

  const headers: Record<string, string> = {
    authorization: `Bearer ${key}`,
    'content-type': 'application/json',
  };
  if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;

  const recipients = (Array.isArray(opts.to) ? opts.to : [opts.to]).map(String);
  const kind = tagOf(opts.tags, 'kind'), week = tagOf(opts.tags, 'week');
  const ledger = (status: LedgerRow['status'], provider_id?: string | null, error?: string | null) =>
    logSends(recipients.map((recipient) => ({ kind, week, recipient, subject: opts.subject, provider_id: provider_id ?? null, status, error: error ?? null, batch_key: opts.idempotencyKey ?? null })));

  try {
    const { res, data } = await resendFetch('https://api.resend.com/emails', headers, JSON.stringify(body));
    if (!res.ok) {
      console.error('[resend] send failed', res.status, data?.message || data);
      ledger('failed', null, data?.message || `HTTP ${res.status}`);
      return { ok: false, error: data?.message || `HTTP ${res.status}` };
    }
    ledger('sent', data?.id);
    return { ok: true, id: data?.id };
  } catch (e: any) {
    console.error('[resend] send threw', e);
    ledger('failed', null, e.message || 'network error');
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
  // Resend's batch endpoint caps at 100 per call. Callers already chunk, but
  // warn loudly rather than silently dropping if someone passes more.
  if (emails.length > 100) console.warn(`[resend] batch given ${emails.length} emails; only the first 100 are sent (chunk before calling)`);
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
    if (e.scheduledAt) item.scheduled_at = e.scheduledAt;
    return item;
  });
  const headers: Record<string, string> = { authorization: `Bearer ${key}`, 'content-type': 'application/json' };
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
  const batchRows = (status: LedgerRow['status'], ids?: (string | null)[], error?: string | null): LedgerRow[] =>
    emails.slice(0, 100).flatMap((e, i) => (Array.isArray(e.to) ? e.to : [e.to]).map((recipient) => ({
      kind: tagOf(e.tags, 'kind'), week: tagOf(e.tags, 'week'), recipient: String(recipient), subject: e.subject,
      provider_id: ids?.[i] ?? null, status, error: error ?? null, batch_key: idempotencyKey ?? null,
    })));
  try {
    const { res, data } = await resendFetch('https://api.resend.com/emails/batch', headers, JSON.stringify(payload));
    if (!res.ok) {
      console.error('[resend] batch failed', res.status, data?.message || data);
      logSends(batchRows('failed', undefined, data?.message || `HTTP ${res.status}`));
      return { ok: false, sent: 0, error: data?.message || `HTTP ${res.status}` };
    }
    const ids = Array.isArray(data?.data) ? data.data.map((d: any) => d?.id ?? null) : [];
    logSends(batchRows('sent', ids));
    return { ok: true, sent: Array.isArray(data?.data) ? data.data.length : payload.length };
  } catch (e: any) {
    console.error('[resend] batch threw', e);
    logSends(batchRows('failed', undefined, e.message || 'network error'));
    return { ok: false, sent: 0, error: e.message || 'network error' };
  }
}
