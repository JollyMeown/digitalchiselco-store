import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { Card } from '../ui';
import { useLiveRefresh } from '../useLiveRefresh';
import Chart3D from '../Chart3D';

type Daily = { day: string; channel: string; revenue_usd: number; ad_spend_usd: number; fees_usd: number };
type Gran = 'week' | 'month' | 'year';

const CHANNELS: Record<string, { label: string; color: string }> = {
  website: { label: 'Website', color: '#2a78d6' },
  etsy: { label: 'Etsy', color: '#eb6834' },
  cults: { label: 'Cults3D', color: '#1baf7a' },
};
const usd = (n: number | null | undefined) => (n == null ? '—' : '$' + (Math.round(Number(n) * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }));
const eur = (n: number | null | undefined) => (n == null ? '—' : '€' + (Math.round(Number(n) * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 }));

// bucket key + label for a day string
function bucket(day: string, g: Gran): { key: string; label: string } {
  if (g === 'year') return { key: day.slice(0, 4), label: day.slice(0, 4) };
  if (g === 'month') { const [y, m] = day.split('-'); return { key: day.slice(0, 7), label: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1] + " '" + y.slice(2) }; }
  // week: Monday of that week
  const d = new Date(day + 'T00:00:00Z');
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - dow);
  const key = d.toISOString().slice(0, 10);
  return { key, label: `${key.slice(8, 10)}/${key.slice(5, 7)}` };
}

function rollup(rows: Daily[], g: Gran, field: 'revenue_usd' | 'ad_spend_usd', limit: number) {
  const map = new Map<string, { label: string; seg: Record<string, number>; total: number }>();
  for (const r of rows) {
    const { key, label } = bucket(r.day, g);
    const b = map.get(key) || { label, seg: {}, total: 0 };
    const v = Number(r[field]) || 0;
    b.seg[r.channel] = (b.seg[r.channel] || 0) + v;
    b.total += v;
    map.set(key, b);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-limit).map(([, v]) => v);
}


function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="bg-white border border-black/10 rounded-xl p-4">
      <div className="text-[11px] uppercase tracking-wide text-ink-700/50">{label}</div>
      <div className="text-2xl font-medium mt-1" style={{ color: accent || '#3a2a1a' }}>{value}</div>
      {sub && <div className="text-xs text-ink-700/60 mt-0.5">{sub}</div>}
    </div>
  );
}

