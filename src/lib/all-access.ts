// All-Access Library pass: the rules in one place.
//
// A holder of an ACTIVE 'all-access-year' membership term can add any single
// design to their account (an entitlement with source 'all-access'), up to a
// fair-use cap per rolling 30 days, so the pass cannot be used to lift the
// whole library in an afternoon and share it. The pass is a normal membership
// term (lib/subscriptions.ts), so it also gets the monthly member pack, and
// purchase, renewal, upgrade and expiry work exactly as for every plan.
//
// Offered publicly only once the plan's available_from date has arrived: the
// owner reviews it first at /membership?preview=1 (hard rule: nothing goes
// live without the owner's approval).
import { supabaseAdmin } from './supabase';

import { ALL_ACCESS_SLUG, PASS_FAIR_USE_PER_30D } from './membership-facts';
export { ALL_ACCESS_SLUG, PASS_FAIR_USE_PER_30D };
const DAY = 86_400_000;

type DB = ReturnType<typeof supabaseAdmin>;
const today = () => new Date().toISOString().slice(0, 10);

/** Is the pass on sale yet (plan active and its launch date reached)? */
export async function passOffered(db: DB): Promise<boolean> {
  const { data } = await db.from('membership_plans').select('active, available_from').eq('slug', ALL_ACCESS_SLUG).maybeSingle();
  return !!data?.active && (!data.available_from || String(data.available_from) <= today());
}

/** The holder's current pass term, or null. */
export async function activePass(db: DB, email: string) {
  const { data } = await db.from('member_subscriptions')
    .select('id, end_date, start_date, status')
    .ilike('email', email).eq('plan_slug', ALL_ACCESS_SLUG).eq('status', 'active')
    .lte('start_date', today()).gte('end_date', today())
    .order('end_date', { ascending: false }).limit(1).maybeSingle();
  return data || null;
}

/** Designs added with the pass in the last 30 days. */
export async function usedLast30(db: DB, email: string): Promise<number> {
  const since = new Date(Date.now() - 30 * DAY).toISOString();
  const { count } = await db.from('entitlements').select('id', { count: 'exact', head: true })
    .ilike('email', email).eq('source', 'all-access').gte('granted_at', since);
  return count || 0;
}

/** A design the pass covers: an active single design, not a bundle, a
 *  membership, software, a gift card or a made-to-order (customised) item. */
export function passCovers(p: { active?: boolean; is_bundle?: boolean; slug?: string | null; membership_plan_slug?: string | null; is_customizable?: boolean; price_usd?: number | string | null } | null): boolean {
  if (!p || !p.active || p.is_bundle || p.membership_plan_slug || p.is_customizable) return false;
  const slug = String(p.slug || '');
  if (slug.startsWith('software-') || slug.startsWith('gift-card-')) return false;
  return Number(p.price_usd) > 0;
}
