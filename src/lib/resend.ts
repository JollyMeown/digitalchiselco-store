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

import { unsubHeaders } from './marketing-emails';

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
  /** Extra SMTP headers (e.g. List-Unsubscribe). Marketing sends get
   *  unsubscribe headers attached automatically — see marketingHeadersFor(). */
  headers?: Record<string, string>;
  /** Optional attachments. `path` is a public URL Resend fetches server-side
   *  (preferred: keeps our request small); `content` is base64 file bytes. */
  attachments?: { filename: string; path?: string; content?: string }[];
};

// Transactional kinds carry no unsubscribe header (order receipts, gift
// delivery, alerts to the owner). Everything else tagged with a kind is
// marketing and MUST advertise one-click unsubscribe (Gmail/Yahoo rules).
// 'membership' = a paying member's pack, reminder or expiry mail: transactional
// and never deferred by the marketing budget (2026-09-05).
const TRANSACTIONAL_KINDS = new Set(['order', 'gift', 'ownerReport', 'designScout', 'resendLibrary', 'cartSave', 'payRecovery', 'picks', 'portalGuide', 'auth', 'optin', 'makerNews', 'marketplace', 'membership']);
function marketingHeadersFor(to: string, tags?: { name: string; value: string }[]): Record<string, string> {
  const kind = tags?.find((t) => t.name === 'kind')?.value;
  if (!kind || TRANSACTIONAL_KINDS.has(kind)) return {};
  try { return unsubHeaders(to); } catch { return {}; }
}

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

// ── Daily-quota gate ─────────────────────────────────────────────────
// The moment Resend says the DAILY quota is exhausted, every later send in
// this process returns immediately with { ok:false, quota:true } instead of
// making a doomed API call (each costs ~0.5s of serialized time and a retry
// dance). Callers leave their ledgers unsent → retried tomorrow. Reset on the
// next UTC day so a long-lived process (dev server) recovers by itself.
let quotaExhaustedDay: string | null = null;
export function isQuotaExhausted(): boolean {
  return quotaExhaustedDay === new Date().toISOString().slice(0, 10);
}

// ── Buyer-critical sends + daily reserve ─────────────────────────────
// Lesson from 2026-08-24: the weekly digest consumed the whole Resend daily
// quota, then a real buyer's order confirmation, magic-link sign-in, and
// opt-in emails all failed — the customer paid $55.99 and had NO path to
// their files. Two protections now:
//   1. BUYER_CRITICAL kinds ('order', 'gift', 'resendLibrary', 'auth',
//      'optin', 'payRecovery') are NEVER short-circuited by the quota gate —
//      they always reach the Resend API (the real quota may still 429, in
//      which case the order-email sweep retries every 10 minutes).
//   2. Everything else (digest, drip, win-back, ...) stops once today's sent
//      count reaches CAP - RESERVE, so RESERVE emails are always left for
//      buyers. Defaults: cap 100 (Resend free tier), reserve 20 — override
//      with RESEND_DAILY_CAP / RESEND_DAILY_RESERVE.
const BUYER_CRITICAL = new Set(['order', 'gift', 'resendLibrary', 'auth', 'optin', 'payRecovery', 'membership']);
export function isBuyerCritical(tags?: { name: string; value: string }[]): boolean {
  return BUYER_CRITICAL.has(tags?.find((t) => t.name === 'kind')?.value || '');
}
// Cap + reserve are ADMIN-EDITABLE (growth_settings, migration 062). Env vars,
// if set, OVERRIDE the DB (so an emergency Netlify change still wins). Both are
// cached ~60s alongside today's send count.
const CAP_ENV = Number(env('RESEND_DAILY_CAP')) || Number(env('PUBLIC_RESEND_DAILY_CAP')) || 0;
const RESERVE_ENV = env('RESEND_DAILY_RESERVE') != null ? Number(env('RESEND_DAILY_RESERVE')) : NaN;
let reserveCache: { day: string; count: number; at: number; cap: number; reserve: number; monthCap: number; monthCount: number } =
  { day: '', count: 0, at: 0, cap: 180, reserve: 20, monthCap: 3000, monthCount: 0 };
