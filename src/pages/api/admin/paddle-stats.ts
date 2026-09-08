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

type Txn = { at: number; gross: number; fee: number; earnings: number; ccy: string; charged: number; chargedCcy: string };

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
    return json({ ok: true, periods, currency: txns[0]?.ccy || 'USD', fetchedAt: new Date().toISOString(), transactions: txns.length });
  } catch (e: any) {
    return json({ error: e?.message || 'Paddle query failed' }, 502);
  }
};
