// Paddle webhook receiver.
//
// Verifies the Paddle-Signature header (HMAC-SHA256 over `<ts>:<rawBody>`),
// stores the event for idempotency, then routes to a handler.
//
// Currently handled:
//   - transaction.completed → creates an `orders` row + `entitlements` rows.
//
// TODO (next pass): on `transaction.completed`, send the buyer an email with
// their download link(s). Pending the user's choice of email provider
// (Resend / Brevo / Klaviyo / MailerLite).

import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { supabaseAdmin } from '../../../lib/supabase';
import { verifyWebhookSignature, paddleApi } from '../../../lib/paddle';
import { send as sendEmail } from '../../../lib/resend';
import { orderConfirmation, membershipPurchaseNotification } from '../../../lib/email-templates';
import { createSubscriptionForPurchase } from '../../../lib/subscriptions';
import { giftCardEmail } from '../../../lib/marketing-emails';

const OPS_INBOX = 'jolly@digitalchiselco.com';

// process.env at runtime in Netlify Functions; import.meta.env at build-time
// in Astro dev. Read both so dev and prod behave identically.
function env(name: string): string | undefined {
  return process.env[name] ?? (import.meta as any).env?.[name];
}

export const prerender = false;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

export const POST: APIRoute = async ({ request }) => {
  const rawBody = await request.text();
  const sig = request.headers.get('paddle-signature');
  const secret = env('PADDLE_WEBHOOK_SECRET') || '';

  if (!secret) {
    console.error('Webhook hit but PADDLE_WEBHOOK_SECRET is not set');
    return json({ error: 'Webhook secret not configured' }, 500);
  }
  if (!verifyWebhookSignature(rawBody, sig, secret)) {
    console.warn('Webhook signature failed');
    return json({ error: 'Invalid signature' }, 401);
  }

  let event: any;
  try { event = JSON.parse(rawBody); } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const eventId: string = event?.event_id || event?.notification_id || '';
  const eventType: string = event?.event_type || '';
  if (!eventId || !eventType) return json({ error: 'Missing event_id or event_type' }, 400);

  const db = supabaseAdmin();

  // 1) Idempotency — insert with unique (provider, event_id). If conflict, this is a retry.
  const { error: insertErr } = await db.from('webhook_events').insert({
    provider: 'paddle',
    event_id: eventId,
    event_type: eventType,
    payload: event,
  });
  if (insertErr) {
    // 23505 = unique_violation in Postgres → already processed, ack with 200 so Paddle stops retrying
    if ((insertErr as any).code === '23505' || /duplicate key/i.test(insertErr.message)) {
      console.log(`Webhook ${eventId} (${eventType}) already processed — acking.`);
      return json({ ok: true, deduped: true });
    }
    console.error('Webhook insert failed:', insertErr);
    return json({ error: 'DB error' }, 500);
  }

  // 2) Route by event type
  try {
    if (eventType === 'transaction.completed') {
      await handleTransactionCompleted(db, event.data);
    }
    // Other events (transaction.created, transaction.updated, subscription.*, etc.)
    // are stored above but not processed yet — easy to add as needed.

    await db.from('webhook_events')
      .update({ processed_at: new Date().toISOString() })
      .eq('provider', 'paddle')
      .eq('event_id', eventId);

    return json({ ok: true });
  } catch (e: any) {
    console.error(`Webhook ${eventType} processing failed:`, e);
    await db.from('webhook_events')
      .update({ error: e.message || String(e) })
      .eq('provider', 'paddle')
      .eq('event_id', eventId);
    // Return 500 so Paddle retries — only ack 200 when we successfully processed
    return json({ error: e.message || 'Processing failed' }, 500);
  }
};

