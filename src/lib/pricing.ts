// Etsy listings run at ~20% off. Store the selling price; derive the "original" for the
// strikethrough. Admin can edit site_settings.discount_percent — pages that have already
// fetched settings should pass that in; otherwise we fall back to 20.
export const DEFAULT_DISCOUNT = 20;

export function pricing(price: number | string, discountPercent: number = DEFAULT_DISCOUNT) {
  const p = Number(price) || 0;
  const d = Math.max(0, Math.min(90, Number(discountPercent) || 0));
  const original = d > 0 ? Math.round((p / (1 - d / 100)) * 100) / 100 : p;
  return { price: p, original, percent: d };
}

export const money = (n: number) => `$${n.toFixed(2)}`;

/** Memberships are never discounted (owner rule), so they never get the
 *  site-wide "was" price either: pass the result as the discount. Found
 *  2026-10-01: the 3-month membership showed "$24.99, was $27.77, 10% off" on
 *  cards, its product page and in the shopping feeds. */
export const saleDiscountFor = (p: { membership_plan_slug?: string | null } | null | undefined, discount: number | undefined) =>
  p?.membership_plan_slug ? 0 : discount;
