// Membership drip automation — the shared engine used by BOTH the Paddle
// webhook (creates a subscription + sends the first pack) and the daily cron
// (sends monthly drops, pre-expiry, and expiry emails).
//
// Model: a member buys an N-month plan (one-time). Drop k (1-based) maps to the
// calendar month = start_date + (k-1) months. There are N drops total; the first
// is sent at purchase, the rest by the cron on each next_drop_date. After the
// last drop the term runs to end_date (= start + N months), then expires.
//
// All DB access uses the service-role client (RLS bypassed). Every send is
// idempotent via subscription_email_logs' unique (subscription_id, email_type,
// drop_month) index — the cron can safely run more than once a day.

import { supabaseAdmin } from './supabase';
import { send as sendEmail } from './resend';
import {
  firstPackEmail, monthlyDropEmail, preExpiryEmail, expiryEmail,
  type DropEmailData, type ExpiryEmailData,
} from './subscription-emails';

const SITE = (process.env.PUBLIC_SITE_URL || 'https://digitalchiselco.com').replace(/\/$/, '');
const RENEW_URL = process.env.MEMBERSHIP_RENEW_URL || `${SITE}/#membership`;

type DB = ReturnType<typeof supabaseAdmin>;

// ── date helpers (work on 'YYYY-MM-DD' / 'YYYY-MM' strings, UTC-safe) ──
export function ymd(d: Date): string { return d.toISOString().slice(0, 10); }
export function toYM(ymdStr: string): string { return ymdStr.slice(0, 7); }
export function todayYMD(): string { return new Date().toISOString().slice(0, 10); }

/** Add n months to a 'YYYY-MM-DD', clamping the day to the target month length. */
export function addMonths(ymdStr: string, n: number): string {
  const [y, m, d] = ymdStr.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1 + n, 1));
  const daysInTarget = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  base.setUTCDate(Math.min(d, daysInTarget));
  return base.toISOString().slice(0, 10);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function ymLabel(ym: string): string { const [y, m] = ym.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; }
export function ymdLabel(ymdStr: string): string { const [y, m, d] = ymdStr.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; }

// ── lookups ───────────────────────────────────────────────────────────
async function getLogoUrl(db: DB): Promise<string | null> {
  const { data } = await db.from('site_settings').select('logo_image_url').eq('id', 1).maybeSingle();
  return data?.logo_image_url || null;
}
async function getPack(db: DB, ym: string): Promise<{ title: string | null; preview_note: string | null; standard_drive_link: string | null; bonus_drive_link: string | null } | null> {
  const { data } = await db.from('monthly_files').select('title, preview_note, standard_drive_link, bonus_drive_link').eq('month', ym).maybeSingle();
  return data ?? null;
}

// ── idempotent send: claims the (sub, type, month) slot, then sends ────
async function sendOnce(
  db: DB,
  claim: { subscription_id: string; email: string; email_type: string; drop_month: string },
  build: () => { subject: string; html: string; text: string },
): Promise<'sent' | 'failed' | 'duplicate'> {
  // Claim the slot first. The unique index makes this the atomic gate — a second
  // run (or a concurrent one) hits 23505 and bails without re-sending.
  const { error: claimErr } = await db.from('subscription_email_logs').insert({
    subscription_id: claim.subscription_id, email: claim.email,
    email_type: claim.email_type, drop_month: claim.drop_month, status: 'pending',
  });
  if (claimErr) {
    if ((claimErr as any).code === '23505') return 'duplicate';
    throw claimErr;
  }
  const { subject, html, text } = build();
  const res = await sendEmail({ to: claim.email, subject, html, text, idempotencyKey: `${claim.email_type}:${claim.subscription_id}:${claim.drop_month}` });
  await db.from('subscription_email_logs')
    .update({ status: res.ok ? 'sent' : 'failed', error_message: res.ok ? null : (res.error || 'send failed') })
    .eq('subscription_id', claim.subscription_id).eq('email_type', claim.email_type).eq('drop_month', claim.drop_month);
  return res.ok ? 'sent' : 'failed';
}

// ── webhook entry: create the subscription + send the first pack ──────
export async function createSubscriptionForPurchase(input: {
  email: string;
  customerName?: string | null;
  plan: { slug: string; name: string; months: number; files_per_month?: number; price_usd?: number };
  orderId?: string | null;
  paddleTransactionId?: string | null;
  startDate?: string;     // 'YYYY-MM-DD'; defaults to today (manual Etsy adds may backdate)
  source?: string;        // 'paddle' | 'etsy' | 'manual' | 'import'
  notes?: string | null;
  couponCode?: string | null;
}): Promise<{ created: boolean; subscriptionId?: string; reason?: string }> {
  const db = supabaseAdmin();
  const email = input.email.toLowerCase().trim();
  const months = input.plan.months;
  const tier = months >= 12 ? 'premium' : 'standard';
  const start = input.startDate && /^\d{4}-\d{2}-\d{2}$/.test(input.startDate) ? input.startDate : todayYMD();
  const end = addMonths(start, months);

  // Renewal detection: any prior term for this email.
  const { data: prior } = await db.from('member_subscriptions').select('id').ilike('email', email).limit(1);
  const isRenewal = !!(prior && prior.length);

  const row = {
    email, customer_name: input.customerName || null,
    plan_slug: input.plan.slug, months, files_per_month: input.plan.files_per_month ?? 8,
    tier, status: 'active', start_date: start, end_date: end,
    next_drop_date: months > 1 ? addMonths(start, 1) : null,
    drops_sent: 0, total_drops: months, price_usd: input.plan.price_usd ?? null,
    is_renewal: isRenewal, order_id: input.orderId || null,
    paddle_transaction_id: input.paddleTransactionId || null,
    source: input.source || 'paddle', notes: input.notes || null, coupon_code: input.couponCode || null,
  };

  const { data: inserted, error } = await db.from('member_subscriptions').insert(row).select('id').single();
  if (error) {
    // Duplicate transaction (webhook retry) — the unique txn index caught it.
    if ((error as any).code === '23505') return { created: false, reason: 'duplicate transaction' };
    throw error;
  }
  const subId = inserted.id as string;

  // Send pack 1 (start month) immediately.
  const startYM = toYM(start);
  const [pack, logoUrl] = await Promise.all([getPack(db, startYM), getLogoUrl(db)]);
  const data: DropEmailData = {
    email, customerName: input.customerName, planName: input.plan.name,
    monthLabel: ymLabel(startYM), packTitle: pack?.title, previewNote: pack?.preview_note,
    standardLink: pack?.standard_drive_link, bonusLink: tier === 'premium' ? pack?.bonus_drive_link : null,
    dropNumber: 1, totalDrops: months, isPremium: tier === 'premium', logoUrl,
  };
  const result = await sendOnce(db, { subscription_id: subId, email, email_type: 'first_pack', drop_month: startYM }, () => firstPackEmail(data));
  if (result !== 'duplicate') {
    await db.from('member_subscriptions').update({ drops_sent: 1 }).eq('id', subId);
  }
  return { created: true, subscriptionId: subId };
}

