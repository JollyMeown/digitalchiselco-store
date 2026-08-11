// Growth automation engine — runs inside the daily cron next to the membership
// drip. THREE independent systems, each gated by its growth_settings toggle
// (all default OFF until the owner previews + enables in Admin → Automations):
//   1. Subscriber nurture drip (5 stages, ~4 days apart, stops on purchase)
//   2. Abandoned-cart reminders (one per cart, ~20h after capture)
//   3. Post-purchase followups (review +7d, new arrivals +30d, loyalty on 3rd order)
// Every send is idempotent (Resend idempotency keys + ledger tables).

import { createHash } from 'node:crypto';
import { supabaseAdmin } from './supabase';
import { send as sendEmail, sendBatch } from './resend';
import {
  dripEmail, cartReminderEmail, reviewRequestEmail, newArrivalsEmail, loyaltyEmail,
  weeklyDigestEmail, abandonedBrowseEmail, etsyWelcomeEmail, applyOverride, TEMPLATE_HEADINGS,
  winbackEmail, priceDropEmail, referralNudgeEmail, refundWinbackEmail,
  type MiniProduct, type TemplateOverride,
} from './marketing-emails';
import { isoWeekKey } from './weekly-digest';

type DB = ReturnType<typeof supabaseAdmin>;
const DRIP_GAP_DAYS = 4;
const DRIP_MAX_PER_RUN = 80;      // stay well under Resend's daily cap
const FOLLOWUP_MAX_PER_RUN = 40;

const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();

