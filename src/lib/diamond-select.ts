// Diamond Select: the credit rules in one place (2026-09-26, replaces the
// All-Access pass).
//
// A member holds a 12-month term of the 'diamond-select' plan. Credits:
//   * 10 on the start date, 10 more on the same day each following month,
//     up to 12 x 10 = 120 for the term (DIAMOND_CREDITS_PER_MONTH x months);
//   * unused credits roll over, and can still be used for DIAMOND_GRACE_DAYS
//     after the term ends;
//   * 1 credit = 1 single design (passCovers): no bundles or sets, memberships,
//     software, gift cards or made-to-order items.
// A used credit is an entitlement with source 'diamond-select', so the design
// sits in the account like a purchase, forever. Credits are counted, never
// stored: earned (from the dates) minus entitlements taken in this term.
// The term itself is an ordinary membership row (lib/subscriptions.ts) that
// sends no curated monthly pack.
// Offered publicly only once the plan's available_from date has arrived: the
// owner tests it first at /membership?preview=1.
import { supabaseAdmin } from './supabase';
import { addMonths, addDays, todayYMD } from './subscriptions';
import { DIAMOND_SLUG, DIAMOND_CREDITS_PER_MONTH, DIAMOND_GRACE_DAYS, DIAMOND_EXTRA_DISCOUNT } from './membership-facts';
export { DIAMOND_SLUG, DIAMOND_CREDITS_PER_MONTH, DIAMOND_GRACE_DAYS, DIAMOND_EXTRA_DISCOUNT };

type DB = ReturnType<typeof supabaseAdmin>;
export type DiamondTerm = { id: string; start_date: string; end_date: string; months: number; status: string; inGrace: boolean };
export type Credits = { earned: number; used: number; left: number; total: number; nextDate: string | null; lastDay: string };

/** Is Diamond Select on sale yet (plan active and its launch date reached)? */
export async function diamondOffered(db: DB): Promise<boolean> {
  const { data } = await db.from('membership_plans').select('active, available_from').eq('slug', DIAMOND_SLUG).maybeSingle();
  return !!data?.active && (!data.available_from || String(data.available_from) <= todayYMD());
}

/** The member's usable term: the running one, else one that ended within the grace days. */
export async function activeDiamond(db: DB, email: string): Promise<DiamondTerm | null> {
  const today = todayYMD();
  const { data } = await db.from('member_subscriptions')
    .select('id, start_date, end_date, months, status')
    .ilike('email', email).eq('plan_slug', DIAMOND_SLUG).in('status', ['active', 'expired'])
    .lte('start_date', today).gte('end_date', addDays(today, -DIAMOND_GRACE_DAYS))
    .order('start_date', { ascending: false }).limit(3);
  const rows = (data || []) as any[];
  const t = rows.find((r) => r.end_date >= today) || rows[0];
  return t ? { id: t.id, start_date: t.start_date, end_date: t.end_date, months: Number(t.months) || 12, status: t.status, inGrace: t.end_date < today } : null;
}

/** Month-days of the term that have arrived (1 on the start date, up to months). */
export function monthsStarted(term: { start_date: string; months: number }, today = todayYMD()): number {
  let n = 0;
  while (n < term.months && addMonths(term.start_date, n) <= today) n++;
  return n;
}

export async function creditsFor(db: DB, term: DiamondTerm, email: string, today = todayYMD()): Promise<Credits> {
  const started = monthsStarted(term, today);
  const earned = started * DIAMOND_CREDITS_PER_MONTH;
  const { count } = await db.from('entitlements').select('id', { count: 'exact', head: true })
    .ilike('email', email).eq('source', DIAMOND_SLUG).gte('granted_at', term.start_date);
  const used = count || 0;
  return {
    earned, used, left: Math.max(0, earned - used), total: term.months * DIAMOND_CREDITS_PER_MONTH,
    nextDate: started < term.months ? addMonths(term.start_date, started) : null,
    lastDay: addDays(term.end_date, DIAMOND_GRACE_DAYS),
  };
}

/** A design a credit can take: an active single design, not a bundle or set,
 *  a membership, software, a gift card or a made-to-order (customised) item. */
export function passCovers(p: { active?: boolean; is_bundle?: boolean; slug?: string | null; membership_plan_slug?: string | null; is_customizable?: boolean; price_usd?: number | string | null } | null): boolean {
  if (!p || !p.active || p.is_bundle || p.membership_plan_slug || p.is_customizable) return false;
  const slug = String(p.slug || '');
  if (slug.startsWith('software-') || slug.startsWith('gift-card-')) return false;
  return Number(p.price_usd) > 0;
}
