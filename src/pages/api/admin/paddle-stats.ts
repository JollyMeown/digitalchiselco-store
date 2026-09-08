// Website revenue straight from PADDLE, not from our own orders table.
//
// Why this route exists (2026-09-09): the Finance card used to add up
// `orders.total`, which is written by our webhook. Two things made that wrong:
//   1. `total` is stored in the currency the buyer was charged, so CAD, EUR and
//      GBP orders were being summed as if they were dollars;
//   2. it is gross, so it silently overstated what actually arrives. Paddle took
//      $34.71 in fees on 2026 to date, which the card never showed.
// Paddle's own `payout_totals` gives all three numbers already converted to the
// payout currency: what the buyer paid, what Paddle kept, and what we earn.
//
// GET /api/admin/paddle-stats  ->  { periods: [...], currency, fetchedAt }
import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../../lib/supabase';

export const prerender = false;

const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY!;
const env = (k: string) => process.env[k] ?? (import.meta as any).env?.[k];
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

type Txn = { at: number; gross: number; tax: number; fee: number; earnings: number; ccy: string; charged: number; chargedCcy: string };

async function fetchTransactions(sinceIso: string): Promise<Txn[]> {
  const key = env('PADDLE_API_KEY');
  if (!key) throw new Error('PADDLE_API_KEY not configured');
  const base = env('PADDLE_ENV') === 'sandbox' ? 'https://sandbox-api.paddle.com' : 'https://api.paddle.com';
  let url: string | null = `${base}/transactions?status=completed&billed_at[GTE]=${sinceIso}&per_page=100`;
  const out: Txn[] = [];
  for (let page = 0; url && page < 30; page++) {
    const res: Response = await fetch(url, { headers: { authorization: `Bearer ${key}` } });
    const j: any = await res.json();
    if (!res.ok) throw new Error(`Paddle ${res.status}: ${JSON.stringify(j).slice(0, 200)}`);
    for (const t of j.data || []) {
      const d = t.details || {};
      // payout_totals is already converted to our payout currency; totals is
      // what the buyer was charged in their own currency.
      const p = d.payout_totals || null;
      const tot = d.totals || {};
      out.push({
        at: Date.parse(t.billed_at || t.created_at),
        gross: Number(p?.grand_total ?? tot.grand_total ?? 0) / 100,
        tax: Number(p?.tax ?? tot.tax ?? 0) / 100,
        fee: Number(p?.fee ?? tot.fee ?? 0) / 100,
        earnings: Number(p?.earnings ?? tot.earnings ?? 0) / 100,
        ccy: String(p?.currency_code || tot.currency_code || 'USD'),
        charged: Number(tot.grand_total || 0) / 100,
        chargedCcy: String(t.currency_code || 'USD'),
      });
    }
    url = j.meta?.pagination?.has_more ? j.meta.pagination.next : null;
  }
  return out;
}