async function refreshBudget(): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  if (reserveCache.day === day && Date.now() - reserveCache.at <= 60000) return;
  const { supabaseAdmin } = await import('./supabase');
  const db = supabaseAdmin();
  const monthStart = day.slice(0, 7) + '-01T00:00:00Z';   // Resend bills per calendar month
  const [{ count }, { count: mCount }, { data: gs }] = await Promise.all([
    db.from('email_send_log').select('id', { count: 'exact', head: true }).eq('status', 'sent').gte('sent_at', day + 'T00:00:00Z'),
    db.from('email_send_log').select('id', { count: 'exact', head: true }).eq('status', 'sent').gte('sent_at', monthStart),
    db.from('growth_settings').select('email_daily_cap, email_daily_reserve, email_monthly_cap').eq('id', 1).maybeSingle(),
  ]);
  // DB (admin-editable) is PRIMARY so the owner's control always wins; env is
  // only a fallback if the column is somehow missing.
  const cap = Math.max(20, Number(gs?.email_daily_cap) || CAP_ENV || 180);
  const reserve = Math.min(cap, Math.max(0, Number.isFinite(Number(gs?.email_daily_reserve)) ? Number(gs?.email_daily_reserve) : (!Number.isNaN(RESERVE_ENV) ? RESERVE_ENV : 20)));
  const monthCap = Math.max(100, Number(gs?.email_monthly_cap) || 3000);
  reserveCache = { day, count: count || 0, at: Date.now(), cap, reserve, monthCap, monthCount: mCount || 0 };
}
// Marketing may spend up to the MONTHLY cap minus a buyer cushion (10× the
// daily reserve, min 200) so order/auth emails keep sending all month even
// after marketing hits the plan's quota.
function monthlyMarketingLeft(): number {
  const cushion = Math.max(200, reserveCache.reserve * 10);
  return Math.max(0, reserveCache.monthCap - cushion - reserveCache.monthCount);
}
async function marketingBudgetLeft(batchSize = 1): Promise<boolean> {
  try { await refreshBudget(); } catch { return true; /* ledger unavailable → do not block */ }
  return reserveCache.count + batchSize <= reserveCache.cap - reserveCache.reserve
    && batchSize <= monthlyMarketingLeft();
}
// How many MARKETING emails may still go out today (cap − reserve − sent,
// also bounded by what's left of the month's plan quota).
// Callers that send in bulk (the weekly digest drain) MUST size each batch to
// this, or a fixed batch larger than the remaining budget is rejected wholesale
// and nothing sends — the bug that stalled 110 W35 digests for 3 days.
export async function marketingBudgetRemaining(): Promise<number> {
  try { await refreshBudget(); } catch { return 999; /* ledger unavailable → assume plenty */ }
  return Math.max(0, Math.min(reserveCache.cap - reserveCache.reserve - reserveCache.count, monthlyMarketingLeft()));
}
// Live throttle snapshot for the admin status panel.
export async function emailThrottleStatus(): Promise<{ cap: number; reserve: number; sentToday: number; marketingLeft: number; monthCap: number; sentThisMonth: number }> {
  try { await refreshBudget(); } catch { return { cap: 180, reserve: 20, sentToday: 0, marketingLeft: 160, monthCap: 3000, sentThisMonth: 0 }; }
  return { cap: reserveCache.cap, reserve: reserveCache.reserve, sentToday: reserveCache.count, marketingLeft: Math.max(0, Math.min(reserveCache.cap - reserveCache.reserve - reserveCache.count, monthlyMarketingLeft())), monthCap: reserveCache.monthCap, sentThisMonth: reserveCache.monthCount };
}
export function noteSent(n: number) { reserveCache.count += n; }
export function markQuotaExhausted(): void {
  quotaExhaustedDay = new Date().toISOString().slice(0, 10);
  console.warn('[resend] DAILY QUOTA EXHAUSTED — remaining sends this run are deferred to tomorrow');
}
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
      // 429 comes in two flavours. Per-second rate limiting: wait out the
      // window and retry. DAILY QUOTA exhausted: no amount of waiting inside
      // this run will help — return immediately so callers can stop cleanly
      // and resume tomorrow (retrying 6×30s here just burned the function
      // timeout and stalled every later step).
      const data429 = await res.clone().json().catch(() => ({}));
      const msg = String(data429?.message || data429?.name || '');
      const resetS = Number(res.headers.get('retry-after')) || Number(res.headers.get('ratelimit-reset')) || 1;
      if (/quota|daily/i.test(msg) || resetS > 120) {
        return { res, data: { ...data429, quota_exhausted: true } };
      }
      await sleep(Math.min(30000, Math.max(1000, resetS * 1000)));
    }
  });
  // Keep the shared chain alive even if one call rejects.
  chain = task.then(() => undefined, () => undefined);
  return task;
}

export async function send(opts: SendOptions): Promise<{ ok: boolean; id?: string; skipped?: boolean; error?: string; quota?: boolean }> {
  const critical = isBuyerCritical(opts.tags);
  if (!critical) {
    if (isQuotaExhausted()) return { ok: false, error: 'daily quota exhausted (deferred)', quota: true };
    if (!(await marketingBudgetLeft(1))) return { ok: false, error: 'daily reserve reached (deferred, buyer emails protected)', quota: true };
  }
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
  if (opts.attachments?.length) body.attachments = opts.attachments;
  const firstTo = Array.isArray(opts.to) ? String(opts.to[0] || '') : String(opts.to);
  const extraHeaders = { ...marketingHeadersFor(firstTo, opts.tags), ...(opts.headers || {}) };
  if (Object.keys(extraHeaders).length) body.headers = extraHeaders;

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
      if (data?.quota_exhausted) markQuotaExhausted();
      return { ok: false, error: data?.message || `HTTP ${res.status}`, quota: !!data?.quota_exhausted };
    }
    ledger('sent', data?.id);
    noteSent(recipients.length);
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
): Promise<{ ok: boolean; sent: number; skipped?: boolean; error?: string; quota?: boolean }> {
  if (!emails.some((e) => isBuyerCritical(e.tags))) {
    if (isQuotaExhausted()) return { ok: false, sent: 0, error: 'daily quota exhausted (deferred)', quota: true };
    if (!(await marketingBudgetLeft(Math.min(emails.length, 100)))) return { ok: false, sent: 0, error: 'daily reserve reached (deferred, buyer emails protected)', quota: true };
  }
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
    const to0 = Array.isArray(e.to) ? String(e.to[0] || '') : String(e.to);
    const eh = { ...marketingHeadersFor(to0, e.tags), ...(e.headers || {}) };
    if (Object.keys(eh).length) item.headers = eh;
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
      if (data?.quota_exhausted) markQuotaExhausted();
      return { ok: false, sent: 0, error: data?.message || `HTTP ${res.status}`, quota: !!data?.quota_exhausted };
    }
    const ids = Array.isArray(data?.data) ? data.data.map((d: any) => d?.id ?? null) : [];
    logSends(batchRows('sent', ids));
    const sentN = Array.isArray(data?.data) ? data.data.length : payload.length;
    noteSent(sentN);
    return { ok: true, sent: sentN };
  } catch (e: any) {
    console.error('[resend] batch threw', e);
    logSends(batchRows('failed', undefined, e.message || 'network error'));
    return { ok: false, sent: 0, error: e.message || 'network error' };
  }
}