async function hasPaidOrder(db: DB, email: string): Promise<boolean> {
  const { data } = await db.from('orders').select('id').ilike('email', email).eq('status', 'paid').limit(1);
  return !!data?.length;
}
async function isUnsubscribed(db: DB, email: string): Promise<boolean> {
  const { data } = await db.from('subscribers').select('unsubscribed_at').ilike('email', email).maybeSingle();
  return !!data?.unsubscribed_at;
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
  const db = supabaseAdmin();
  const stats: Record<string, any> = { drip: 'off', carts: 'off', followups: 'off' };
  const { data: g } = await db.from('growth_settings').select('*').eq('id', 1).maybeSingle();
  if (!g) return { error: 'growth_settings missing' };
  // owner-edited template overrides (Admin → Automations)
  const { data: ovrRows } = await db.from('email_template_overrides').select('*');
  const ovr = new Map<string, TemplateOverride>((ovrRows || []).map((r: any) => [r.kind, r]));
  const withOvr = (kind: string, out: { subject: string; html: string; text: string }, email: string) =>
    applyOverride(out, ovr.get(kind), email, TEMPLATE_HEADINGS[kind] || '');

  // ── 1. nurture drip ─────────────────────────────────────────────────
  if (g.drip_enabled) {
    const s = { enrolled: 0, sent: 0, converted: 0, failed: 0 };
    // enroll confirmed subscribers not yet in the drip. Etsy buyers are excluded:
    // they get their own one-time welcome, never the "free pack" drip.
    const { data: subs } = await db.from('subscribers').select('email').not('confirmed_at', 'is', null).is('unsubscribed_at', null).neq('source', 'etsy-buyer').limit(3000);
    const { data: inDrip } = await db.from('subscriber_drip').select('email');
    const enrolled = new Set((inDrip || []).map((r) => r.email.toLowerCase()));
    const newbies = (subs || []).map((r) => r.email.toLowerCase()).filter((e) => !enrolled.has(e));
    for (let i = 0; i < newbies.length; i += 200) {
      await db.from('subscriber_drip').insert(newbies.slice(i, i + 200).map((email) => ({ email })));
    }
    s.enrolled = newbies.length;

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
        } else s.failed++;
      } catch { s.failed++; }
    }
    stats.drip = s;
  }

  // ── 2. abandoned-cart reminders ─────────────────────────────────────
  if (g.cart_reminders_enabled) {
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
        else s.failed++;
      } catch { s.failed++; }
    }
    stats.carts = s;
  }

  // ── 3. post-purchase followups ──────────────────────────────────────
  if (g.followups_enabled) {
    const s = { review: 0, arrivals: 0, loyalty: 0, failed: 0 };
    const { data: doneRows } = await db.from('order_followups').select('order_id, kind');
    const done = new Set((doneRows || []).map((r) => `${r.order_id}:${r.kind}`));
    const claim = async (orderId: string, kind: string) => {
      const { error } = await db.from('order_followups').insert({ order_id: orderId, kind });
      return !error; // unique PK — false means another run already claimed it
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
      res.ok ? s.review++ : s.failed++;
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
      res.ok ? s.arrivals++ : s.failed++;
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
      res.ok ? s.loyalty++ : s.failed++;
      if (s.loyalty >= 20) break;                                          // safety cap per run
    }
    stats.followups = s;
  }

  // ── 4. weekly fresh-designs digest (Mondays) ────────────────────────
  stats.weekly = 'off';
  if (g.weekly_digest_enabled) {
    const now = new Date();
    if (now.getUTCDay() !== 1) {
      stats.weekly = 'waiting for Monday';
    } else {
      const week = isoWeekKey(now);
      // PK claim → exactly one send per ISO week, even across cron retries
      const { error: claimErr } = await db.from('weekly_digest_log').insert({ week_key: week });
      if (claimErr) {
        stats.weekly = `already sent (${week})`;
      } else {
        const s = { week, products: 0, sent: 0, failed: 0 };
        // Only designs added SINCE the last digest went out — never repeats what
        // subscribers already saw. Falls back to the last 7 days on first run.
        const { data: mk } = await db.from('site_settings').select('weekly_last_sent_at').eq('id', 1).maybeSingle();
        const sinceIso = (mk?.weekly_last_sent_at as string) || daysAgo(7);
        const { data: fresh } = await db.from('products')
          .select('id, title, slug, price_usd, image_url, created_at')
          .eq('active', true).gt('created_at', sinceIso)
          .not('slug', 'like', 'gift-card-%').not('image_url', 'is', null)
          .order('created_at', { ascending: false }).limit(80);
        s.products = fresh?.length || 0;
        const nowIso = new Date().toISOString();
        if (fresh?.length) {
          // Email is pictures + product-page links (like every other upsell email)
          // — no PDF. Product-page links ONLY, never raw download links.
          const weekNumber = Number(week.split('-W')[1]) || 0;
          const fmtDay = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          const startD = fmtDay(fresh[fresh.length - 1].created_at), endD = fmtDay(fresh[0].created_at);
          const range = startD === endD ? startD : `${startD} – ${endD}`;
          // Everyone confirmed gets the weekly digest, INCLUDING Etsy buyers
          // (they get their one-time welcome first, then join the weekly).
          const { data: subs } = await db.from('subscribers').select('email, best_send_hour')
            .not('confirmed_at', 'is', null).is('unsubscribed_at', null).is('suppressed_at', null).limit(20000);
          const list = (subs || []).map((r) => ({ email: r.email.toLowerCase(), hour: r.best_send_hour as number | null }));

          // ── Personalization: order each person's designs by their category
          // affinity so the ones most like what they engage with come first.
          const freshProducts = fresh as (MiniProduct & { id?: string })[];
          const catByProduct = new Map<string, string[]>();     // productId → categoryIds
          const affByEmail = new Map<string, Set<string>>();     // email → top categoryIds
          if (g.weekly_personalized) {
            const ids = (freshProducts as any[]).map((p) => p.id).filter(Boolean);
            if (ids.length) {
              const { data: pcs } = await db.from('product_categories').select('product_id, category_id').in('product_id', ids);
              for (const r of pcs || []) (catByProduct.get(r.product_id) || catByProduct.set(r.product_id, []).get(r.product_id)!).push(r.category_id);
            }
            for (const batch of chunk(list.map((l) => l.email), 300)) {
              const { data: aff } = await db.from('v_subscriber_category_affinity').select('email, category_id, score').in('email', batch);
              const perEmail = new Map<string, { c: string; s: number }[]>();
              for (const a of aff || []) (perEmail.get(a.email) || perEmail.set(a.email, []).get(a.email)!).push({ c: a.category_id, s: a.score });
              for (const [em, arr] of perEmail) affByEmail.set(em, new Set(arr.sort((x, y) => y.s - x.s).slice(0, 5).map((x) => x.c)));
            }
          }
          const personalize = (email: string): MiniProduct[] => {
            if (!g.weekly_personalized) return freshProducts;
            const liked = affByEmail.get(email); if (!liked?.size) return freshProducts;
            const sc = (p: any) => ((catByProduct.get(p.id) || []).some((c) => liked.has(c)) ? 1 : 0);
            return [...freshProducts].sort((a, b) => sc(b) - sc(a));
          };

          const tags = [{ name: 'kind', value: 'weekly' }, { name: 'week', value: week }];
          for (const part of chunk(list, 100)) {
            const emails = part.map((r) => {
              const { subject, html, text } = withOvr('weekly',
                weeklyDigestEmail({ email: r.email, products: personalize(r.email), weekNumber, range }), r.email);
              return { to: r.email, subject, html, text, tags, scheduledAt: g.sendtime_enabled ? nextHourIso(r.hour) : undefined };
            });
            const res = await sendBatch(emails, hashKey(`digest:${week}`, part.map((r) => r.email)));
            if (res.ok) s.sent += res.sent; else s.failed += emails.length;
          }
          await db.from('weekly_digest_log').update({ sent_count: s.sent, product_count: s.products }).eq('week_key', week);
        } else {
          await db.from('weekly_digest_log').update({ sent_count: 0, product_count: 0 }).eq('week_key', week);
        }
        // Advance the marker so next Monday starts fresh from here (even a quiet week).
        await db.from('site_settings').update({ weekly_last_sent_at: nowIso }).eq('id', 1);
        stats.weekly = s;
      }
    }
  }

  // ── 4b. Etsy-buyer welcome (one-time) ───────────────────────────────
  // Any imported Etsy buyer we have not welcomed yet gets ONE welcome email
  // with this week's newest designs + a 10% code. Deduped by etsy_welcome_log
  // (PK on email), so a retry or the manual script can never double-send.
  stats.etsyWelcome = 'off';
  if (g.etsy_welcome_enabled) {
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
  }

  // ── 5. abandoned-browse: viewed ≥3 designs, never carted, never bought ──
  stats.browse = 'off';
  if (g.abandoned_browse_enabled) {
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
  }

  const SITE = (process.env.PUBLIC_SITE_URL || 'https://digitalchiselco.com').replace(/\/$/, '');
  const BAD = /fake|mailinator|@example\.|@test\.|\.invalid|localhost/i;
  const okEmail = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && !BAD.test(e);

  // ── 6. Win-back + deliverability suppression ─────────────────────────
  stats.winback = 'off';
  if (g.winback_enabled) {
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
  }

  // ── 7. Price-drop alerts (a design they liked got cheaper) ───────────
  stats.priceDrop = 'off';
  if (g.price_drop_enabled) {
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
  }

  // ── 8. Referral nudge (ask happy customers to share their link) ──────
  stats.referralNudge = 'off';
  if (g.referral_nudge_enabled) {
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
        if (res.ok) { s.sent++; await db.from('referral_nudge_log').upsert({ email }, { onConflict: 'email', ignoreDuplicates: true }); } else s.failed++;
      } catch { s.failed++; }
    }
    stats.referralNudge = s;
  }

  // ── 9. Send-time learning: each subscriber's most common open hour ───
  if (g.sendtime_enabled) {
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
  } else stats.sendtime = 'off';

  // ── 10. Post-refund win-back: 30 days after a refund, one olive branch ──
  // Window is 30-37 days so enabling the toggle months later never blasts
  // ancient refunds. One email per address ever (refund_winback_log).
  stats.refundWinback = 'off';
  if (g.refund_winback_enabled) {
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
          else s.failed++;
        } catch { s.failed++; }
      }
    }
    stats.refundWinback = s;
  }

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

  return stats;
}