export const GET: APIRoute = async ({ request }) => {
  if (!(await isCallerAdmin(request))) return json({ error: 'Admin authentication required.' }, 401);
  try {
    const now = new Date();
    // far enough back to cover "last 3 months" and "this year" whichever is older
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const d90 = new Date(now.getTime() - 90 * 86400000);
    const since = (yearStart < d90 ? yearStart : d90);
    const txns = await fetchTransactions(new Date(since.getTime() - 86400000).toISOString());

    const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
    const dow = (now.getDay() + 6) % 7;                                  // Monday = 0
    const weekStart = startOfDay(new Date(now.getTime() - dow * 86400000));
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
    const bucket = (from: number, to = Infinity) => {
      const rows = txns.filter((t) => t.at >= from && t.at < to);
      return {
        gross: +rows.reduce((s, t) => s + t.gross, 0).toFixed(2),
        tax: +rows.reduce((s, t) => s + t.tax, 0).toFixed(2),
        fee: +rows.reduce((s, t) => s + t.fee, 0).toFixed(2),
        earnings: +rows.reduce((s, t) => s + t.earnings, 0).toFixed(2),
        orders: rows.length,
      };
    };
    const monthName = (t: number) => new Date(t).toLocaleString('en-US', { month: 'long' });
    const periods = [
      { key: 'This week', note: 'since Monday', ...bucket(weekStart) },
      { key: 'This month', note: monthName(monthStart), ...bucket(monthStart) },
      { key: 'Last month', note: monthName(lastMonthStart), ...bucket(lastMonthStart, monthStart) },
      { key: 'Last 3 months', note: 'rolling 90 days', ...bucket(d90.getTime()) },
      { key: 'This year', note: String(now.getFullYear()), ...bucket(yearStart.getTime()) },
    ];
    // Month by month, every month the account has ever billed, so "what do I
    // pay Paddle" is answerable at a glance and a payout can be reconciled
    // against the months it covers.
    const all = await fetchTransactions('2020-01-01T00:00:00Z');
    const months: Record<string, any> = {};
    for (const t of all) {
      const k = new Date(t.at).toISOString().slice(0, 7);
      const b = (months[k] ||= { month: k, gross: 0, tax: 0, fee: 0, earnings: 0, orders: 0 });
      b.gross += t.gross; b.tax += t.tax; b.fee += t.fee; b.earnings += t.earnings; b.orders++;
    }
    const byMonth = Object.values(months)
      .map((b: any) => ({
        ...b,
        gross: +b.gross.toFixed(2), tax: +b.tax.toFixed(2), fee: +b.fee.toFixed(2), earnings: +b.earnings.toFixed(2),
        feePct: b.gross > 0 ? +((100 * b.fee) / b.gross).toFixed(1) : 0,
      }))
      .sort((a: any, b: any) => b.month.localeCompare(a.month));
    const allTime = {
      gross: +all.reduce((s, t) => s + t.gross, 0).toFixed(2),
      tax: +all.reduce((s, t) => s + t.tax, 0).toFixed(2),
      fee: +all.reduce((s, t) => s + t.fee, 0).toFixed(2),
      earnings: +all.reduce((s, t) => s + t.earnings, 0).toFixed(2),
      orders: all.length,
    };

    // Every calendar month of the current year, including the empty ones, so
    // the shape of the year is honest rather than only the months that sold.
    const year = now.getFullYear();
    const calendar = Array.from({ length: 12 }, (_, i) => {
      const key = `${year}-${String(i + 1).padStart(2, '0')}`;
      const found = months[key];
      return {
        month: key,
        label: new Date(year, i, 2).toLocaleString('en-US', { month: 'short' }),
        future: new Date(year, i, 1) > now,
        gross: +(found?.gross || 0).toFixed(2),
        tax: +(found?.tax || 0).toFixed(2),
        fee: +(found?.fee || 0).toFixed(2),
        earnings: +(found?.earnings || 0).toFixed(2),
        orders: found?.orders || 0,
      };
    });

    // What the numbers mean for the business, not just what they are.
    const byCcy: Record<string, { orders: number; gross: number }> = {};
    for (const t of all) {
      const c = (byCcy[t.chargedCcy] ||= { orders: 0, gross: 0 });
      c.orders++; c.gross += t.gross;
    }
    const sorted = [...all].sort((a, b) => a.gross - b.gross);
    const feeRate = (rows: Txn[]) => {
      const g = rows.reduce((s, t) => s + t.gross, 0);
      return g > 0 ? +((100 * rows.reduce((s, t) => s + t.fee, 0)) / g).toFixed(1) : 0;
    };
    const half = Math.max(1, Math.floor(sorted.length / 2));
    const insights = {
      avgOrder: all.length ? +(allTime.gross / all.length).toFixed(2) : 0,
      avgEarnings: all.length ? +(allTime.earnings / all.length).toFixed(2) : 0,
      avgFee: all.length ? +(allTime.fee / all.length).toFixed(2) : 0,
      feeRateAll: allTime.gross ? +((100 * allTime.fee) / allTime.gross).toFixed(1) : 0,
      // Paddle charges a percentage PLUS a fixed amount per transaction, so
      // small orders are proportionally far more expensive. This proves it.
      feeRateSmallest: feeRate(sorted.slice(0, half)),
      feeRateLargest: feeRate(sorted.slice(-half)),
      smallestAvg: half ? +(sorted.slice(0, half).reduce((s, t) => s + t.gross, 0) / half).toFixed(2) : 0,
      largestAvg: half ? +(sorted.slice(-half).reduce((s, t) => s + t.gross, 0) / half).toFixed(2) : 0,
      taxShare: allTime.gross ? +((100 * allTime.tax) / allTime.gross).toFixed(1) : 0,
      currencies: Object.entries(byCcy).map(([ccy, v]) => ({ ccy, orders: v.orders, gross: +v.gross.toFixed(2) })).sort((a, b) => b.gross - a.gross),
    };

    return json({ ok: true, periods, byMonth, calendar, allTime, insights, year, currency: txns[0]?.ccy || all[0]?.ccy || 'USD', fetchedAt: new Date().toISOString(), transactions: all.length });
  } catch (e: any) {
    return json({ error: e?.message || 'Paddle query failed' }, 502);
  }
};
