// The advertising brain behind Admin > Advertising.
//
// It answers four questions from data only, never from opinion:
//   1. What daily budget has actually produced the most profit?
//   2. What should the budget be right now, given current revenue?
//   3. Which listings are consuming exposure and returning nothing?
//   4. When do orders actually arrive, so ads can follow demand?
//
// The honest limit, verified against Etsy's API on 2026-09-09: Etsy publishes
// NO per-listing ad spend, clicks or impressions (there is no ads endpoint).
// It does publish the daily Promoted Listings charge and per-listing views.
// So listing-level waste is measured as VIEWS WITHOUT SALES, which is a proxy,
// and the dashboard says so plainly rather than inventing precision.
import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../../lib/supabase';
import { fetchAll } from '../../../lib/fetch-all';

export const prerender = false;

const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY!;
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

async function caller(request: Request): Promise<{ ok: boolean; email?: string }> {
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return { ok: false };
  const uc = createClient(SUPABASE_URL, SUPABASE_ANON, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: who } = await uc.auth.getUser();
  if (!who?.user?.id) return { ok: false };
  const { data: prof } = await supabaseAdmin().from('profiles').select('is_admin').eq('id', who.user.id).maybeSingle();
  return { ok: !!prof?.is_admin, email: who.user.email || undefined };
}

type Day = { day: string; rev: number; fee: number; ad: number; profit: number };

/** Group the shop's history by AD SHARE OF REVENUE, never by the dollar budget.
 *
 *  Why share and not dollars: Etsy consumes Promoted Listings budget in
 *  proportion to traffic, so busy months automatically spend more. Grouping by
 *  dollars therefore says "high spend earns the most", which is reverse
 *  causation: the spend followed the traffic, it did not cause it. Verified on
 *  2026-09-09, where the $55+ dollar band looked best purely because those days
 *  were February to April, the shop's peak.
 *
 *  Share is scale free, so the comparison is fair, and PROFIT MARGIN is the
 *  outcome to read: if a higher ad share bought more sales, revenue per day
 *  would rise with it. If revenue stays flat while margin falls, the extra
 *  advertising is simply being taken out of profit. */
function tiers(days: Day[]) {
  const bands = [
    { key: 'under 15%', lo: 0, hi: 15 },
    { key: '15 to 20%', lo: 15, hi: 20 },
    { key: '20 to 25%', lo: 20, hi: 25 },
    { key: '25 to 30%', lo: 25, hi: 30 },
    { key: '30% and over', lo: 30, hi: Infinity },
  ];
  return bands.map((b) => {
    const rows = days.filter((d) => { const s = (100 * d.ad) / d.rev; return s >= b.lo && s < b.hi; });
    const n = rows.length || 1;
    const rev = rows.reduce((s, d) => s + d.rev, 0);
    const ad = rows.reduce((s, d) => s + d.ad, 0);
    const profit = rows.reduce((s, d) => s + d.profit, 0);
    return {
      band: b.key, days: rows.length,
      adPerDay: +(ad / n).toFixed(2),
      revPerDay: +(rev / n).toFixed(2),
      profitPerDay: +(profit / n).toFixed(2),
      margin: rev > 0 ? +((100 * profit) / rev).toFixed(1) : 0,
      adShare: rev > 0 ? +((100 * ad) / rev).toFixed(1) : 0,
      // enough days to mean something? two weeks is the minimum honest sample
      reliable: rows.length >= 14,
    };
  }).filter((t) => t.days > 0);
}