// ── Website revenue, straight from Paddle ─────────────────────────────
// Read from Paddle's own transaction records (/api/admin/paddle-stats), not
// from our orders table, so mixed currencies are already converted and the fee
// Paddle keeps is visible instead of hidden inside a gross number.
function PaddleRevenue({ d, err }: { d: any; err: string }) {
  return (
    <Card>
      <div className="flex items-baseline gap-2 mb-3 flex-wrap">
        <h3 className="font-medium text-ink-900 text-sm">🌐 Website revenue (Paddle)</h3>
        <span className="text-xs text-ink-700/55">from Paddle's own records · all currencies converted to {d?.currency || 'USD'}</span>
        {d?.fetchedAt && <span className="ml-auto text-[11px] text-ink-700/40">{d.transactions} transactions · {new Date(d.fetchedAt).toLocaleTimeString()}</span>}
      </div>
      {err && <p className="text-xs text-red-600 mb-2">Could not reach Paddle: {err}</p>}
      {!d && !err && <p className="text-xs text-ink-700/50">Loading from Paddle…</p>}
      {d && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {d.periods.map((p: any) => (
              <div key={p.key} className="rounded-lg border border-black/10 bg-white px-3 py-2.5">
                <div className="text-[11px] uppercase tracking-wide text-ink-700/50">{p.key}</div>
                <div className="text-2xl font-medium mt-0.5" style={{ color: '#1f9254' }}>{usd(p.earnings)}</div>
                <div className="text-[11px] text-ink-700/60">yours after fee and tax</div>
                <div className="text-[11px] text-ink-700/50 mt-1">{usd(p.gross)} paid · {usd(p.fee)} fee</div>
                <div className="text-[11px] text-ink-700/40">
                  {p.orders} order{p.orders === 1 ? '' : 's'}{p.note ? ` · ${p.note}` : ''}
                </div>
              </div>
            ))}
          </div>

          {/* The year in 3D: revenue, what Paddle took, what is left */}
          {d.calendar?.length > 0 && (
            <div className="mt-5">
              <div className="flex items-baseline gap-2 mb-1 flex-wrap">
                <h4 className="text-sm font-medium text-ink-900">{d.year} by calendar month</h4>
                <span className="text-[11px] text-ink-700/55">every month of the year, months still to come are greyed</span>
              </div>
              <Chart3D
                title="Paddle revenue by month"
                points={d.calendar.map((m: any) => ({
                  label: m.label, muted: m.future,
                  values: { gross: m.gross, fee: m.fee + m.tax, earnings: m.earnings },
                }))}
                series={[
                  { key: 'gross', label: 'Revenue (buyers paid)', color: '#2a78d6' },
                  { key: 'fee', label: 'Paid to Paddle (fee + tax)', color: '#d2544b' },
                  { key: 'earnings', label: 'Profit (yours)', color: '#1f9254' },
                ]}
              />
            </div>
          )}

          {/* Month by month: what buyers paid, what tax and Paddle took, what is left */}
          {d.byMonth?.length > 0 && (
            <div className="mt-4">
              <div className="flex items-baseline gap-2 mb-1.5 flex-wrap">
                <h4 className="text-sm font-medium text-ink-900">Month by month</h4>
                <span className="text-[11px] text-ink-700/55">what you pay Paddle, and what reaches you</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-ink-700/60 text-left">
                    <tr>
                      <th className="p-1.5">Month</th>
                      <th className="p-1.5 text-right">Orders</th>
                      <th className="p-1.5 text-right">Buyers paid</th>
                      <th className="p-1.5 text-right">Tax</th>
                      <th className="p-1.5 text-right">Paddle fee</th>
                      <th className="p-1.5 text-right">Fee %</th>
                      <th className="p-1.5 text-right">You earn</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.byMonth.map((m: any) => (
                      <tr key={m.month} className="border-t border-black/5">
                        <td className="p-1.5">{new Date(m.month + '-02').toLocaleString('en-US', { month: 'long', year: 'numeric' })}</td>
                        <td className="p-1.5 text-right">{m.orders}</td>
                        <td className="p-1.5 text-right">{usd(m.gross)}</td>
                        <td className="p-1.5 text-right text-ink-700/60">{usd(m.tax)}</td>
                        <td className="p-1.5 text-right text-red-700">{usd(m.fee)}</td>
                        <td className="p-1.5 text-right text-ink-700/60">{m.feePct}%</td>
                        <td className="p-1.5 text-right font-medium text-green-800">{usd(m.earnings)}</td>
                      </tr>
                    ))}
                    {d.allTime && (
                      <tr className="border-t-2 border-black/15 font-medium">
                        <td className="p-1.5">All time</td>
                        <td className="p-1.5 text-right">{d.allTime.orders}</td>
                        <td className="p-1.5 text-right">{usd(d.allTime.gross)}</td>
                        <td className="p-1.5 text-right text-ink-700/60">{usd(d.allTime.tax)}</td>
                        <td className="p-1.5 text-right text-red-700">{usd(d.allTime.fee)}</td>
                        <td className="p-1.5 text-right text-ink-700/60">{d.allTime.gross ? (100 * d.allTime.fee / d.allTime.gross).toFixed(1) : 0}%</td>
                        <td className="p-1.5 text-right text-green-800">{usd(d.allTime.earnings)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* What the numbers mean */}
          {d.insights && (
            <div className="mt-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="rounded-lg border border-black/10 bg-cream/30 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-ink-700/50">Average order</div>
                <div className="text-lg font-medium text-ink-900">{usd(d.insights.avgOrder)}</div>
                <div className="text-[11px] text-ink-700/55">you keep {usd(d.insights.avgEarnings)} of it</div>
              </div>
              <div className="rounded-lg border border-black/10 bg-cream/30 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-ink-700/50">Paddle's cut</div>
                <div className="text-lg font-medium text-ink-900">{d.insights.feeRateAll}%</div>
                <div className="text-[11px] text-ink-700/55">{usd(d.insights.avgFee)} per order on average</div>
              </div>
              <div className="rounded-lg border border-black/10 bg-cream/30 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-ink-700/50">Tax collected for you</div>
                <div className="text-lg font-medium text-ink-900">{usd(d.allTime.tax)}</div>
                <div className="text-[11px] text-ink-700/55">{d.insights.taxShare}% of revenue, remitted by Paddle</div>
              </div>
              <div className="rounded-lg border border-black/10 bg-cream/30 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-ink-700/50">Where buyers pay from</div>
                <div className="text-lg font-medium text-ink-900">{d.insights.currencies.length} currenc{d.insights.currencies.length === 1 ? 'y' : 'ies'}</div>
                <div className="text-[11px] text-ink-700/55 truncate">{d.insights.currencies.slice(0, 4).map((c: any) => `${c.ccy} ${c.orders}`).join(' · ')}</div>
              </div>
            </div>
          )}

          {/* The one insight that changes what you sell */}
          {d.insights && d.insights.feeRateSmallest > d.insights.feeRateLargest && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
              <b>Small orders cost you far more in fees.</b> Paddle charges a percentage plus a fixed amount per
              transaction, so your cheaper half of orders (averaging {usd(d.insights.smallestAvg)}) loses{' '}
              <b>{d.insights.feeRateSmallest}%</b> to fees, while the dearer half (averaging {usd(d.insights.largestAvg)}) loses only{' '}
              <b>{d.insights.feeRateLargest}%</b>. Every bundle, Pick-5 and membership sale you make instead of a single
              design keeps a bigger share of the money.
            </div>
          )}

          <p className="text-[11px] text-ink-700/45 mt-3 leading-relaxed">
            Every figure is Paddle's own, converted to {d.currency} by Paddle. A buyer's payment splits three ways:
            sales tax and VAT that Paddle collects and remits for you, Paddle's fee, and your earnings.
            <b> A payout is not a calendar month:</b> Paddle settles on its own schedule and may cover more than one month,
            so compare a payout against the months above rather than a single one.
            Weeks start Monday; this month, last month and this year are calendar periods; last 3 months is a rolling 90 days.
          </p>
        </>
      )}
    </Card>
  );
}

// ── Combined profit across every channel ──────────────────────────────
// Profit, not revenue, because each platform keeps a different share:
//   Paddle  earnings after its fee and the tax it remits (from Paddle itself)
//   Etsy    revenue minus Etsy's fees minus Promoted Listings ad spend
//   Cults   the designer income Cults credits, already net of its commission
function CombinedProfit({ daily, paddle }: { daily: Daily[]; paddle: any }) {
  const year = new Date().getFullYear();
  const rows = useMemo(() => {
    const m: Record<string, { etsy: number; cults: number; paddle: number }> = {};
    for (let i = 0; i < 12; i++) m[`${year}-${String(i + 1).padStart(2, '0')}`] = { etsy: 0, cults: 0, paddle: 0 };
    for (const r of daily) {
      const k = String(r.day).slice(0, 7);
      if (!m[k]) continue;
      const profit = Number(r.revenue_usd || 0) - Number(r.fees_usd || 0) - Number(r.ad_spend_usd || 0);
      if (r.channel === 'etsy') m[k].etsy += profit;
      else if (r.channel === 'cults') m[k].cults += profit;
    }
    for (const c of paddle?.calendar || []) if (m[c.month]) m[c.month].paddle = Number(c.earnings || 0);
    return Object.entries(m).map(([month, v], i) => ({
      month, label: new Date(year, i, 2).toLocaleString('en-US', { month: 'short' }),
      future: new Date(year, i, 1) > new Date(),
      ...v, total: v.etsy + v.cults + v.paddle,
    }));
  }, [daily, paddle, year]);

  const tot = rows.reduce((s, r) => ({ etsy: s.etsy + r.etsy, cults: s.cults + r.cults, paddle: s.paddle + r.paddle, total: s.total + r.total }), { etsy: 0, cults: 0, paddle: 0, total: 0 });
  const share = (v: number) => (tot.total > 0 ? Math.round((100 * v) / tot.total) : 0);
  const best = rows.filter((r) => !r.future).slice().sort((a, b) => b.total - a.total)[0];

  return (
    <Card>
      <div className="flex items-baseline gap-2 mb-3 flex-wrap">
        <h3 className="font-medium text-ink-900 text-sm">💵 Combined profit · Paddle + Etsy + Cults</h3>
        <span className="text-xs text-ink-700/55">what you actually keep, after every platform takes its share</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-wide text-green-700/70">Total profit {year}</div>
          <div className="text-2xl font-medium text-green-800">{usd(tot.total)}</div>
        </div>
        <div className="rounded-lg border border-black/10 bg-white px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-wide text-ink-700/50">Etsy</div>
          <div className="text-xl font-medium" style={{ color: '#eb6834' }}>{usd(tot.etsy)}</div>
          <div className="text-[11px] text-ink-700/55">{share(tot.etsy)}% of profit</div>
        </div>
        <div className="rounded-lg border border-black/10 bg-white px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-wide text-ink-700/50">Website (Paddle)</div>
          <div className="text-xl font-medium" style={{ color: '#2a78d6' }}>{usd(tot.paddle)}</div>
          <div className="text-[11px] text-ink-700/55">{share(tot.paddle)}% of profit</div>
        </div>
        <div className="rounded-lg border border-black/10 bg-white px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-wide text-ink-700/50">Cults3D</div>
          <div className="text-xl font-medium" style={{ color: '#1baf7a' }}>{usd(tot.cults)}</div>
          <div className="text-[11px] text-ink-700/55">{share(tot.cults)}% of profit</div>
        </div>
      </div>
      <Chart3D
        title="Combined profit by month"
        points={rows.map((r) => ({ label: r.label, muted: r.future, values: { etsy: r.etsy, paddle: r.paddle, cults: r.cults } }))}
        series={[
          { key: 'etsy', label: 'Etsy profit', color: '#eb6834' },
          { key: 'paddle', label: 'Website profit', color: '#2a78d6' },
          { key: 'cults', label: 'Cults3D profit', color: '#1baf7a' },
        ]}
      />
      {best && best.total > 0 && (
        <p className="text-[11px] text-ink-700/55 mt-2">
          Best month so far: <b>{new Date(best.month + '-02').toLocaleString('en-US', { month: 'long' })}</b> at {usd(best.total)} profit.
        </p>
      )}
      <p className="text-[11px] text-ink-700/45 mt-1 leading-relaxed">
        Profit, not revenue. Etsy is its revenue less Etsy's fees and Promoted Listings spend; the website is Paddle's own
        earnings figure after its fee and the tax it remits; Cults is the designer income it credits, already net of commission.
        Etsy and Cults come from the last local sync, the website is live from Paddle.
      </p>
    </Card>
  );
}

export default function Finance() {
  const [daily, setDaily] = useState<Daily[]>([]);
  const [status, setStatus] = useState<any>({});
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [gran, setGran] = useState<Gran>('month');
  const [loading, setLoading] = useState(true);
  const [paddle, setPaddle] = useState<any>(null);
  const [paddleErr, setPaddleErr] = useState('');

  const [web30, setWeb30] = useState(0);
  useEffect(() => { load(); loadPaddle(); }, []);
  useLiveRefresh(() => { load(true); loadPaddle(); }, 60000);   // keep this tab live (silent, pauses while editing)
  async function loadPaddle() {
    const { data: { session } } = await supabase.auth.getSession();
    const r = await fetch('/api/admin/paddle-stats', { headers: { authorization: `Bearer ${session?.access_token || ''}` } })
      .then((x) => x.json()).catch(() => ({ error: 'bad response' }));
    if (r?.error) setPaddleErr(r.error); else { setPaddle(r); setPaddleErr(''); }
  }
  async function load(silent = false) {
    if (!silent) setLoading(true);
    const since = new Date(); since.setUTCFullYear(since.getUTCFullYear() - 1);
    const [{ data: d }, { data: s }, { data: ord }] = await Promise.all([
      supabase.from('finance_daily').select('day, channel, revenue_usd, ad_spend_usd, fees_usd').order('day'),
      supabase.from('finance_status').select('data, synced_at').eq('id', 1).maybeSingle(),
      // Website revenue LIVE from orders — so a new sale shows instantly, no refresh wait.
      supabase.from('orders').select('total, created_at').eq('status', 'paid').gte('created_at', since.toISOString()).limit(5000),
    ]);
    // Build website daily rows from live orders; keep Etsy/Cults from the cache.
    const webByDay = new Map<string, number>();
    let w30 = 0; const cut30 = Date.now() - 30 * 86400000;
    for (const o of (ord || []) as any[]) {
      const day = String(o.created_at).slice(0, 10);
      webByDay.set(day, (webByDay.get(day) || 0) + (Number(o.total) || 0));
      if (new Date(o.created_at).getTime() >= cut30) w30 += Number(o.total) || 0;
    }
    const cachedNonWebsite = ((d || []) as Daily[]).filter((r) => r.channel !== 'website');
    const liveWebsite: Daily[] = [...webByDay.entries()].map(([day, rev]) => ({ day, channel: 'website', revenue_usd: rev, ad_spend_usd: 0, fees_usd: 0 }));
    setDaily([...cachedNonWebsite, ...liveWebsite]);
    setWeb30(Math.round(w30 * 100) / 100);
    setStatus((s?.data as any) || {});
    setSyncedAt(s?.synced_at || null);
    setLoading(false);
  }

  const limit = gran === 'week' ? 16 : gran === 'month' ? 13 : 5;
  const revBuckets = useMemo(() => rollup(daily, gran, 'revenue_usd', limit), [daily, gran, limit]);
  const adBuckets = useMemo(() => rollup(daily.filter((x) => x.channel === 'etsy'), gran, 'ad_spend_usd', limit), [daily, gran, limit]);
  const totalRev = useMemo(() => daily.reduce((s, r) => s + Number(r.revenue_usd || 0), 0), [daily]);
  const totalAd = useMemo(() => daily.reduce((s, r) => s + Number(r.ad_spend_usd || 0), 0), [daily]);

  const ch = status.channels || {};
  const web = ch.website || {}, etsy = ch.etsy || {}, cults = ch.cults || {};

  if (loading) return <div className="text-sm text-ink-700/60">Loading finance…</div>;
  const noData = daily.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-700/60">
        <span>💰 USD (Cults €→$ at {cults.eur_usd || '~1.08'}). <b>Website = live</b>; Etsy/Cults from last sync.</span>
        <span className="ml-auto">Etsy/Cults synced: {syncedAt ? new Date(syncedAt).toLocaleString() : 'never'}</span>
        <button className="underline text-bronze-700" onClick={() => load()}>reload</button>
      </div>

      {noData && (
        <Card><p className="text-sm text-ink-700/70">No finance data cached yet. Run the local refresh: <code className="bg-cream px-1 rounded">node scripts/finance_refresh.mjs</code> (needs the Etsy OAuth token on that machine, like the Cults3D engine). Then hit <b>reload</b>.</p></Card>
      )}

      {/* Channel stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Website (Paddle)" value={usd(web30)} sub="revenue · last 30 days · live" accent="#2a78d6" />
        <StatCard label="Etsy balance" value={usd(etsy.balance)} sub={etsy.next_payout_est ? `next payout ~${etsy.next_payout_est}` : 'awaiting sync'} accent="#eb6834" />
        <StatCard label="Cults3D available" value={eur(cults.available)} sub={`pending ${eur(cults.pending)}`} accent="#1baf7a" />
        <StatCard label="Etsy ad spend" value={usd(totalAd)} sub={`Promoted Listings · ${gran === 'year' ? 'shown' : 'total window'}`} accent="#993c1d" />
      </div>

      <CombinedProfit daily={daily} paddle={paddle} />
      <PaddleRevenue d={paddle} err={paddleErr} />

      {/* Payout / due-date row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <div className="text-sm font-medium text-ink-900 mb-1">Etsy payout</div>
          <div className="text-xs text-ink-700/70">Last: {etsy.last_payout ? `${usd(etsy.last_payout.amount)} on ${etsy.last_payout.date}` : '—'}</div>
          <div className="text-xs text-ink-700/70">Est. next: {etsy.next_payout_est || '—'} <span className="text-ink-700/40">(estimate)</span></div>
        </Card>
        <Card>
          <div className="text-sm font-medium text-ink-900 mb-1">Cults3D payout</div>
          <div className="text-xs text-ink-700/70">Available now: {eur(cults.available)} · pending {eur(cults.pending)}</div>
          <div className="text-xs text-ink-700/70">Est. next: {cults.next_payout_est || '—'}</div>
          <a href={cults.payout_url || 'https://cults3d.com/en/sales'} target="_blank" rel="noreferrer" className="inline-block mt-2 bg-bronze-600 hover:bg-bronze-700 text-cream px-3 py-1.5 rounded text-xs">Request payout on Cults3D ↗</a>
        </Card>
        <Card>
          <div className="text-sm font-medium text-ink-900 mb-1">Totals (window)</div>
          <div className="text-xs text-ink-700/70">Revenue: {usd(totalRev)}</div>
          <div className="text-xs text-ink-700/70">Etsy fees: {usd(etsy.fees)} · ad spend: {usd(totalAd)}</div>
        </Card>
      </div>

      {/* Revenue graph */}
      <Card>
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-medium text-ink-900">Revenue by {gran}</div>
          <div className="flex gap-1">
            {(['week', 'month', 'year'] as Gran[]).map((g) => (
              <button key={g} onClick={() => setGran(g)} className={`text-xs px-2 py-1 rounded ${gran === g ? 'bg-bronze-600 text-cream' : 'bg-cream text-ink-700'}`}>{g[0].toUpperCase() + g.slice(1)}</button>
            ))}
          </div>
        </div>
        <div className="flex gap-4 text-xs text-ink-700/60 mb-2">
          {Object.entries(CHANNELS).map(([k, c]) => (
            <span key={k} className="flex items-center gap-1"><span style={{ width: 10, height: 10, borderRadius: 2, background: c.color, display: 'inline-block' }} />{c.label}</span>
          ))}
        </div>
        {revBuckets.length ? (
          <Chart3D
            title="Revenue by channel"
            points={revBuckets.map((b) => ({ label: b.label, values: { etsy: b.seg.etsy || 0, website: b.seg.website || 0, cults: b.seg.cults || 0 } }))}
            series={[
              { key: 'etsy', label: 'Etsy', color: '#eb6834' },
              { key: 'website', label: 'Website', color: '#2a78d6' },
              { key: 'cults', label: 'Cults3D', color: '#1baf7a' },
            ]}
          />
        ) : <p className="text-xs text-ink-700/50 py-8 text-center">No revenue in range.</p>}
      </Card>

      {/* Ad spend graph */}
      <Card>
        <div className="text-sm font-medium text-ink-900 mb-2">Etsy ad spend by {gran}</div>
        {adBuckets.some((b) => b.total > 0) ? (
          <Chart3D
            title="Etsy ad spend"
            points={adBuckets.map((b) => ({ label: b.label, values: { etsy: b.seg.etsy || 0 } }))}
            series={[{ key: 'etsy', label: 'Promoted Listings spend', color: '#993c1d' }]}
          />
        ) : <p className="text-xs text-ink-700/50 py-8 text-center">No ad spend recorded in range.</p>}
      </Card>

      <SubscriptionCosts />
    </div>
  );
}

