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