export const GET: APIRoute = async ({ request }) => {
  const who = await caller(request);
  if (!who.ok) return json({ error: 'Admin authentication required.' }, 401);
  try {
    const db = supabaseAdmin();
    const [{ data: fin }, { data: hours }, { data: budgets }, { data: stats }, { data: prods }, { data: hist }] = await Promise.all([
      fetchAll((a, b) => db.from('finance_daily').select('day, revenue_usd, fees_usd, ad_spend_usd').eq('channel', 'etsy').order('day').range(a, b)).then((data) => ({ data })),
      db.from('etsy_order_hours').select('*').then((r) => ({ data: r.data })),
      db.from('ad_budget_log').select('*').order('changed_at', { ascending: false }).limit(20).then((r) => ({ data: r.data })),
      fetchAll((a, b) => db.from('etsy_listing_stats').select('listing_id, title, views, favorers').range(a, b)).then((data) => ({ data })),
      fetchAll((a, b) => db.from('products').select('etsy_listing_id, etsy_sales_365, slug').not('etsy_listing_id', 'is', null).range(a, b)).then((data) => ({ data })),
      fetchAll((a, b) => db.from('etsy_listing_history').select('listing_id, day, views').gte('day', new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10)).range(a, b)).then((data) => ({ data })),
    ]);

    // The finance sync runs mid-morning, so today's row is always partial and
    // would drag every average down. Drop the newest day.
    const all: Day[] = (fin || []).map((r: any) => ({
      day: r.day, rev: Number(r.revenue_usd) || 0, fee: Number(r.fees_usd) || 0, ad: Number(r.ad_spend_usd) || 0,
      profit: (Number(r.revenue_usd) || 0) - (Number(r.fees_usd) || 0) - (Number(r.ad_spend_usd) || 0),
    }));
    const complete = all.slice(0, -1).filter((d) => d.ad > 0);
    const band = tiers(complete.filter((d) => d.rev > 0));
    const usable = band.filter((t) => t.reliable);
    // Judge on MARGIN, the scale-free outcome, not on profit per day, which
    // still carries the revenue of the period it happened in.
    const best = (usable.length ? usable : band).slice().sort((a, b) => b.margin - a.margin)[0] || null;

    // Current revenue run rate, from the last 14 complete days.
    const recent = all.slice(-15, -1);
    const revPerDay = recent.length ? recent.reduce((s, d) => s + d.rev, 0) / recent.length : 0;
    const adPerDayNow = recent.length ? recent.reduce((s, d) => s + d.ad, 0) / recent.length : 0;
    const profitPerDayNow = recent.length ? recent.reduce((s, d) => s + d.profit, 0) / recent.length : 0;

    // The recommendation. The stable rule is a SHARE of revenue, because a
    // fixed cap silently becomes too large the moment revenue softens, which
    // is exactly what happened at $65/day in September.
    // Aim at the middle of the winning band rather than its measured average,
    // so the target does not drift down every time the band is re-measured.
    const targetShare = best ? Math.max(10, Math.min(25, Math.round(best.adShare))) : 18;
    const recommended = Math.max(5, Math.round((targetShare / 100) * revPerDay));
    const currentBudget = budgets?.[0]?.daily_budget != null ? Number(budgets[0].daily_budget) : null;
    const gap = currentBudget != null ? recommended - currentBudget : null;

    // ── listing waste: views without sales ──
    const salesBy = new Map((prods || []).map((p: any) => [String(p.etsy_listing_id), { sales: Number(p.etsy_sales_365 || 0), slug: p.slug }]));
    const firstSeen = new Map<string, { day: string; views: number }>();
    const lastSeen = new Map<string, { day: string; views: number }>();
    for (const h of hist || []) {
      const k = String((h as any).listing_id);
      const cur = { day: (h as any).day, views: Number((h as any).views) || 0 };
      const f = firstSeen.get(k); if (!f || cur.day < f.day) firstSeen.set(k, cur);
      const l = lastSeen.get(k); if (!l || cur.day > l.day) lastSeen.set(k, cur);
    }
    const haveGrowth = firstSeen.size > 0 && [...firstSeen.keys()].some((k) => (lastSeen.get(k)?.day || '') > (firstSeen.get(k)?.day || ''));
    const listings = (stats || []).map((s: any) => {
      const k = String(s.listing_id);
      const p = salesBy.get(k);
      const grow = haveGrowth ? Math.max(0, (lastSeen.get(k)?.views || 0) - (firstSeen.get(k)?.views || 0)) : null;
      const views = Number(s.views) || 0;
      const sales = p?.sales ?? null;
      return {
        listing_id: k, title: String(s.title || '').split('|')[0].trim(),
        views, favorers: Number(s.favorers) || 0, sales, slug: p?.slug || null,
        recentViews: grow,
        // views per sale: how much exposure each sale costs. High with zero
        // sales means the listing takes attention and returns nothing.
        conversion: sales && views ? +((100 * sales) / views).toFixed(2) : 0,
      };
    }).filter((l) => l.sales !== null);

    const wasteBasis = haveGrowth ? 'recentViews' : 'views';
    const waste = listings
      .filter((l) => l.sales === 0 && (haveGrowth ? (l.recentViews || 0) > 0 : l.views > 0))
      .sort((a, b) => ((b as any)[wasteBasis] || 0) - ((a as any)[wasteBasis] || 0))
      .slice(0, 60);
    const wasteViews = listings.filter((l) => l.sales === 0).reduce((s, l) => s + (haveGrowth ? (l.recentViews || 0) : l.views), 0);
    const totalViews = listings.reduce((s, l) => s + (haveGrowth ? (l.recentViews || 0) : l.views), 0);

    const winners = listings.filter((l) => (l.sales || 0) >= 3).sort((a, b) => (b.sales || 0) - (a.sales || 0)).slice(0, 40);
    const sold = listings.filter((l) => (l.sales || 0) > 0);

    return json({
      ok: true,
      now: { revPerDay: +revPerDay.toFixed(2), adPerDay: +adPerDayNow.toFixed(2), profitPerDay: +profitPerDayNow.toFixed(2), adShare: revPerDay ? +((100 * adPerDayNow) / revPerDay).toFixed(1) : 0, days: recent.length },
      recommendation: { daily: recommended, targetShare, basedOn: best?.band || null, bestProfitPerDay: best?.profitPerDay ?? null, currentBudget, gap },
      tiers: band,
      budgets: budgets || [],
      hours: hours || [],
      listings: { total: listings.length, sold: sold.length, dead: listings.length - sold.length, wasteViews, totalViews, wasteBasis, waste, winners },
      historyDays: new Set((hist || []).map((h: any) => h.day)).size,
      fetchedAt: new Date().toISOString(),
    });
  } catch (e: any) {
    return json({ error: e?.message || 'ad strategy failed' }, 500);
  }
};

// Record a budget change so the next review can judge it against what followed.
export const POST: APIRoute = async ({ request }) => {
  const who = await caller(request);
  if (!who.ok) return json({ error: 'Admin authentication required.' }, 401);
  try {
    const b = await request.json().catch(() => ({} as any));
    const daily = Number(b.daily_budget);
    if (!Number.isFinite(daily) || daily < 0 || daily > 1000) return json({ error: 'daily_budget must be between 0 and 1000' }, 400);
    const db = supabaseAdmin();
    const { data: prev } = await db.from('ad_budget_log').select('daily_budget').order('changed_at', { ascending: false }).limit(1);
    const { error } = await db.from('ad_budget_log').insert({
      daily_budget: daily,
      previous_budget: prev?.[0]?.daily_budget ?? null,
      reason: String(b.reason || '').slice(0, 300) || null,
      set_by: who.email || 'admin',
    });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  } catch (e: any) { return json({ error: e?.message || 'failed' }, 500); }
};