async function handleTransactionCompleted(db: any, txn: any) {
  if (!txn?.id) throw new Error('transaction.data.id missing');

  // Paddle's webhook payload only embeds customer_id (not the full customer
  // record). Fetch the customer separately so we have the email + name for
  // the order row and the transactional receipt.
  let customerEmail = '';
  let customerName: string | null = null;
  if (txn.customer_id) {
    try {
      const cust = await paddleApi<any>(`/customers/${txn.customer_id}`);
      customerEmail = (cust?.data?.email || '').toLowerCase().trim();
      customerName = cust?.data?.name || null;
    } catch (e: any) {
      console.error(`Paddle customer lookup failed for ${txn.customer_id}:`, e.message);
    }
  }
  // Fallback chain in case the customer lookup fails or customer_id is missing.
  const email: string = customerEmail || (txn.customer?.email || '').toLowerCase().trim();
  const total = Number(txn.details?.totals?.total ?? txn.details?.totals?.subtotal ?? 0) / 100; // cents → dollars
  const subtotal = Number(txn.details?.totals?.subtotal ?? 0) / 100;
  const currency = String(txn.currency_code || 'USD');

  // Upsert order keyed on paddle_transaction_id (the unique index makes this safe).
  const { data: existing } = await db
    .from('orders')
    .select('id')
    .eq('paddle_transaction_id', txn.id)
    .maybeSingle();
  if (existing?.id) {
    console.log(`Order already exists for transaction ${txn.id} → skipping create.`);
    return;
  }

  // Capture customer's name early — used both on the order row and for the
  // ops notification we may send further down.
  const earlyOpsCustomerName =
    customerName || (txn.custom_data && txn.custom_data.customer_name) || null;

  const { data: order, error: orderErr } = await db
    .from('orders')
    .insert({
      email: email || 'unknown@digitalchiselco.com',
      customer_name: earlyOpsCustomerName,
      status: 'paid',
      subtotal,
      total,
      currency,
      provider: 'paddle',
      provider_order_id: txn.id,
      paddle_transaction_id: txn.id,
      paddle_customer_id: txn.customer_id || null,
    })
    .select('id')
    .single();
  if (orderErr || !order) throw new Error(`Insert order failed: ${orderErr?.message}`);

  // Stamp the coupon redemption now that payment has actually completed. The
  // coupon_id rides along in custom_data from checkout-init. This is the ONLY
  // place redemptions are counted (moved out of checkout-init so an
  // unauthenticated caller can't burn a promo's max_redemptions without paying).
  // The whole webhook is idempotent (order insert is skipped on retry above),
  // so this runs at most once per paid order.
  const couponId: string | null = txn.custom_data?.coupon_id || null;
  if (couponId) {
    try {
      await db.from('coupon_redemptions').insert({
        coupon_id: couponId,
        email: email || null,
        amount_off: Number(txn.custom_data?.coupon_discount) || 0,
      });
      await db.rpc('increment_coupon_redemption', { p_coupon_id: couponId }).then(() => {}, async () => {
        const { data: cur } = await db.from('coupons').select('redemption_count').eq('id', couponId).maybeSingle();
        await db.from('coupons').update({ redemption_count: (cur?.redemption_count || 0) + 1 }).eq('id', couponId);
      });
    } catch (e) {
      console.error('coupon redemption stamp failed (order still valid):', e);
    }
  }

  // Resolve each line item → our product (by paddle_price_id) and create order_items + entitlements.
  const items = Array.isArray(txn.items) ? txn.items : [];
  // custom_data.cart_ids is the array our checkout-init pushed: the DB UUID per
  // cart item, in the same order as the Paddle items (with non-product cart
  // entries like 'membership:slug' preserved). Used as a fallback when an
  // item came through as ad-hoc (no paddle_price_id) and so title-matching is
  // the only handle we have.
  const cartIds: string[] = Array.isArray(txn.custom_data?.cart_ids) ? txn.custom_data.cart_ids : [];
  // Per-line customization snapshots (aligned by index with cart_ids). The cart
  // page sends these via /api/checkout-init; each entry is either null or
  // [{ key, label, type, value }, ...].
  const cartCustomizations: any[] = Array.isArray(txn.custom_data?.customizations) ? txn.custom_data.customizations : [];
  // Track membership plans in this order so we can ping ops afterwards.
  const purchasedMemberships: { name: string; slug: string; price_usd: number; months: number; files_per_month: number; qty: number }[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const priceId = it.price?.id;
    const lineTotal = Number(it.totals?.total ?? it.totals?.subtotal ?? 0) / 100;
    const lineUnit = Number(it.price?.unit_price?.amount ?? 0) / 100;
    const qty = Number(it.quantity ?? 1);

    let productId: string | null = null;
    let title: string = String(it.price?.description || it.price?.name || '').slice(0, 240);

    // "Pick any 5 for $25" bundle: one Paddle line expands into 5 order_items
    // (line total split evenly) + an entitlement per design, so downloads and
    // the confirmation email flow exactly like 5 normal purchases.
    if (cartIds[i]?.startsWith('bundle5:')) {
      const bIds = cartIds[i].slice('bundle5:'.length).split(',').map((s: string) => s.trim()).filter(Boolean);
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const valid = bIds.filter((id: string) => uuidRe.test(id));
      const { data: bProds } = valid.length
        ? await db.from('products').select('id, title').in('id', valid)
        : { data: [] as any[] };
      const per = valid.length ? +(lineTotal / valid.length).toFixed(2) : 0;
      for (const bp of bProds || []) {
        await db.from('order_items').insert({
          order_id: order.id,
          product_id: bp.id,
          title: `${bp.title} (Pick-5 Bundle)`.slice(0, 240),
          price_usd: per,
          qty: 1,
        });
        await db.from('entitlements').insert({
          order_id: order.id,
          email: email || 'unknown@digitalchiselco.com',
          product_id: bp.id,
        });
      }
      continue;
    }

    // Detect membership-plan items: match by paddle_price_id OR by membership:<slug> cart marker.
    let membershipPlan: { name: string; slug: string; price_usd: number; months: number; files_per_month: number } | null = null;
    if (priceId) {
      const { data: mp } = await db
        .from('membership_plans')
        .select('name, slug, price_usd, months, files_per_month')
        .eq('paddle_price_id', priceId)
        .maybeSingle();
      if (mp) membershipPlan = mp;
    }
    if (!membershipPlan && cartIds[i]?.startsWith('membership:')) {
      const slug = cartIds[i].slice('membership:'.length);
      const { data: mp } = await db
        .from('membership_plans')
        .select('name, slug, price_usd, months, files_per_month')
        .eq('slug', slug)
        .maybeSingle();
      if (mp) membershipPlan = mp;
    }
    if (membershipPlan) {
      purchasedMemberships.push({ ...membershipPlan, qty });
      // Use the canonical plan name for the order_items row so admin/email reads cleanly.
      title = membershipPlan.name;
    }

    // (1) Catalog match: synced products carry a paddle_price_id in our DB.
    if (priceId) {
      const { data: p } = await db
        .from('products')
        .select('id, title')
        .eq('paddle_price_id', priceId)
        .maybeSingle();
      if (p) { productId = p.id; title = p.title; }
    }
    // (2) cart_ids positional fallback — works for ad-hoc items added before
    //     the product was synced to Paddle's catalog.
    if (!productId && cartIds[i] && !cartIds[i].startsWith('membership:')) {
      const { data: p } = await db
        .from('products')
        .select('id, title')
        .eq('id', cartIds[i])
        .maybeSingle();
      if (p) { productId = p.id; title = p.title; }
    }
    // (3) Last resort: match the inline title against products.title.
    if (!productId && title) {
      const { data: p } = await db
        .from('products')
        .select('id, title')
        .eq('title', title)
        .maybeSingle();
      if (p) { productId = p.id; }
    }

    const { data: insertedItem } = await db.from('order_items').insert({
      order_id: order.id,
      product_id: productId,
      title,
      price_usd: lineUnit || lineTotal,
      qty,
    }).select('id').single();

    if (productId) {
      await db.from('entitlements').insert({
        order_id: order.id,
        email: email || 'unknown@digitalchiselco.com',
        product_id: productId,
      });
    }

    // Persist captured customization values for this line, if any. Wrapped in
    // try/catch so a DB hiccup here can never block the order confirmation
    // email that runs after this loop.
    try {
      const lineCustom = cartCustomizations[i];
      if (insertedItem?.id && Array.isArray(lineCustom) && lineCustom.some((f) => f && String(f.value || '').trim())) {
        const cleaned = lineCustom
          .filter((f) => f && typeof f === 'object')
          .map((f) => ({
            key: String(f.key || '').slice(0, 60),
            label: String(f.label || '').slice(0, 200),
            type: String(f.type || 'text').slice(0, 20),
            value: String(f.value || '').slice(0, 2000),
          }));
        await db.from('order_item_customizations').insert({
          order_item_id: insertedItem.id,
          product_id: productId,
          fields: cleaned,
        });
      }
    } catch (e) {
      console.error('order_item_customizations insert failed (continuing):', e);
    }
  }

  console.log(`Order ${order.id} created for txn ${txn.id} (${email}, $${total}).`);

  // ── Free-gift threshold: SMART auto-pick when the paid subtotal qualifies ──
  // Owner sets only a $ threshold. Enforced here off the real Paddle-paid amount
  // (browser can't fake it). The shop chooses the gift itself:
  //   • themed order (bought items share a category)  → gift from that category
  //   • mixed / single-category-tie order             → a surprise pick
  // Never re-gifts a design the customer already owns; works for guests + first
  // timers too. The gift becomes a $0 order_item + entitlement, so it flows into
  // the confirmation email's download links like any purchase.
  if (email && email !== 'unknown@digitalchiselco.com') {
    try {
      const { data: st } = await db.from('site_settings').select('free_gift_threshold').eq('id', 1).maybeSingle();
      const threshold = Number(st?.free_gift_threshold) || 0;
      if (threshold > 0 && subtotal >= threshold) {
        const shortId = String(order.id).slice(0, 8);
        const GIFT_PRICE_CAP = 15;   // only give away modestly-priced singles

        // real products bought in this order
        const { data: oi2 } = await db.from('order_items').select('product_id').eq('order_id', order.id);
        const boughtIds = [...new Set((oi2 || []).map((r: any) => r.product_id).filter(Boolean))];

        // everything this email already owns (entitlements cover every past order)
        const ownedSet = new Set<string>(boughtIds);
        const { data: ents } = await db.from('entitlements').select('product_id').ilike('email', email);
        for (const e of ents || []) if (e.product_id) ownedSet.add(e.product_id);

        // decide "themed" vs "surprise" from the bought products' categories
        let pool: any[] = [];
        if (boughtIds.length) {
          const { data: pcs } = await db.from('product_categories').select('product_id, category_id').in('product_id', boughtIds);
          const catCount: Record<string, number> = {};
          for (const r of pcs || []) catCount[r.category_id] = (catCount[r.category_id] || 0) + 1;
          const top = Object.entries(catCount).sort((a, b) => b[1] - a[1])[0];
          // themed if the top category is shared by ≥2 items, or a single-item order
          const useCat = top && (top[1] >= 2 || boughtIds.length === 1) ? top[0] : null;
          if (useCat) {
            const { data: catPool } = await db.from('product_categories')
              .select('products!inner(id, slug, title, price_usd, active, is_bundle, is_subscription)')
              .eq('category_id', useCat).limit(300);
            pool = (catPool || []).map((r: any) => r.products).filter(Boolean);
          }
        }
        // surprise / fallback pool: any active singles
        if (!pool.length) {
          const { data: anyPool } = await db.from('products')
            .select('id, slug, title, price_usd, active, is_bundle, is_subscription')
            .eq('active', true).gt('price_usd', 0).lte('price_usd', GIFT_PRICE_CAP).limit(500);
          pool = anyPool || [];
        }

        // eligibility: active single, not owned, not gift-card/catalogue, within cap
        const seenId = new Set<string>();
        let candidates = pool.filter((p: any) => p && p.active && !p.is_bundle && !p.is_subscription
          && !ownedSet.has(p.id)
          && !String(p.slug || '').startsWith('gift-card-')
          && !String(p.slug || '').startsWith('catalogue-')
          && Number(p.price_usd) > 0 && Number(p.price_usd) <= GIFT_PRICE_CAP
          && !seenId.has(p.id) && seenId.add(p.id));

        // must have a downloadable file so the gift actually delivers
        if (candidates.length) {
          const { data: dls } = await db.from('product_downloads').select('product_id').in('product_id', candidates.map((p: any) => p.id));
          const hasDl = new Set((dls || []).map((d: any) => d.product_id));
          candidates = candidates.filter((p: any) => hasDl.has(p.id));
        }

        if (candidates.length) {
          const gift = candidates[Math.floor(Math.random() * candidates.length)];
          await db.from('order_items').insert({ order_id: order.id, product_id: gift.id, title: `🎁 Free gift: ${String(gift.title).split('|')[0].trim()}`, price_usd: 0, qty: 1 });
          await db.from('entitlements').insert({ order_id: order.id, email, product_id: gift.id });
          console.log(`[free-gift] granted ${gift.slug} (smart pick) on order ${shortId} — subtotal $${subtotal} >= $${threshold}`);
        } else {
          console.log(`[free-gift] order ${shortId} qualified but no eligible gift candidate found`);
        }
      }
    } catch (e) { console.error('[free-gift] grant failed (order still valid):', e); }
  }

  // ── Referral program: friend used a REF-XXXX share code ──────────────
  // The code is a normal 15% coupon; here we log the referral and (if reward
  // sending is enabled) mint + email the referrer their own 15% thank-you code.
  const usedCode: string | null = txn.custom_data?.coupon_code || null;
  if (usedCode && usedCode.startsWith('REF-') && email && email !== 'unknown@digitalchiselco.com') {
    try {
      const { data: rc } = await db.from('referral_codes').select('email').eq('code', usedCode).maybeSingle();
      const referrer = rc?.email ? String(rc.email).toLowerCase() : null;
      if (referrer && referrer !== email) {
        // idempotent on order (unique index referrals_order_uidx)
        const { data: refRow, error: refErr } = await db.from('referrals').insert({
          code: usedCode, referrer_email: referrer, referred_email: email,
          order_id: order.id, amount_usd: total, status: 'pending',
        }).select('id').maybeSingle();
        if (!refErr && refRow) {
          const { data: g2 } = await db.from('growth_settings').select('referral_rewards_enabled').eq('id', 1).maybeSingle();
          if (g2?.referral_rewards_enabled) {
            const rewardCode = 'THANKS-' + crypto.randomBytes(3).toString('hex').toUpperCase();
            await db.from('coupons').insert({ code: rewardCode, percent_off: 15, active: true, max_redemptions: 1, description: `referral reward for ${referrer}` });
            await db.from('referrals').update({ status: 'rewarded', reward_code: rewardCode }).eq('id', refRow.id);
            try {
              const { referralRewardEmail } = await import('../../../lib/marketing-emails');
              const { subject, html, text } = referralRewardEmail({ email: referrer, code: rewardCode, friendEmail: email });
              await sendEmail({ to: referrer, subject, html, text, idempotencyKey: `refreward:${refRow.id}`, tags: [{ name: 'kind', value: 'referral' }] });
            } catch (e) { console.error('[referral] reward email failed:', e); }
            console.log(`[referral] ${email} referred by ${referrer} → reward ${rewardCode}`);
          }
        }
      }
    } catch (e) { console.error('[referral] handling failed (order still valid):', e); }
  }

  // ── Loyalty: award points on every paid order (if enabled) ──────────
  // points = round(total × earn_per_dollar). Idempotent per order via the
  // unique index on loyalty_ledger(order_id) where reason='earned'.
  if (email && email !== 'unknown@digitalchiselco.com' && total > 0) {
    try {
      const { data: ls } = await db.from('site_settings').select('loyalty_enabled, loyalty_earn_per_dollar').eq('id', 1).maybeSingle();
      if (ls?.loyalty_enabled) {
        const pts = Math.round(total * (Number(ls.loyalty_earn_per_dollar) || 10));
        if (pts > 0) {
          const { error: le } = await db.from('loyalty_ledger').insert({ email, points: pts, reason: 'earned', order_id: order.id });
          if (!le) console.log(`[loyalty] +${pts} pts to ${email} for order ${String(order.id).slice(0, 8)}`);
        }
      }
    } catch (e) { console.error('[loyalty] award failed (order still valid):', e); }
  }

  // Abandoned-cart recovery: they paid — close any open cart snapshot so the
  // reminder cron never emails a buyer who already completed checkout.
  if (email && email !== 'unknown@digitalchiselco.com') {
    try {
      await db.from('abandoned_carts').update({ recovered_at: new Date().toISOString() })
        .ilike('email', email).is('recovered_at', null);
    } catch { /* best-effort */ }
  }

  // ── Ops notification: new membership purchase ─────────────────────
  // Sends to OPS_INBOX so Jolly can spin up the manual fulfilment side
  // (first 8-file pack + monthly schedule). Best-effort — failure here
  // never rolls back the order.
  if (purchasedMemberships.length && email && email !== 'unknown@digitalchiselco.com') {
    try {
      const { subject, html, text } = membershipPurchaseNotification({
        customerEmail: email,
        customerName: earlyOpsCustomerName,
        orderId: order.id,
        orderShortId: String(order.id).slice(0, 8),
        createdAt: new Date().toISOString(),
        currency,
        plans: purchasedMemberships,
        totalPaid: total,
        invoiceNumber: txn.invoice_number || null,
      });
      const r = await sendEmail({
        to: OPS_INBOX,
        subject,
        html,
        text,
        replyTo: email,            // hitting reply goes straight to the customer
        idempotencyKey: `membership-ops:${order.id}`,
      });
      if (r.ok && !r.skipped) {
        console.log(`[email] Membership ops notification sent for order ${order.id.slice(0, 8)} (id=${r.id})`);
      } else if (r.skipped) {
        console.log(`[email] Membership ops notification skipped (Resend not configured) — order ${order.id.slice(0, 8)}`);
      } else {
        console.error(`[email] Membership ops notification failed for order ${order.id.slice(0, 8)}: ${r.error}`);
      }
    } catch (e) {
      console.error(`[email] Membership ops notification threw for order ${order.id}:`, e);
    }
  }

  // ── Membership automation: create the subscription + send pack 1 ──────
  // Fixed-term drip. createSubscriptionForPurchase inserts the term row and
  // emails the buyer their first monthly pack. Idempotent per (txn, plan) so a
  // webhook retry never double-creates. Best-effort — never rolls back the order.
  if (purchasedMemberships.length && email && email !== 'unknown@digitalchiselco.com') {
    for (const mp of purchasedMemberships) {
      try {
        const r = await createSubscriptionForPurchase({
          email,
          customerName: earlyOpsCustomerName,
          plan: { slug: mp.slug, name: mp.name, months: mp.months, files_per_month: mp.files_per_month, price_usd: mp.price_usd },
          orderId: order.id,
          paddleTransactionId: `${txn.id}:${mp.slug}`,
        });
        console.log(`[membership] ${r.created ? `created subscription ${r.subscriptionId}` : `skipped (${r.reason})`} for ${email} (${mp.slug})`);
      } catch (e) {
        console.error(`[membership] subscription creation failed for order ${order.id} (${mp.slug}):`, e);
      }
    }
  }

  // ── Gift cards: mint one single-use coupon per card + email the buyer ──
  // Idempotent on webhook retries: skip if a coupon for this order already exists.
  if (email && email !== 'unknown@digitalchiselco.com') {
    try {
      const shortId = String(order.id).slice(0, 8);
      const { data: already } = await db.from('coupons').select('id').ilike('description', `%order ${shortId}%`).limit(1);
      if (!already?.length) {
        const { data: giftProds } = await db.from('products').select('id, price_usd').like('slug', 'gift-card-%');
        const giftById = new Map((giftProds || []).map((g: any) => [g.id, Number(g.price_usd)]));
        const { data: oi } = await db.from('order_items').select('product_id, qty').eq('order_id', order.id);
        const minted: { code: string; amount: number }[] = [];
        for (const it of oi || []) {
          const amount = it.product_id ? giftById.get(it.product_id) : undefined;
          if (amount === undefined) continue;
          for (let k = 0; k < Math.max(1, Number(it.qty) || 1); k++) {
            const code = 'GIFT-' + crypto.randomBytes(3).toString('hex').toUpperCase();
            const { error: ce } = await db.from('coupons').insert({
              code, fixed_amount_off: amount, active: true, max_redemptions: 1,
              description: `gift card · order ${shortId}`,
            });
            if (!ce) minted.push({ code, amount });
          }
        }
        if (minted.length) {
          const { subject, html, text } = giftCardEmail({ email, buyerName: earlyOpsCustomerName, cards: minted });
          await sendEmail({ to: email, subject, html, text, idempotencyKey: `gift:${order.id}`, tags: [{ name: 'kind', value: 'gift' }] });
          console.log(`[gift] minted ${minted.length} card(s) for order ${shortId}`);
        }
      }
    } catch (e) { console.error('[gift] minting failed for order', order.id, e); }
  }

  // ── Send branded confirmation email with download links ──────────────
  // Pulls download links from product_downloads for each ordered product, then
  // hands off to Resend. Failure here does NOT roll back the order (the customer
  // can still see their order on /account); we just log so we can resend later.
  if (email && email !== 'unknown@digitalchiselco.com') {
    try {
      // Fetch order items (+ their customizations + each product's is_customizable
      // flag), product download links, and the brand logo — all in parallel.
      const [{ data: orderItems }, { data: settings }] = await Promise.all([
        db.from('order_items')
          .select('id, title, qty, price_usd, product_id, order_item_customizations(fields), products(is_customizable)')
          .eq('order_id', order.id),
        db.from('site_settings').select('logo_image_url').eq('id', 1).maybeSingle(),
      ]);
      const productIds = (orderItems || []).map((it: any) => it.product_id).filter(Boolean);
      const downloadsByProduct: Record<string, { name?: string; url: string }[]> = {};
      if (productIds.length) {
        const { data: dls } = await db
          .from('product_downloads')
          .select('product_id, file_name, download_link')
          .in('product_id', productIds);
        for (const dl of dls || []) {
          (downloadsByProduct[dl.product_id] ||= []).push({ name: dl.file_name || undefined, url: dl.download_link });
        }
      }

      const emailItems = (orderItems || []).map((it: any) => {
        const fields = (it.order_item_customizations || []).flatMap((c: any) => Array.isArray(c.fields) ? c.fields : []);
        // A line is "customized" if either it has captured field values OR the
        // product itself is flagged is_customizable (catches the edge case
        // where a customizable product was bought without filling fields).
        const isCustomized = fields.length > 0 || !!(it.products && it.products.is_customizable);
        return {
          title: it.title || 'Item',
          qty: it.qty || 1,
          price_usd: Number(it.price_usd) || 0,
          // Skip download links entirely for customized lines — the file
          // doesn't exist yet; the customer gets it once the artisan delivers.
          download_links: isCustomized ? undefined : (it.product_id ? downloadsByProduct[it.product_id] : undefined),
          is_customized: isCustomized,
          customization_fields: fields,
        };
      });

      // customerName already looked up at top of function via /customers/{id}
      const finalCustomerName: string | null =
        customerName || (txn.custom_data && txn.custom_data.customer_name) || null;

      // "Carvers also bought" cross-sells for the delivery email: 3 active
      // products from the same categories as the purchase, excluding what they own.
      let crossSells: { title: string; slug: string; image_url: string | null; price_usd: number }[] = [];
      try {
        const boughtIds = productIds;
        if (boughtIds.length) {
          const { data: pcs } = await db.from('product_categories').select('category_id').in('product_id', boughtIds).limit(6);
          const catIds = [...new Set((pcs || []).map((r: any) => r.category_id))];
          if (catIds.length) {
            const { data: pool } = await db.from('product_categories')
              .select('products!inner(id, slug, title, price_usd, image_url, active)')
              .in('category_id', catIds).limit(40);
            const seen = new Set(boughtIds);
            for (const r of (pool || []) as any[]) {
              const pr = r.products;
              if (!pr?.active || seen.has(pr.id)) continue;
              seen.add(pr.id);
              crossSells.push({ title: pr.title, slug: pr.slug, image_url: pr.image_url, price_usd: Number(pr.price_usd) });
              if (crossSells.length >= 3) break;
            }
          }
        }
      } catch { /* cross-sells are optional */ }

      // Pull receipt-grade fields straight from Paddle's payload so our email
      // can fully replace Paddle's generic receipt.
      const tax = Number(txn.details?.totals?.tax ?? 0) / 100 || 0;
      const discountTotal = Number(txn.details?.totals?.discount ?? 0) / 100 || 0;
      const card = txn.payments?.[0]?.method_details?.card;
      const paymentMethod = card ? {
        type: txn.payments?.[0]?.method_details?.type || 'card',
        cardBrand: card.type || null,
        last4: card.last4 || null,
      } : null;
      const invoiceNumber = txn.invoice_number || null;
      // Permanent redirect endpoint on OUR domain. The endpoint fetches a
      // fresh pre-signed invoice URL from Paddle on each click — Paddle's
      // direct URLs expire after 1 hour, so emailing them directly breaks.
      const siteUrl = (env('PUBLIC_SITE_URL') || 'https://digitalchiselco.com').replace(/\/$/, '');
      const paddleInvoiceUrl = invoiceNumber ? `${siteUrl}/api/invoice/${txn.id}` : null;

      const { subject, html, text } = orderConfirmation({
        email,
        customerName: finalCustomerName,
        crossSells,
        orderId: order.id,
        orderShortId: String(order.id).slice(0, 8),
        createdAt: new Date().toISOString(),
        total,
        currency,
        items: emailItems,
        logoUrl: settings?.logo_image_url || null,
        invoiceNumber,
        paddleInvoiceUrl,
        subtotal,
        tax,
        discountTotal,
        paymentMethod,
      });

      const sendResult = await sendEmail({
        to: email,
        subject,
        html,
        text,
        idempotencyKey: `order:${order.id}`,   // Resend dedupes if we accidentally retry
        tags: [{ name: 'kind', value: 'order' }],
      });

      if (sendResult.ok && !sendResult.skipped) {
        console.log(`[email] Order ${order.id.slice(0, 8)} confirmation sent to ${email} (id=${sendResult.id})`);
      } else if (sendResult.skipped) {
        console.log(`[email] skipped (Resend not configured) — order ${order.id.slice(0, 8)}`);
      } else {
        console.error(`[email] failed for order ${order.id.slice(0, 8)}: ${sendResult.error}`);
      }
    } catch (e) {
      // Don't throw — the order is already saved, the customer can refetch via /account
      console.error(`[email] threw for order ${order.id}:`, e);
    }
  }
}
