// The Google Shopping scoreboard, kept from the shop's own books.
//
// Google reports its own conversions and has every incentive to claim
// generously: a 30-day click window lets a click today claim a sale next month
// that email or Etsy actually produced. So this counts what WE can prove: a
// click that arrived with Google's click id, and an order that carried that
// same id through checkout.
//
// Cost is the one number we cannot measure. This account has no Ads API, so the
// owner enters spend by hand or pastes it from the Ads export, and it is kept in
// its own table so a measured number is never confused with a typed one.
import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../../lib/supabase';
import { fetchAll } from '../../../lib/fetch-all';

export const prerender = false;

const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY!;
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

async function isCallerAdmin(request: Request): Promise<boolean> {
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return false;
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: who } = await userClient.auth.getUser();
  if (!who?.user?.id) return false;
  const { data: prof } = await supabaseAdmin().from('profiles').select('is_admin').eq('id', who.user.id).maybeSingle();
  return !!prof?.is_admin;
}

// The decision numbers, fixed where they were measured so a moving average
// cannot quietly move the goalposts mid-test.
const NET_OF_FEES = 0.922;          // what is left of an order after Paddle
const TARGET_SALES_30D = 20;        // the test passes at this
const MAX_COST_PER_SALE_USD = 15.59;

export const GET: APIRoute = async ({ request, url }) => {
  if (!(await isCallerAdmin(request))) return json({ error: 'Admin authentication required.' }, 401);
  try {
    const db = supabaseAdmin();
    const days = Math.max(7, Math.min(120, Number(url.searchParams.get('days')) || 30));
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const sinceTs = since + 'T00:00:00Z';

    const [clicks, orders, { data: cost }, { data: rate }] = await Promise.all([
      fetchAll((a, b) => db.from('ad_clicks').select('day, gclid, path, country').gte('day', since).order('day').range(a, b)),
      fetchAll((a, b) => db.from('orders').select('id, created_at, total, currency, email, gclid, status').eq('status', 'paid').not('gclid', 'is', null).gte('created_at', sinceTs).order('created_at').range(a, b)),
      db.from('google_ads_daily').select('*').gte('day', since).order('day'),
      db.from('growth_settings').select('usd_pkr_rate').eq('id', 1).maybeSingle(),
    ]);

    const pkrPerUsd = Number((rate as any)?.usd_pkr_rate) || 280;
    const costPkr = (cost || []).reduce((s: number, r: any) => s + Number(r.cost_pkr || 0), 0);
    const costUsd = costPkr / pkrPerUsd;
    const googleClicks = (cost || []).reduce((s: number, r: any) => s + Number(r.clicks || 0), 0);
    const googleConv = (cost || []).reduce((s: number, r: any) => s + Number(r.conversions || 0), 0);

    const ourClicks = clicks.length;
    const revenue = (orders as any[]).reduce((s, o) => s + (Number(o.total) || 0), 0);
    const netRevenue = revenue * NET_OF_FEES;
    const sales = (orders as any[]).length;

    // by day, so a trend is visible rather than one blended number
    const byDay: Record<string, { clicks: number; sales: number; revenue: number; cost_pkr: number }> = {};
    const touch = (d: string) => (byDay[d] ||= { clicks: 0, sales: 0, revenue: 0, cost_pkr: 0 });
    for (const c of clicks as any[]) touch(String(c.day)).clicks++;
    for (const o of orders as any[]) {
      const d = String(o.created_at).slice(0, 10);
      touch(d).sales++;
      touch(d).revenue += Number(o.total) || 0;
    }
    for (const c of (cost || []) as any[]) touch(String(c.day)).cost_pkr += Number(c.cost_pkr || 0);

    const costPerSale = sales ? costUsd / sales : null;
    const verdict = !sales && ourClicks >= 100 ? 'no-sales'
      : costPerSale != null && costPerSale > MAX_COST_PER_SALE_USD ? 'too-expensive'
      : sales ? 'working' : 'too-early';

    return json({
      ok: true,
      days, pkrPerUsd,
      measured: {
        clicks: ourClicks,
        sales,
        revenue: +revenue.toFixed(2),
        netRevenue: +netRevenue.toFixed(2),
        conversionRate: ourClicks ? +((100 * sales) / ourClicks).toFixed(2) : 0,
      },
      reported: { clicks: googleClicks, conversions: googleConv, costPkr: +costPkr.toFixed(2), costUsd: +costUsd.toFixed(2) },
      derived: {
        cpcUsd: googleClicks ? +(costUsd / googleClicks).toFixed(3) : null,
        costPerSaleUsd: costPerSale != null ? +costPerSale.toFixed(2) : null,
        roas: costUsd > 0 ? +(netRevenue / costUsd).toFixed(2) : null,
        profitUsd: +(netRevenue - costUsd).toFixed(2),
        // Google's claim against ours. A gap is not fraud, it is the attribution
        // window at work, but it is the number to argue with.
        claimGap: googleConv && sales ? +(googleConv - sales).toFixed(2) : null,
      },
      thresholds: { targetSales30d: TARGET_SALES_30D, maxCostPerSaleUsd: MAX_COST_PER_SALE_USD },
      verdict,
      byDay: Object.entries(byDay).sort().map(([day, v]) => ({ day, ...v, cost_usd: +(v.cost_pkr / pkrPerUsd).toFixed(2) })),
      recentSales: (orders as any[]).slice(-10).reverse().map((o) => ({ at: o.created_at, total: Number(o.total), currency: o.currency, email: o.email })),
      fetchedAt: new Date().toISOString(),
    });
  } catch (e: any) {
    return json({ error: e?.message || 'could not build the scoreboard' }, 500);
  }
};

// Record what Google charged. Typed by hand or pasted from the Ads export,
// deliberately separate from anything measured.
export const POST: APIRoute = async ({ request }) => {
  if (!(await isCallerAdmin(request))) return json({ error: 'Admin authentication required.' }, 401);
  try {
    const b = await request.json().catch(() => ({} as any));
    const day = String(b.day || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return json({ error: 'day must be YYYY-MM-DD' }, 400);
    const row = {
      day,
      cost_pkr: Math.max(0, Number(b.cost_pkr) || 0),
      clicks: Math.max(0, Math.round(Number(b.clicks) || 0)),
      impressions: Math.max(0, Math.round(Number(b.impressions) || 0)),
      conversions: Math.max(0, Number(b.conversions) || 0),
      note: String(b.note || '').slice(0, 200) || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabaseAdmin().from('google_ads_daily').upsert(row, { onConflict: 'day' });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, day });
  } catch (e: any) { return json({ error: e?.message || 'failed' }, 500); }
};
