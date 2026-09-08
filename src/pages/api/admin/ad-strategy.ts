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

/** Measure what actually happened while each logged budget was in force.
 *
 *  A budget is only ever as good as the fortnight that followed it, and memory
 *  is not evidence. Each log row therefore gets the trading days between its
 *  own change and the next one, so the log turns into this shop's own record of
 *  what every level did. Periods shorter than 5 days are marked thin rather
 *  than hidden, because a short period is still a fact, just a weak one. */
function periods(budgets: any[], all: Day[]) {
  const asc = [...budgets].sort((a, b) => String(a.changed_at).localeCompare(String(b.changed_at)));
  const today = new Date().toISOString().slice(0, 10);
  const out = asc.map((b, i) => {
    const from = String(b.changed_at).slice(0, 10);
    // A budget logged today runs to today, never to yesterday: changed_at is
    // stamped in UTC while the shop's own clock can already be on the next day.
    const to = i + 1 < asc.length ? String(asc[i + 1].changed_at).slice(0, 10) : (today > from ? today : from);
    const rows = all.filter((d) => d.day >= from && d.day < to);
    const n = rows.length || 1;
    const rev = rows.reduce((s, d) => s + d.rev, 0);
    const ad = rows.reduce((s, d) => s + d.ad, 0);
    const profit = rows.reduce((s, d) => s + d.profit, 0);
    return {
      ...b, from, to,
      result: {
        days: rows.length,
        revPerDay: +(rev / n).toFixed(2),
        adPerDay: +(ad / n).toFixed(2),
        profitPerDay: +(profit / n).toFixed(2),
        margin: rev > 0 ? +((100 * profit) / rev).toFixed(1) : null,
        adShare: rev > 0 ? +((100 * ad) / rev).toFixed(1) : null,
        thin: rows.length < 5,
      },
    };
  });
  // compare each period with the one before it, which is the only comparison
  // that answers "did changing the number help?"
  for (let i = 1; i < out.length; i++) {
    const a = out[i - 1].result, b = out[i].result;
    (out[i] as any).vsPrevious = (a.margin != null && b.margin != null)
      ? { margin: +(b.margin - a.margin).toFixed(1), profitPerDay: +(b.profitPerDay - a.profitPerDay).toFixed(2), revPerDay: +(b.revPerDay - a.revPerDay).toFixed(2) }
      : null;
  }
  return out.reverse();
}

