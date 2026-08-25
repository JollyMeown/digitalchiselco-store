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
import { giftCardEmail, paymentRecoveryEmail } from '../../../lib/marketing-emails';
import { telegramOwner } from '../../../lib/notify';

const OPS_INBOX = 'jolly@digitalchiselco.com';

// supabase-js never throws on PostgREST errors. Fulfilment writes MUST throw on
// error so the webhook 500s and Paddle retries — otherwise a transient DB blip
// leaves a paid customer with no items/entitlements and no email, silently.
function must<T extends { error: any }>(r: T, what: string): T {
  if (r.error) throw new Error(what + ': ' + (r.error.message || String(r.error)));
  return r;
}

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
    if ((insertErr as any).code === '23505' || /duplicate key/i.test(insertErr.message)) {
      // Retry of an event we've seen. Only ack-and-skip if the FIRST attempt
      // finished (processed_at set). If it died partway, fall through and
      // reprocess — otherwise Paddle's retry gets swallowed here and a paid
      // order can be left permanently half-created (no items/email).
      const { data: prior } = await db.from('webhook_events')
        .select('processed_at').eq('provider', 'paddle').eq('event_id', eventId).maybeSingle();
      if (prior?.processed_at) {
        console.log(`Webhook ${eventId} (${eventType}) already processed — acking.`);
        return json({ ok: true, deduped: true });
      }
      console.warn(`Webhook ${eventId} (${eventType}) previously failed mid-processing — reprocessing.`);
    } else {
      console.error('Webhook insert failed:', insertErr);
      return json({ error: 'DB error' }, 500);
    }
  }
  // Atomic processing claim: two deliveries of the same event racing (first
  // still running near the function timeout, retry arrives) could both run
  // the fulfilment and, e.g., mint two gift codes. Only the claimant proceeds;
  // a stale claim (>5 min, crashed attempt) can be re-claimed.
  try {
    const { data: claimed, error: claimErr } = await db.rpc('claim_webhook_event', { p_event_id: eventId });
    if (!claimErr && claimed === false) {
      console.log(`Webhook ${eventId} is being processed by another delivery — acking.`);
      return json({ ok: true, deduped: true, reason: 'in-progress' });
    }
  } catch { /* if the RPC is unavailable, fall through (previous behaviour) */ }

  // 2) Route by event type
  try {
    if (eventType === 'transaction.completed') {
      await handleTransactionCompleted(db, event.data);
    } else if (eventType === 'adjustment.created' || eventType === 'adjustment.updated') {
      await handleAdjustment(db, event.data);
    } else if (eventType === 'transaction.payment_failed') {
      await handlePaymentFailed(db, event.data);
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
  // A paid order with NO resolvable email would be filed under unknown@… and
  // the buyer would never get downloads. Throw → 500 → Paddle retries (the
  // customer lookup was almost certainly a transient Paddle blip).
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error(`no customer email resolvable for txn ${txn.id} (customer_id=${txn.customer_id || 'none'}) — retry`);
  }

  // ── TRUSTED checkout snapshot ────────────────────────────────────────
  // checkout-init records exactly what each transaction sells in
  // pending_checkouts. We fulfil from THAT, never from txn.custom_data: Paddle.js
  // on our own domain lets any page script open a checkout with forged
  // custom_data (fake bundle5 lines → 5 designs for the price of one; fake
  // gift_remainder → free gift codes; someone else's coupon_id…). No snapshot
  // (transaction not created by our server) → an EMPTY trusted object: the
  // order still fulfils via Paddle catalog price-id matching only and is
  // flagged for review.
  const { data: snap } = await db.from('pending_checkouts').select('*').eq('txn_id', txn.id).maybeSingle();
  const trusted = {
    cart_ids: (Array.isArray(snap?.cart_ids) ? snap!.cart_ids : []) as string[],
    customizations: (Array.isArray(snap?.customizations) ? snap!.customizations : []) as any[],
    coupon_id: (snap?.coupon_id as string | null) || null,
    coupon_code: (snap?.coupon_code as string | null) || null,
    coupon_discount: Number(snap?.coupon_discount) || 0,
    gift_remainder: Number(snap?.gift_remainder) || 0,
    gift: (snap?.gift as any) || null,
    fx: (snap?.fx as any) || null,
    fromServer: !!snap,
  };
  if (!snap) console.warn(`[webhook] txn ${txn.id} has NO pending_checkouts snapshot — fulfilling via catalog match only, flagged for review`);

  // Gift orders: the RECIPIENT gets entitlements + the download email; the
  // buyer keeps the order row, the receipt, loyalty points and referral credit.
  const giftRaw = trusted.gift;
  const giftTo = giftRaw && typeof giftRaw.to === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(giftRaw.to)
    ? String(giftRaw.to).toLowerCase().trim() : null;
  const gift = giftTo ? {
    to: giftTo,
    fromName: (String(giftRaw.from || '').trim().slice(0, 80)) || null,
    note: (String(giftRaw.note || '').trim().slice(0, 300)) || null,
  } : null;
  const deliveryEmail: string = gift ? gift.to : email;
  const total = Number(txn.details?.totals?.total ?? txn.details?.totals?.subtotal ?? 0) / 100; // cents → dollars
  const subtotal = Number(txn.details?.totals?.subtotal ?? 0) / 100;
  const currency = String(txn.currency_code || 'USD');
  // Multi-currency charging: checkout-init stamps the USD-equivalent subtotal
  // into custom_data.fx so USD-denominated rules (free-gift threshold, loyalty
  // points per dollar, referral stats) stay correct when the buyer paid in EUR
  // etc. For USD transactions these are identical to subtotal/total.
  const usdSubtotal = Number(trusted.fx?.usd_subtotal) > 0 ? Number(trusted.fx.usd_subtotal) : subtotal;
  const usdTotal = currency === 'USD' ? total : usdSubtotal;

  // Upsert order keyed on paddle_transaction_id (the unique index makes this safe).
  const { data: existing } = await db
    .from('orders')
    .select('id, fulfilled_at, confirmation_sent_at')
    .eq('paddle_transaction_id', txn.id)
    .maybeSingle();
  let resumeEmailOnly = false;
  if (existing?.id) {
    // Resume support, driven by explicit stamps (NOT the old 'has ≥1 item'
    // heuristic, which treated a half-written order as done and never sent
    // the email):
    //   fulfilled_at + confirmation_sent_at → fully done, skip.
    //   fulfilled_at only                   → items OK, just (re)send the email.
    //   neither                             → wipe any partial items and redo
    //                                          the whole fulfilment.
    if (existing.fulfilled_at && existing.confirmation_sent_at) {
      console.log(`Order already fulfilled+emailed for transaction ${txn.id} → skipping.`);
      return;
    }
    if (existing.fulfilled_at) {
      resumeEmailOnly = true;
      console.warn(`Order ${existing.id} fulfilled but confirmation never sent — resending email only.`);
    } else {
      console.warn(`Order ${existing.id} exists for txn ${txn.id} but fulfilment incomplete — redoing items/entitlements.`);
      await db.from('entitlements').delete().eq('order_id', existing.id);
      await db.from('order_items').delete().eq('order_id', existing.id);
    }
  }

  // Capture customer's name early — used both on the order row and for the
  // ops notification we may send further down.
  const earlyOpsCustomerName =
    customerName || (txn.custom_data && txn.custom_data.customer_name) || null;

  let order: { id: string };
  if (existing?.id) {
    order = { id: existing.id };
  } else {
    const { data: created, error: orderErr } = await db
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
    if (orderErr || !created) throw new Error(`Insert order failed: ${orderErr?.message}`);
    order = created;
  }

  // Stamp the coupon redemption now that payment has actually completed. The
  // coupon_id rides along in custom_data from checkout-init. This is the ONLY
  // place redemptions are counted (moved out of checkout-init so an
  // unauthenticated caller can't burn a promo's max_redemptions without paying).
  // The whole webhook is idempotent (order insert is skipped on retry above),
  // so this runs at most once per paid order.
  // Skipped on the resume path: the stamp sits immediately after the order
  // insert, so on any crash-late-then-resume it already ran once — running it
  // again would double-count the redemption.
  const couponId: string | null = existing?.id ? null : trusted.coupon_id;
  if (couponId) {
    try {
      await db.from('coupon_redemptions').insert({
        coupon_id: couponId,
        email: email || null,
        amount_off: trusted.coupon_discount,
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
  const cartIds: string[] = trusted.cart_ids;
  // Per-line customization snapshots (aligned by index with cart_ids). The cart
  // page sends these via /api/checkout-init; each entry is either null or
  // [{ key, label, type, value }, ...].
  const cartCustomizations: any[] = trusted.customizations;
  // Track membership plans in this order so we can ping ops afterwards.
  const purchasedMemberships: { name: string; slug: string; price_usd: number; months: number; files_per_month: number; qty: number }[] = [];
  for (let i = 0; i < (resumeEmailOnly ? 0 : items.length); i++) {
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
        must(await db.from('order_items').insert({
          order_id: order.id,
          product_id: bp.id,
          title: `${bp.title} (Pick-5 Bundle)`.slice(0, 240),
          price_usd: per,
          qty: 1,
        }), 'order_items insert (bundle)');
        must(await db.from('entitlements').insert({
          order_id: order.id,
          email: deliveryEmail || 'unknown@digitalchiselco.com',
          product_id: bp.id,
        }), 'entitlements insert (bundle)');
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
    // (3) Last resort: match the inline title against products.title. ONLY
    //     for server-created transactions — a forged checkout could otherwise
    //     name any product in an ad-hoc line and get it fulfilled.
    if (!productId && title && trusted.fromServer) {
      const { data: p } = await db
        .from('products')
        .select('id, title')
        .eq('title', title)
        .maybeSingle();
      if (p) { productId = p.id; }
    }

    const { data: insertedItem } = must(await db.from('order_items').insert({
      order_id: order.id,
      product_id: productId,
      title,
      price_usd: lineUnit || lineTotal,
      qty,
    }).select('id').single(), 'order_items insert');

    if (productId) {
      must(await db.from('entitlements').insert({
        order_id: order.id,
        email: deliveryEmail || 'unknown@digitalchiselco.com',
        product_id: productId,
      }), 'entitlements insert');
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

  // Fulfilment complete → stamp it (drives the resume logic above). Also flag
  // orders whose transaction had no server snapshot so ops can review them.
  if (!resumeEmailOnly) {
    must(await db.from('orders').update({ fulfilled_at: new Date().toISOString() }).eq('id', order.id), 'orders.fulfilled_at update');
    if (!trusted.fromServer) {
      try {
        await sendEmail({ to: OPS_INBOX, subject: `⚠️ Order #${String(order.id).slice(0, 8)} needs review: no checkout snapshot`,
          html: `<p>Paddle txn <code>${txn.id}</code> (${email}, ${total.toFixed(2)} ${currency}) was NOT created by our checkout — fulfilled via catalog price-id match only. Please verify what was granted.</p>`,
          text: `Order ${order.id} (txn ${txn.id}) had no checkout snapshot; fulfilled via catalog match only. Verify.`, idempotencyKey: `review-order:${order.id}` });
      } catch { /* best-effort */ }
    }
  }
  console.log(`Order ${order.id} ${resumeEmailOnly ? 'resumed (email only)' : 'created'} for txn ${txn.id} (${email}, ${total}).`);

  // ── Owner instant alert: a real order just landed 🎉 ─────────────────
  // Gated by growth_settings.owner_alerts_enabled; idempotent per order.
  try {
    const { data: gset } = await db.from('growth_settings').select('owner_alerts_enabled').eq('id', 1).maybeSingle();
    const { data: oiAlert } = await db.from('order_items').select('title, price_usd').eq('order_id', order.id).limit(10);
    // Dashboard feed row (all channels live here; the admin chime for website
    // orders comes from the `orders` realtime insert, so the listener does not
    // ring twice for this kind). Not gated: it is history, not a notification.
    if (!resumeEmailOnly) {
      await db.from('owner_alerts').insert({
        kind: 'website_order',
        title: `Website order: $${total.toFixed(2)} ${currency}`,
        body: `${email} · ${(oiAlert || []).slice(0, 3).map((r: any) => String(r.title).split('|')[0].trim()).join(', ')}`,
        amount: total, currency, url: '#orders', meta: { order_id: order.id, txn_id: txn.id },
      });
    }
    if (gset?.owner_alerts_enabled) {
      const lines = (oiAlert || []).map((r: any) => `• ${String(r.title).split('|')[0].trim()} ($${Number(r.price_usd).toFixed(2)})`).join('<br/>');
      await sendEmail({
        to: OPS_INBOX,
        subject: `🎉 New order: $${total.toFixed(2)} ${currency} from ${email}`,
        html: `<p><strong>${email}</strong> just paid <strong>$${total.toFixed(2)} ${currency}</strong> (order #${String(order.id).slice(0, 8)}).</p><p>${lines}</p>`,
        text: `New order $${total.toFixed(2)} ${currency} from ${email} (#${String(order.id).slice(0, 8)}).`,
        idempotencyKey: `order-alert:${order.id}`,
      });
      // Free Telegram push (skipped silently unless TELEGRAM_* env is set)
      await telegramOwner(`🎉 <b>New order: $${total.toFixed(2)} ${currency}</b>\n${email}\n${(oiAlert || []).slice(0, 5).map((r: any) => `• ${String(r.title).split('|')[0].trim()}`).join('\n')}`);
    }
  } catch (e) { console.error('[owner-alert] failed (order fine):', e); }

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
      if (threshold > 0 && usdSubtotal >= threshold) {
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
          // NOTE: named `pick`, not `gift` — the outer `gift` is the gift-ORDER
          // routing object and must stay visible here (deliveryEmail target).
          const pick = candidates[Math.floor(Math.random() * candidates.length)];
          await db.from('order_items').insert({ order_id: order.id, product_id: pick.id, title: `🎁 Free gift: ${String(pick.title).split('|')[0].trim()}`, price_usd: 0, qty: 1 });
          await db.from('entitlements').insert({ order_id: order.id, email: deliveryEmail, product_id: pick.id });
          console.log(`[free-gift] granted ${pick.slug} (smart pick) on order ${shortId} — subtotal $${subtotal} >= $${threshold}`);
        } else {
          console.log(`[free-gift] order ${shortId} qualified but no eligible gift candidate found`);
        }
      }
    } catch (e) { console.error('[free-gift] grant failed (order still valid):', e); }
  }

  // ── Referral program: friend used a REF-XXXX share code ──────────────
  // The code is a normal 15% coupon; here we log the referral and (if reward
  // sending is enabled) mint + email the referrer their own 15% thank-you code.
  const usedCode: string | null = trusted.coupon_code;
  if (usedCode && usedCode.startsWith('REF-') && email && email !== 'unknown@digitalchiselco.com') {
    try {
      const { data: rc } = await db.from('referral_codes').select('email').eq('code', usedCode).maybeSingle();
      const referrer = rc?.email ? String(rc.email).toLowerCase() : null;
      if (referrer && referrer !== email) {
        // idempotent on order (unique index referrals_order_uidx)
        const { data: refRow, error: refErr } = await db.from('referrals').insert({
          code: usedCode, referrer_email: referrer, referred_email: email,
          order_id: order.id, amount_usd: usdTotal, status: 'pending',
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
        const pts = Math.round(usdTotal * (Number(ls.loyalty_earn_per_dollar) || 10));
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
      // Match the exact description we mint below — a looser '%order X%' would
      // also match the gift-REMAINDER coupon and wrongly skip minting here.
      const { data: already } = await db.from('coupons').select('id').ilike('description', `%gift card · order ${shortId}%`).limit(1);
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

  // ── Gift-card remainder: card was worth more than the cart ─────────────
  // checkout-init capped the applied amount and passed the balance through in
  // custom_data.gift_remainder. Mint a fresh single-use GIFT- code for the
  // balance and email it — the buyer never loses a cent of stored value.
  // (The original card's coupon was max_redemptions=1 and its redemption was
  // stamped above, so it can't be reused; this code IS its new balance.)
  const giftRemainder = trusted.gift_remainder;
  if (giftRemainder >= 0.01 && email && email !== 'unknown@digitalchiselco.com') {
    try {
      const shortId = String(order.id).slice(0, 8);
      const { data: alreadyRem } = await db.from('coupons').select('id')
        .ilike('description', `%gift remainder · order ${shortId}%`).limit(1);
      if (!alreadyRem?.length) {
        const code = 'GIFT-' + crypto.randomBytes(3).toString('hex').toUpperCase();
        const { error: ce } = await db.from('coupons').insert({
          code, fixed_amount_off: giftRemainder, active: true, max_redemptions: 1,
          description: `gift remainder · order ${shortId}`,
        });
        if (!ce) {
          const { html, text } = giftCardEmail({ email, buyerName: earlyOpsCustomerName, cards: [{ code, amount: giftRemainder }] });
          await sendEmail({
            to: email,
            subject: `Your remaining gift balance: $${giftRemainder.toFixed(2)} — new code inside`,
            html, text,
            idempotencyKey: `gift-remainder:${order.id}`,
            tags: [{ name: 'kind', value: 'gift' }],
          });
          console.log(`[gift] remainder $${giftRemainder} re-minted as ${code} for order ${shortId}`);
        }
      }
    } catch (e) { console.error('[gift] remainder minting failed for order', order.id, e); }
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
        email: deliveryEmail,
        // A gift recipient's name is unknown — the gift banner carries the
        // sender's name instead, so suppress the buyer's name there.
        customerName: gift ? null : finalCustomerName,
        gift: gift ? { fromName: gift.fromName, note: gift.note } : null,
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

      // Every buyer also receives the "How your portal works" PDF (sign-in
      // steps + benefits, with screenshots) and a pointer to it in the body.
      const { portalGuideBlock, PORTAL_GUIDE_URL, PORTAL_GUIDE_FILENAME } = await import('../../../lib/order-email');
      const htmlWithGuide = html.includes('</body>') ? html.replace('</body>', portalGuideBlock() + '</body>') : html + portalGuideBlock();
      const sendResult = await sendEmail({
        to: deliveryEmail,
        subject,
        html: htmlWithGuide,
        text,
        idempotencyKey: `order:${order.id}`,   // Resend dedupes if we accidentally retry
        tags: [{ name: 'kind', value: 'order' }],
        attachments: [{ filename: PORTAL_GUIDE_FILENAME, path: PORTAL_GUIDE_URL }],
      });

      // Gift orders: the buyer also gets a short "delivered" note (their money
      // receipt still comes from Paddle as merchant of record).
      if (gift && email && email !== deliveryEmail) {
        try {
          await sendEmail({
            to: email,
            subject: `🎁 Your gift is on its way to ${gift.to}`,
            html: `<p>Hi${finalCustomerName ? ' ' + finalCustomerName : ''},</p>
<p>Lovely gesture! We have delivered your gift to <strong>${gift.to}</strong> with the download links${gift.note ? ' and your note' : ''}.</p>
<p>Order #${String(order.id).slice(0, 8)} · $${Number(total).toFixed(2)} ${currency}. Your payment receipt arrives separately.</p>
<p>Happy making,<br/>Jolly · DigitalChiselCo</p>`,
            text: `Your gift was delivered to ${gift.to} with the download links${gift.note ? ' and your note' : ''}. Order #${String(order.id).slice(0, 8)}.`,
            idempotencyKey: `gift-sender:${order.id}`,
            tags: [{ name: 'kind', value: 'gift' }],
          });
        } catch (e) { console.error('[gift-order] sender note failed:', e); }
      }

      if (sendResult.ok && !sendResult.skipped) {
        console.log(`[email] Order ${order.id.slice(0, 8)} confirmation sent to ${email} (id=${sendResult.id})`);
        await db.from('orders').update({ confirmation_sent_at: new Date().toISOString() }).eq('id', order.id);
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

// ── Refunds & chargebacks (adjustment.created / adjustment.updated) ─────────
// Paddle models refunds as "adjustments" against a transaction. When one is
// APPROVED we revoke access:
//   • FULL refund   → orders.status = 'refunded' + delete the order's
//     entitlements. The account page only shows download links for status
//     'paid', so access disappears immediately; entitlement deletion also
//     stops the free-gift "already owns" logic counting refunded designs.
//   • PARTIAL refund → order stays 'paid' (revoking everything would punish
//     the items they kept); ops gets an email to adjust manually if needed.
// Requires `adjustment.created` + `adjustment.updated` to be ticked on the
// webhook's notification settings in the Paddle dashboard.
async function handleAdjustment(db: any, adj: any) {
  const action = String(adj?.action || '');
  const status = String(adj?.status || '');
  const txnId = adj?.transaction_id;
  if (!txnId) return;
  // Only money-back actions revoke access. Statuses: pending_approval →
  // approved / rejected. Card-initiated chargebacks arrive already approved.
  if (action !== 'refund' && action !== 'chargeback') {
    console.log(`[adjustment] ignoring action=${action} for ${txnId}`);
    return;
  }
  if (status !== 'approved') {
    console.log(`[adjustment] ${action} for ${txnId} is ${status} — waiting for approval event.`);
    return;
  }

  const { data: order } = await db.from('orders')
    .select('id, email, total, currency, status')
    .eq('paddle_transaction_id', txnId).maybeSingle();
  if (!order) { console.warn(`[adjustment] no order found for txn ${txnId}`); return; }
  if (order.status === 'refunded') { console.log(`[adjustment] order ${order.id} already refunded — skipping.`); return; }

  const refunded = Number(adj.totals?.total ?? 0) / 100;
  const isFull = refunded >= Number(order.total) - 0.01;
  const shortId = String(order.id).slice(0, 8);

  if (isFull) {
    await db.from('orders').update({ status: 'refunded', refunded_at: new Date().toISOString() }).eq('id', order.id);
    const { error: entErr } = await db.from('entitlements').delete().eq('order_id', order.id);
    if (entErr) throw new Error(`entitlement revoke failed for order ${order.id}: ${entErr.message}`);
    console.log(`[adjustment] FULL ${action} — order ${shortId} marked refunded, entitlements revoked ($${refunded}).`);
  } else {
    // Stamp refunded_at (order stays 'paid') so the post-refund win-back can
    // still reach partial refunders, then tell the BUYER what they keep.
    await db.from('orders').update({ refunded_at: new Date().toISOString() }).eq('id', order.id);
    console.log(`[adjustment] PARTIAL ${action} on order ${shortId} ($${refunded} of $${order.total}) — order left paid, ops notified.`);
    if (order.email && order.email !== 'unknown@digitalchiselco.com' && action === 'refund') {
      try {
        await sendEmail({
          to: order.email,
          subject: `Your refund of $${refunded.toFixed(2)} is on its way`,
          html: `<p>Hi fellow maker,</p>
<p>We have refunded <strong>$${refunded.toFixed(2)} ${order.currency}</strong> from your order <strong>#${shortId}</strong>. Depending on your bank it lands within 5 to 10 business days.</p>
<p>The rest of your order is untouched, your other designs stay in your account with unlimited re-downloads.</p>
<p>If anything else needs fixing, just reply to this email. A real person reads every message.</p>
<p>Jolly · DigitalChiselCo</p>`,
          text: `We have refunded $${refunded.toFixed(2)} ${order.currency} from your order #${shortId}. It lands within 5 to 10 business days. The rest of your order is untouched and stays in your account.`,
          idempotencyKey: `adjustment-buyer:${adj.id || txnId}`,
        });
      } catch (e) { console.error('[adjustment] buyer email failed:', e); }
    }
  }

  // Ops heads-up either way (best-effort).
  try {
    const kind = isFull ? 'Full' : 'Partial';
    await sendEmail({
      to: OPS_INBOX,
      subject: `${kind} ${action}: order ${shortId} ($${refunded.toFixed(2)} ${order.currency})`,
      html: `<p>${kind} <strong>${action}</strong> approved on order <strong>#${shortId}</strong> (${order.email}).</p>
<p>Amount: <strong>$${refunded.toFixed(2)} ${order.currency}</strong> of $${Number(order.total).toFixed(2)} paid · Paddle txn <code>${txnId}</code>.</p>
<p>${isFull ? 'Download access has been revoked automatically.' : 'Order left active (they keep the other items) — review in admin if a specific design should be pulled.'}</p>`,
      text: `${kind} ${action} on order ${shortId} (${order.email}): $${refunded.toFixed(2)} of $${Number(order.total).toFixed(2)}. ${isFull ? 'Access revoked.' : 'Order left active — review manually.'}`,
      idempotencyKey: `adjustment-ops:${adj.id || txnId}:${status}`,
    });
  } catch (e) { console.error('[adjustment] ops email failed:', e); }
}

// ── Failed payment recovery (transaction.payment_failed) ────────────────────
// One gentle nudge, scheduled +2h so an immediate successful retry makes it
// moot (the copy also says "ignore if you already finished"). Deduped to one
// per email per day via the Resend idempotency key. Requires ticking
// `transaction.payment_failed` on the webhook in the Paddle dashboard.
async function handlePaymentFailed(db: any, txn: any) {
  if (!txn?.id) return;

  // If this transaction already produced a paid order (retry succeeded before
  // the webhook reached us), never nudge.
  const { data: paid } = await db.from('orders').select('id').eq('paddle_transaction_id', txn.id).maybeSingle();
  if (paid) { console.log(`[payfail] txn ${txn.id} already paid — skipping.`); return; }

  let email = '';
  if (txn.customer_id) {
    try {
      const cust = await paddleApi<any>(`/customers/${txn.customer_id}`);
      email = (cust?.data?.email || '').toLowerCase().trim();
    } catch { /* fall through */ }
  }
  email = email || (txn.customer?.email || '').toLowerCase().trim();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { console.log(`[payfail] txn ${txn.id}: no usable email.`); return; }

  // Respect unsubscribes.
  const { data: sub } = await db.from('subscribers').select('unsubscribed_at').ilike('email', email).maybeSingle();
  if (sub?.unsubscribed_at) return;

  const items = (Array.isArray(txn.items) ? txn.items : []).map((it: any) => ({
    title: String(it.price?.name || it.price?.description || 'Design'),
    price: Number(it.price?.unit_price?.amount ?? 0) / 100,
  }));
  const { subject, html, text } = paymentRecoveryEmail({ email, items });
  const r = await sendEmail({
    to: email, subject, html, text,
    scheduledAt: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
    idempotencyKey: `payfail:${email}:${new Date().toISOString().slice(0, 10)}`,
    tags: [{ name: 'kind', value: 'payRecovery' }],
  });
  if (r.ok) console.log(`[payfail] recovery email scheduled (+2h) for ${email}, txn ${txn.id}`);
  else console.error(`[payfail] recovery email failed for ${email}: ${r.error}`);
}
