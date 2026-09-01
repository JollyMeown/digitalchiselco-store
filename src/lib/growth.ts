// Growth automation engine — runs inside the daily cron next to the membership
// drip. THREE independent systems, each gated by its growth_settings toggle
// (all default OFF until the owner previews + enables in Admin → Automations):
//   1. Subscriber nurture drip (5 stages, ~4 days apart, stops on purchase)
//   2. Abandoned-cart reminders (one per cart, ~20h after capture)
//   3. Post-purchase followups (review +7d, new arrivals +30d, loyalty on 3rd order)
// Every send is idempotent (Resend idempotency keys + ledger tables).

import { createHash } from 'node:crypto';
import { supabaseAdmin } from './supabase';
import { send as sendEmail, sendBatch, isQuotaExhausted, marketingBudgetRemaining } from './resend';
import {
  dripEmail, cartReminderEmail, reviewRequestEmail, newArrivalsEmail, loyaltyEmail,
  weeklyDigestEmail, abandonedBrowseEmail, etsyWelcomeEmail, applyOverride, TEMPLATE_HEADINGS,
  winbackEmail, priceDropEmail, referralNudgeEmail, refundWinbackEmail,
  wishlistReminderEmail, ownerWeeklyReport,
  type MiniProduct, type TemplateOverride,
} from './marketing-emails';
import { isoWeekKey } from './weekly-digest';

type DB = ReturnType<typeof supabaseAdmin>;
const DRIP_GAP_DAYS = 4;
// Per-run caps are sized for the SERVERLESS TIME BUDGET, not just the Resend
// quota: sends are serialized at ~2/s, and every step below shares one
// invocation. Every step is idempotent + ledgered, so anything not reached
// today is simply picked up tomorrow — smaller batches, zero loss.
const DRIP_MAX_PER_RUN = 25;
const FOLLOWUP_MAX_PER_RUN = 15;

const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();

// ── Run time budget ────────────────────────────────────────────────────
// Netlify synchronous functions are killed at ~10s (26s max). Rather than
// let a long step take everything after it down with it (silently), each
// step checks `outOfTime()` before starting and skips with a visible marker
// so the admin sees "skipped: time budget" instead of nothing at all. The
// scheduler runs daily, so skipped steps run next time.
const RUN_STARTED_AT = { t: Date.now() };
// Read at RUN time (not import time) so the background runner can raise it via env
// before calling runGrowthAutomation(); the SSR route keeps the 20s default.
const timeBudgetMs = () => Number(process.env.CRON_TIME_BUDGET_MS) || 20000;
const outOfTime = () => Date.now() - RUN_STARTED_AT.t > timeBudgetMs();

// Wrap one numbered step: never lets a throw abort the steps after it, and
// records the failure where the admin can see it.
// EMAIL_STEPS: steps whose whole job is sending marketing email. Once Resend's
// daily quota is exhausted they are skipped with a visible 'deferred' marker —
// no doomed API calls, no wasted seconds, and tomorrow they run first thing.
// (Non-email steps like fx / bundle-of-week / send-time learning still run.)
const EMAIL_STEPS = new Set(['drip', 'carts', 'followups', 'weekly', 'etsyWelcome', 'browse', 'winback', 'priceDrop', 'referralNudge', 'refundWinback', 'wishlistReminder', 'ownerReport', 'designScout', 'makerJobsNudge', 'makerLowCredits', 'makerRecruitDrip', 'makerRecruitDripExtra', 'makerFeeSettlement']);
async function step(stats: Record<string, any>, key: string, fn: () => Promise<void>) {
  if (outOfTime()) { stats[key] = 'skipped: time budget (runs next time)'; return; }
  if (EMAIL_STEPS.has(key) && isQuotaExhausted()) { stats[key] = 'deferred: Resend daily quota reached (runs tomorrow)'; return; }
  try { await fn(); }
  catch (e: any) { stats[key] = `failed: ${String(e?.message || e).slice(0, 200)}`; console.error(`[growth:${key}]`, e); }
}

async function hasPaidOrder(db: DB, email: string): Promise<boolean> {
  const { data } = await db.from('orders').select('id').ilike('email', email).eq('status', 'paid').limit(1);
  return !!data?.length;
}
// "Do not mail": unsubscribed OR suppressed (hard bounce / spam complaint /
// chronic never-opener). Every per-recipient sender routes through this, so
// suppression is honoured everywhere, not just in the handful of steps that
// checked suppressed_at explicitly.
async function isUnsubscribed(db: DB, email: string): Promise<boolean> {
  const { data } = await db.from('subscribers').select('unsubscribed_at, suppressed_at').eq('email', email.toLowerCase()).maybeSingle();
  return !!(data?.unsubscribed_at || data?.suppressed_at);
}

const chunk = <T,>(a: T[], n: number): T[][] => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const hashKey = (prefix: string, emails: string[]) =>
  prefix + ':' + createHash('sha256').update([...emails].sort().join(',')).digest('hex').slice(0, 28);

/** The next future occurrence (UTC) of `hour`:00, as an ISO string, for
 *  send-time-optimized delivery via Resend scheduled_at. */
function nextHourIso(hour: number | null | undefined): string | undefined {
  if (hour == null || hour < 0 || hour > 23) return undefined;
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, 0, 0));
  if (d.getTime() <= now.getTime() + 60000) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

/** Deterministic REF- code per email (mirrors /account); ensures the
 *  referral_codes row + matching 15% coupon exist. */
async function ensureReferralCode(db: DB, email: string): Promise<string> {
  const e = email.toLowerCase();
  const { data: rc } = await db.from('referral_codes').select('code').eq('email', e).maybeSingle();
  if (rc?.code) return rc.code;
  const secret = process.env.ACCOUNT_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'ref';
  const code = 'REF-' + createHash('sha256').update('ref:' + e).digest('hex').slice(0, 6).toUpperCase();
  await db.from('referral_codes').upsert({ email: e, code }, { onConflict: 'email' });
  await db.from('coupons').upsert({ code, percent_off: 15, active: true, description: `referral share code for ${e}` }, { onConflict: 'code' });
  return code;
}

