// Admin > Advertising. One place to decide the Etsy Promoted Listings budget,
// see which listings are eating exposure for nothing, and know when orders
// actually arrive. Every number comes from /api/admin/ad-strategy, which reads
// the shop's own history; nothing here is a rule of thumb.
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { Card, btnPrimary, btnGhost, inputCls } from '../ui';
import { useLiveRefresh } from '../useLiveRefresh';
import Chart3D from '../Chart3D';

const usd = (n: number | null | undefined) => (n == null ? '—' : '$' + (Math.round(Number(n) * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: Math.abs(Number(n)) < 100 ? 2 : 0 }));

export default function AdStrategy() {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  const [budget, setBudget] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [tz, setTz] = useState<'Asia/Karachi' | 'America/Los_Angeles'>('Asia/Karachi');

  async function load() {
    const { data: { session } } = await supabase.auth.getSession();
    const r = await fetch('/api/admin/ad-strategy', { headers: { authorization: `Bearer ${session?.access_token || ''}` } })
      .then((x) => x.json()).catch(() => ({ error: 'bad response' }));
    if (r?.error) setErr(r.error); else { setD(r); setErr(''); }
  }
  useEffect(() => { load(); }, []);
  useLiveRefresh(load, 300000);

  async function saveBudget() {
    const v = Number(budget);
    if (!Number.isFinite(v) || v < 0) { setMsg('Enter a number.'); return; }
    setBusy(true);
    const { data: { session } } = await supabase.auth.getSession();
    const r = await fetch('/api/admin/ad-strategy', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${session?.access_token || ''}` },
      body: JSON.stringify({ daily_budget: v, reason }),
    }).then((x) => x.json()).catch(() => ({ error: 'bad response' }));
    setBusy(false);
    setMsg(r?.error || `Recorded $${v}/day. Now set the same number in Etsy > Marketing > Etsy Ads.`);
    if (!r?.error) { setBudget(''); setReason(''); load(); }
  }

  if (err) return <Card><p className="text-sm text-red-600">Could not load: {err}</p></Card>;
  if (!d) return <Card><p className="text-sm text-ink-700/60">Reading your advertising history…</p></Card>;

  const rec = d.recommendation, now = d.now, L = d.listings;
  const hours = (d.hours || []).filter((h: any) => h.tz === tz).sort((a: any, b: any) => a.hour - b.hour);
  const totalOrders = hours.reduce((s: number, h: any) => s + h.orders, 0);
  const peak = [...hours].sort((a: any, b: any) => b.orders - a.orders).slice(0, 8).map((h: any) => h.hour).sort((a: number, b: number) => a - b);
  const bestBand = (d.tiers || []).filter((t: any) => t.reliable).slice().sort((a: any, b: any) => b.margin - a.margin)[0];
  const gap = rec.gap;

  return (
    <div className="space-y-4">
      <div className="text-xs text-ink-700/70 bg-cream/40 border border-bronze-600/15 rounded-lg px-3 py-2">
        📣 <b>Advertising.</b> Etsy Promoted Listings is the largest cost in the business. This page decides the budget from
        your own history, names the listings taking exposure without selling, and shows when orders really arrive.
        Etsy publishes no per-listing ad spend, so listing waste is measured by views without sales and labelled as such.
      </div>

      {/* THE DECISION */}
      <Card>
        <div className="flex items-baseline gap-2 mb-3 flex-wrap">
          <h3 className="font-medium text-ink-900 text-sm">🎯 What to set today</h3>
          <span className="text-xs text-ink-700/55">from {now.days} recent complete days and {d.tiers.reduce((s: number, t: any) => s + t.days, 0)} days of history</span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-lg border-2 border-green-300 bg-green-50 px-4 py-3">
            <div className="text-[10px] uppercase tracking-wide text-green-700/70">Recommended daily budget</div>
            <div className="text-3xl font-bold text-green-800">{usd(rec.daily)}</div>
            <div className="text-[11px] text-green-800/70">{rec.targetShare}% of your {usd(now.revPerDay)}/day revenue</div>
          </div>
          <div className="rounded-lg border border-black/10 bg-white px-4 py-3">
            <div className="text-[10px] uppercase tracking-wide text-ink-700/50">You are running</div>
            <div className="text-2xl font-medium text-ink-900">{rec.currentBudget != null ? usd(rec.currentBudget) : '—'}</div>
            <div className="text-[11px] text-ink-700/55">actually spending {usd(now.adPerDay)}/day, {now.adShare}% of revenue</div>
          </div>
          <div className="rounded-lg border border-black/10 bg-white px-4 py-3">
            <div className="text-[10px] uppercase tracking-wide text-ink-700/50">Profit right now</div>
            <div className="text-2xl font-medium" style={{ color: '#1f9254' }}>{usd(now.profitPerDay)}</div>
            <div className="text-[11px] text-ink-700/55">per day, after Etsy fees and ads</div>
          </div>
          <div className="rounded-lg border border-black/10 bg-white px-4 py-3">
            <div className="text-[10px] uppercase tracking-wide text-ink-700/50">Best evidenced band</div>
            <div className="text-2xl font-medium text-ink-900">{bestBand?.band || '—'}</div>
            <div className="text-[11px] text-ink-700/55">{bestBand ? `${bestBand.margin}% margin over ${bestBand.days} days` : ''}</div>
          </div>
        </div>

        {gap != null && Math.abs(gap) >= 5 && (
          <div className={`mt-3 rounded-lg px-3 py-2.5 text-xs ${gap > 0 ? 'border border-amber-200 bg-amber-50 text-amber-900' : 'border border-sky-200 bg-sky-50 text-sky-900'}`}>
            {gap > 0
              ? <>Your budget is <b>{usd(Math.abs(gap))} below</b> the recommendation. That is a safe place to be, but if revenue holds you can move up to {usd(rec.daily)} without leaving the best-margin band.</>
              : <>Your budget is <b>{usd(Math.abs(gap))} above</b> the recommendation. At your current revenue that pushes ad share past the band where margin holds up.</>}
          </div>
        )}

        <div className="mt-4 pt-3 border-t border-black/10 flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="text-[10px] uppercase tracking-wide text-ink-700/50">Record a budget change</span>
            <input value={budget} onChange={(e) => setBudget(e.target.value)} placeholder={String(rec.daily)} className={inputCls + ' w-28'} />
          </label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="why (optional)" className={inputCls + ' flex-1 min-w-[180px]'} />
          <button className={btnPrimary} disabled={busy} onClick={saveBudget}>{busy ? 'Saving…' : 'Log it'}</button>
          {msg && <span className="text-xs text-bronze-800 basis-full">{msg}</span>}
          <p className="text-[11px] text-ink-700/45 basis-full">
            Logging here does not change Etsy. Set the number in Etsy under Marketing, then log it so the next review can
            judge the change against what followed it.
          </p>
        </div>
      </Card>

      {/* THE EVIDENCE */}
      <Card>
        <div className="flex items-baseline gap-2 mb-1 flex-wrap">
          <h3 className="font-medium text-ink-900 text-sm">📊 What each level of advertising has actually done</h3>
          <span className="text-xs text-ink-700/55">grouped by ad share of revenue, not by dollars</span>
        </div>
        <p className="text-[11px] text-ink-700/55 mb-3">
          Grouping by dollar budget is misleading: Etsy spends more on busy days, so high spend looks like it causes high
          revenue when it merely follows it. Share of revenue removes that. Read the <b>margin</b> column: if more
          advertising bought more sales, revenue per day would climb with it.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-ink-700/60 text-left">
              <tr><th className="p-1.5">Ad share of revenue</th><th className="p-1.5 text-right">Days</th><th className="p-1.5 text-right">Ad spend/day</th><th className="p-1.5 text-right">Revenue/day</th><th className="p-1.5 text-right">Profit/day</th><th className="p-1.5 text-right">Margin</th></tr>
            </thead>
            <tbody>
              {(d.tiers || []).map((t: any) => (
                <tr key={t.band} className={`border-t border-black/5 ${bestBand && t.band === bestBand.band ? 'bg-green-50' : ''}`}>
                  <td className="p-1.5">{t.band}{bestBand && t.band === bestBand.band ? ' ★' : ''}</td>
                  <td className="p-1.5 text-right">{t.days}{t.reliable ? '' : ' (thin)'}</td>
                  <td className="p-1.5 text-right text-red-700">{usd(t.adPerDay)}</td>
                  <td className="p-1.5 text-right">{usd(t.revPerDay)}</td>
                  <td className="p-1.5 text-right text-green-800">{usd(t.profitPerDay)}</td>
                  <td className="p-1.5 text-right font-medium">{t.margin}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* WHEN ORDERS ARRIVE */}
      <Card>
        <div className="flex items-baseline gap-2 mb-3 flex-wrap">
          <h3 className="font-medium text-ink-900 text-sm">🕐 When your orders actually arrive</h3>
          <span className="text-xs text-ink-700/55">{totalOrders.toLocaleString()} Etsy orders over {hours[0]?.sample_days || 0} days</span>
          <div className="ml-auto flex gap-1">
            {([['Asia/Karachi', 'Your time'], ['America/Los_Angeles', 'Pacific']] as const).map(([k, lbl]) => (
              <button key={k} onClick={() => setTz(k)} className={`text-xs px-2 py-1 rounded ${tz === k ? 'bg-bronze-600 text-cream' : 'bg-cream text-ink-700'}`}>{lbl}</button>
            ))}
          </div>
        </div>
        {hours.length ? (
          <>
            <Chart3D
              title="Orders by hour"
              height={150}
              points={hours.map((h: any) => ({ label: String(h.hour).padStart(2, '0'), values: { orders: h.orders } }))}
              series={[{ key: 'orders', label: `Orders per hour (${tz === 'Asia/Karachi' ? 'Pakistan time' : 'Pacific time'})`, color: '#b8791f' }]}
            />
            <p className="text-[11px] text-ink-700/60 mt-2">
              Busiest eight hours: <b>{peak.map((h: number) => `${String(h).padStart(2, '0')}:00`).join(', ')}</b>, which carry{' '}
              {Math.round((100 * peak.reduce((s: number, h: number) => s + (hours.find((x: any) => x.hour === h)?.orders || 0), 0)) / Math.max(1, totalOrders))}% of all orders.
              Etsy has no ad scheduling, so this cannot set bid times, but it tells you when to publish new designs and send email so they land while buyers are actually shopping.
            </p>
          </>
        ) : <p className="text-xs text-ink-700/50 py-6 text-center">No order-hour data yet. Run <code className="bg-cream px-1 rounded">node scripts/etsy_ads_sync.mjs</code>.</p>}
      </Card>

      {/* WASTE */}
      <Card>
        <div className="flex items-baseline gap-2 mb-1 flex-wrap">
          <h3 className="font-medium text-ink-900 text-sm">🔻 Listings taking exposure and returning nothing</h3>
          <span className="text-xs text-ink-700/55">{L.dead} of {L.total} listings have no sale in 365 days</span>
        </div>
        <p className="text-[11px] text-ink-700/55 mb-3">
          Etsy publishes no per-listing ad spend, so this ranks by {L.wasteBasis === 'recentViews' ? 'views gained in the last 45 days' : 'lifetime views'} with
          zero sales, which is where advertising money goes without returning. Those listings hold{' '}
          <b>{Math.round((100 * L.wasteViews) / Math.max(1, L.totalViews))}%</b> of all your views.
          {L.wasteBasis === 'views' && ' Recent-view tracking starts from today, so this improves after a few days of history.'}
          {' '}Switch them off in Etsy under Marketing, Etsy Ads, Manage advertised listings.
        </p>
        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="text-ink-700/60 text-left sticky top-0 bg-white">
              <tr><th className="p-1.5">Listing</th><th className="p-1.5 text-right">{L.wasteBasis === 'recentViews' ? 'Views (45d)' : 'Views'}</th><th className="p-1.5 text-right">Favourites</th><th className="p-1.5 text-right">Sales</th><th className="p-1.5"></th></tr>
            </thead>
            <tbody>
              {L.waste.map((l: any) => (
                <tr key={l.listing_id} className="border-t border-black/5">
                  <td className="p-1.5">{l.title.slice(0, 62)}</td>
                  <td className="p-1.5 text-right font-medium text-red-700">{(L.wasteBasis === 'recentViews' ? l.recentViews : l.views)?.toLocaleString?.() ?? 0}</td>
                  <td className="p-1.5 text-right text-ink-700/60">{l.favorers}</td>
                  <td className="p-1.5 text-right">0</td>
                  <td className="p-1.5"><a href={`https://www.etsy.com/listing/${l.listing_id}`} target="_blank" rel="noreferrer" className="text-bronze-700 underline">open ↗</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* WINNERS */}
      <Card>
        <div className="flex items-baseline gap-2 mb-2 flex-wrap">
          <h3 className="font-medium text-ink-900 text-sm">🏆 The listings worth advertising</h3>
          <span className="text-xs text-ink-700/55">3 or more sales in 365 days; keep the budget on these</span>
        </div>
        <div className="overflow-x-auto max-h-80 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="text-ink-700/60 text-left sticky top-0 bg-white">
              <tr><th className="p-1.5">Listing</th><th className="p-1.5 text-right">Sales</th><th className="p-1.5 text-right">Views</th><th className="p-1.5 text-right">Sales per 100 views</th></tr>
            </thead>
            <tbody>
              {L.winners.map((l: any) => (
                <tr key={l.listing_id} className="border-t border-black/5">
                  <td className="p-1.5">{l.title.slice(0, 62)}</td>
                  <td className="p-1.5 text-right font-medium text-green-800">{l.sales}</td>
                  <td className="p-1.5 text-right text-ink-700/60">{l.views.toLocaleString()}</td>
                  <td className="p-1.5 text-right">{l.conversion}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* HISTORY */}
      {d.budgets?.length > 0 && (
        <Card>
          <h3 className="font-medium text-ink-900 text-sm mb-2">Budget changes</h3>
          <table className="w-full text-xs">
            <thead className="text-ink-700/60 text-left"><tr><th className="p-1.5">When</th><th className="p-1.5 text-right">From</th><th className="p-1.5 text-right">To</th><th className="p-1.5">Why</th></tr></thead>
            <tbody>
              {d.budgets.map((b: any) => (
                <tr key={b.id} className="border-t border-black/5">
                  <td className="p-1.5">{new Date(b.changed_at).toLocaleDateString()}</td>
                  <td className="p-1.5 text-right text-ink-700/60">{b.previous_budget != null ? usd(b.previous_budget) : '—'}</td>
                  <td className="p-1.5 text-right font-medium">{usd(b.daily_budget)}</td>
                  <td className="p-1.5 text-ink-700/70">{b.reason || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
