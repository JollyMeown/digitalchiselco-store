// Growth automation engine — runs inside the daily cron next to the membership
// drip. THREE independent systems, each gated by its growth_settings toggle
// (all default OFF until the owner previews + enables in Admin → Automations):
//   1. Subscriber nurture drip (5 stages, ~4 days apart, stops on purchase)
//   2. Abandoned-cart reminders (one per cart, ~20h after capture)
//   3. Post-purchase followups (review +7d, new arrivals +30d, loyalty on 3rd order)
// Every send is idempotent (Resend idempotency keys + ledger tables).

import { supabaseAdmin } from './supabase';
import { send as sendEmail, sendBatch } from './resend';
import {
  dripEmail, cartReminderEmail, reviewRequestEmail, newArrivalsEmail, loyaltyEmail,
  weeklyDigestEmail, abandonedBrowseEmail, applyOverride, TEMPLATE_HEADINGS,
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
          .select('title, slug, price_usd, image_url, created_at')
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
          const { data: subs } = await db.from('subscribers').select('email')
            .not('confirmed_at', 'is', null).is('unsubscribed_at', null).limit(3000);
          // Resend batch: 100 emails/call, one idempotency key per chunk.
          const list = (subs || []).map((r) => r.email.toLowerCase());
          const tags = [{ name: 'kind', value: 'weekly' }, { name: 'week', value: week }];
          for (let c = 0; c < list.length; c += 100) {
            const chunk = list.slice(c, c + 100).map((email) => {
              const { subject, html, text } = withOvr('weekly',
                weeklyDigestEmail({ email, products: fresh as MiniProduct[], weekNumber, range }), email);
              return { to: email, subject, html, text, tags };
            });
            const res = await sendBatch(chunk, `digest:${week}:chunk${c / 100}`);
            if (res.ok) s.sent += res.sent; else s.failed += chunk.length;
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

  return stats;
}
