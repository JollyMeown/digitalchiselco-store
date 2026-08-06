// Growth automation engine — runs inside the daily cron next to the membership
// drip. THREE independent systems, each gated by its growth_settings toggle
// (all default OFF until the owner previews + enables in Admin → Automations):
//   1. Subscriber nurture drip (5 stages, ~4 days apart, stops on purchase)
//   2. Abandoned-cart reminders (one per cart, ~20h after capture)
//   3. Post-purchase followups (review +7d, new arrivals +30d, loyalty on 3rd order)
// Every send is idempotent (Resend idempotency keys + ledger tables).

import { supabaseAdmin } from './supabase';
import { send as sendEmail } from './resend';
import {
  dripEmail, cartReminderEmail, reviewRequestEmail, newArrivalsEmail, loyaltyEmail,
  type MiniProduct,
} from './marketing-emails';

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

export async function runGrowthAutomation(): Promise<Record<string, any>> {
  const db = supabaseAdmin();
  const stats: Record<string, any> = { drip: 'off', carts: 'off', followups: 'off' };
  const { data: g } = await db.from('growth_settings').select('*').eq('id', 1).maybeSingle();
  if (!g) return { error: 'growth_settings missing' };

  // ── 1. nurture drip ─────────────────────────────────────────────────
  if (g.drip_enabled) {
    const s = { enrolled: 0, sent: 0, converted: 0, failed: 0 };
    // enroll confirmed subscribers not yet in the drip
    const { data: subs } = await db.from('subscribers').select('email').not('confirmed_at', 'is', null).is('unsubscribed_at', null).limit(3000);
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
        const { subject, html, text } = dripEmail(stage, { email: r.email, bestsellers, bundle: bundle as MiniProduct | null, plan: plan as any, couponCode: 'CARVE15' });
        const res = await sendEmail({ to: r.email, subject, html, text, idempotencyKey: `drip:${r.email}:${stage}` });
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
        const items = (Array.isArray(c.cart) ? c.cart : []) as { title: string; price: number }[];
        if (!items.length) { s.skipped++; continue; }
        const { subject, html, text } = cartReminderEmail({ email: c.email, items, subtotal: Number(c.subtotal) || 0 });
        const res = await sendEmail({ to: c.email, subject, html, text, idempotencyKey: `cartrem:${c.id}` });
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
      const { subject, html, text } = reviewRequestEmail({ email: o.email, name: o.customer_name, itemTitles: (o.order_items || []).map((i: any) => i.title) });
      const res = await sendEmail({ to: o.email, subject, html, text, idempotencyKey: `review7:${o.id}` });
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
      const { subject, html, text } = newArrivalsEmail({ email: o.email, name: o.customer_name, products: (newest || []) as MiniProduct[] });
      const res = await sendEmail({ to: o.email, subject, html, text, idempotencyKey: `arrivals30:${o.id}` });
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
      const { subject, html, text } = loyaltyEmail({ email, name: info.name, code });
      const res = await sendEmail({ to: email, subject, html, text, idempotencyKey: `loyalty:${email}` });
      res.ok ? s.loyalty++ : s.failed++;
      if (s.loyalty >= 20) break;                                          // safety cap per run
    }
    stats.followups = s;
  }

  return stats;
}