// ── Subscription costs — every fixed fee the owner pays, editable ─────
type SubCost = { name: string; monthly_usd: number; note?: string };
function SubscriptionCosts() {
  const [rows, setRows] = useState<SubCost[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const load = async () => {
    const { data } = await supabase.from('growth_settings').select('subscription_costs').eq('id', 1).maybeSingle();
    setRows(Array.isArray(data?.subscription_costs) ? data!.subscription_costs : []);
    setDirty(false);
  };
  useEffect(() => { load(); }, []);
  if (!rows) return null;
  const upd = (i: number, patch: Partial<SubCost>) => { setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r))); setDirty(true); };
  const save = async () => {
    setSaving(true);
    const clean = rows.filter((r) => (r.name || '').trim()).map((r) => ({ name: r.name.trim().slice(0, 80), monthly_usd: Math.max(0, Number(r.monthly_usd) || 0), note: (r.note || '').trim().slice(0, 160) }));
    await supabase.from('growth_settings').update({ subscription_costs: clean }).eq('id', 1);
    setRows(clean); setDirty(false); setSaving(false);
  };
  const total = rows.reduce((s, r) => s + (Number(r.monthly_usd) || 0), 0);
  return (
    <Card>
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-1">
        <div className="text-sm font-bold text-ink-900">🧾 Subscription costs (what you pay monthly)</div>
        <div className="text-sm"><b className="text-bronze-800 text-lg">${total.toFixed(2)}</b><span className="text-ink-700/50">/month · ${(total * 12).toFixed(0)}/year</span></div>
      </div>
      <p className="text-[11px] text-ink-700/55 mb-3">Edit amounts as your plans change (e.g. set Resend to 20 when you upgrade). Saved instantly to the site settings.</p>
      <div className="space-y-1.5">
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <input value={r.name} onChange={(e) => upd(i, { name: e.target.value })} placeholder="Service" className="border border-black/15 rounded px-2 py-1.5 text-sm flex-1 min-w-[140px]" />
            <span className="text-xs text-ink-700/50">$</span>
            <input type="number" min={0} step={0.01} value={r.monthly_usd} onChange={(e) => upd(i, { monthly_usd: Number(e.target.value) })} className="border border-black/15 rounded px-2 py-1.5 text-sm w-24" />
            <input value={r.note || ''} onChange={(e) => upd(i, { note: e.target.value })} placeholder="note" className="border border-black/15 rounded px-2 py-1.5 text-xs flex-[2] min-w-[160px] text-ink-700/70" />
            <button className="text-xs text-red-500 hover:text-red-700 px-1" title="Remove" onClick={() => { setRows(rows.filter((_, j) => j !== i)); setDirty(true); }}>✕</button>
          </div>
        ))}
      </div>
      <div className="flex gap-2 mt-3">
        <button className="text-xs border border-black/15 rounded px-3 py-1.5 hover:border-bronze-600" onClick={() => { setRows([...rows, { name: '', monthly_usd: 0, note: '' }]); setDirty(true); }}>+ Add a cost</button>
        <button className={`text-xs rounded px-3 py-1.5 ${dirty ? 'bg-bronze-600 text-cream hover:bg-bronze-700' : 'border border-black/10 text-ink-700/40'}`} disabled={!dirty || saving} onClick={save}>{saving ? 'Saving…' : dirty ? 'Save costs' : 'Saved'}</button>
      </div>
    </Card>
  );
}
