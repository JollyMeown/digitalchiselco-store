// ONE place that turns a membership plan row into every number the site,
// the emails and the admin quote about it. Owner rule (2026-09-06): change a
// plan's price in Admin > Membership and every page and email must follow.
// Nothing outside this file may hard-code a membership price, file count,
// retail value or "% off".
export type PlanLike = {
  slug?: string; name?: string; months: number; files_per_month?: number | null;
  price_usd: number | string; original_price_usd?: number | string | null; features?: string[] | null; highlight?: boolean | null;
};

/** Retail value of one design when the plan row carries no original_price_usd. */
export const RETAIL_PER_DESIGN = 8;

export function planFacts(p: PlanLike) {
  const months = Math.max(1, Number(p.months) || 1);
  const files = Math.max(1, Number(p.files_per_month) || 8);
  const price = Number(p.price_usd) || 0;
  const totalFiles = months * files;
  const retail = Number(p.original_price_usd) > 0 ? Number(p.original_price_usd) : totalFiles * RETAIL_PER_DESIGN;
  const perMonth = price / months;
  const perFile = price / totalFiles;
  const pctOff = retail > 0 ? Math.round((1 - price / retail) * 100) : 0;
  const money = (n: number) => (Number.isInteger(+n.toFixed(2)) ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`);
  return {
    months, files, price, totalFiles, retail, perMonth, perFile, pctOff,
    priceLabel: money(price), retailLabel: money(retail), perMonthLabel: money(perMonth), perFileLabel: `$${perFile.toFixed(2)}`,
    retailPerMonthLabel: money(retail / months),
    monthsLabel: `${months} month${months === 1 ? '' : 's'}`,
  };
}

/** Feature lines that carry numbers are generated, never stored, so they can never go stale. */
export function autoFeatureLines(p: PlanLike): string[] {
  const f = planFacts(p);
  return [
    `${f.files} fresh bas-relief STL designs every month`,
    `${f.totalFiles} designs over ${f.monthsLabel}, ${f.perFileLabel} each`,
    `About ${f.retailLabel} retail value, ${f.pctOff}% off`,
  ];
}
/** A stored feature line that quotes a number the plan already knows (price, file count, retail value, % off). */
export function isNumericFeature(line: string): boolean {
  // a digit plus a price/count/value word = a line the plan row already knows;
  // "10% member discount" and "2 extra bonus designs" carry no such word and stay
  return /\d/.test(line) && /\$|\bfresh\b|\btotal\b|\bover \d|\bretail\b|%\s*off|\bper month\b|\/mo\b|\bper file\b|\beach\b|\bin a year\b/i.test(line);
}
/** Stored, human feature lines (numeric ones replaced by the generated set). */
export function planFeatureLines(p: PlanLike): string[] {
  const kept = (p.features || []).filter((l) => l && !isNumericFeature(l));
  return [...autoFeatureLines(p), ...kept];
}

/** Replace {price} {months} {files} {total_files} {retail} {pct_off} {per_month} {per_file} {name} in owner-written copy. */
export function fillPlanTokens(text: string, p: PlanLike | null | undefined): string {
  if (!text) return text;
  if (!p) return text.replace(/\{[a-z_]+\}/g, '');
  const f = planFacts(p);
  const map: Record<string, string> = {
    price: f.priceLabel, months: String(f.months), files: String(f.files), total_files: String(f.totalFiles),
    retail: f.retailLabel, pct_off: `${f.pctOff}%`, per_month: f.perMonthLabel, per_file: f.perFileLabel, name: p.name || 'membership',
  };
  return text.replace(/\{([a-z_]+)\}/g, (m, k) => (k in map ? map[k] : m));
}
