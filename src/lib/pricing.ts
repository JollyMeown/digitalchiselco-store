// Etsy listings run at ~20% off. Store the selling price; derive the "original" for the
// strikethrough. (Adjustable later from admin settings.)
export const DISCOUNT_PERCENT = 20;

export function pricing(price: number | string) {
  const p = Number(price) || 0;
  const original = Math.round((p / (1 - DISCOUNT_PERCENT / 100)) * 100) / 100;
  return { price: p, original, percent: DISCOUNT_PERCENT };
}

export const money = (n: number) => `$${n.toFixed(2)}`;