export const GET: APIRoute = async ({ request }) => {
  const who = await caller(request);
  if (!who.ok) return json({ error: 'Admin authentication required.' }, 401);
  try {
    const db = supabaseAdmin();
    const [{ data: fin }, { data: hours }, { data: budgets }, { data: stats }, { data: prods }, { data: hist }] = await Promise.all([
      fetchAll((a, b) => db.from('finance_daily').select('day, revenue_usd, fees_usd, ad_spend_usd').eq('channel', 'etsy').order('day').range(a, b)).then((data) => ({ data })),
      db.from('etsy_order_hours').select('*').then((r) => ({ data: r.data })),
      db.from('ad_budget_log').select('*').order('changed_at', { ascending: false }).limit(30).then((r) => ({ data: r.data })),
      fetchAll((a, b) => db.from('etsy_listing_stats').select('listing_id, title, views, favorers, listing_created').range(a, b)).then((data) => ({ data })),
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
        ageDays: s.listing_created ? Math.round((Date.now() - Date.parse(s.listing_created + 'T00:00:00Z')) / 86400000) : null,
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

    // ── should a brand new listing be advertised? ──
    // Answered by the shop's own age curve rather than by Etsy's advice. Each
    // band reports how many listings that old have EVER sold, which is the only
    // honest way to price the risk of putting money behind an unproven one.
    // Net per order is what a sale is actually worth after Etsy's cut, so the
    // breakeven cost per visit follows directly from the views a sale takes.
    const withAge = listings.filter((l) => l.ageDays != null);
    const ageBands = [
      { key: 'Under 30 days', lo: 0, hi: 30 }, { key: '30 to 60 days', lo: 30, hi: 60 },
      { key: '60 to 90 days', lo: 60, hi: 90 }, { key: '90 to 180 days', lo: 90, hi: 180 },
      { key: 'Over 180 days', lo: 180, hi: Infinity },
    ].map((b) => {
      const g = withAge.filter((l) => (l.ageDays as number) >= b.lo && (l.ageDays as number) < b.hi);
      const sold = g.filter((l) => (l.sales || 0) > 0).length;
      const v = g.reduce((s, l) => s + l.views, 0);
      const sa = g.reduce((s, l) => s + (l.sales || 0), 0);
      return {
        band: b.key, listings: g.length,
        soldPct: g.length ? Math.round((100 * sold) / g.length) : 0,
        avgViews: g.length ? Math.round(v / g.length) : 0,
        viewsPerSale: sa ? Math.round(v / sa) : null,
        salesPerListing: g.length ? +(sa / g.length).toFixed(2) : 0,
      };
    }).filter((b) => b.listings > 0);
    const soldAll = listings.filter((l) => (l.sales || 0) > 0);
    const viewsPerSale = soldAll.length
      ? Math.round(soldAll.reduce((s, l) => s + l.views, 0) / Math.max(1, soldAll.reduce((s, l) => s + (l.sales || 0), 0)))
      : null;
    const yearDays = all.filter((d) => d.rev > 0);
    const yearRev = yearDays.reduce((s, d) => s + d.rev, 0);
    const yearFee = yearDays.reduce((s, d) => s + d.fee, 0);
    const orders = (hours || []).filter((h: any) => h.tz === 'Asia/Karachi').reduce((s: number, h: any) => s + (h.orders || 0), 0);
    const aov = orders ? yearRev / orders : 0;
    const netPerOrder = aov * (yearRev > 0 ? 1 - yearFee / yearRev : 1);
    const newListings = {
      bands: ageBands,
      aov: +aov.toFixed(2),
      netPerOrder: +netPerOrder.toFixed(2),
      viewsPerSale,
      // the most a click can be worth on a listing that converts like the rest
      // of the shop, and on one that converts half as well
      breakevenCpc: viewsPerSale ? +(netPerOrder / viewsPerSale).toFixed(3) : null,
      breakevenCpcWeak: viewsPerSale ? +(netPerOrder / (viewsPerSale * 2)).toFixed(3) : null,
    };

    const winners = listings.filter((l) => (l.sales || 0) >= 3).sort((a, b) => (b.sales || 0) - (a.sales || 0)).slice(0, 40);
    const sold = listings.filter((l) => (l.sales || 0) > 0);

    // ── the standing plan ──
    // A budget is a decision with a date on it, not a setting. The live row is
    // the number in force; review_on is when it gets judged. Two weeks is the
    // shortest window that can separate an ad effect from ordinary day-to-day
    // noise on 13 orders a day.
    const { data: reviews } = await db.from('ad_reviews').select('*').order('reviewed_at', { ascending: false }).limit(12);
    const live = (budgets || [])[0] || null;
    const today = new Date().toISOString().slice(0, 10);
    const reviewOn = live?.review_on || null;
    const daysToReview = reviewOn ? Math.round((new Date(reviewOn + 'T00:00:00Z').getTime() - new Date(today + 'T00:00:00Z').getTime()) / 86400000) : null;
    const held = live ? all.filter((d) => d.day >= String(live.changed_at).slice(0, 10)) : [];
    const heldRev = held.reduce((s, d) => s + d.rev, 0);
    const heldProfit = held.reduce((s, d) => s + d.profit, 0);
    // What to do at the review. Drift, not the raw gap, is what matters: the
    // budget is right when spend sits inside the best-margin band, so the
    // action follows ad share, not dollars.
    // The call must be made on the days the CURRENT budget has been in force.
    // The trailing fortnight still carries the previous budget's spending for
    // two weeks after a change, so reading it would tell the owner to cut a
    // budget they have only just cut.
    const shareHeld = heldRev > 0 ? (100 * held.reduce((s, d) => s + d.ad, 0)) / heldRev : null;
    const shareTrailing = revPerDay ? (100 * adPerDayNow) / revPerDay : 0;
    const shareNow = shareHeld ?? shareTrailing;
    const action = !live ? 'set'
      : held.length < 5 ? 'wait'
      : shareNow > targetShare + 6 ? 'cut'
      : shareNow < targetShare - 6 ? 'raise' : 'hold';
    const plan = {
      current: live ? Number(live.daily_budget) : null,
      setOn: live?.changed_at || null,
      source: live?.source || 'owner',
      expectation: live?.expectation || null,
      reviewOn, daysToReview,
      due: daysToReview != null && daysToReview <= 0,
      daysHeld: held.length,
      sinceChange: held.length ? {
        days: held.length,
        revPerDay: +(heldRev / held.length).toFixed(2),
        profitPerDay: +(heldProfit / held.length).toFixed(2),
        margin: heldRev > 0 ? +((100 * heldProfit) / heldRev).toFixed(1) : null,
      } : null,
      action,
      // which days the call was made on, so the card can say so plainly
      basis: held.length >= 5 ? 'since the change' : 'not enough days yet',
      shareSinceChange: shareHeld != null ? +shareHeld.toFixed(1) : null,
      nextBudget: recommended,
      // the guard rails the recommendation must always respect
      floor: Math.max(5, Math.round(0.10 * revPerDay)),
      ceiling: Math.round(0.25 * revPerDay),
      cadence: 14,
    };

    return json({
      ok: true,
      plan,
      history: periods(budgets || [], all),
      reviews: reviews || [],
      now: { revPerDay: +revPerDay.toFixed(2), adPerDay: +adPerDayNow.toFixed(2), profitPerDay: +profitPerDayNow.toFixed(2), adShare: revPerDay ? +((100 * adPerDayNow) / revPerDay).toFixed(1) : 0, days: recent.length },
      recommendation: { daily: recommended, targetShare, basedOn: best?.band || null, bestProfitPerDay: best?.profitPerDay ?? null, currentBudget, gap },
      tiers: band,
      budgets: budgets || [],
      hours: hours || [],
      listings: { total: listings.length, sold: sold.length, dead: listings.length - sold.length, wasteViews, totalViews, wasteBasis, waste, winners },
      newListings,
      historyDays: new Set((hist || []).map((h: any) => h.day)).size,
      fetchedAt: new Date().toISOString(),
    });
  } catch (e: any) {
    return json({ error: e?.message || 'ad strategy failed' }, 500);
  }
};

// Two things get written here, and both matter to the pattern:
//   a BUDGET CHANGE, stamped with the date it will be judged on, and
//   a REVIEW, which records the look at the numbers even when the answer was
//   "leave it alone". Without the second, the log would only ever contain
//   changes, and a run of correct holds would look like months of inactivity.
export const POST: APIRoute = async ({ request }) => {
  const who = await caller(request);
  if (!who.ok) return json({ error: 'Admin authentication required.' }, 401);
  try {
    const b = await request.json().catch(() => ({} as any));

    if (b.review) {
      const db = supabaseAdmin();
      const { data: live } = await db.from('ad_budget_log').select('id').order('changed_at', { ascending: false }).limit(1);
      const next = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
      const r = b.review as any;
      const { error } = await db.from('ad_reviews').insert({
        budget_id: live?.[0]?.id ?? null,
        window_days: Number(r.window_days) || 14,
        rev_per_day: Number(r.rev_per_day) || null,
        ad_per_day: Number(r.ad_per_day) || null,
        profit_per_day: Number(r.profit_per_day) || null,
        margin: Number(r.margin) || null,
        ad_share: Number(r.ad_share) || null,
        recommended: Number(r.recommended) || null,
        action: ['hold', 'raise', 'cut', 'set'].includes(String(r.action)) ? String(r.action) : 'hold',
        note: String(r.note || '').slice(0, 500) || null,
        next_review: next,
      });
      if (error) return json({ error: error.message }, 500);
      // push the live budget's next review out, so holding restarts the clock
      if (live?.[0]?.id) await db.from('ad_budget_log').update({ review_on: next, reviewed_at: new Date().toISOString() }).eq('id', live[0].id);
      return json({ ok: true, nextReview: next });
    }

    const daily = Number(b.daily_budget);
    if (!Number.isFinite(daily) || daily < 0 || daily > 1000) return json({ error: 'daily_budget must be between 0 and 1000' }, 400);
    const db = supabaseAdmin();
    const { data: prev } = await db.from('ad_budget_log').select('daily_budget').order('changed_at', { ascending: false }).limit(1);
    // every budget is set with the date it will be judged on, a fortnight out
    const review = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
    const { error } = await db.from('ad_budget_log').insert({
      daily_budget: daily,
      previous_budget: prev?.[0]?.daily_budget ?? null,
      reason: String(b.reason || '').slice(0, 300) || null,
      set_by: who.email || 'admin',
      source: b.source === 'claude' ? 'claude' : 'owner',
      expectation: String(b.expectation || '').slice(0, 300) || null,
      review_on: review,
    });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, reviewOn: review });
  } catch (e: any) { return json({ error: e?.message || 'failed' }, 500); }
};
