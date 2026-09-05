// Shared discount math. Used by /api/coupons/validate, /api/checkout-init,
// and the cart UI (which only needs validate's response).
import { supabaseAdmin } from './supabase';

export type CartLine = { id: string; price: number; qty: number; title?: string };

export type ValidationOk = {
  ok: true;
  code: string;
  description: string | null;
  discount_amount: number;
  percent_off: number | null;
  fixed_amount_off: number | null;
  subtotal: number;
  total: number;
  /** Cart line ids the discount applies to (scoped coupons); null = every line. */
  eligible_ids: string[] | null;
};
export type ValidationErr = { ok: false; error: string };
export type Validation = ValidationOk | ValidationErr;

// Pick the deepest active sale (if any) — applies to every line.
export async function getActiveShopSale(): Promise<{ name: string; percent_off: number } | null> {
  try {
    const db = supabaseAdmin();
    const now = new Date().toISOString();
    const { data } = await db
      .from('sales')
      .select('name,percent_off')
      .eq('active', true)
      .eq('scope', 'all')
      .lte('starts_at', now)
      .gte('expires_at', now)
      .order('percent_off', { ascending: false })
      .limit(1);
    return data?.[0] ?? null;
  } catch { return null; }
}

export async function validateCoupon(rawCode: string, cart: CartLine[], email: string | null): Promise<Validation> {
  const code = rawCode.trim().toUpperCase();
  if (!code) return { ok: false, error: 'Enter a code.' };
  if (!cart.length) return { ok: false, error: 'Cart is empty.' };

  const db = supabaseAdmin();
  const { data: coupon, error } = await db.from('coupons').select('*').eq('code', code).maybeSingle();
  if (error || !coupon) return { ok: false, error: 'Code not recognised.' };
  if (!coupon.active) return { ok: false, error: 'This code is no longer active.' };

  const now = Date.now();
  if (coupon.starts_at && Date.parse(coupon.starts_at) > now) return { ok: false, error: 'This code is not active yet.' };
  if (coupon.expires_at && Date.parse(coupon.expires_at) < now) return { ok: false, error: 'This code has expired.' };
  if (coupon.max_redemptions && coupon.redemption_count >= coupon.max_redemptions) return { ok: false, error: 'This code has reached its redemption limit.' };

  // ADDON is the post-purchase one-click offer on the success page. Its code is
  // visible in that page's source, so gate it server-side: only honoured for an
  // email that placed a real order in the last 48 hours. The cart promo box
  // sends no email, so casual typing of "ADDON" is rejected outright.
  if (code === 'ADDON') {
    const gateErr = { ok: false as const, error: 'This code is only available right after a purchase.' };
    if (!email) return gateErr;
    const recentCutoff = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    const { data: recent } = await db.from('orders').select('id')
      .eq('email', email.toLowerCase()).eq('status', 'paid').gte('created_at', recentCutoff).limit(1);
    if (!recent?.length) return gateErr;
    // Scope: the one-click add-on is exactly ONE design, not already owned.
    // Without this the visible code was a 25%-off-everything coupon for 48h.
    if (cart.length !== 1 || (Number(cart[0].qty) || 1) !== 1) return { ok: false, error: 'This code covers a single add-on design only.' };
    const { data: owned } = await db.from('entitlements').select('product_id').eq('email', email.toLowerCase()).eq('product_id', cart[0].id).limit(1);
    if (owned?.length) return { ok: false, error: 'You already own this design.' };
  }

  // ── Memberships never take a code (owner rule 2026-09-06) ───────────────
  // Plan lines ("membership:<slug>") and membership PRODUCTS (is_subscription /
  // membership_plan_slug) are dropped before scope, minimum and amount checks,
  // so a code can neither discount them nor be unlocked by their price.
  {
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const ids = cart.map((l) => String(l.id)).filter((id) => uuidRe.test(id));
    const memberIds = new Set<string>();
    if (ids.length) {
      const { data: mp } = await db.from('products').select('id').in('id', ids).or('is_subscription.eq.true,membership_plan_slug.not.is.null');
      for (const r of mp || []) memberIds.add(String(r.id));
    }
    cart = cart.filter((l) => !String(l.id).startsWith('membership:') && !memberIds.has(String(l.id)));
    if (!cart.length) return { ok: false, error: 'Promo codes do not apply to memberships. The membership is already the best price we offer.' };
  }

  // ── Scope filtering ────────────────────────────────────────────────────
  // If the coupon is scoped to specific categories/products, restrict the
  // cart lines to ones inside that scope BEFORE checking min_items / min_total.
  let eligible: CartLine[] = cart;
  if (coupon.scope && coupon.scope !== 'all' && Array.isArray(coupon.scope_ids) && coupon.scope_ids.length > 0) {
    const ids: string[] = coupon.scope_ids;
    if (coupon.scope === 'product') {
      const set = new Set(ids);
      eligible = cart.filter((l) => set.has(l.id));
    } else if (coupon.scope === 'category') {
      const productIds = cart.map((l) => l.id);
      const { data: pc } = await db.from('product_categories')
        .select('product_id,category_id').in('product_id', productIds);
      const catSet = new Set(ids);
      const productCats: Record<string, string[]> = {};
      (pc ?? []).forEach((row: any) => {
        (productCats[row.product_id] ||= []).push(row.category_id);
      });
      eligible = cart.filter((l) => (productCats[l.id] || []).some((c) => catSet.has(c)));
    }
    if (eligible.length === 0) {
      return { ok: false, error: 'This code doesn\'t apply to the products in your cart.' };
    }
  }

  const items = eligible.reduce((n, l) => n + (Number(l.qty) || 1), 0);
  const subtotal = eligible.reduce((s, l) => s + (Number(l.price) || 0) * (Number(l.qty) || 1), 0);

  if (coupon.min_items && items < coupon.min_items) return { ok: false, error: `Add ${coupon.min_items - items} more item${coupon.min_items - items === 1 ? '' : 's'} to use this code (needs ${coupon.min_items}+).` };
  if (coupon.min_subtotal && subtotal < Number(coupon.min_subtotal)) return { ok: false, error: `Spend $${(Number(coupon.min_subtotal) - subtotal).toFixed(2)} more to use this code (minimum $${coupon.min_subtotal}).` };

  if (coupon.single_use_per_buyer && !email) return { ok: false, error: 'Please enter your email to use this code.' };
  if (coupon.single_use_per_buyer && email) {
    const { data: prev } = await db.from('coupon_redemptions').select('id').eq('coupon_id', coupon.id).eq('email', email.toLowerCase()).limit(1);
    if (prev && prev.length) return { ok: false, error: 'You have already used this code.' };
  }

  let discount = 0;
  if (coupon.percent_off) discount = subtotal * (coupon.percent_off / 100);
  else if (coupon.fixed_amount_off) discount = Math.min(subtotal, Number(coupon.fixed_amount_off));
  discount = Math.round(discount * 100) / 100;

  return {
    ok: true,
    code: coupon.code,
    description: coupon.description,
    discount_amount: discount,
    percent_off: coupon.percent_off ?? null,
    fixed_amount_off: coupon.fixed_amount_off ?? null,
    subtotal: Math.round(subtotal * 100) / 100,
    total: Math.max(0, Math.round((subtotal - discount) * 100) / 100),
    eligible_ids: eligible === cart ? null : eligible.map((l) => l.id),
  };
}
