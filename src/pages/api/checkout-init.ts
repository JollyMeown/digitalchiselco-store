// Creates a Paddle "transaction" from the cart and returns its transactionId,
// which the frontend feeds to Paddle.Checkout.open({ transactionId }) to launch
// the overlay.
//
// We use this server-side path (instead of inline non-catalog items in the
// browser) because:
//   1) It lets us look up each cart item's paddle_price_id in the DB rather
//      than trusting the browser-supplied price.
//   2) Membership items (id starts with 'membership:<slug>') resolve to their
//      Paddle price via membership_plans table.
//   3) For products that don't have a paddle_price_id yet, we fall back to
//      passing non-catalog items so checkout still works during the catalog
//      sync rollout.

import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../lib/supabase';
import { paddleApi } from '../../lib/paddle';
import { validateCoupon, getActiveShopSale } from '../../lib/discounts';
import { rateLimit, clientIp, tooMany } from '../../lib/rate-limit';

export const prerender = false;

type CartItem = { id: string; slug?: string; title?: string; price?: number; qty?: number };

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const cart: CartItem[] = Array.isArray(body.items) ? body.items : [];
    const email: string | undefined = body.email ? String(body.email).toLowerCase().trim() : undefined;
    // SECURITY: the discount is resolved entirely server-side (coupon lookup or
    // active shop sale). We NEVER trust a browser-supplied percentage — doing so
    // let a caller pass discount_percent:99 and check out at 1% of catalog price.
    let discountPercent = 0;
    const couponCode: string | undefined = body.coupon_code ? String(body.coupon_code).trim().toUpperCase() : undefined;
    // Per-line customization snapshots aligned with cart order:
    // customizations[i] = null OR [{key,label,type,value}, ...]
    const customizations: any[] = Array.isArray(body.customizations) ? body.customizations : [];

    // Multi-currency: charge in the buyer's selected currency when we hold a
    // fresh fx rate for it (rates refreshed daily by the growth cron into
    // site_settings.fx_rates). Anything else falls back to USD. All discount
    // math happens in USD; only the FINAL unit prices are converted.
    const SUPPORTED_CCY = ['EUR', 'GBP', 'CAD', 'AUD'];
    const reqCcy = String(body.currency || 'USD').toUpperCase();
    let chargeCcy = 'USD';
    let fxRate = 1;

    // Gift order: recipient email + optional sender name/note ride through
    // custom_data; the webhook delivers entitlements + downloads to them.
    let giftData: { to: string; from: string; note: string } | null = null;
    if (body.gift && typeof body.gift === 'object') {
      const to = String(body.gift.to || '').toLowerCase().trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return json({ error: "Please enter a valid email for the gift recipient." }, 400);
      giftData = { to, from: String(body.gift.from || '').trim().slice(0, 80), note: String(body.gift.note || '').trim().slice(0, 300) };
    }

    if (!cart.length) return json({ error: 'Cart is empty.' }, 400);

    // Each call creates a Paddle transaction (a paid third-party write), so cap
    // it per IP to stop automated abuse of that endpoint.
    if (!(await rateLimit(`checkout:ip:${clientIp(request)}`, 30, 600))) {
      return tooMany('Too many checkout attempts. Please wait a minute and try again.');
    }

    const db = supabaseAdmin();

    // Split cart into product ids vs membership slugs vs Pick-5 bundle markers
    const productIds = cart
      .filter((c) => !String(c.id).startsWith('membership:') && !String(c.id).startsWith('bundle5:'))
      .map((c) => c.id);
    const membershipSlugs = cart
      .filter((c) => String(c.id).startsWith('membership:'))
      .map((c) => String(c.id).slice('membership:'.length));

    // Look up Paddle IDs + REAL prices from DB (before coupon validation, so
    // min_subtotal / min_items gates run on DB prices, never browser-claimed ones).
    const [{ data: products }, { data: plans }] = await Promise.all([
      productIds.length
        ? db.from('products').select('id, title, slug, price_usd, paddle_price_id').in('id', productIds)
        : { data: [] as any[] },
      membershipSlugs.length
        ? db.from('membership_plans').select('slug, name, price_usd, paddle_price_id').in('slug', membershipSlugs)
        : { data: [] as any[] },
    ] as any);
    const dbPriceById = new Map<string, number>((products || []).map((p: any) => [String(p.id), Number(p.price_usd)]));

    // Resolve the fx rate for the requested currency — only trust a rate the
    // cron refreshed within the last 7 days; otherwise charge USD as always.
    if (SUPPORTED_CCY.includes(reqCcy)) {
      try {
        const { data: stFx } = await db.from('site_settings').select('fx_rates').eq('id', 1).maybeSingle();
        const rates: any = stFx?.fx_rates || {};
        const r = Number(rates[reqCcy]);
        const updated = Date.parse(rates.updated_at || '') || 0;
        if (r > 0 && Date.now() - updated < 7 * 86400000) { chargeCcy = reqCcy; fxRate = r; }
      } catch { /* stay USD */ }
    }

    // Server-side discount resolution. Priority:
    //   1) Promo code (customer-entered)   — server-validated, may set fixed-$ or percent
    //   2) Auto shop sale (Etsy-style)     — applies when no code is used
    let couponMeta: { id: string; code: string; amount: number; percent: number | null } | null = null;
    let fixedDiscount = 0;
    if (couponCode) {
      const validation = await validateCoupon(
        couponCode,
        // Membership + Pick-5 bundle lines never count toward a promo code —
        // the bundle is already a deep flat-price deal. Prices come from the DB
        // (unknown ids price as 0), so browser-inflated prices can't pass a
        // coupon's spend-minimum gate.
        cart.filter((c) => !String(c.id).startsWith('membership:') && !String(c.id).startsWith('bundle5:')).map((c) => ({ id: c.id, price: dbPriceById.get(String(c.id)) ?? 0, qty: Number(c.qty) || 1 })),
        email ?? null,
      );
      if (!validation.ok) return json({ error: validation.error }, 400);
      // Referral codes (REF-XXXX) are real 15% coupons, but you can't redeem
      // your OWN share code — the friend must be someone else.
      if (validation.code.startsWith('REF-') && email) {
        const { data: rc } = await db.from('referral_codes').select('email').eq('code', validation.code).maybeSingle();
        if (rc && String(rc.email).toLowerCase() === email) {
          return json({ error: "That's your own referral code — share it with a friend instead. They get 15% off, and you earn a reward when they order." }, 400);
        }
      }
      const { data: row } = await db.from('coupons').select('id').eq('code', validation.code).maybeSingle();
      if (row) {
        couponMeta = { id: row.id, code: validation.code, amount: validation.discount_amount, percent: validation.percent_off };
        if (validation.percent_off) discountPercent = validation.percent_off;
        else if (validation.fixed_amount_off) fixedDiscount = validation.fixed_amount_off;
      }
    } else {
      const sale = await getActiveShopSale();
      if (sale) discountPercent = sale.percent_off;
      // Member perk: buyers with an ACTIVE membership get 10% off products —
      // best-of against a running sale, never stacked on a coupon (coupon branch
      // above returns its own discount). Server-side only: the email is verified
      // by Paddle at payment, so nobody gains by typing a member email they
      // don't control (the receipt + downloads go to that inbox).
      if (email) {
        const { data: mem } = await db.from('member_subscriptions')
          .select('id').eq('email', email).eq('status', 'active').limit(1);
        if (mem?.length && discountPercent < 10) discountPercent = 10;
      }
    }

    // Build the items array Paddle expects.
    // When a discount applies (percent or fixed), we force ad-hoc lines so the
    // discounted prices reach Paddle directly (Paddle's catalog price would
    // otherwise override). Membership prices are NEVER discounted by promo codes.
    const hasDiscount = discountPercent > 0 || fixedDiscount > 0;

    // Pre-compute the product subtotal so we can pro-rate fixed-$ discounts
    const productSubtotal = cart.reduce((s, c) => {
      if (String(c.id).startsWith('membership:')) return s;
      const p = (products || []).find((x: any) => x.id === c.id);
      if (!p) return s;
      return s + Number(p.price_usd) * Math.max(1, Number(c.qty) || 1);
    }, 0);

    // Fixed-$ code worth MORE than the cart (typically a gift card): apply only
    // up to (subtotal − $0.50) so the Paddle transaction always has a real,
    // chargeable total — a $0 one-time transaction is unsupported territory.
    // The unapplied remainder is NOT forfeited: for GIFT- codes it rides along
    // in custom_data and the webhook mints a fresh GIFT- code for the balance
    // and emails it to the buyer after payment.
    let giftRemainder = 0;
    if (fixedDiscount > 0 && productSubtotal > 0) {
      const maxApplicable = Math.max(0, +(productSubtotal - 0.5).toFixed(2));
      if (fixedDiscount > maxApplicable) {
        giftRemainder = +(fixedDiscount - maxApplicable).toFixed(2);
        fixedDiscount = maxApplicable;
      }
    }
    const remainderEligible = giftRemainder >= 0.01 && !!couponMeta?.code?.startsWith('GIFT-');

    const items: any[] = [];
    // These two arrays are built in LOCKSTEP with `items` (one entry per line
    // actually sent to Paddle). The webhook correlates Paddle's items back to
    // our products positionally via custom_data — building these from the raw
    // cart instead would shift every index after a skipped line (unknown
    // product/plan) and could fulfil the wrong design.
    const sentIds: string[] = [];
    const sentCustomizations: any[] = [];
    for (let ci = 0; ci < cart.length; ci++) {
      const c = cart[ci];
      const qty = Math.max(1, Number(c.qty) || 1);
      if (String(c.id).startsWith('bundle5:')) {
        // "Pick any 5 for $25" — the flat price is enforced HERE, never taken
        // from the browser. Validate: exactly 5 distinct eligible product ids.
        const ids = String(c.id).slice('bundle5:'.length).split(',').map((s) => s.trim()).filter(Boolean);
        const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (new Set(ids).size !== 5 || ids.length !== 5 || !ids.every((id) => uuidRe.test(id))) {
          return json({ error: 'The Pick-5 bundle must contain exactly 5 different designs.' }, 400);
        }
        const { data: bps } = await db.from('products')
          .select('id, slug, title, active, price_usd').in('id', ids);
        const eligible = (bps || []).filter((p: any) =>
          p.active && Number(p.price_usd) > 0 &&
          !String(p.slug || '').startsWith('gift-card-') &&
          !String(p.slug || '').startsWith('catalogue-') &&
          !/bundle/i.test(String(p.title || '')));
        if (eligible.length !== 5) {
          return json({ error: 'One of the designs in your Pick-5 bundle is no longer available — please rebuild it.' }, 400);
        }
        // Flat $25 — no sale/coupon/member discount ever stacks on top.
        items.push(adhocItem('Pick-5 Bundle — 5 Premium STL Designs', 25, 1));
        sentIds.push(String(c.id)); sentCustomizations.push(customizations[ci] ?? null);
        continue;
      }
      if (String(c.id).startsWith('membership:')) {
        const slug = String(c.id).slice('membership:'.length);
        const plan = (plans || []).find((p: any) => p.slug === slug);
        if (!plan) continue;
        // Catalog price_ids are USD — a Paddle transaction is single-currency,
        // so when charging in another currency memberships go ad-hoc too.
        if (plan.paddle_price_id && chargeCcy === 'USD') {
          items.push({ price_id: plan.paddle_price_id, quantity: qty });
        } else {
          items.push(adhocItem(plan.name, Number(plan.price_usd), qty));
        }
        sentIds.push(String(c.id)); sentCustomizations.push(customizations[ci] ?? null);
      } else {
        const p = (products || []).find((x: any) => x.id === c.id);
        if (!p) continue;
        let unit = Number(p.price_usd);
        // Gift cards are never discounted: a discounted card would still mint a
        // coupon for its full face value (guaranteed loss).
        const isGiftCard = String(p.slug || '').startsWith('gift-card-');
        if (discountPercent && !isGiftCard) unit = applyDiscount(unit, discountPercent);
        if (fixedDiscount && productSubtotal > 0 && !isGiftCard) {
          // Pro-rate the fixed discount across product lines
          const share = (unit * qty / productSubtotal) * fixedDiscount;
          unit = Math.max(0, +(unit - share / qty).toFixed(2));
        }
        // Always send the storefront price as an ad-hoc line so products.price_usd
        // is the single source of truth. Using the Paddle catalog price_id would
        // let a stale synced price (e.g. after a website price change) override the
        // current website price. Paddle still taxes + receipts ad-hoc items; the
        // webhook resolves the product via custom_data.cart_ids / title match.
        items.push(adhocItem(p.title, unit, qty));
        sentIds.push(String(c.id)); sentCustomizations.push(customizations[ci] ?? null);
      }
    }
    if (!items.length) return json({ error: 'No valid items in cart.' }, 400);

    // All discount math above ran in USD. Record the USD subtotal, then (for a
    // non-USD charge) convert each ad-hoc unit price to the charge currency.
    let usdSubtotal = 0;
    for (const it of items) {
      if (it.price?.unit_price) {
        const usdCents = Number(it.price.unit_price.amount) || 0;
        usdSubtotal += (usdCents / 100) * (Number(it.quantity) || 1);
        if (chargeCcy !== 'USD') {
          it.price.unit_price.amount = String(Math.round(usdCents * fxRate));
          it.price.unit_price.currency_code = chargeCcy;
        }
      }
    }
    usdSubtotal = +usdSubtotal.toFixed(2);

    // Create the transaction in Paddle
    const txn = await paddleApi<any>('/transactions', {
      method: 'POST',
      body: {
        items,
        ...(email ? { customer: { email } } : {}),
        // Embed our own identifiers so the webhook handler can correlate easily
        custom_data: {
          source: 'digitalchiselco-cart',
          cart_ids: sentIds,
          ...(couponMeta ? { coupon_id: couponMeta.id, coupon_code: couponMeta.code, coupon_discount: couponMeta.amount } : {}),
          ...(remainderEligible ? { gift_remainder: giftRemainder } : {}),
          ...(chargeCcy !== 'USD' ? { fx: { currency: chargeCcy, rate: fxRate, usd_subtotal: usdSubtotal } } : {}),
          ...(giftData ? { gift: { to: giftData.to, from: giftData.from, note: giftData.note } } : {}),
          // Per-line customization snapshots, aligned 1:1 with cart_ids (and
          // therefore with the Paddle items array). null = no fields.
          ...(sentCustomizations.some((c) => Array.isArray(c) && c.length) ? { customizations: sentCustomizations } : {}),
        },
      },
    });

    // NOTE: coupon redemption is NOT stamped here. It is recorded in the Paddle
    // webhook (transaction.completed) AFTER payment succeeds — otherwise anyone
    // could loop this unauthenticated endpoint to exhaust a coupon's
    // max_redemptions and disable the promo without ever paying.

    // SECURITY: server-side snapshot of exactly what this transaction sells.
    // The webhook fulfils from THIS row, never from txn.custom_data (which a
    // page-context script can forge via Paddle.js on our own approved domain).
    // If the insert fails, checkout still proceeds — the webhook then falls
    // back to catalog price_id matching only and flags the order for review.
    if (txn.data?.id) {
      try {
        await db.from('pending_checkouts').insert({
          txn_id: txn.data.id,
          email: email || null,
          cart_ids: sentIds,
          customizations: sentCustomizations.some((c) => Array.isArray(c) && c.length) ? sentCustomizations : null,
          coupon_id: couponMeta?.id || null,
          coupon_code: couponMeta?.code || null,
          coupon_discount: couponMeta?.amount ?? null,
          gift_remainder: remainderEligible ? giftRemainder : null,
          gift: giftData || null,
          fx: chargeCcy !== 'USD' ? { currency: chargeCcy, rate: fxRate, usd_subtotal: usdSubtotal } : null,
          expected_total_usd: usdSubtotal,
        });
      } catch (e) { console.error('[checkout-init] pending_checkouts insert failed (webhook will use safe fallback):', e); }
    }

    // Funnel truth-meter: a Paddle transaction now exists. Server-side (can't
    // be ad-blocked), so checkout_start → txn_created → paid orders shows
    // exactly where buyers drop inside the payment frame.
    try { await db.from('site_events').insert({ type: 'txn_created', path: '/cart' }); } catch { /* analytics never blocks checkout */ }

    return json({ transaction_id: txn.data?.id, status: txn.data?.status, discount_amount: couponMeta?.amount || 0, currency: chargeCcy });
  } catch (e: any) {
    console.error('checkout-init failed:', e);
    return json({ error: e.message || 'Checkout could not start.' }, 500);
  }
};

function applyDiscount(price: number, percent: number): number {
  if (!percent || percent <= 0 || percent >= 100) return price;
  return Math.max(0, +(price * (100 - percent) / 100).toFixed(2));
}

// Non-catalog item — Paddle accepts this in /transactions when the price is
// declared inline. We use USD across the board.
function adhocItem(name: string, priceUsd: number, qty: number) {
  return {
    quantity: qty,
    price: {
      description: 'Instant digital download — commercial use included',
      name: name.slice(0, 200),
      product: {
        name: name.slice(0, 200),
        tax_category: 'standard',
      },
      unit_price: {
        amount: String(Math.round(priceUsd * 100)),
        currency_code: 'USD',
      },
    },
  };
}