// ── cron entry: process every active subscription ─────────────────────
export async function runDailyAutomation(): Promise<{
  processed: number; drops: number; preExpiry: number; expired: number; skippedNoPack: number; failures: number;
}> {
  const db = supabaseAdmin();
  const today = todayYMD();
  const stats = { processed: 0, drops: 0, preExpiry: 0, expired: 0, skippedNoPack: 0, failures: 0 };
  const logoUrl = await getLogoUrl(db);

  const { data: subs, error } = await db.from('member_subscriptions')
    .select('*').in('status', ['active']).order('created_at');
  if (error) throw error;

  // plan display names (fallback to a readable default)
  const { data: plans } = await db.from('membership_plans').select('slug, name');
  const planName = (slug: string) => (plans || []).find((p) => p.slug === slug)?.name || 'CNC STL Membership';

  for (const s of subs || []) {
    stats.processed++;
    try {
      // 1) monthly drop due?
      if (s.next_drop_date && s.next_drop_date <= today && s.drops_sent < s.total_drops) {
        const dropNumber = s.drops_sent + 1;                 // 1-based
        const ym = toYM(addMonths(s.start_date, s.drops_sent)); // month for this drop
        const pack = await getPack(db, ym);
        if (!pack || (!pack.standard_drive_link && !pack.bonus_drive_link)) {
          // Files not uploaded yet — wait; don't advance. Retries tomorrow.
          stats.skippedNoPack++;
        } else {
          const data: DropEmailData = {
            email: s.email, customerName: s.customer_name, planName: planName(s.plan_slug),
            monthLabel: ymLabel(ym), packTitle: pack.title, previewNote: pack.preview_note,
            standardLink: pack.standard_drive_link, bonusLink: s.tier === 'premium' ? pack.bonus_drive_link : null,
            dropNumber, totalDrops: s.total_drops, isPremium: s.tier === 'premium', logoUrl,
          };
          const r = await sendOnce(db, { subscription_id: s.id, email: s.email, email_type: 'monthly_drop', drop_month: ym }, () => monthlyDropEmail(data));
          if (r === 'failed') stats.failures++;
          if (r !== 'duplicate') stats.drops++;
          // Advance regardless (duplicate means it was already sent) so we move on.
          const newDropsSent = dropNumber;
          const nextDrop = newDropsSent < s.total_drops ? addMonths(s.start_date, newDropsSent) : null;
          await db.from('member_subscriptions').update({ drops_sent: newDropsSent, next_drop_date: nextDrop }).eq('id', s.id);
        }
      }

      // 2) pre-expiry reminder — within 7 days of end_date (once)
      const preWindow = daysUntil(today, s.end_date);
      if (preWindow <= 7 && preWindow >= 0) {
        const ed: ExpiryEmailData = { email: s.email, customerName: s.customer_name, planName: planName(s.plan_slug), endDateLabel: ymdLabel(s.end_date), renewUrl: RENEW_URL, logoUrl };
        const r = await sendOnce(db, { subscription_id: s.id, email: s.email, email_type: 'pre_expiry', drop_month: toYM(s.end_date) }, () => preExpiryEmail(ed));
        if (r === 'sent') stats.preExpiry++;
        if (r === 'failed') stats.failures++;
      }

      // 3) expiry — on/after end_date
      if (s.end_date <= today) {
        const ed: ExpiryEmailData = { email: s.email, customerName: s.customer_name, planName: planName(s.plan_slug), endDateLabel: ymdLabel(s.end_date), renewUrl: RENEW_URL, logoUrl };
        const r = await sendOnce(db, { subscription_id: s.id, email: s.email, email_type: 'expiry', drop_month: toYM(s.end_date) }, () => expiryEmail(ed));
        if (r === 'failed') stats.failures++;
        await db.from('member_subscriptions').update({ status: 'expired', next_drop_date: null }).eq('id', s.id);
        stats.expired++;
      }
    } catch (e: any) {
      stats.failures++;
      console.error('[subscriptions] failed on', s.id, e?.message || e);
    }
  }
  return stats;
}

/** Whole days from `from` to `to` (both 'YYYY-MM-DD'); negative if `to` is past. */
function daysUntil(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}
