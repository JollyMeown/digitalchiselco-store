// Membership engine, shared by the Paddle webhook (new term + first pack),
// the admin "Add member" route (Etsy buyers), the admin "Deliver now" and
// "Resend pack" actions, the member portal, and the nightly cron.
//
// Model: a member buys an N-month plan (one-time). Drop k (1-based) is the
// calendar month start_date + (k-1) months. The first drop goes out at
// purchase (if its pack exists), the rest when each month arrives. The term
// runs to end_date = start + N months, then expires.
//
// Robustness rules (2026-09-05 rebuild):
//   * every send is claimed in subscription_email_logs first (unique index),
//     so two runs can never double-send, and a failed send releases the claim
//     so tomorrow retries;
//   * a member who is behind (backdated add, pack uploaded late, cron missed)
//     is caught up in ONE run, oldest pack first, via processSubscription;
//   * a renewal bought while a term is still active starts the day the old
//     term ends (no lost months), and the old term points at the new one;
//   * membership mail is tagged kind=membership: buyer-critical, never held
//     back by the marketing budget;
//   * the provider id is kept on the ledger so opens/clicks join back, and
//     every pack link is a tracked link so downloads are known too;
//   * the owner is told (Telegram) when a due pack is missing, when next
//     month's pack is missing close to month start, and when sends fail.

import crypto from 'node:crypto';
import { supabaseAdmin } from './supabase';
import { send as sendEmail } from './resend';
import {
  firstPackEmail, monthlyDropEmail, preExpiryEmail, expiryEmail, winbackEmail,
  type DropEmailData, type ExpiryEmailData, type PackItem,
} from './subscription-emails';

const SITE = (process.env.PUBLIC_SITE_URL || 'https://digitalchiselco.com').replace(/\/$/, '');
const RENEW_URL = process.env.MEMBERSHIP_RENEW_URL || `${SITE}/membership?renew=1`;
const KIND = [{ name: 'kind', value: 'membership' }];
// The only address allowed to receive a test pack (month 2090 or later).
const TEST_INBOX = 'jolly@digitalchiselco.com';

type DB = ReturnType<typeof supabaseAdmin>;

