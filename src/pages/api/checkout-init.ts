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

    if (!cart.length) return json({ error: 'Cart is empty.' }, 400);

    // Each call creates a Paddle transaction (a paid third-party write), so cap
    // it per IP to stop automated abuse of that endpoint.
    if (!(await rateLimit(`checkout:ip:${clientIp(request)}`, 30, 600))) {
      return tooMany('Too many checkout attempts. Please wait a minute and try again.');
    }

    const db = supabaseAdmin();

    // Server-side discount resolution. Priority:
    //   1) Promo code (customer-entered)   — server-validated, may set fixed-$ or percent
    //   2) Auto shop sale (Etsy-style)     — applies when no code is used
    let couponMeta: { id: string; code: string; amount: number; percent: number | null } | null = null;
    let fixedDiscount = 0;
    if (couponCode) {
      const validation = await validateCoupon(
        couponCode,
        cart.filter((c) => !String(c.id).startsWith('membership:')).map((c) => ({ id: c.id, price: Number(c.price) || 0, qty: Number(c.qty) || 1 })),
        email ?? null,
      );
      if (!validation.ok) return json({ error: validation.error }, 400);
      const { data: row } = await db.from('coupons').select('id').eq('code', validation.code).maybeSingle();
      if (row) {
        couponMeta = { id: row.id, code: validation.code, amount: validation.discount_amount, percent: validation.percent_off };
        if (validation.percent_off) discountPercent = validation.percent_off;
        else if (validation.fixed_amount_off) fixedDiscount = validation.fixed_amount_off;
      }
    } else {
      const sale = await getActiveShopSale();
      if (sale) discountPercent = sale.percent_off;
    }

    // Split cart into product ids vs membership slugs
    const productIds = cart.filter((c) => !String(c.id).startsWith('membership:')).map((c) => c.id);
    const membershipSlugs = cart
      .filter((c) => String(c.id).startsWith('membership:'))
      .map((c) => String(c.id).slice('membership:'.length));

    // Look up Paddle IDs from DB
    const [{ data: products }, { data: plans }] = await Promise.all([
      productIds.length
        ? db.from('products').select('id, title, slug, price_usd, paddle_price_id').in('id', productIds)
        : { data: [] as any[] },
      membershipSlugs.length
        ? db.from('membership_plans').select('slug, name, price_usd, paddle_price_id').in('slug', membershipSlugs)
        : { data: [] as any[] },
    ] as any);

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

    const items: any[] = [];
    for (const c of cart) {
      const qty = Math.max(1, Number(c.qty) || 1);
      if (String(c.id).startsWith('membership:')) {
        const slug = String(c.id).slice('membership:'.length);
        const plan = (plans || []).find((p: any) => p.slug === slug);
        if (!plan) continue;
        if (plan.paddle_price_id) {
          items.push({ price_id: plan.paddle_price_id, quantity: qty });
        } else {
          items.push(adhocItem(plan.name, Number(plan.price_usd), qty));
        }
      } else {
        const p = (products || []).find((x: any) => x.id === c.id);
        if (!p) continue;
        let unit = Number(p.price_usd);
        if (discountPercent) unit = applyDiscount(unit, discountPercent);
        if (fixedDiscount && productSubtotal > 0) {
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
      }
    }
    if (!items.length) return json({ error: 'No valid items in cart.' }, 400);

    // Create the transaction in Paddle
    const txn = await paddleApi<any>('/transactions', {
      method: 'POST',
      body: {
        items,
        ...(email ? { customer: { email } } : {}),
        // Embed our own identifiers so the webhook handler can correlate easily
        custom_data: {
          source: 'digitalchiselco-cart',
          cart_ids: cart.map((c) => c.id),
          ...(couponMeta ? { coupon_id: couponMeta.id, coupon_code: couponMeta.code, coupon_discount: couponMeta.amount } : {}),
          // Pass per-line customization snapshots so the webhook can persist
          // them into order_item_customizations once the order is created.
          // Indices align with cart_ids; null means "no fields configured".
          ...(customizations.some((c) => Array.isArray(c) && c.length) ? { customizations } : {}),
        },
      },
    });

    // NOTE: coupon redemption is NOT stamped here. It is recorded in the Paddle
    // webhook (transaction.completed) AFTER payment succeeds — otherwise anyone
    // could loop this unauthenticated endpoint to exhaust a coupon's
    // max_redemptions and disable the promo without ever paying. The coupon_id
    // is carried through in custom_data (above) so the webhook can stamp it.

    return json({ transaction_id: txn.data?.id, status: txn.data?.status, discount_amount: couponMeta?.amount || 0 });
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
