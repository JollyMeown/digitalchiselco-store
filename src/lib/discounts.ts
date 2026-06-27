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

  const items = cart.reduce((n, l) => n + (Number(l.qty) || 1), 0);
  const subtotal = cart.reduce((s, l) => s + (Number(l.price) || 0) * (Number(l.qty) || 1), 0);

  if (coupon.min_items && items < coupon.min_items) return { ok: false, error: `Add ${coupon.min_items - items} more item${coupon.min_items - items === 1 ? '' : 's'} to use this code (needs ${coupon.min_items}+).` };
  if (coupon.min_subtotal && subtotal < Number(coupon.min_subtotal)) return { ok: false, error: `Spend $${(Number(coupon.min_subtotal) - subtotal).toFixed(2)} more to use this code (minimum $${coupon.min_subtotal}).` };

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
  };
}