// ── date helpers ('YYYY-MM-DD' / 'YYYY-MM' strings, UTC-safe) ─────────
export function ymd(d: Date): string { return d.toISOString().slice(0, 10); }
export function toYM(ymdStr: string): string { return ymdStr.slice(0, 7); }
export function todayYMD(): string { return new Date().toISOString().slice(0, 10); }
export function addMonths(ymdStr: string, n: number): string {
  const [y, m, d] = ymdStr.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1 + n, 1));
  const daysInTarget = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  base.setUTCDate(Math.min(d, daysInTarget));
  return base.toISOString().slice(0, 10);
}
export function addDays(ymdStr: string, n: number): string {
  const [y, m, d] = ymdStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function ymLabel(ym: string): string { const [y, m] = ym.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; }
export function ymdLabel(ymdStr: string): string { const [y, m, d] = ymdStr.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; }
export function daysUntil(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

// ── tracked pack links ────────────────────────────────────────────────
// /api/member/pack?s=<sub>&m=<YYYY-MM>&k=standard|bonus&v=email|portal&t=<sig>
// The signature binds the subscription and month, so a link cannot be edited
// into another member's pack, and the route logs the click before redirecting.
function linkSecret(): string {
  const s = process.env.ACCOUNT_TOKEN_SECRET || (import.meta as any).env?.ACCOUNT_TOKEN_SECRET
    || process.env.SUPABASE_SERVICE_ROLE_KEY || (import.meta as any).env?.SUPABASE_SERVICE_ROLE_KEY || 'dev-only';
  return s;
}
export function packLinkSig(subId: string, ym: string, kind: string): string {
  return crypto.createHmac('sha256', linkSecret()).update(`${subId}|${ym}|${kind}`).digest('base64url').slice(0, 24);
}
export function packLink(subId: string, ym: string, kind: 'standard' | 'bonus', via: 'email' | 'portal'): string {
  return `${SITE}/api/member/pack?s=${encodeURIComponent(subId)}&m=${ym}&k=${kind}&v=${via}&t=${packLinkSig(subId, ym, kind)}`;
}

// ── lookups ───────────────────────────────────────────────────────────
async function getLogoUrl(db: DB): Promise<string | null> {
  const { data } = await db.from('site_settings').select('logo_image_url').eq('id', 1).maybeSingle();
  return data?.logo_image_url || null;
}
export type Pack = { month: string; title: string | null; preview_note: string | null; standard_drive_link: string | null; bonus_drive_link: string | null; cover_image_url: string | null; items: PackItem[]; bonus_items: PackItem[] };
export async function getPack(db: DB, ym: string): Promise<Pack | null> {
  const { data } = await db.from('monthly_files').select('month, title, preview_note, standard_drive_link, bonus_drive_link, cover_image_url, items, bonus_items').eq('month', ym).maybeSingle();
  if (!data) return null;
  return { ...data, items: Array.isArray(data.items) ? data.items : [], bonus_items: Array.isArray(data.bonus_items) ? data.bonus_items : [] } as Pack;
}
const hasFiles = (p: Pack | null) => !!(p && (p.standard_drive_link || p.bonus_drive_link));
async function getSettings(db: DB) {
  const { data } = await db.from('growth_settings')
    .select('membership_reminder_days, membership_winback_days, membership_winback_coupon, membership_pack_alert_days, membership_last_alert_at, marketplace_enabled').eq('id', 1).maybeSingle();
  const days = String(data?.membership_reminder_days || '10,3').split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n >= 0);
  return {
    // the Cut Local block at the foot of every membership email, same gate as the order email
    makerInvite: !!data?.marketplace_enabled,
    reminderDays: days.length ? [...new Set(days)].sort((a, b) => b - a) : [10, 3],
    winbackDays: Number(data?.membership_winback_days) || 14,
    coupon: (data?.membership_winback_coupon || '').trim() || null,
    packAlertDays: Number(data?.membership_pack_alert_days) || 7,
    lastAlertAt: data?.membership_last_alert_at || null,
  };
}
async function planName(db: DB, slug: string): Promise<string> {
  const { data } = await db.from('membership_plans').select('name').eq('slug', slug).maybeSingle();
  return data?.name || 'CNC STL Membership';
}

// ── idempotent send ───────────────────────────────────────────────────
async function sendOnce(
  db: DB,
  claim: { subscription_id: string; email: string; email_type: string; drop_month: string },
  build: () => { subject: string; html: string; text: string },
  opts: { force?: boolean } = {},
): Promise<'sent' | 'failed' | 'duplicate'> {
  // force = a deliberate re-send (admin or member button): the claim carries a
  // timestamp so the unique index allows it, and the ledger shows it as a re-send.
  const dropMonth = opts.force ? `${claim.drop_month}#${Date.now().toString(36)}` : claim.drop_month;
  const { error: claimErr } = await db.from('subscription_email_logs').insert({
    subscription_id: claim.subscription_id, email: claim.email,
    email_type: claim.email_type, drop_month: dropMonth, status: 'pending',
  });
  if (claimErr) {
    if ((claimErr as any).code === '23505') return 'duplicate';
    throw claimErr;
  }
  const { subject, html, text } = build();
  const res = await sendEmail({
    to: claim.email, subject, html, text, tags: KIND,
    idempotencyKey: `${claim.email_type}:${claim.subscription_id}:${dropMonth}`,
  });
  if (res.ok) {
    await db.from('subscription_email_logs')
      .update({ status: 'sent', error_message: null, provider_id: res.id || null, subject, sent_at: new Date().toISOString() })
      .eq('subscription_id', claim.subscription_id).eq('email_type', claim.email_type).eq('drop_month', dropMonth);
    await db.from('member_subscriptions').update({ last_email_at: new Date().toISOString() }).eq('id', claim.subscription_id);
    return 'sent';
  }
  // Release the claim so the next run retries; the failure stays in email_send_log.
  await db.from('subscription_email_logs').delete()
    .eq('subscription_id', claim.subscription_id).eq('email_type', claim.email_type).eq('drop_month', dropMonth);
  console.error(`[subscriptions] ${claim.email_type} for ${claim.email} (${dropMonth}) failed: ${res.error}`);
  return 'failed';
}

function dropData(s: any, ym: string, pack: Pack | null, dropNumber: number, plan: string, logoUrl: string | null, resend = false, makerInvite = false): DropEmailData {
  const nextYM = dropNumber < s.total_drops ? toYM(addMonths(s.start_date, dropNumber)) : null;
  return {
    makerInvite,
    email: s.email, customerName: s.customer_name, planName: plan,
    monthLabel: ymLabel(ym), packTitle: pack?.title, previewNote: pack?.preview_note,
    coverUrl: pack?.cover_image_url, items: pack?.items || [],
    standardLink: pack?.standard_drive_link ? packLink(s.id, ym, 'standard', 'email') : null,
    bonusLink: s.tier === 'premium' && pack?.bonus_drive_link ? packLink(s.id, ym, 'bonus', 'email') : null,
    bonusItems: s.tier === 'premium' ? (pack?.bonus_items || []) : [],
    hasBonus: !!pack?.bonus_drive_link,
    dropNumber, totalDrops: s.total_drops, isPremium: s.tier === 'premium',
    nextPackLabel: nextYM ? ymLabel(nextYM) : null, endDateLabel: ymdLabel(s.end_date), logoUrl, resend,
  };
}

// ── create a term (webhook, admin add) ────────────────────────────────
export async function createSubscriptionForPurchase(input: {
  email: string;
  customerName?: string | null;
  plan: { slug: string; name: string; months: number; files_per_month?: number; price_usd?: number };
  orderId?: string | null;
  paddleTransactionId?: string | null;
  startDate?: string;     // 'YYYY-MM-DD'; a manual add may backdate
  source?: string;        // 'paddle' | 'etsy' | 'manual' | 'import' | 'website'
  notes?: string | null;
  couponCode?: string | null;
  /** Migration from the old system: packs the member already received there. Those months are not re-sent. */
  dropsAlreadySent?: number;
}): Promise<{ created: boolean; subscriptionId?: string; reason?: string; chainedFrom?: string | null; upgradedFrom?: string | null; creditMonths?: number; startDate?: string }> {
  const db = supabaseAdmin();
  const email = input.email.toLowerCase().trim();
  const months = input.plan.months;
  const tier = months >= 12 ? 'premium' : 'standard';
  const today = todayYMD();

  // Renewal chaining: a purchase while a term is still running starts when
  // that term ends, so the member never pays for overlapping months.
  const { data: priorRows } = await db.from('member_subscriptions')
    .select('id, status, end_date, start_date, months, tier, drops_sent, total_drops').ilike('email', email).order('end_date', { ascending: false }).limit(5);
  const prior = priorRows || [];
  const isRenewal = prior.length > 0;
  const running = prior.find((p: any) => p.status === 'active' && p.end_date > today) as any;
  let start = input.startDate && /^\d{4}-\d{2}-\d{2}$/.test(input.startDate) ? input.startDate : today;
  let chainedFrom: string | null = null;
  let upgradedFrom: string | null = null;
  let creditMonths = 0;
  if (running && !input.startDate) {
    // Upgrade (longer plan or higher tier): starts now, the unsent months of
    // the old term are added to the end so nothing paid for is lost, and the
    // old term is closed as "upgraded". Otherwise a renewal chains after.
    const isUpgrade = months > Number(running.months) || (tier === 'premium' && running.tier !== 'premium');
    if (isUpgrade) {
      upgradedFrom = running.id;
      creditMonths = Math.max(0, Number(running.total_drops) - Number(running.drops_sent));
    } else { start = running.end_date; chainedFrom = running.id; }
  }
  const end = addMonths(start, months + creditMonths);

  const row = {
    email, customer_name: input.customerName || null,
    plan_slug: input.plan.slug, months, files_per_month: input.plan.files_per_month ?? 8,
    tier, status: 'active', start_date: start, end_date: end,
    // the cron sends drop 1 when start arrives (future start) or catches up now
    // an imported member may already have received some packs in the old
    // system: start counting from there so nothing is sent twice
    drops_sent: Math.max(0, Math.min(months + creditMonths, Number(input.dropsAlreadySent) || 0)),
    next_drop_date: (Number(input.dropsAlreadySent) || 0) >= months + creditMonths ? null : addMonths(start, Math.max(0, Number(input.dropsAlreadySent) || 0)),
    total_drops: months + creditMonths, price_usd: input.plan.price_usd ?? null,
    is_renewal: isRenewal, order_id: input.orderId || null,
    paddle_transaction_id: input.paddleTransactionId || null,
    source: input.source || 'paddle',
    notes: [input.notes, creditMonths ? `upgrade: ${creditMonths} unused month(s) of the previous term carried over` : null].filter(Boolean).join(' · ') || null,
    coupon_code: input.couponCode || null,
    renewed_from: chainedFrom || upgradedFrom,
  };
  const { data: inserted, error } = await db.from('member_subscriptions').insert(row).select('id').single();
  if (error) {
    if ((error as any).code === '23505') return { created: false, reason: 'duplicate transaction' };
    throw error;
  }
  const subId = inserted.id as string;
  if (chainedFrom) await db.from('member_subscriptions').update({ renewed_to: subId }).eq('id', chainedFrom);
  if (upgradedFrom) await db.from('member_subscriptions').update({ renewed_to: subId, status: 'upgraded', next_drop_date: null }).eq('id', upgradedFrom);

  // Deliver whatever is already due (pack 1 today, or every past month of a
  // backdated add). A future-dated renewal sends nothing yet.
  const { data: s } = await db.from('member_subscriptions').select('*').eq('id', subId).single();
  if (s) await processSubscription(db, s, { today, logoUrl: await getLogoUrl(db), settings: await getSettings(db), stats: newStats() });
  return { created: true, subscriptionId: subId, chainedFrom, upgradedFrom, creditMonths, startDate: start };
}

// ── per-member processing (cron and admin "deliver now") ──────────────
/** A run context for driving processSubscription() one member at a time (tests, admin). */
export async function makeRunContext(today?: string): Promise<Ctx> {
  const db = supabaseAdmin();
  return { today: today || todayYMD(), logoUrl: await getLogoUrl(db), settings: await getSettings(db), stats: newStats() };
}
export type RunStats ={ processed: number; drops: number; preExpiry: number; expired: number; winback: number; skippedNoPack: number; failures: number; missingPacks: string[]; notes: string[] };
export const newStats = (): RunStats => ({ processed: 0, drops: 0, preExpiry: 0, expired: 0, winback: 0, skippedNoPack: 0, failures: 0, missingPacks: [], notes: [] });
type Ctx = { today: string; logoUrl: string | null; settings: Awaited<ReturnType<typeof getSettings>>; stats: RunStats };

export async function processSubscription(db: DB, s: any, ctx: Ctx): Promise<void> {
  const { today, logoUrl, settings, stats } = ctx;
  stats.processed++;
  const plan = await planName(db, s.plan_slug);

  // Test terms: the owner's own membership dated 2090 or later (used to prove
  // the BRS pack builder end to end). Its months are due immediately, and a
  // pack month of 2090+ is NEVER sent to any other address, whatever happens.
  const isTestTerm = String(s.email).toLowerCase() === TEST_INBOX && String(s.start_date) >= '2090';

  // 1) drops: catch up every month that has arrived, oldest first, stopping
  //    at the first month whose pack is not uploaded yet
  if (s.status === 'active') {
    let dropsSent = s.drops_sent;
    for (let guard = 0; guard < 24 && dropsSent < s.total_drops; guard++) {
      const dueDate = addMonths(s.start_date, dropsSent);
      if (dueDate > today && !isTestTerm) break;
      const ym = toYM(dueDate);
      if (ym >= '2090' && !isTestTerm) break;        // test months never reach real members
      const pack = await getPack(db, ym);
      if (!hasFiles(pack)) {
        // A brand-new member must still hear from us: a welcome now, with the
        // pack email following the moment the month is uploaded. Once per term.
        if (dropsSent === 0) {
          const data = dropData(s, ym, pack, 1, plan, logoUrl, false, settings.makerInvite);
          const r = await sendOnce(db, { subscription_id: s.id, email: s.email, email_type: 'welcome', drop_month: ym }, () => firstPackEmail(data));
          if (r === 'sent') stats.notes.push(`welcome sent to ${s.email} (pack ${ym} pending)`);
          if (r === 'failed') stats.failures++;
        }
        stats.skippedNoPack++;
        if (!stats.missingPacks.includes(ym)) stats.missingPacks.push(ym);
        break;                                   // wait for the upload; retry next run
      }
      const dropNumber = dropsSent + 1;
      const type = dropNumber === 1 ? 'first_pack' : 'monthly_drop';
      const data = dropData(s, ym, pack, dropNumber, plan, logoUrl, false, settings.makerInvite);
      const r = await sendOnce(db, { subscription_id: s.id, email: s.email, email_type: type, drop_month: ym },
        () => (dropNumber === 1 ? firstPackEmail(data) : monthlyDropEmail(data)));
      if (r === 'failed') { stats.failures++; break; }
      if (r === 'sent') stats.drops++;
      dropsSent = dropNumber;
      const next = dropsSent < s.total_drops ? addMonths(s.start_date, dropsSent) : null;
      await db.from('member_subscriptions').update({ drops_sent: dropsSent, next_drop_date: next }).eq('id', s.id);
    }
    s.drops_sent = dropsSent;

    // 2) reminders before the end (each configured day, once each), skipped
    //    when the member has already renewed
    if (!s.renewed_to) {
      const left = daysUntil(today, s.end_date);
      for (const d of settings.reminderDays) {
        // fire at day d, and still fire if the cron missed that exact day (up to 2 days late)
        if (left <= d && left > d - 3 && left >= 0) {
          const ed: ExpiryEmailData = { email: s.email, customerName: s.customer_name, planName: plan, endDateLabel: ymdLabel(s.end_date), daysLeft: left, renewUrl: RENEW_URL, coupon: null, packsReceived: s.drops_sent, logoUrl, makerInvite: settings.makerInvite };
          const r = await sendOnce(db, { subscription_id: s.id, email: s.email, email_type: `pre_expiry_${d}`, drop_month: toYM(s.end_date) }, () => preExpiryEmail(ed));
          if (r === 'sent') stats.preExpiry++;
          if (r === 'failed') stats.failures++;
          break;                                 // one reminder per run
        }
      }
    }

    // 3) expiry, on or after the end date
    if (s.end_date <= today) {
      if (!s.renewed_to) {
        const ed: ExpiryEmailData = { email: s.email, customerName: s.customer_name, planName: plan, endDateLabel: ymdLabel(s.end_date), renewUrl: RENEW_URL, coupon: null, logoUrl, makerInvite: settings.makerInvite };
        const r = await sendOnce(db, { subscription_id: s.id, email: s.email, email_type: 'expiry', drop_month: toYM(s.end_date) }, () => expiryEmail(ed));
        if (r === 'failed') stats.failures++;
      }
      await db.from('member_subscriptions').update({ status: 'expired', next_drop_date: null }).eq('id', s.id);
      stats.expired++;
    }
  }

  // 4) win-back, some days after an expiry that was not renewed
  if (s.status === 'expired' && !s.renewed_to && settings.winbackDays > 0) {
    const since = daysUntil(s.end_date, today);
    if (since >= settings.winbackDays && since < settings.winbackDays + 3) {
      // skip if they have since started a new term
      const { data: later } = await db.from('member_subscriptions').select('id').ilike('email', s.email).gt('start_date', s.end_date).limit(1);
      if (!later?.length) {
        const latest = await db.from('monthly_files').select('title').order('month', { ascending: false }).limit(1).maybeSingle();
        const ed = { email: s.email, customerName: s.customer_name, planName: plan, endDateLabel: ymdLabel(s.end_date), renewUrl: RENEW_URL, coupon: settings.coupon, logoUrl, newPackTitle: latest.data?.title || null, makerInvite: settings.makerInvite };
        const r = await sendOnce(db, { subscription_id: s.id, email: s.email, email_type: 'winback', drop_month: toYM(s.end_date) }, () => winbackEmail(ed));
        if (r === 'sent') stats.winback++;
        if (r === 'failed') stats.failures++;
      }
    }
  }
}

// ── cron entry ────────────────────────────────────────────────────────
export async function runDailyAutomation(): Promise<RunStats> {
  const db = supabaseAdmin();
  const today = todayYMD();
  const stats = newStats();
  const ctx: Ctx = { today, logoUrl: await getLogoUrl(db), settings: await getSettings(db), stats };

  // First the safety net: any paid membership order with no term gets one now
  // (the created term sends its first pack inside createSubscriptionForPurchase).
  try {
    const rec = await reconcileMembershipOrders();
    if (rec.created.length) { stats.notes.push(`reconciled: ${rec.created.join('; ')}`); (stats as any).reconciled = rec.created; }
  } catch (e: any) { stats.notes.push(`reconcile failed: ${String(e?.message || e).slice(0, 120)}`); }

  const { data: subs, error } = await db.from('member_subscriptions')
    .select('*').in('status', ['active', 'expired']).order('created_at');
  if (error) throw error;
  for (const s of subs || []) {
    try { await processSubscription(db, s, ctx); }
    catch (e: any) { stats.failures++; stats.notes.push(`${s.email}: ${String(e?.message || e).slice(0, 120)}`); console.error('[subscriptions] failed on', s.id, e?.message || e); }
  }

  // Owner alerts: a pack that is due and missing, next month's pack missing
  // close to month start, failures. At most one alert a day.
  try {
    const alerts: string[] = [];
    if (stats.missingPacks.length) alerts.push(`⛔ Pack missing for ${stats.missingPacks.map(ymLabel).join(', ')}: ${stats.skippedNoPack} member(s) are waiting. Add the Drive link in Admin > Monthly Drops.`);
    const nextYM = toYM(addMonths(today.slice(0, 7) + '-01', 1));
    const daysToNext = daysUntil(today, nextYM + '-01');
    const nextPack = await getPack(db, nextYM);
    const { count: activeCount } = await db.from('member_subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'active');
    if (!hasFiles(nextPack) && daysToNext <= ctx.settings.packAlertDays && (activeCount || 0) > 0) {
      alerts.push(`⏰ ${ymLabel(nextYM)} pack is not uploaded yet and ${activeCount} member(s) expect it in ${daysToNext} day(s).`);
    }
    const rec = (stats as any).reconciled as string[] | undefined;
    if (rec?.length) alerts.push(`🧾 Created ${rec.length} membership(s) from paid orders that had none (first pack sent): ${rec.join('; ')}`);
    if (stats.failures) alerts.push(`⚠️ ${stats.failures} membership email(s) failed to send; they retry tomorrow.${stats.notes.length ? '\n' + stats.notes.slice(0, 5).join('\n') : ''}`);
    if (alerts.length) {
      const last = ctx.settings.lastAlertAt ? new Date(ctx.settings.lastAlertAt).getTime() : 0;
      if (Date.now() - last > 20 * 3600e3) {
        const { telegramOwner } = await import('./notify');
        await telegramOwner(`<b>Membership</b>\n${alerts.join('\n')}`);
        await db.from('growth_settings').update({ membership_last_alert_at: new Date().toISOString() }).eq('id', 1);
      }
    }
  } catch (e: any) { console.error('[subscriptions] alert failed', e?.message); }
  return stats;
}

// ── reconciliation: no paid membership order may exist without a term ─
// Safety net under the webhook. Looks at paid orders of the last 120 days
// whose items are subscription products or plan names, and creates the term
// for any that has none (idempotent on `${txn}:${slug}`, and skipped when a
// term for that email already starts within 3 days of the order, which is
// how a hand-added member looks). Returns what it did, for the ledger.
export async function reconcileMembershipOrders(): Promise<{ checked: number; created: string[]; skipped: number }> {
  const db = supabaseAdmin();
  const out = { checked: 0, created: [] as string[], skipped: 0 };
  const since = new Date(Date.now() - 120 * 864e5).toISOString();
  const { data: plans } = await db.from('membership_plans').select('name, slug, months, price_usd, files_per_month');
  if (!plans?.length) return out;
  const planNames = new Set(plans.map((p: any) => p.name));
  const { data: subProducts } = await db.from('products').select('id, title, membership_plan_slug').eq('is_subscription', true);
  const byProduct = new Map((subProducts || []).map((p: any) => [p.id, p]));
  const { data: items } = await db.from('order_items')
    .select('order_id, product_id, title, orders!inner(id, email, customer_name, status, created_at, paddle_transaction_id)')
    .gte('orders.created_at', since).eq('orders.status', 'paid').limit(5000);
  const planFor = (it: any) => {
    if (planNames.has(it.title)) return plans.find((p: any) => p.name === it.title);
    const sp = it.product_id ? byProduct.get(it.product_id) : null;
    if (!sp) return null;
    const m = /(\d+)\s*-?\s*month/i.exec(String(sp.title || ''));
    return plans.find((p: any) => p.slug === sp.membership_plan_slug) || (m ? plans.find((p: any) => Number(p.months) === Number(m[1])) : null) || [...plans].sort((a: any, b: any) => a.months - b.months)[0];
  };
  const seen = new Set<string>();
  for (const it of items || []) {
    const o: any = (it as any).orders;
    const plan: any = planFor(it);
    if (!o?.email || !plan) continue;
    const key = `${o.id}:${plan.slug}`;
    if (seen.has(key)) continue;
    seen.add(key); out.checked++;
    const email = String(o.email).toLowerCase();
    const orderDay = String(o.created_at).slice(0, 10);
    const { data: existing } = await db.from('member_subscriptions').select('id, start_date, order_id, paddle_transaction_id').ilike('email', email);
    const has = (existing || []).some((s: any) => s.order_id === o.id
      || (o.paddle_transaction_id && s.paddle_transaction_id === `${o.paddle_transaction_id}:${plan.slug}`)
      || Math.abs(daysUntil(orderDay, s.start_date)) <= 3);
    if (has) { out.skipped++; continue; }
    try {
      const r = await createSubscriptionForPurchase({
        email, customerName: o.customer_name, orderId: o.id,
        paddleTransactionId: o.paddle_transaction_id ? `${o.paddle_transaction_id}:${plan.slug}` : null,
        plan: { slug: plan.slug, name: plan.name, months: plan.months, files_per_month: plan.files_per_month, price_usd: plan.price_usd },
        startDate: orderDay, source: 'paddle', notes: `created by reconciliation on ${todayYMD()} (order ${String(o.id).slice(0, 8)} had no membership)`,
      });
      if (r.created) out.created.push(`${email} (${plan.slug}, order ${String(o.id).slice(0, 8)})`);
    } catch (e: any) { console.error('[subscriptions] reconcile failed', o.id, e?.message); }
  }
  return out;
}

// ── admin / member actions ────────────────────────────────────────────
/** Deliver everything due right now, for one member or for all active. */
export async function deliverNow(subscriptionId?: string): Promise<RunStats> {
  const db = supabaseAdmin();
  const stats = newStats();
  const ctx: Ctx = { today: todayYMD(), logoUrl: await getLogoUrl(db), settings: await getSettings(db), stats };
  let q = db.from('member_subscriptions').select('*').eq('status', 'active');
  if (subscriptionId) q = q.eq('id', subscriptionId);
  const { data: subs } = await q;
  for (const s of subs || []) {
    try { await processSubscription(db, s, ctx); }
    catch (e: any) { stats.failures++; stats.notes.push(`${s.email}: ${String(e?.message || e).slice(0, 120)}`); }
  }
  return stats;
}

/** Re-send one pack email to one member (admin button, or the member's own "email me this pack again"). */
export async function resendPack(subscriptionId: string, ym: string, opts: { requireEmail?: string } = {}): Promise<{ ok: boolean; error?: string }> {
  const db = supabaseAdmin();
  const { data: s } = await db.from('member_subscriptions').select('*').eq('id', subscriptionId).maybeSingle();
  if (!s) return { ok: false, error: 'membership not found' };
  if (opts.requireEmail && String(s.email).toLowerCase() !== opts.requireEmail.toLowerCase()) return { ok: false, error: 'not your membership' };
  // the month must be one of this term's months and already unlocked
  const idx = Array.from({ length: s.total_drops }, (_, k) => toYM(addMonths(s.start_date, k))).indexOf(ym);
  if (idx < 0) return { ok: false, error: 'that month is not part of this membership' };
  const testTerm = String(s.email).toLowerCase() === TEST_INBOX && String(s.start_date) >= '2090';
  if (ym >= '2090' && !testTerm) return { ok: false, error: 'test months are only sent to the shop inbox' };
  if (addMonths(s.start_date, idx) > todayYMD() && !testTerm) return { ok: false, error: 'that pack has not unlocked yet' };
  const pack = await getPack(db, ym);
  if (!hasFiles(pack)) return { ok: false, error: 'that pack has no files yet' };
  // rate limit member-initiated re-sends: one per pack per 12 h
  if (opts.requireEmail) {
    const { data: recent } = await db.from('subscription_email_logs').select('sent_at').eq('subscription_id', s.id).like('drop_month', `${ym}#%`).gte('sent_at', new Date(Date.now() - 12 * 3600e3).toISOString()).limit(1);
    if (recent?.length) return { ok: false, error: 'already re-sent recently; check your spam folder' };
  }
  const data = dropData(s, ym, pack, idx + 1, await planName(db, s.plan_slug), await getLogoUrl(db), true, (await getSettings(db)).makerInvite);
  const r = await sendOnce(db, { subscription_id: s.id, email: s.email, email_type: 'monthly_drop', drop_month: ym }, () => monthlyDropEmail(data), { force: true });
  return r === 'sent' ? { ok: true } : { ok: false, error: r === 'failed' ? 'send failed, try again shortly' : 'duplicate' };
}

/** Send the renewal reminder now (admin button). */
export async function sendReminderNow(subscriptionId: string): Promise<{ ok: boolean; error?: string }> {
  const db = supabaseAdmin();
  const { data: s } = await db.from('member_subscriptions').select('*').eq('id', subscriptionId).maybeSingle();
  if (!s) return { ok: false, error: 'membership not found' };
  const settings = await getSettings(db);
  const ed: ExpiryEmailData = { email: s.email, customerName: s.customer_name, planName: await planName(db, s.plan_slug), endDateLabel: ymdLabel(s.end_date), daysLeft: Math.max(0, daysUntil(todayYMD(), s.end_date)), renewUrl: RENEW_URL, coupon: settings.coupon, packsReceived: s.drops_sent, logoUrl: await getLogoUrl(db), makerInvite: settings.makerInvite };
  const r = await sendOnce(db, { subscription_id: s.id, email: s.email, email_type: 'pre_expiry_manual', drop_month: toYM(s.end_date) }, () => preExpiryEmail(ed), { force: true });
  return r === 'sent' ? { ok: true } : { ok: false, error: 'send failed' };
}

/** Log a tracked pack click and return the real Drive link. */
export async function resolvePackClick(q: { s: string; m: string; k: string; v: string; t: string; ua?: string }): Promise<{ url: string } | { error: string; status: number }> {
  const kind = q.k === 'bonus' ? 'bonus' : 'standard';
  if (!q.s || !/^\d{4}-\d{2}$/.test(q.m)) return { error: 'bad link', status: 400 };
  const expected = packLinkSig(q.s, q.m, kind);
  if (!q.t || q.t.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(q.t), Buffer.from(expected))) return { error: 'invalid link', status: 403 };
  const db = supabaseAdmin();
  // The admin "test to me" email signs its buttons with the all-zero
  // membership id: valid signature, no member. Open the pack, log nothing.
  if (q.s === '00000000-0000-0000-0000-000000000000') {
    const pack = await getPack(db, q.m);
    const url = kind === 'bonus' ? pack?.bonus_drive_link : pack?.standard_drive_link;
    return url ? { url } : { error: 'this pack has no files yet', status: 404 };
  }
  const { data: s } = await db.from('member_subscriptions').select('id, email, tier, status, start_date, total_drops').eq('id', q.s).maybeSingle();
  if (!s) return { error: 'membership not found', status: 404 };
  const pack = await getPack(db, q.m);
  const url = kind === 'bonus' ? (s.tier === 'premium' ? pack?.bonus_drive_link : null) : pack?.standard_drive_link;
  if (!url) return { error: 'this pack is not available yet', status: 404 };
  // packs stay downloadable after expiry (files never expire), but only the
  // months of the term itself
  const months = Array.from({ length: s.total_drops }, (_, k) => toYM(addMonths(s.start_date, k)));
  if (!months.includes(q.m)) return { error: 'that month is not part of this membership', status: 403 };
  const now = new Date().toISOString();
  await db.from('pack_downloads').insert({ subscription_id: s.id, email: s.email, month: q.m, kind, via: q.v === 'portal' ? 'portal' : 'email', user_agent: (q.ua || '').slice(0, 200) });
  await db.from('member_subscriptions').update({ last_download_at: now }).eq('id', s.id);
  return { url };
}
