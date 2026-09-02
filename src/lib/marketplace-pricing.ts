// Cut Local pricing, in ONE place with no imports of its own.
//
// This lives apart from marketplace.ts deliberately. marketplace.ts imports the
// mailer, and the mailer imports the email templates, so a template that reads
// pricing from marketplace.ts creates an import cycle and the constants arrive
// undefined at module-evaluation time. Everything that only needs the numbers
// (email templates, the apply page, the maker FAQ) imports THIS file.
//
// These are the numbers customers are actually charged, so every page and email
// that quotes a price must read them from here rather than hard-coding one.

export const SUCCESS_FEE_PCT = 3;        // % of job value, billed on completion only
export const FOUNDING_CREDITS = 5;       // free credits granted on approval
export const FEE_INVOICE_MIN_USD = 5;    // invoice raised once fees due reach this
export const FEE_INVOICE_DAYS = 45;      // ...or after this long, whichever comes first
export const FEE_TERMS_DAYS = 14;        // days a maker has to pay an invoice

export const CREDIT_PACKS: Record<string, { credits: number; price: number; label: string }> = {
  starter: { credits: 10, price: 8, label: '10 credits' },
  pro: { credits: 30, price: 21, label: '30 credits' },
  bulk: { credits: 75, price: 45, label: '75 credits' },
};

/** Packs cheapest-first, for display. */
export const creditPacks = () => Object.values(CREDIT_PACKS).sort((a, b) => a.price - b.price);
/** Price of one quote for a pack, as "80c". */
export const perQuote = (p: { price: number; credits: number }) => `${Math.round((p.price / p.credits) * 100)}c`;
/** Cheapest and dearest per-quote price across all packs, e.g. ["60c", "80c"]. */
export function quotePriceRange(): [string, string] {
  const packs = creditPacks();
  const rates = packs.map((p) => p.price / p.credits);
  const lo = packs[rates.indexOf(Math.min(...rates))], hi = packs[rates.indexOf(Math.max(...rates))];
  return [perQuote(lo), perQuote(hi)];
}
/** "10 for $8, 30 for $21, 75 for $45" — one line for emails. */
export const packLine = () => creditPacks().map((p) => `${p.credits} for $${p.price}`).join(', ');