export async function runGrowthAutomation(): Promise<Record<string, any>> {
  RUN_STARTED_AT.t = Date.now();
  const db = supabaseAdmin();
  const stats: Record<string, any> = { drip: 'off', carts: 'off', followups: 'off' };
  const { data: g } = await db.from('growth_settings').select('*').eq('id', 1).maybeSingle();
  if (!g) return { error: 'growth_settings missing' };
  // owner-edited template overrides (Admin → Automations)
  const { data: ovrRows } = await db.from('email_template_overrides').select('*');
  const ovr = new Map<string, TemplateOverride>((ovrRows || []).map((r: any) => [r.kind, r]));
  const withOvr = (kind: string, out: { subject: string; html: string; text: string }, email: string) =>
    applyOverride(out, ovr.get(kind), email, TEMPLATE_HEADINGS[kind] || '');

  // Shared helpers MUST be defined before the first step that uses them: the
  // weekly digest was moved to run first (2026-08-18) but okEmail still lived
  // beside the win-back step below, so the Monday GENERATE path died with a
  // temporal-dead-zone error on 2026-08-24 (W35). Defined here, used everywhere.
  const SITE = (process.env.PUBLIC_SITE_URL || 'https://digitalchiselco.com').replace(/\/$/, '');
  const BAD = /fake|mailinator|@example\.|@test\.|\.invalid|localhost/i;
  const okEmail = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && !BAD.test(e);

  // ── STEP 0: buyer emails owed from earlier outages ───────────────────
  // A paid order whose confirmation never went out (quota exhausted, crash)
  // is resent BEFORE any marketing spends today's quota. Kind 'order' also
  // bypasses the quota gate entirely (see resend.ts BUYER_CRITICAL).
  await step(stats, 'orderEmails', async () => {
    const { sweepUnsentOrderConfirmations } = await import('./order-email');
    const s = await sweepUnsentOrderConfirmations(db, 20);
    stats.orderEmails = s.checked ? s : 'none owed';
  });

  // ── PRIORITY: the weekly digest runs FIRST ───────────────────────────
  // It is the highest-value, widest-reach send (every confirmed subscriber).
  // On a quota-limited day it must never lose out to the drip.

  // ── 4. weekly fresh-designs digest — SELF-HEALING QUEUE ────────────
  // Two phases so nobody is ever left unsent silently:
  //   GENERATE (once per ISO week, Mon–Wed so a late/failed Monday still
  //     catches up): freeze this week's designs into weekly_digest_log and
  //     enqueue ONE row per eligible subscriber in weekly_send_queue.
  //   DRAIN (EVERY daily run): send everything still 'pending' in the current
  //     week's queue, in batches of 100. If Resend's daily quota hits, stop
  //     cleanly and finish tomorrow — the rows just stay 'pending'. Every
  //     recipient's status/attempts/error is recorded and visible in admin.
  // ── Maker-recruit drip, shared sender ────────────────────────────────
  // Owner directive: at least 20 recruit invites EVERY day, more when the
  // budget allows. Two passes: a GUARANTEED pass of up to 20 that runs
  // BEFORE the weekly digest (which can drain the whole day's budget — it
  // did on 8/31 and the drip sent 0), and a top-up pass after the digest
  // that spends surplus budget while leaving ~40 for other marketing.
  const runRecruitDrip = async (target: number, statsKey: string) => {
    const { makerRecruitEmail } = await import('./marketing-emails');
    if (target <= 0) { stats[statsKey] = 'deferred: no budget today'; return; }
    const { data: invited } = await db.from('maker_invites').select('email').limit(20000);
    const invitedSet = new Set((invited || []).map((r: any) => String(r.email).toLowerCase()));
    const pool: string[] = [];
    for (let from = 0; from < 20000 && pool.length < target + 50; from += 1000) {
      const { data: subs } = await db.from('subscribers').select('email').order('created_at').range(from, from + 999);
      if (!subs?.length) break;
      for (const srow of subs) {
        const em = String(srow.email || '').toLowerCase().trim();
        if (em && !invitedSet.has(em) && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) pool.push(em);
      }
      if (subs.length < 1000) break;
    }
    const s: any = { sent: 0, failed: 0, poolLeft: Math.max(0, pool.length - target) };
    if (!pool.length) { stats[statsKey] = 'pool empty: every subscriber has been invited'; return; }
    for (const em of pool.slice(0, target)) {
      if (outOfTime()) break;
      try {
        if (await isUnsubscribed(db, em)) { invitedSet.add(em); await db.from('maker_invites').upsert({ email: em, source: 'drip-skip-unsub' }, { onConflict: 'email', ignoreDuplicates: true }); continue; }
        const { subject, html, text } = makerRecruitEmail({ email: em });
        const r2 = await sendEmail({ to: em, subject, html, text, idempotencyKey: 'maker-recruit:' + em, tags: [{ name: 'kind', value: 'makerRecruit' }] });
        if (r2.ok && !r2.skipped) { s.sent++; await db.from('maker_invites').upsert({ email: em, source: 'drip' }, { onConflict: 'email', ignoreDuplicates: true }); }
        else if (r2.quota) { stats[statsKey] = { ...s, note: 'stopped: daily budget reached' }; return; }
        else s.failed++;
      } catch { s.failed++; }
    }
    stats[statsKey] = s;
  };

  // GUARANTEED pass: 20 recruit invites before the digest can drain the day.
  stats.makerRecruitDrip = 'off';
  if (g.maker_recruit_drip_enabled) {
    await step(stats, 'makerRecruitDrip', async () => {
      const { marketingBudgetRemaining } = await import('./resend');
      const budget = await marketingBudgetRemaining();
      await runRecruitDrip(Math.min(20, budget), 'makerRecruitDrip');
    });
  }

  stats.weekly = 'off';
  await step(stats, 'weekly', async () => {
    if (!g.weekly_digest_enabled) return;
    const now = new Date();
    const week = isoWeekKey(now);
    const dow = now.getUTCDay();   // 1 = Mon
    const s: any = { week, phase: [] as string[], generated: false, queued: 0, sent: 0, failed: 0, pending: 0 };

    // ── GENERATE ──
    const { data: wk } = await db.from('weekly_digest_log').select('week_key, product_ids').eq('week_key', week).maybeSingle();
    if (!wk && dow >= 1 && dow <= 3) {
      const { error: claimErr } = await db.from('weekly_digest_log').insert({ week_key: week });
      if (!claimErr) {
        // Only designs added SINCE the last digest — never repeats. Falls back to 7d on first run.
        const { data: mk } = await db.from('site_settings').select('weekly_last_sent_at').eq('id', 1).maybeSingle();
        const sinceIso = (mk?.weekly_last_sent_at as string) || daysAgo(7);
        const { data: fresh } = await db.from('products')
          .select('id').eq('active', true).gt('created_at', sinceIso)
          .not('slug', 'like', 'gift-card-%').not('image_url', 'is', null)
          .order('created_at', { ascending: false }).limit(80);
        const ids = (fresh || []).map((p: any) => p.id);
        const nowIso = new Date().toISOString();
        if (ids.length) {
          const { data: subs } = await db.from('subscribers').select('email')
            .not('confirmed_at', 'is', null).is('unsubscribed_at', null).is('suppressed_at', null).limit(20000);
          const emails = [...new Set((subs || []).map((r) => r.email.toLowerCase().trim()).filter(okEmail))];
          for (const b of chunk(emails, 500)) {
            await db.from('weekly_send_queue').upsert(b.map((email) => ({ week_key: week, email })), { onConflict: 'week_key,email', ignoreDuplicates: true });
          }
          await db.from('weekly_digest_log').update({ product_ids: ids, product_count: ids.length, queued_count: emails.length, sent_count: 0 }).eq('week_key', week);
          s.generated = true; s.queued = emails.length; s.phase.push(`generated ${ids.length} designs → ${emails.length} queued`);
        } else {
          await db.from('weekly_digest_log').update({ product_ids: [], product_count: 0, queued_count: 0, sent_count: 0, drain_note: 'quiet week, no new designs' }).eq('week_key', week);
          s.phase.push('quiet week (no new designs)');
        }
        // Advance the marker so next week starts fresh from here (even a quiet week).
        await db.from('site_settings').update({ weekly_last_sent_at: nowIso }).eq('id', 1);
      }
    } else if (!wk) {
      s.phase.push('waiting for Monday');
    }

    // ── DRAIN (every run) ──
    const { data: wk2 } = await db.from('weekly_digest_log').select('product_ids').eq('week_key', week).maybeSingle();
    const productIds: string[] = Array.isArray(wk2?.product_ids) ? wk2!.product_ids : [];
    if (productIds.length) {
      const { data: pend } = await db.from('weekly_send_queue').select('email, attempts')
        .eq('week_key', week).eq('status', 'pending').lt('attempts', 5).order('queued_at').limit(2000);
      const pending = pend || [];
      if (pending.length) {
        // Rebuild the SAME email Monday's recipients got (frozen product list).
        const { data: prods } = await db.from('products').select('id, title, slug, price_usd, image_url, created_at').in('id', productIds);
        const byId = new Map((prods || []).map((p: any) => [p.id, p]));
        const fresh = productIds.map((id) => byId.get(id)).filter(Boolean) as (MiniProduct & { id: string; created_at: string })[];
        const weekNumber = Number(week.split('-W')[1]) || 0;
        const fmtDay = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const startD = fmtDay(fresh[fresh.length - 1].created_at), endD = fmtDay(fresh[0].created_at);
        const range = startD === endD ? startD : `${startD} – ${endD}`;

        // Personalization: order each person's designs by category affinity.
        const catByProduct = new Map<string, string[]>();
        const affByEmail = new Map<string, Set<string>>();
        const hourByEmail = new Map<string, number | null>();
        if (g.weekly_personalized || g.sendtime_enabled) {
          const { data: pcs } = await db.from('product_categories').select('product_id, category_id').in('product_id', productIds);
          for (const r of pcs || []) (catByProduct.get(r.product_id) || catByProduct.set(r.product_id, []).get(r.product_id)!).push(r.category_id);
          for (const batch of chunk(pending.map((p) => p.email), 300)) {
            if (g.weekly_personalized) {
              const { data: aff } = await db.from('v_subscriber_category_affinity').select('email, category_id, score').in('email', batch);
              const perEmail = new Map<string, { c: string; s: number }[]>();
              for (const a of aff || []) (perEmail.get(a.email) || perEmail.set(a.email, []).get(a.email)!).push({ c: a.category_id, s: a.score });
              for (const [em, arr] of perEmail) affByEmail.set(em, new Set(arr.sort((x, y) => y.s - x.s).slice(0, 5).map((x) => x.c)));
            }
            if (g.sendtime_enabled) {
              const { data: hs } = await db.from('subscribers').select('email, best_send_hour').in('email', batch);
              for (const h of hs || []) hourByEmail.set(h.email.toLowerCase(), h.best_send_hour);
            }
          }
        }
        const personalize = (email: string): MiniProduct[] => {
          if (!g.weekly_personalized) return fresh;
          const liked = affByEmail.get(email); if (!liked?.size) return fresh;
          const sc = (p: any) => ((catByProduct.get(p.id) || []).some((c) => liked.has(c)) ? 1 : 0);
          return [...fresh].sort((a, b) => sc(b) - sc(a));
        };

        const tags = [{ name: 'kind', value: 'weekly' }, { name: 'week', value: week }];
        let quotaHit = false;
        // Only drain as many as today's MARKETING budget allows (cap − reserve
        // − already-sent). A fixed 100-batch is larger than the 80/day
        // marketing budget, so sendBatch rejected it wholesale and NOTHING
        // sent — that stalled 110 W35 digests for 3 days. Size to the budget,
        // send what fits today, leave the rest pending for tomorrow.
        const budget = await marketingBudgetRemaining();
        if (budget <= 0) {
          quotaHit = true;
          s.phase.push('Daily email budget already used — resuming tomorrow');
        }
        const drainable = pending.slice(0, budget);
        // Resend batch endpoint caps at 100; never exceed the budget either.
        for (const part of chunk(drainable, Math.min(100, Math.max(1, budget)))) {
          if (quotaHit) break;
          const emails = part.map((r) => {
            const { subject, html, text } = withOvr('weekly',
              weeklyDigestEmail({ email: r.email, products: personalize(r.email), weekNumber, range }), r.email);
            return { to: r.email, subject, html, text, tags, scheduledAt: g.sendtime_enabled ? nextHourIso(hourByEmail.get(r.email)) : undefined };
          });
          const res = await sendBatch(emails, hashKey(`digest:${week}`, part.map((r) => r.email)));
          const nowIso = new Date().toISOString();
          if (res.ok) {
            s.sent += res.sent;
            for (const b of chunk(part.map((r) => r.email), 200)) {
              await db.from('weekly_send_queue').update({ status: 'sent', sent_at: nowIso, last_error: null }).eq('week_key', week).in('email', b);
            }
          } else {
            // Leave rows PENDING (record error, bump attempts) so tomorrow's
            // drain retries them. After 5 failed attempts a row is left alone
            // and shows in admin as needing attention.
            const err = (res.error || 'send failed').slice(0, 300);
            for (const r of part) {
              await db.from('weekly_send_queue').update({ last_error: err, attempts: (r.attempts || 0) + 1 }).eq('week_key', week).eq('email', r.email);
            }
            s.failed += emails.length;
            if (res.quota) { quotaHit = true; s.phase.push('Resend daily quota reached — resuming tomorrow'); }
          }
        }
        const { count: stillPending } = await db.from('weekly_send_queue').select('email', { count: 'exact', head: true }).eq('week_key', week).eq('status', 'pending');
        const { count: totalSent } = await db.from('weekly_send_queue').select('email', { count: 'exact', head: true }).eq('week_key', week).eq('status', 'sent');
        s.pending = stillPending || 0;
        await db.from('weekly_digest_log').update({
          sent_count: totalSent || 0, last_drain_at: new Date().toISOString(),
          drain_note: quotaHit ? `quota hit, ${s.pending} still pending` : (s.pending ? `${s.pending} pending` : 'complete'),
        }).eq('week_key', week);
        s.phase.push(`drained: +${s.sent} sent, ${s.pending} still pending`);
      } else {
        const { count: totalSent } = await db.from('weekly_send_queue').select('email', { count: 'exact', head: true }).eq('week_key', week).eq('status', 'sent');
        s.phase.push(`queue empty — ${totalSent || 0} delivered this week`);
      }
    }
    stats.weekly = s;
  });

  // ── Maker-recruit TOP-UP: spend surplus budget after the digest ──────
  // The guaranteed 20 already went out above; this sends more when the day
  // still has budget, leaving ~40 for the remaining marketing steps.
  stats.makerRecruitDripExtra = 'off';
  if (g.maker_recruit_drip_enabled) {
    await step(stats, 'makerRecruitDripExtra', async () => {
      const { marketingBudgetRemaining } = await import('./resend');
      const budget = await marketingBudgetRemaining();
      // cap the top-up at 80 (=> max 100 recruit emails/day with the
      // guaranteed 20): steady daily volume beats one-day blasts for both
      // sender reputation and reply-handling
      const target = Math.min(budget - 40, 80);
      if (target <= 0) { stats.makerRecruitDripExtra = 'no surplus today (guaranteed 20 already sent)'; return; }
      await runRecruitDrip(target, 'makerRecruitDripExtra');
    });
  }


  // ── 1. nurture drip ─────────────────────────────────────────────────
  await step(stats, 'drip', async () => {
    if (!g.drip_enabled) return;
    const s = { enrolled: 0, sent: 0, converted: 0, failed: 0 };
    // enroll confirmed subscribers not yet in the drip. Etsy buyers are excluded:
    // they get their own one-time welcome, never the "free pack" drip.
    // Enrol via idempotent upsert (PK on email + ignoreDuplicates): no need to
    // read the whole subscriber_drip table first. The old read-then-diff hit
    // PostgREST's silent 1,000-row default cap once the drip grew, so genuine
    // newbies were skipped and the batch insert failed wholesale on duplicates.
    // Paginate the subscriber read too so >1,000 subscribers all get enrolled.
    let enrolledNow = 0;
    for (let from = 0; ; from += 1000) {
      const { data: subs } = await db.from('subscribers').select('email')
        .not('confirmed_at', 'is', null).is('unsubscribed_at', null).is('suppressed_at', null).neq('source', 'etsy-buyer')
        .order('email').range(from, from + 999);
      const emails = (subs || []).map((r) => r.email.toLowerCase());
      if (!emails.length) break;
      for (let i = 0; i < emails.length; i += 200) {
        const { count } = await db.from('subscriber_drip')
          .upsert(emails.slice(i, i + 200).map((email) => ({ email })), { onConflict: 'email', ignoreDuplicates: true, count: 'exact' });
        enrolledNow += count || 0;
      }
      if (emails.length < 1000) break;
    }
    s.enrolled = enrolledNow;

    // context shared by every send this run
    const [{ data: best }, { data: bundle }, { data: plan }] = await Promise.all([
      db.from('products').select('title, slug, image_url, price_usd').eq('active', true).eq('is_bestseller', true).limit(3),
      db.from('products').select('title, slug, image_url, price_usd').eq('active', true).eq('is_bundle', true).order('price_usd', { ascending: false }).limit(1).maybeSingle(),
      db.from('membership_plans').select('name, months, files_per_month, price_usd').eq('active', true).order('sort_order').limit(1).maybeSingle(),
    ]);
    let bestsellers = (best || []) as MiniProduct[];
    if (!bestsellers.length) {
      const { data: fb } = await db.from('products').select('title, slug, image_url, price_usd').eq('active', true).order('created_at', { ascending: false }).limit(3);
      bestsellers = (fb || []) as MiniProduct[];
    }
    // make sure the stage-5 coupon exists (15%, 60 days)
    const { data: cv } = await db.from('coupons').select('id').ilike('code', 'CARVE15').maybeSingle();
    if (!cv) await db.from('coupons').insert({ code: 'CARVE15', percent_off: 15, active: true, expires_at: new Date(Date.now() + 60 * 86400000).toISOString() });

    const { data: due } = await db.from('subscriber_drip')
      .select('email, stage, last_sent_at').eq('status', 'active').lt('stage', 5)
      .or(`last_sent_at.is.null,last_sent_at.lte.${daysAgo(DRIP_GAP_DAYS)}`)
      .order('enrolled_at').limit(DRIP_MAX_PER_RUN);
    for (const r of due || []) {
      try {
        if (await hasPaidOrder(db, r.email)) {           // they bought — stop selling
          await db.from('subscriber_drip').update({ status: 'converted' }).eq('email', r.email);
          s.converted++; continue;
        }
        const stage = r.stage + 1;
        const { subject, html, text } = withOvr(`drip${stage}`,
          dripEmail(stage, { email: r.email, bestsellers, bundle: bundle as MiniProduct | null, plan: plan as any, couponCode: 'CARVE15' }), r.email);
        const res = await sendEmail({ to: r.email, subject, html, text, idempotencyKey: `drip:${r.email}:${stage}`, tags: [{ name: 'kind', value: `drip${stage}` }] });
        if (res.ok) {
          await db.from('subscriber_drip').update({ stage, last_sent_at: new Date().toISOString(), ...(stage >= 5 ? { status: 'done' } : {}) }).eq('email', r.email);
          s.sent++;
        } else if (res.quota) { (s as any).note = 'stopped: daily budget reached (resumes tomorrow)'; break; }
        else s.failed++;
      } catch { s.failed++; }
    }
    stats.drip = s;
  });

  // ── 2. abandoned-cart reminders ─────────────────────────────────────
  await step(stats, 'carts', async () => {
    if (!g.cart_reminders_enabled) return;
    const s = { sent: 0, recovered: 0, skipped: 0, failed: 0 };
    const { data: carts } = await db.from('abandoned_carts')
      .select('id, email, cart, subtotal, updated_at')
      .is('recovered_at', null).is('reminded_at', null)
      .lte('updated_at', new Date(Date.now() - 20 * 3600000).toISOString())
      .limit(FOLLOWUP_MAX_PER_RUN);
    for (const c of carts || []) {
      try {
        if (await hasPaidOrder(db, c.email)) {           // they bought after all
          await db.from('abandoned_carts').update({ recovered_at: new Date().toISOString() }).eq('id', c.id);
          s.recovered++; continue;
        }
        if (await isUnsubscribed(db, c.email)) { s.skipped++; continue; }
        const rawItems = (Array.isArray(c.cart) ? c.cart : []) as { id?: string; title: string; price: number }[];
        if (!rawItems.length) { s.skipped++; continue; }
        // Enrich with product thumbnails + slugs so the email shows pictures
        // (the cart snapshot only stores id/title/price).
        const ids = rawItems.map((i) => i.id).filter((id): id is string => !!id && /^[0-9a-f-]{36}$/i.test(id));
        const imgBy: Record<string, { image_url: string | null; slug: string }> = {};
        if (ids.length) {
          const { data: prods } = await db.from('products').select('id, image_url, slug').in('id', ids);
          for (const p of prods || []) imgBy[p.id] = { image_url: p.image_url, slug: p.slug };
        }
        const items = rawItems.map((i) => ({ title: i.title, price: i.price, image_url: (i.id && imgBy[i.id]?.image_url) || null, slug: (i.id && imgBy[i.id]?.slug) || null }));
        const { subject, html, text } = withOvr('cart', cartReminderEmail({ email: c.email, items, subtotal: Number(c.subtotal) || 0 }), c.email);
        const res = await sendEmail({ to: c.email, subject, html, text, idempotencyKey: `cartrem:${c.id}`, tags: [{ name: 'kind', value: 'cart' }] });
        if (res.ok) { await db.from('abandoned_carts').update({ reminded_at: new Date().toISOString() }).eq('id', c.id); s.sent++; }
        else if (res.quota) { (s as any).note = 'stopped: daily budget reached (resumes tomorrow)'; break; }
        else s.failed++;
      } catch { s.failed++; }
    }
    stats.carts = s;
  });

  // ── 3. post-purchase followups ──────────────────────────────────────
  await step(stats, 'followups', async () => {
    if (!g.followups_enabled) return;
    const s = { review: 0, arrivals: 0, loyalty: 0, failed: 0 };
    const { data: doneRows } = await db.from('order_followups').select('order_id, kind');
    const done = new Set((doneRows || []).map((r) => `${r.order_id}:${r.kind}`));
    const claim = async (orderId: string, kind: string) => {
      const { error } = await db.from('order_followups').insert({ order_id: orderId, kind });
      return !error; // unique PK — false means another run already claimed it
    };
    // A claim is only "done" if the email actually went out. On send failure
    // (Resend quota, blip) release it so tomorrow's run retries instead of the
    // followup being lost forever.
    const release = async (orderId: string, kind: string) => {
      await db.from('order_followups').delete().eq('order_id', orderId).eq('kind', kind);
    };

    // review request: paid 7–14 days ago
    const { data: reviewOrders } = await db.from('orders')
      .select('id, email, customer_name, created_at, order_items(title)')
      .eq('status', 'paid').gte('created_at', daysAgo(14)).lte('created_at', daysAgo(7)).limit(FOLLOWUP_MAX_PER_RUN);
    for (const o of reviewOrders || []) {
      if (done.has(`${o.id}:review7`) || await isUnsubscribed(db, o.email)) continue;
      if (!(await claim(o.id, 'review7'))) continue;
      const { subject, html, text } = withOvr('review7', reviewRequestEmail({ email: o.email, name: o.customer_name, itemTitles: (o.order_items || []).map((i: any) => i.title) }), o.email);
      const res = await sendEmail({ to: o.email, subject, html, text, idempotencyKey: `review7:${o.id}`, tags: [{ name: 'kind', value: 'review7' }] });
      if (res.ok) s.review++; else { s.failed++; await release(o.id, 'review7'); }
    }

    // new arrivals: paid 30–40 days ago, with the 3 newest products
    const { data: newest } = await db.from('products').select('title, slug, image_url, price_usd').eq('active', true).order('created_at', { ascending: false }).limit(3);
    const { data: arrOrders } = await db.from('orders')
      .select('id, email, customer_name, created_at')
      .eq('status', 'paid').gte('created_at', daysAgo(40)).lte('created_at', daysAgo(30)).limit(FOLLOWUP_MAX_PER_RUN);
    for (const o of arrOrders || []) {
      if (done.has(`${o.id}:arrivals30`) || await isUnsubscribed(db, o.email)) continue;
      if (!(await claim(o.id, 'arrivals30'))) continue;
      const { subject, html, text } = withOvr('arrivals30', newArrivalsEmail({ email: o.email, name: o.customer_name, products: (newest || []) as MiniProduct[] }), o.email);
      const res = await sendEmail({ to: o.email, subject, html, text, idempotencyKey: `arrivals30:${o.id}`, tags: [{ name: 'kind', value: 'arrivals30' }] });
      if (res.ok) s.arrivals++; else { s.failed++; await release(o.id, 'arrivals30'); }
    }

    // loyalty: 3rd paid order → permanent personal 10% code (once per customer)
    const { data: paidAll } = await db.from('orders').select('id, email, customer_name, created_at').eq('status', 'paid').order('created_at');
    const byEmail = new Map<string, { ids: string[]; name: string | null }>();
    for (const o of paidAll || []) {
      const k = o.email.toLowerCase();
      const cur = byEmail.get(k) || { ids: [], name: null };
      cur.ids.push(o.id); cur.name = cur.name || o.customer_name;
      byEmail.set(k, cur);
    }
    for (const [email, info] of byEmail) {
      if (info.ids.length < 3) continue;
      if (info.ids.some((id) => done.has(`${id}:loyalty`))) continue;      // already rewarded
      if (await isUnsubscribed(db, email)) continue;
      const anchor = info.ids[2];                                          // the 3rd order
      if (!(await claim(anchor, 'loyalty'))) continue;
      const code = 'LOYAL-' + Math.random().toString(36).slice(2, 6).toUpperCase();
      await db.from('coupons').insert({ code, percent_off: 10, active: true, description: `loyalty reward for ${email}` });
      const { subject, html, text } = withOvr('loyalty', loyaltyEmail({ email, name: info.name, code }), email);
      const res = await sendEmail({ to: email, subject, html, text, idempotencyKey: `loyalty:${email}`, tags: [{ name: 'kind', value: 'loyalty' }] });
      if (res.ok) s.loyalty++; else { s.failed++; await release(anchor, 'loyalty'); }
      if (s.loyalty >= 20) break;                                          // safety cap per run
    }
    stats.followups = s;
  });

  // ── 4b. Etsy-buyer welcome (one-time) ───────────────────────────────
  // Any imported Etsy buyer we have not welcomed yet gets ONE welcome email
  // with this week's newest designs + a 10% code. Deduped by etsy_welcome_log
  // (PK on email), so a retry or the manual script can never double-send.
  stats.etsyWelcome = 'off';
  await step(stats, 'etsyWelcome', async () => {
    if (!g.etsy_welcome_enabled) return;
    const s = { candidates: 0, sent: 0, failed: 0 };
    const { data: buyers } = await db.from('subscribers').select('email')
      .eq('source', 'etsy-buyer').not('confirmed_at', 'is', null).is('unsubscribed_at', null).limit(3000);
    const { data: done } = await db.from('etsy_welcome_log').select('email').limit(20000);
    const welcomed = new Set((done || []).map((r) => r.email.toLowerCase()));
    const TEST = /fake|mailinator|@example\.|@test\.|\.invalid|localhost/i;
    const pending = [...new Set((buyers || []).map((r) => r.email.toLowerCase().trim()))]
      .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && !TEST.test(e) && !welcomed.has(e));
    s.candidates = pending.length;
    if (pending.length) {
      // this week's newest designs (up to 12 shown) + total count for the link
      const sinceIso = daysAgo(7);
      const [{ data: fresh }, { count: totalNew }] = await Promise.all([
        db.from('products').select('title, slug, price_usd, image_url')
          .eq('active', true).gte('created_at', sinceIso)
          .not('slug', 'like', 'gift-card-%').not('image_url', 'is', null)
          .order('created_at', { ascending: false }).limit(12),
        db.from('products').select('id', { count: 'exact', head: true })
          .eq('active', true).gte('created_at', sinceIso)
          .not('slug', 'like', 'gift-card-%').not('image_url', 'is', null),
      ]);
      const products = (fresh || []) as MiniProduct[];
      const total = totalNew || products.length;
      const tags = [{ name: 'kind', value: 'etsy-welcome' }];
      for (let c = 0; c < pending.length; c += 100) {
        const batch = pending.slice(c, c + 100);
        const chunk = batch.map((email) => {
          const { subject, html, text } = withOvr('etsyWelcome',
            etsyWelcomeEmail({ email, products, totalNew: total, code: 'THANKYOU10' }), email);
          return { to: email, subject, html, text, tags };
        });
        // Idempotency key = hash of this batch's recipients (stable across
        // retries, unique per recipient set, never a positional-index collision).
        const idem = 'etsy-welcome:' + createHash('sha256').update([...batch].sort().join(',')).digest('hex').slice(0, 32);
        const res = await sendBatch(chunk, idem);
        if (res.ok) {
          s.sent += res.sent;
          // mark them welcomed so we never send again
          await db.from('etsy_welcome_log').upsert(batch.map((email) => ({ email })), { onConflict: 'email', ignoreDuplicates: true });
        } else s.failed += batch.length;
      }
    }
    stats.etsyWelcome = s;
  });

  // ── 7. Price-drop alerts (a design they liked got cheaper) ───────────
  stats.priceDrop = 'off';
  await step(stats, 'priceDrop', async () => {
    if (!g.price_drop_enabled) return;
    const s = { drops: 0, sent: 0, failed: 0 };
    const { data: snaps } = await db.from('product_price_snapshot').select('product_id, price_usd').limit(50000);
    const snapMap = new Map((snaps || []).map((r) => [r.product_id, Number(r.price_usd)]));
    const { data: prods } = await db.from('products').select('id, slug, title, image_url, price_usd').eq('active', true).not('price_usd', 'is', null).limit(50000);
    const drops = (prods || []).filter((p) => snapMap.has(p.id) && Number(p.price_usd) < (snapMap.get(p.id) as number) - 0.001).slice(0, 20);
    s.drops = drops.length;
    const suppressed = new Set(((await db.from('subscribers').select('email').not('suppressed_at', 'is', null).limit(50000)).data || []).map((r) => r.email.toLowerCase()));
    for (const p of drops) {
      const oldPrice = snapMap.get(p.id) as number, newPrice = Number(p.price_usd);
      // interested non-buyers: clickers + browsers
      const interested = new Set<string>();
      const [{ data: cl }, { data: br }, { data: buys }] = await Promise.all([
        db.from('email_events').select('email').eq('event', 'clicked').ilike('url', `%/product/${p.slug}%`).limit(5000),
        db.from('browse_events').select('email').eq('product_id', p.id).limit(5000),
        db.from('order_items').select('order_id').eq('product_id', p.id).limit(5000),
      ]);
      for (const r of cl || []) interested.add((r.email || '').toLowerCase());
      for (const r of br || []) interested.add((r.email || '').toLowerCase());
      const buyers = new Set<string>();
      for (const b of chunk((buys || []).map((x) => x.order_id), 300)) { const { data } = await db.from('orders').select('email').in('id', b).is('deleted_at', null); (data || []).forEach((o) => buyers.add((o.email || '').toLowerCase())); }
      let cands = [...interested].filter((e) => okEmail(e) && !buyers.has(e) && !suppressed.has(e));
      // confirmed, non-unsubscribed subscribers only
      const sendable = new Set<string>();
      for (const b of chunk(cands, 300)) { const { data } = await db.from('subscribers').select('email, confirmed_at, unsubscribed_at').in('email', b); for (const su of data || []) if (su.confirmed_at && !su.unsubscribed_at) sendable.add(su.email.toLowerCase()); }
      // drop already-notified for this product
      for (const b of chunk([...sendable], 300)) { const { data } = await db.from('price_drop_log').select('email').eq('product_id', p.id).in('email', b); for (const r of data || []) sendable.delete((r.email || '').toLowerCase()); }
      const recips = [...sendable].slice(0, 300);
      for (const part of chunk(recips, 100)) {
        const emails = part.map((email) => { const { subject, html, text } = withOvr('priceDrop', priceDropEmail({ email, product: p as MiniProduct, oldPrice, newPrice }), email); return { to: email, subject, html, text, tags: [{ name: 'kind', value: 'price-drop' }] }; });
        const res = await sendBatch(emails, hashKey(`pricedrop:${p.id}`, part));
        if (res.ok) { s.sent += res.sent; await db.from('price_drop_log').upsert(part.map((email) => ({ product_id: p.id, email, price_usd: newPrice })), { onConflict: 'product_id,email', ignoreDuplicates: true }); } else s.failed += part.length;
      }
    }
    // refresh ALL snapshots to current price (so increases re-baseline and drops do not re-fire)
    for (const b of chunk(prods || [], 500)) await db.from('product_price_snapshot').upsert(b.map((p) => ({ product_id: p.id, price_usd: Number(p.price_usd), updated_at: new Date().toISOString() })), { onConflict: 'product_id' });
    stats.priceDrop = s;
  });

  // ── 8. Referral nudge (ask happy customers to share their link) ──────
  stats.referralNudge = 'off';
  await step(stats, 'referralNudge', async () => {
    if (!g.referral_nudge_enabled) return;
    const s = { candidates: 0, sent: 0, failed: 0 };
    const { data: rfm } = await db.from('v_subscriber_rfm').select('email, orders, last_order_at').gte('orders', 1).limit(50000);
    const { data: nl } = await db.from('referral_nudge_log').select('email').limit(50000);
    const nudged = new Set((nl || []).map((r) => r.email.toLowerCase()));
    const now = Date.now();
    const cand = (rfm || []).filter((r) => {
      const e = r.email.toLowerCase();
      return okEmail(e) && !nudged.has(e) && (!r.last_order_at || new Date(r.last_order_at).getTime() < now - 14 * 86400000);
    }).map((r) => r.email.toLowerCase()).slice(0, 40);
    s.candidates = cand.length;
    for (const email of cand) {
      try {
        // must be a confirmed, non-unsubscribed, non-suppressed subscriber
        const { data: su } = await db.from('subscribers').select('confirmed_at, unsubscribed_at, suppressed_at').ilike('email', email).maybeSingle();
        if (!su?.confirmed_at || su.unsubscribed_at || su.suppressed_at) continue;
        const code = await ensureReferralCode(db, email);
        const { subject, html, text } = withOvr('referralNudge', referralNudgeEmail({ email, code, link: `${SITE}/?ref=${code}` }), email);
        const res = await sendEmail({ to: email, subject, html, text, idempotencyKey: `refnudge:${email}`, tags: [{ name: 'kind', value: 'referral-nudge' }] });
        if (res.ok) { s.sent++; await db.from('referral_nudge_log').upsert({ email }, { onConflict: 'email', ignoreDuplicates: true }); }
        else if (res.quota) { (s as any).note = 'stopped: daily budget reached (resumes tomorrow)'; break; }
        else s.failed++;
      } catch { s.failed++; }
    }
    stats.referralNudge = s;
  });

  // ── PRIORITY NOTE ─────────────────────────────────────────────────────
  // Steps 5 (abandoned-browse) and 6 (win-back) are the LOWEST-value emails
  // (people who never carted / haven't opened in 60+ days). They are run
  // AFTER the high-value senders (weekly digest, cart reminders, followups,
  // Etsy welcome, price drops, referral) so on a quota-limited day the daily
  // email budget goes to what converts. Order chosen 2026-08-18 after the
  // first quota-exhausted day (drip+digest+winback all competing).

  // ── 5. abandoned-browse: viewed ≥3 designs, never carted, never bought ──
  stats.browse = 'off';
  await step(stats, 'browse', async () => {
    if (!g.abandoned_browse_enabled) return;
    const s = { candidates: 0, sent: 0, skipped: 0, failed: 0 };
    // recent browse events with a known email (last 3 days)
    const { data: evs } = await db.from('browse_events')
      .select('email, product_id, created_at')
      .gte('created_at', daysAgo(3)).order('created_at', { ascending: false }).limit(3000);
    // group distinct products per email
    const byEmail = new Map<string, Set<string>>();
    for (const e of evs || []) {
      if (!e.product_id) continue;
      const k = String(e.email).toLowerCase();
      (byEmail.get(k) || byEmail.set(k, new Set()).get(k)!).add(e.product_id);
    }
    // only confirmed, non-unsubscribed subscribers already reminded=never
    const { data: already } = await db.from('browse_reminders').select('email');
    const reminded = new Set((already || []).map((r) => r.email.toLowerCase()));
    for (const [email, pidSet] of byEmail) {
      if (pidSet.size < 3 || reminded.has(email)) { s.skipped++; continue; }
      try {
        const { data: sub } = await db.from('subscribers').select('confirmed_at, unsubscribed_at').ilike('email', email).maybeSingle();
        if (!sub?.confirmed_at || sub.unsubscribed_at) { s.skipped++; continue; }
        if (await hasPaidOrder(db, email)) { s.skipped++; continue; }
        // skip if they have an open cart (the cart reminder covers them)
        const { data: oc } = await db.from('abandoned_carts').select('id').ilike('email', email).is('recovered_at', null).limit(1);
        if (oc?.length) { s.skipped++; continue; }
        // claim the one-per-email reminder BEFORE sending (idempotent)
        const { error: claimErr } = await db.from('browse_reminders').insert({ email });
        if (claimErr) { s.skipped++; continue; }
        const { data: prods } = await db.from('products')
          .select('title, slug, image_url, price_usd').in('id', [...pidSet].slice(0, 6)).eq('active', true).not('image_url', 'is', null);
        if (!prods?.length) { s.skipped++; continue; }
        const { subject, html, text } = withOvr('browse', abandonedBrowseEmail({ email, products: prods as MiniProduct[] }), email);
        const res = await sendEmail({ to: email, subject, html, text, idempotencyKey: `browse:${email}`, tags: [{ name: 'kind', value: 'browse' }] });
        res.ok ? s.sent++ : s.failed++;
        if (s.sent >= FOLLOWUP_MAX_PER_RUN) break;
      } catch { s.failed++; }
    }
    s.candidates = byEmail.size;
    stats.browse = s;
  });

  // (SITE / BAD / okEmail are defined at the top of this function.)

  // ── 6. Win-back + deliverability suppression ─────────────────────────
  stats.winback = 'off';
  await step(stats, 'winback', async () => {
    if (!g.winback_enabled) return;
    const s = { candidates: 0, sent: 0, suppressed: 0, failed: 0 };
    const { data: eng } = await db.from('v_subscriber_engagement')
      .select('email, joined_at, sent, opened, bounced, complained, last_opened_at, unsubscribed_at').limit(50000);
    const { data: supRows } = await db.from('subscribers').select('email').not('suppressed_at', 'is', null).limit(50000);
    const suppressed = new Set((supRows || []).map((r) => r.email.toLowerCase()));
    const { data: wl } = await db.from('winback_log').select('email').limit(50000);
    const welcomedBack = new Set((wl || []).map((r) => r.email.toLowerCase()));
    const now = Date.now();
    const D = (d: any) => (d ? new Date(d).getTime() : 0);

    // suppress chronic never-openers (6+ sends, 0 opens, older than 90d)
    const toSuppress = (eng || []).filter((r) => !r.unsubscribed_at && !suppressed.has(r.email.toLowerCase())
      && r.sent >= 6 && r.opened === 0 && D(r.joined_at) < now - 90 * 86400000).map((r) => r.email.toLowerCase());
    for (const b of chunk(toSuppress, 200)) {
      await db.from('subscribers').update({ suppressed_at: new Date().toISOString() }).in('email', b);
      b.forEach((e) => suppressed.add(e));
    }
    s.suppressed = toSuppress.length;

    // win-back audience: dormant but not dead
    const cand = (eng || []).filter((r) => {
      const e = r.email.toLowerCase(); const lo = D(r.last_opened_at);
      return !r.unsubscribed_at && !r.bounced && !r.complained && !suppressed.has(e) && !welcomedBack.has(e)
        && r.sent >= 2 && okEmail(e) && D(r.joined_at) < now - 30 * 86400000
        && (lo === 0 || lo < now - 60 * 86400000);
    }).map((r) => r.email.toLowerCase()).slice(0, 60);
    s.candidates = cand.length;
    if (cand.length) {
      await db.from('coupons').upsert({ code: 'WINBACK15', percent_off: 15, active: true, description: 'win-back 15%' }, { onConflict: 'code' });
      const { data: best } = await db.from('products').select('title, slug, image_url, price_usd')
        .eq('active', true).eq('is_bestseller', true).not('image_url', 'is', null).limit(3);
      let show = (best || []) as MiniProduct[];
      if (!show.length) { const { data: nw } = await db.from('products').select('title, slug, image_url, price_usd').eq('active', true).not('image_url', 'is', null).order('created_at', { ascending: false }).limit(3); show = (nw || []) as MiniProduct[]; }
      for (const part of chunk(cand, 100)) {
        const emails = part.map((email) => { const { subject, html, text } = withOvr('winback', winbackEmail({ email, products: show, code: 'WINBACK15' }), email); return { to: email, subject, html, text, tags: [{ name: 'kind', value: 'winback' }] }; });
        const res = await sendBatch(emails, hashKey('winback', part));
        if (res.ok) { s.sent += res.sent; await db.from('winback_log').upsert(part.map((email) => ({ email })), { onConflict: 'email', ignoreDuplicates: true }); } else s.failed += part.length;
      }
    }
    stats.winback = s;
  });

  // ── 9. Send-time learning: each subscriber's most common open hour ───
  stats.sendtime = 'off';
  await step(stats, 'sendtime', async () => {
    if (!g.sendtime_enabled) return;
    const { data: opens } = await db.from('email_events').select('email, created_at').eq('event', 'opened').gte('created_at', daysAgo(90)).limit(50000);
    const hours = new Map<string, number[]>();   // email → 24-bucket histogram
    for (const o of opens || []) {
      const em = (o.email || '').toLowerCase(); if (!em) continue;
      const h = new Date(o.created_at).getUTCHours();
      const arr = hours.get(em) || new Array(24).fill(0); arr[h]++; hours.set(em, arr);
    }
    const updates: { email: string; best_send_hour: number }[] = [];
    for (const [email, hist] of hours) { let bi = 0; for (let i = 1; i < 24; i++) if (hist[i] > hist[bi]) bi = i; updates.push({ email, best_send_hour: bi }); }
    for (const b of chunk(updates, 200)) for (const u of b) await db.from('subscribers').update({ best_send_hour: u.best_send_hour }).ilike('email', u.email);
    stats.sendtime = { learned: updates.length };
  });

  // ── 10. Post-refund win-back: 30 days after a refund, one olive branch ──
  // Window is 30-37 days so enabling the toggle months later never blasts
  // ancient refunds. One email per address ever (refund_winback_log).
  stats.refundWinback = 'off';
  await step(stats, 'refundWinback', async () => {
    if (!g.refund_winback_enabled) return;
    const s = { candidates: 0, sent: 0, failed: 0 };
    const { data: refunded } = await db.from('orders')
      .select('email, refunded_at')
      .not('refunded_at', 'is', null)
      .lte('refunded_at', daysAgo(30)).gte('refunded_at', daysAgo(37))
      .limit(500);
    const { data: rl } = await db.from('refund_winback_log').select('email').limit(50000);
    const alreadySent = new Set((rl || []).map((r) => r.email.toLowerCase()));
    const cand = [...new Set((refunded || [])
      .map((r) => (r.email || '').toLowerCase())
      .filter((e) => e && e !== 'unknown@digitalchiselco.com' && !alreadySent.has(e)))].slice(0, 40);
    s.candidates = cand.length;
    if (cand.length) {
      await db.from('coupons').upsert({ code: 'COMEBACK15', percent_off: 15, active: true, description: 'post-refund win-back 15%' }, { onConflict: 'code' });
      const { data: best } = await db.from('products').select('title, slug, image_url, price_usd')
        .eq('active', true).eq('is_bestseller', true).not('image_url', 'is', null).limit(3);
      let show = (best || []) as MiniProduct[];
      if (!show.length) { const { data: nw } = await db.from('products').select('title, slug, image_url, price_usd').eq('active', true).not('image_url', 'is', null).order('created_at', { ascending: false }).limit(3); show = (nw || []) as MiniProduct[]; }
      for (const em of cand) {
        try {
          if (await isUnsubscribed(db, em)) continue;
          const { subject, html, text } = withOvr('refundWinback', refundWinbackEmail({ email: em, products: show, code: 'COMEBACK15' }), em);
          const res = await sendEmail({ to: em, subject, html, text, idempotencyKey: `refundwb:${em}`, tags: [{ name: 'kind', value: 'refundWinback' }] });
          if (res.ok) { s.sent++; await db.from('refund_winback_log').upsert({ email: em }, { onConflict: 'email', ignoreDuplicates: true }); }
          else if (res.quota) { (s as any).note = 'stopped: daily budget reached (resumes tomorrow)'; break; }
          else s.failed++;
        } catch { s.failed++; }
      }
    }
    stats.refundWinback = s;
  });

  // ── 11. Daily fx refresh (multi-currency checkout) ───────────────────
  // Free, keyless API. checkout-init only trusts rates < 7 days old, so a few
  // failed days just means those buyers get charged in USD as before.
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD');
    const d: any = await res.json();
    if (d?.result === 'success' && d.rates) {
      const fx = {
        EUR: Number(d.rates.EUR) || null,
        GBP: Number(d.rates.GBP) || null,
        CAD: Number(d.rates.CAD) || null,
        AUD: Number(d.rates.AUD) || null,
        updated_at: new Date().toISOString(),
      };
      await db.from('site_settings').update({ fx_rates: fx }).eq('id', 1);
      stats.fx = { EUR: fx.EUR, GBP: fx.GBP, CAD: fx.CAD, AUD: fx.AUD };
    } else stats.fx = 'api error';
  } catch (e: any) { stats.fx = `failed: ${e?.message}`; }

  // ── 12. Bundle of the Week: rotate a theme, pick 5, publish ──────────
  // Regenerates whenever the stored week key is stale (so enabling mid-week
  // works). The /bundle-of-week page reads site_settings.weekly_bundle and the
  // existing bundle5: checkout path enforces the flat $25 server-side.
  stats.bundleWeek = 'off';
  await step(stats, 'bundleWeek', async () => {
    if (!g.bundle_week_enabled) return;
    try {
      const week = isoWeekKey(new Date());
      const { data: st } = await db.from('site_settings').select('weekly_bundle').eq('id', 1).maybeSingle();
      const cur: any = st?.weekly_bundle;
      if (cur?.week === week) {
        stats.bundleWeek = `current (${cur.category_name})`;
      } else {
        const { data: cats } = await db.from('categories').select('id, name, slug').order('name');
        const list = cats || [];
        const weekNum = parseInt(week.replace(/\D/g, ''), 10) || 0;
        let chosen: any = null; let ids: string[] = [];
        for (let i = 0; i < list.length && !chosen; i++) {
          const cat = list[(weekNum + i) % list.length];
          const { data: pool } = await db.from('product_categories')
            .select('products!inner(id, slug, title, price_usd, image_url, active, is_bundle, is_subscription, is_bestseller)')
            .eq('category_id', cat.id).limit(80);
          // mirror the bundle5 checkout eligibility exactly, or the add-to-cart would 400
          const eligible = (pool || []).map((r: any) => r.products).filter((p: any) =>
            p?.active && !p.is_bundle && !p.is_subscription && p.image_url && Number(p.price_usd) > 0
            // keep the advertised flat $25 truthful: the bundle5: checkout now
            // prices max($25, $25 + 0.7 x (sum - $40)), so the weekly five must
            // sum to $40 or less -> only standard-priced designs qualify
            && Number(p.price_usd) <= 8
            && !/personalized|made.to.order|from your (picture|photo)|membership/i.test(String(p.title || ''))
            && !String(p.slug || '').startsWith('gift-card-') && !String(p.slug || '').startsWith('catalogue-')
            && !/bundle/i.test(String(p.title || '')));
          if (eligible.length >= 5) {
            eligible.sort((a: any, b: any) => Number(b.is_bestseller) - Number(a.is_bestseller));
            chosen = cat; ids = eligible.slice(0, 5).map((p: any) => p.id);
          }
        }
        if (chosen) {
          const now = new Date();
          const daysToMon = ((8 - now.getUTCDay()) % 7) || 7;   // next Monday 00:00 UTC
          const exp = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysToMon));
          await db.from('site_settings').update({
            weekly_bundle: { week, category_id: chosen.id, category_name: chosen.name, category_slug: chosen.slug, ids, expires_at: exp.toISOString(), generated_at: now.toISOString() },
          }).eq('id', 1);
          stats.bundleWeek = `generated: ${chosen.name}`;
        } else stats.bundleWeek = 'no category with 5 eligible designs';
      }
    } catch (e: any) { stats.bundleWeek = `failed: ${e?.message}`; }
  });

  // ── 13. Owner weekly report (Mondays, to the ops inbox) ──────────────
  stats.ownerReport = 'off';
  await step(stats, 'ownerReport', async () => {
    if (!g.owner_report_enabled) return;
    if (new Date().getUTCDay() !== 1) stats.ownerReport = 'waiting for Monday';
    else {
      try {
        const OPS = 'jolly@digitalchiselco.com';
        const week = isoWeekKey(new Date());
        const since = daysAgo(7); const sinceDay = since.slice(0, 10);
        const [{ count: pv }, { data: ords }, { data: evs }, { data: oi }] = await Promise.all([
          db.from('site_visits').select('id', { count: 'exact', head: true }).gte('day', sinceDay),
          db.from('orders').select('total, currency').eq('status', 'paid').gte('created_at', since),
          db.from('site_events').select('type, product_id, q, n').gte('day', sinceDay).limit(20000),
          db.from('order_items').select('title, orders!inner(status, created_at)').eq('orders.status', 'paid').gte('orders.created_at', since).limit(2000),
        ]);
        const cnt = (t: string) => (evs || []).filter((e: any) => e.type === t).length;
        const topProd = async (t: string) => {
          const c: Record<string, number> = {};
          for (const e of evs || []) if ((e as any).type === t && (e as any).product_id) c[(e as any).product_id] = (c[(e as any).product_id] || 0) + 1;
          const top = Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 5);
          if (!top.length) return [];
          const { data: ps } = await db.from('products').select('id, title').in('id', top.map(([id]) => id));
          const nameOf = new Map((ps || []).map((p: any) => [p.id, String(p.title).split('|')[0].trim()]));
          return top.map(([id, n]) => ({ title: nameOf.get(id) || 'Design', n }));
        };
        const soldCount: Record<string, number> = {};
        for (const r of oi || []) { const t = String((r as any).title || '').split('|')[0].trim(); if (t) soldCount[t] = (soldCount[t] || 0) + 1; }
        const revenue = (ords || []).reduce((s: number, o: any) => s + (Number(o.total) || 0), 0);
        const { subject, html, text } = ownerWeeklyReport({
          email: OPS, weekLabel: week,
          pageviews: pv || 0,
          actions: [
            { label: '🛒 Cart adds', n: cnt('add_to_cart') },
            { label: '⚡ Buy-now', n: cnt('buy_now') },
            { label: '❤️ Wishlist', n: cnt('wishlist_add') },
            { label: '🚪 Checkouts', n: cnt('checkout_start') },
            { label: '💳 Reached pay', n: cnt('txn_created') },
          ],
          orders: (ords || []).length, revenue,
          topCarted: await topProd('add_to_cart'),
          topWished: await topProd('wishlist_add'),
          topSold: Object.entries(soldCount).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([title, n]) => ({ title, n })),
          zeroSearches: [...new Set((evs || []).filter((e: any) => e.type === 'search' && e.q && (e.n ?? 0) === 0).map((e: any) => String(e.q)))].slice(0, 12),
        });
        const r = await sendEmail({ to: OPS, subject, html, text, idempotencyKey: `ownerreport:${week}`, tags: [{ name: 'kind', value: 'ownerReport' }] });
        stats.ownerReport = r.ok ? `sent (${week})` : `failed: ${r.error}`;
      } catch (e: any) { stats.ownerReport = `failed: ${e?.message}`; }
    }
  });

  // ── 14. Wishlist reminders: hearted 3-14 days ago, never bought ──────
  stats.wishlistReminder = 'off';
  await step(stats, 'wishlistReminder', async () => {
    if (!g.wishlist_reminder_enabled) return;
    const s = { candidates: 0, sent: 0, failed: 0 };
    const { data: favs } = await db.from('browse_events')
      .select('email, product_id')
      .eq('source', 'favorite')
      .lte('created_at', daysAgo(3)).gte('created_at', daysAgo(14))
      .limit(5000);
    const byEmail = new Map<string, Set<string>>();
    for (const f of favs || []) {
      const em = (f.email || '').toLowerCase(); if (!em || !f.product_id) continue;
      (byEmail.get(em) || byEmail.set(em, new Set()).get(em)!).add(f.product_id);
    }
    s.candidates = byEmail.size;
    let sends = 0;
    for (const [em, pidSet] of byEmail) {
      if (sends >= 40) break;
      try {
        if (await isUnsubscribed(db, em)) continue;
        let pids = [...pidSet].slice(0, 6);
        const { data: logged } = await db.from('wishlist_reminder_log').select('product_id').eq('email', em).in('product_id', pids);
        const done = new Set((logged || []).map((r: any) => r.product_id));
        pids = pids.filter((id) => !done.has(id));
        if (!pids.length) continue;
        const { data: owned } = await db.from('entitlements').select('product_id').ilike('email', em).in('product_id', pids);
        const own = new Set((owned || []).map((r: any) => r.product_id));
        pids = pids.filter((id) => !own.has(id));
        if (!pids.length) continue;
        const { data: prods } = await db.from('products')
          .select('id, title, slug, image_url, price_usd')
          .in('id', pids).eq('active', true).not('image_url', 'is', null).limit(3);
        if (!prods?.length) continue;
        const { subject, html, text } = withOvr('wishlistReminder',
          wishlistReminderEmail({ email: em, products: prods as MiniProduct[] }), em);
        const res = await sendEmail({ to: em, subject, html, text, idempotencyKey: hashKey(`wishrem:${em}`, prods.map((p: any) => p.id)), tags: [{ name: 'kind', value: 'wishlistReminder' }] });
        if (res.ok) {
          s.sent++; sends++;
          await db.from('wishlist_reminder_log').upsert(prods.map((p: any) => ({ email: em, product_id: p.id })), { onConflict: 'email,product_id', ignoreDuplicates: true });
        } else if (res.quota) { (s as any).note = 'stopped: daily budget reached (resumes tomorrow)'; break; }
        else s.failed++;
      } catch { s.failed++; }
    }
    stats.wishlistReminder = s;
  });

  // ── 15. AI Design Scout (Mondays): demand signals → 5 design ideas ───
  // Feeds real evidence (zero-result searches, top searches, most carted /
  // wishlisted themes) to Claude Haiku and emails the owner a ranked list of
  // designs to make next. Costs a fraction of a cent per week.
  stats.designScout = 'off';
  await step(stats, 'designScout', async () => {
    if (!g.design_scout_enabled) return;
    if (new Date().getUTCDay() !== 1) stats.designScout = 'waiting for Monday';
    else if (!process.env.ANTHROPIC_API_KEY) stats.designScout = 'ANTHROPIC_API_KEY not set';
    else {
      try {
        const OPS = 'jolly@digitalchiselco.com';
        const week = isoWeekKey(new Date());
        const sinceDay = daysAgo(30).slice(0, 10);
        // ── Website signals ──
        const { data: evs } = await db.from('site_events').select('type, product_id, q, n').gte('day', sinceDay).limit(20000);
        const zero = [...new Set((evs || []).filter((e: any) => e.type === 'search' && e.q && (e.n ?? 0) === 0).map((e: any) => String(e.q)))].slice(0, 25);
        const searchCount: Record<string, number> = {};
        for (const e of evs || []) if ((e as any).type === 'search' && (e as any).q) searchCount[(e as any).q] = (searchCount[(e as any).q] || 0) + 1;
        const topSearches = Object.entries(searchCount).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([q, n]) => `${q} (${n}x)`);
        const actIds = [...new Set((evs || []).filter((e: any) => ['add_to_cart', 'wishlist_add', 'buy_now'].includes(e.type) && e.product_id).map((e: any) => e.product_id))].slice(0, 100);
        const { data: actProds } = actIds.length ? await db.from('products').select('title').in('id', actIds) : { data: [] as any[] };
        const hotTitles = (actProds || []).map((p: any) => String(p.title).split('|')[0].trim()).slice(0, 40);
        // ── Etsy signals (synced daily by the local finance-refresh run) ──
        // Trending = biggest views gained since the previous sync; Loved =
        // most favorers overall; plus recent-review titles = what actually SELLS.
        const { data: els } = await db.from('etsy_listing_stats').select('title, views, favorers, views_prev').limit(3000);
        const clean = (t: string) => String(t || '').split('|')[0].trim().slice(0, 70);
        const trendingEtsy = (els || [])
          .map((r: any) => ({ t: clean(r.title), d: Math.max(0, (r.views || 0) - (r.views_prev || 0)) }))
          .filter((x) => x.d > 0).sort((a, b) => b.d - a.d).slice(0, 15).map((x) => `${x.t} (+${x.d} views)`);
        const lovedEtsy = (els || [])
          .sort((a: any, b: any) => (b.favorers || 0) - (a.favorers || 0)).slice(0, 12)
          .map((r: any) => `${clean(r.title)} (${r.favorers} favorites)`);
        const { data: recentRevs } = await db.from('reviews').select('product_id, etsy_created_at').not('etsy_review_id', 'is', null).gte('etsy_created_at', daysAgo(45)).limit(500);
        const revIds = [...new Set((recentRevs || []).map((r: any) => r.product_id).filter(Boolean))].slice(0, 40);
        const { data: revProds } = revIds.length ? await db.from('products').select('title').in('id', revIds) : { data: [] as any[] };
        const recentlySold = (revProds || []).map((p: any) => clean(p.title)).slice(0, 20);

        const Anthropic = (await import('@anthropic-ai/sdk')).default;
        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 3 });
        const res = await anthropic.messages.create({
          model: 'claude-haiku-4-5',
          max_tokens: 1400,
          system: `You advise DigitalChiselCo, a shop selling bas-relief STL files for CNC carving on both its own website and Etsy. Given real demand signals from BOTH channels, propose exactly 5 NEW bas-relief design ideas the shop should produce next. Rules: never use em dashes; rank by demand evidence; each idea gets a bold one-line name, 1-2 sentences of what the relief shows, and one line citing the evidence (name the specific searches, Etsy trends or favorites that support it, and which channel the signal came from). Do not duplicate anything in the "already hot" or Etsy lists, propose ADJACENT ideas those signals point toward. Output clean HTML using only <p>, <strong>, <ol>, <li>.`,
          messages: [{ role: 'user', content: `WEBSITE, searches that found NOTHING (strongest signal, last 30 days):\n${zero.join(', ') || 'none'}\n\nWEBSITE, top searches:\n${topSearches.join(', ') || 'none'}\n\nWEBSITE, already hot (carted/wishlisted, do not duplicate):\n${hotTitles.join('; ') || 'none'}\n\nETSY, trending listings by views gained since yesterday:\n${trendingEtsy.join('; ') || 'no delta yet (first sync was today)'}\n\nETSY, most-favorited listings all-time:\n${lovedEtsy.join('; ') || 'none'}\n\nETSY, designs with reviews in the last 45 days (recently SOLD):\n${recentlySold.join('; ') || 'none'}` }],
        });
        const block: any = res.content.find((b: any) => b.type === 'text');
        const ideasHtml = (block?.text || '').trim();
        if (!ideasHtml) throw new Error('empty model response');
        const r = await sendEmail({
          to: OPS,
          subject: `🧭 Design Scout ${week}: your next 5 designs, ranked by real demand`,
          html: `<div style="max-width:600px;margin:0 auto;font-family:Helvetica,Arial,sans-serif;color:#2A1A0E;font-size:14px;line-height:1.6;">
<h2 style="font-family:Georgia,serif;color:#5E380A;">🧭 Design Scout · ${week}</h2>
<p>Ranked from 30 days of real shopper searches and product interest. Zero-result searches are gold: people wanted these and left empty-handed.</p>
${ideasHtml}
<p style="color:#999;font-size:12px;">Signals used: ${zero.length} zero-result searches, ${topSearches.length} top searches, ${hotTitles.length} hot designs excluded.</p></div>`,
          text: ideasHtml.replace(/<[^>]+>/g, ''),
          idempotencyKey: `designscout:${week}`,
          tags: [{ name: 'kind', value: 'designScout' }],
        });
        stats.designScout = r.ok ? `sent (${week})` : `failed: ${r.error}`;
      } catch (e: any) { stats.designScout = `failed: ${e?.message}`; }
    }
  });

  // ── Cut Local maker automations (gated) ──────────────────────────────
  // Nudge makers who have unquoted open jobs near them (max once/20h each),
  // and remind low-credit makers to top up (max once/7d each).
  stats.makerJobsNudge = 'off';
  stats.makerLowCredits = 'off';
  stats.makerFeeSettlement = 'off';
  if (g.maker_automations_enabled) {
    const { matchMakers } = await import('./marketplace');
    await step(stats, 'makerJobsNudge', async () => {
      const s: any = { sent: 0, failed: 0 };
      const { data: openReqs } = await db.from('maker_requests').select('*').eq('status', 'open').gte('created_at', daysAgo(30)).limit(500);
      if (!openReqs?.length) { stats.makerJobsNudge = 'no open jobs'; return; }
      const cutoff = new Date(Date.now() - 20 * 3600000).toISOString();
      const { data: makers } = await db.from('makers').select('*').eq('status', 'approved').or(`jobs_nudged_at.is.null,jobs_nudged_at.lt.${cutoff}`).limit(1000);
      for (const m of makers || []) {
        if (outOfTime()) break;
        // count open jobs this maker matches but hasn't quoted
        const matched = openReqs.filter((r: any) => {
          const mc = (m.country || '').toLowerCase(), rc = (r.country || '').toLowerCase();
          return (!rc || rc === mc || m.deliver_intl);
        });
        if (!matched.length) continue;
        const { data: quoted } = await db.from('maker_quotes').select('request_id').eq('maker_id', m.id).in('request_id', matched.map((r: any) => r.id));
        const already = new Set((quoted || []).map((q: any) => q.request_id));
        const fresh = matched.filter((r: any) => !already.has(r.id));
        if (!fresh.length) continue;
        try {
          const link = `${SITE}/maker?t=${encodeURIComponent((await import('./marketplace-token')).signMakerToken(m.email))}`;
          const r = await sendEmail({ to: m.email, subject: `${fresh.length} Cut Local job${fresh.length > 1 ? 's are' : ' is'} waiting for your quote`,
            html: `<div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;color:#2a241d;"><p>You have <b>${fresh.length} open job${fresh.length > 1 ? 's' : ''}</b> near you waiting for a quote on Cut Local. First to quote often wins.</p><p style="margin:18px 0;"><a href="${link}" style="background:#854F0B;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:bold;">View &amp; quote →</a></p></div>`,
            text: `${fresh.length} Cut Local jobs are waiting for your quote: ${link}`, idempotencyKey: `maker-nudge:${m.id}:${new Date().toISOString().slice(0, 10)}`, tags: [{ name: 'kind', value: 'marketplace' }] });
          if (r.ok && !r.skipped) { s.sent++; await db.from('makers').update({ jobs_nudged_at: new Date().toISOString() }).eq('id', m.id); }
          else if (r.quota) { stats.makerJobsNudge = `deferred (quota) after ${s.sent}`; return; }
        } catch { s.failed++; }
      }
      stats.makerJobsNudge = s;
    });
    // ── Fee settlement: roll un-invoiced success fees into invoices ──
    // Invoice when a maker's unbilled fees reach $5, or when the oldest
    // unbilled fee is over 45 days old. 14-day terms; one overdue reminder;
    // overdue invoices pause new quotes (enforced in /api/mp/action).
    await step(stats, 'makerFeeSettlement', async () => {
      const s: any = { invoiced: 0, reminded: 0 };
      const { signMakerToken } = await import('./marketplace-token');
      const { data: unbilled } = await db.from('maker_ledger').select('id, maker_id, amount_usd, created_at').eq('kind', 'success_fee').is('invoice_id', null).limit(2000);
      const byMaker = new Map<string, any[]>();
      for (const row of unbilled || []) { if (!byMaker.has(row.maker_id)) byMaker.set(row.maker_id, []); byMaker.get(row.maker_id)!.push(row); }
      for (const [makerId, rows] of byMaker) {
        if (outOfTime()) break;
        const total = Math.round(rows.reduce((t: number, r: any) => t + Number(r.amount_usd || 0), 0) * 100) / 100;
        const oldest = Math.min(...rows.map((r: any) => new Date(r.created_at).getTime()));
        if (total < 5 && Date.now() - oldest < 45 * 86400000) continue;
        if (total <= 0) continue;
        // one open invoice per maker at a time — new fees wait for the next run
        const { data: openInv } = await db.from('maker_fee_invoices').select('id').eq('maker_id', makerId).eq('status', 'pending').limit(1);
        if (openInv?.length) continue;
        const { data: mk } = await db.from('makers').select('email, maker_name').eq('id', makerId).maybeSingle();
        if (!mk) continue;
        const { data: inv, error: ie } = await db.from('maker_fee_invoices').insert({ maker_id: makerId, amount_usd: total }).select('*').single();
        if (ie || !inv) { s.failed = (s.failed || 0) + 1; continue; }
        await db.from('maker_ledger').update({ invoice_id: inv.id }).in('id', rows.map((r: any) => r.id));
        const link = `${SITE}/maker?t=${encodeURIComponent(signMakerToken(mk.email))}`;
        const r = await sendEmail({ to: mk.email, subject: `Your Cut Local success fees: $${total.toFixed(2)}`,
          html: `<div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;color:#2a241d;"><p>Hi ${(mk.maker_name || '').split(' ')[0] || 'there'},</p><p>Congrats on your completed jobs! Your 3% success fees come to <b>$${total.toFixed(2)}</b>, due within 14 days. Pay in one click from your dashboard:</p><p style="margin:18px 0;"><a href="${link}" style="background:#854F0B;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:bold;">Pay $${total.toFixed(2)} →</a></p><p style="font-size:13px;color:#6b5d4a;">This keeps Cut Local free to join and brings you more local jobs. Unpaid invoices pause new quotes after the due date.</p><p>Jolly · DigitalChiselCo</p></div>`,
          text: `Your Cut Local success fees: $${total.toFixed(2)}, due in 14 days. Pay: ${link}`,
          idempotencyKey: `fee-invoice:${inv.id}`, tags: [{ name: 'kind', value: 'marketplace' }] });
        if (r.ok && !r.skipped) s.invoiced++;
      }
      // one reminder when an invoice goes overdue
      const { data: late } = await db.from('maker_fee_invoices').select('*').eq('status', 'pending').lt('due_at', new Date().toISOString()).is('reminded_at', null).limit(100);
      for (const inv of late || []) {
        if (outOfTime()) break;
        const { data: mk } = await db.from('makers').select('email').eq('id', inv.maker_id).maybeSingle();
        if (!mk) continue;
        const link = `${SITE}/maker?t=${encodeURIComponent(signMakerToken(mk.email))}`;
        const r = await sendEmail({ to: mk.email, subject: 'Action needed: your Cut Local fees are overdue',
          html: `<div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;color:#2a241d;"><p>Your success-fee invoice of <b>$${Number(inv.amount_usd).toFixed(2)}</b> is past due, so new quotes are paused on your account. Pay it in one click and you are instantly back in the game:</p><p style="margin:18px 0;"><a href="${link}" style="background:#854F0B;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:bold;">Pay now →</a></p></div>`,
          text: `Your Cut Local fee invoice ($${inv.amount_usd}) is overdue and quoting is paused. Pay: ${link}`,
          idempotencyKey: `fee-overdue:${inv.id}`, tags: [{ name: 'kind', value: 'marketplace' }] });
        if (r.ok && !r.skipped) { s.reminded++; await db.from('maker_fee_invoices').update({ reminded_at: new Date().toISOString() }).eq('id', inv.id); }
      }
      stats.makerFeeSettlement = s;
    });
    await step(stats, 'makerLowCredits', async () => {
      const s: any = { sent: 0 };
      const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
      const { data: makers } = await db.from('makers').select('*').eq('status', 'approved').lte('credits', 1)
        .or(`low_credit_nudged_at.is.null,low_credit_nudged_at.lt.${cutoff}`).limit(500);
      for (const m of makers || []) {
        if (outOfTime()) break;
        // only nudge makers who have shown activity (quoted at least once)
        const { count: hasQuoted } = await db.from('maker_quotes').select('id', { count: 'exact', head: true }).eq('maker_id', m.id);
        if (!hasQuoted) continue;
        try {
          const link = `${SITE}/maker?t=${encodeURIComponent((await import('./marketplace-token')).signMakerToken(m.email))}`;
          const r = await sendEmail({ to: m.email, subject: 'You’re low on Cut Local quote credits', html: `<div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;color:#2a241d;"><p>You have <b>${m.credits} credit${m.credits === 1 ? '' : 's'}</b> left. Top up so you never miss a job near you.</p><p style="margin:18px 0;"><a href="${link}" style="background:#854F0B;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:bold;">Buy credits →</a></p></div>`, text: `You have ${m.credits} Cut Local credits left. Top up: ${link}`, idempotencyKey: `maker-lowcred:${m.id}:${new Date().toISOString().slice(0, 10)}`, tags: [{ name: 'kind', value: 'marketplace' }] });
          if (r.ok && !r.skipped) { s.sent++; await db.from('makers').update({ low_credit_nudged_at: new Date().toISOString() }).eq('id', m.id); }
          else if (r.quota) { stats.makerLowCredits = `deferred (quota) after ${s.sent}`; return; }
        } catch {}
      }
      stats.makerLowCredits = s;
    });
  }

  return stats;
}
