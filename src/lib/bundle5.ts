// "Pick any 5" bundle pricing — ONE continuous rule everywhere:
//
//     flat $25 while the five list prices sum to $40 or less;
//     above $40, each extra dollar of list value adds $0.70.
//
//     price = max($25, $25 + 0.70 × (sum − $40))
//
// Why this shape: it keeps the existing "any 5 for $25" promise EXACTLY
// intact for standard designs (five $7.99 picks sum to $39.95 → still $25),
// while premium designs smoothly raise the live price instead of being
// excluded. The discount can never exceed 37.5% (the current offer's own
// best case), so no combination is a giveaway: the five priciest designs
// ($142 list) now cost $96.40, where before this rule they went for $25.
//
// Used by: bundle-builder.astro (live price bar; formula mirrored in its
// inline script via define:vars), /api/checkout-init (the trusted price the
// buyer is actually charged), and the Paddle webhook (proportional split of
// the paid amount back onto the five order_items).
export const BUNDLE5_MIN = 25;          // the "from $25" anchor
export const BUNDLE5_VALUE_CAP = 40;    // flat $25 up to this combined value
export const BUNDLE5_OVERAGE = 0.70;    // pay 70% of list value above the cap

export function bundle5Price(prices: number[]): number {
  const sum = prices.reduce((s, p) => s + (Number(p) || 0), 0);
  return Math.max(BUNDLE5_MIN, Math.round((BUNDLE5_MIN + BUNDLE5_OVERAGE * (sum - BUNDLE5_VALUE_CAP)) * 100) / 100);
}

// Designs that may NEVER enter a Pick-5, under any pricing:
//  - customizable / made-to-order items (they create real labor per sale)
//  - memberships (a $25 membership inside a $25 bundle = free everything)
//  - gift cards, catalogues, and other bundles (deal is for singles)
// The builder's query, checkout-init's validation, and this predicate must
// stay in sync; checkout-init is the enforcement point.
export function bundle5Eligible(p: { active?: boolean; price_usd?: number | string; slug?: string; title?: string; is_customizable?: boolean }): boolean {
  return !!p.active && Number(p.price_usd) > 0 &&
    !p.is_customizable &&
    !String(p.slug || '').startsWith('gift-card-') &&
    !String(p.slug || '').startsWith('catalogue-') &&
    !/bundle|membership/i.test(String(p.title || '')) &&
    // Made-to-order work (real labor per sale) is never discounted. Some of
    // these are not flagged is_customizable, so match the title too.
    !/personalized|made.to.order|from your (picture|photo)/i.test(String(p.title || ''));
}
