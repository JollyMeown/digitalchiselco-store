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

  // A review is logged whether or not the number changes. A run of correct
  // holds is evidence, and without this the log would only ever show changes.
  async function logReview(action: string, note: string) {
    setBusy(true);
    const { data: { session } } = await supabase.auth.getSession();
    const n = d.now, r0 = d.recommendation;
    const r = await fetch('/api/admin/ad-strategy', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${session?.access_token || ''}` },
      body: JSON.stringify({ review: { window_days: n.days, rev_per_day: n.revPerDay, ad_per_day: n.adPerDay, profit_per_day: n.profitPerDay, margin: n.revPerDay ? +((100 * n.profitPerDay) / n.revPerDay).toFixed(1) : null, ad_share: n.adShare, recommended: r0.daily, action, note } }),
    }).then((x) => x.json()).catch(() => ({ error: 'bad response' }));
    setBusy(false);
    setMsg(r?.error || `Review logged. Next review ${r.nextReview}.`);
    if (!r?.error) load();
  }

  if (err) return <Card><p className="text-sm text-red-600">Could not load: {err}</p></Card>;
  if (!d) return <Card><p className="text-sm text-ink-700/60">Reading your advertising history…</p></Card>;

  const rec = d.recommendation, now = d.now, L = d.listings, plan = d.plan, NL = d.newListings;
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

      {/* THE STANDING PLAN */}
      <Card>
        <div className="flex items-baseline gap-2 mb-3 flex-wrap">
          <h3 className="font-medium text-ink-900 text-sm">🗓️ The plan</h3>
          <span className="text-xs text-ink-700/55">a budget is a decision with a review date on it, not a setting</span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-lg border border-black/10 bg-white px-4 py-3">
            <div className="text-[10px] uppercase tracking-wide text-ink-700/50">Budget in force</div>
            <div className="text-2xl font-bold text-ink-900">{plan.current != null ? usd(plan.current) : 'not set'}</div>
            <div className="text-[11px] text-ink-700/55">
              {plan.setOn ? `set ${new Date(plan.setOn).toLocaleDateString()}, held ${plan.daysHeld} day${plan.daysHeld === 1 ? '' : 's'}` : 'log the number you have in Etsy'}
            </div>
          </div>
          <div className={`rounded-lg px-4 py-3 border ${plan.due ? 'border-amber-300 bg-amber-50' : 'border-black/10 bg-white'}`}>
            <div className="text-[10px] uppercase tracking-wide text-ink-700/50">Next review</div>
            <div className="text-2xl font-medium text-ink-900">{plan.reviewOn ? new Date(plan.reviewOn + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '—'}</div>
            <div className="text-[11px] text-ink-700/55">
              {plan.due ? 'due now' : plan.daysToReview != null ? `in ${plan.daysToReview} days` : ''}
              {plan.cadence ? `, every ${plan.cadence} days` : ''}
            </div>
          </div>
          <div className="rounded-lg border border-black/10 bg-white px-4 py-3">
            <div className="text-[10px] uppercase tracking-wide text-ink-700/50">Since the change</div>
            <div className="text-2xl font-medium" style={{ color: '#1f9254' }}>{plan.sinceChange ? usd(plan.sinceChange.profitPerDay) : '—'}</div>
            <div className="text-[11px] text-ink-700/55">
              {plan.sinceChange ? `profit per day over ${plan.sinceChange.days} day${plan.sinceChange.days === 1 ? '' : 's'}, ${plan.sinceChange.margin}% margin` : 'measured from the day it was set'}
            </div>
          </div>
          <div className={`rounded-lg px-4 py-3 border-2 ${plan.action === 'hold' ? 'border-green-300 bg-green-50' : plan.action === 'cut' ? 'border-red-300 bg-red-50' : plan.action === 'wait' ? 'border-amber-300 bg-amber-50' : 'border-sky-300 bg-sky-50'}`}>
            <div className="text-[10px] uppercase tracking-wide text-ink-700/50">Call today</div>
            <div className="text-2xl font-bold text-ink-900 capitalize">{plan.action === 'wait' ? 'Leave it' : plan.action}</div>
            <div className="text-[11px] text-ink-700/60">
              {plan.action === 'wait' ? `only ${plan.daysHeld} day${plan.daysHeld === 1 ? '' : 's'} at this budget, judge it at the review`
                : plan.action === 'hold' ? `spend is inside the target band at ${plan.shareSinceChange ?? now.adShare}% of revenue`
                : plan.action === 'cut' ? `spend has drifted above ${rec.targetShare}% of revenue`
                : `there is room up to ${usd(plan.ceiling)}/day`}
            </div>
          </div>
        </div>

        <div className="mt-3 rounded-lg border border-bronze-600/20 bg-cream/40 px-3 py-2.5 text-xs text-ink-700/80">
          <b>How this runs.</b> The budget is set as a share of revenue, never as a fixed sum, because a fixed sum quietly
          becomes too large the moment sales soften. The guard rails are <b>{usd(plan.floor)} floor</b> and <b>{usd(plan.ceiling)} ceiling</b> at
          today's {usd(now.revPerDay)}/day of revenue, with {rec.targetShare}% as the aim. On the review date the days since the change are
          compared with the days before it, the verdict is written into the log below, and the clock restarts. Every review is
          recorded even when the answer is to leave the number alone, so the log becomes the pattern rather than a list of changes.
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-ink-700/55">Log today's review:</span>
          <button className={btnGhost} disabled={busy} onClick={() => logReview('hold', `held ${usd(plan.current)}/day, ad share ${now.adShare}%`)}>✅ Held it</button>
          <button className={btnGhost} disabled={busy} onClick={() => logReview('cut', 'cut after review')}>🔻 Cut it</button>
          <button className={btnGhost} disabled={busy} onClick={() => logReview('raise', 'raised after review')}>🔺 Raised it</button>
        </div>
      </Card>

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
          {' '}<b>Edit</b> opens the listing straight in Etsy's editor so advertising can be switched off there.
        </p>
        <div className="flex flex-wrap gap-2 mb-3">
          <a href="https://www.etsy.com/your/shops/me/advertising" target="_blank" rel="noreferrer" className={btnGhost}>📣 Etsy Ads: manage advertised listings ↗</a>
          <button className={btnGhost} onClick={() => {
            const ids = L.waste.map((l: any) => l.listing_id).join('\n');
            navigator.clipboard.writeText(ids).then(() => setMsg(`${L.waste.length} listing ids copied`), () => setMsg('copy failed'));
          }}>📋 Copy these listing ids</button>
        </div>
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
                  <td className="p-1.5 whitespace-nowrap">
                    {/* straight into the listing editor, where advertising can be switched off */}
                    <a href={`https://www.etsy.com/your/shops/me/tools/listings/${l.listing_id}`} target="_blank" rel="noreferrer" className="text-bronze-700 underline font-medium">edit ↗</a>
                    <a href={`https://www.etsy.com/listing/${l.listing_id}`} target="_blank" rel="noreferrer" className="text-ink-700/50 underline ml-2">view</a>
                  </td>
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

      {/* NEW LISTINGS: should advertising go on automatically? */}
      {NL?.bands?.length > 0 && (
        <Card>
          <div className="flex items-baseline gap-2 mb-1 flex-wrap">
            <h3 className="font-medium text-ink-900 text-sm">🌱 Should a new listing be advertised?</h3>
            <span className="text-xs text-ink-700/55">how listings of each age have actually performed in this shop</span>
          </div>
          <p className="text-[11px] text-ink-700/60 mb-3">
            A sale is worth <b>{usd(NL.netPerOrder)}</b> after Etsy's cut, on a {usd(NL.aov)} average order. A sale takes about{' '}
            <b>{NL.viewsPerSale} views</b>, so a visit is worth at most <b>{NL.breakevenCpc != null ? '$' + NL.breakevenCpc.toFixed(2) : '—'}</b> on a
            listing converting like the rest of the shop, and <b>{NL.breakevenCpcWeak != null ? '$' + NL.breakevenCpcWeak.toFixed(2) : '—'}</b> on one
            converting half as well. Anything above that is paid for out of profit.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-ink-700/60 text-left">
                <tr><th className="p-1.5">Listing age</th><th className="p-1.5 text-right">Listings</th><th className="p-1.5 text-right">Ever sold</th><th className="p-1.5 text-right">Avg views</th><th className="p-1.5 text-right">Views per sale</th><th className="p-1.5 text-right">Sales each</th></tr>
              </thead>
              <tbody>
                {NL.bands.map((b: any) => (
                  <tr key={b.band} className="border-t border-black/5">
                    <td className="p-1.5">{b.band}</td>
                    <td className="p-1.5 text-right text-ink-700/60">{b.listings}</td>
                    <td className="p-1.5 text-right font-medium" style={{ color: b.soldPct >= 50 ? '#1f9254' : b.soldPct >= 20 ? '#a16207' : '#b91c1c' }}>{b.soldPct}%</td>
                    <td className="p-1.5 text-right text-ink-700/60">{b.avgViews.toLocaleString()}</td>
                    <td className="p-1.5 text-right text-ink-700/60">{b.viewsPerSale ?? '—'}</td>
                    <td className="p-1.5 text-right">{b.salesPerListing}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-ink-700/60 mt-2">
            Read the "ever sold" column downwards. If new listings sold at anything like the rate of settled ones, advertising
            every launch would pay for itself. Where the top rows sit far below the bottom rows, a launch is unproven rather
            than slow, and the sound approach is a short capped test on each new listing, then budget only for the ones that
            convert. The test is capped in days and in money so a launch that does nothing stops costing anything.
          </p>
        </Card>
      )}

      {/* HISTORY: every budget with what it actually produced */}
      {d.history?.length > 0 && (
        <Card>
          <div className="flex items-baseline gap-2 mb-1 flex-wrap">
            <h3 className="font-medium text-ink-900 text-sm">📒 Budget log and what each one produced</h3>
            <span className="text-xs text-ink-700/55">the pattern builds here, one period at a time</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-ink-700/60 text-left">
                <tr><th className="p-1.5">Period</th><th className="p-1.5 text-right">Budget</th><th className="p-1.5 text-right">Spent/day</th><th className="p-1.5 text-right">Revenue/day</th><th className="p-1.5 text-right">Profit/day</th><th className="p-1.5 text-right">Margin</th><th className="p-1.5">Why</th></tr>
              </thead>
              <tbody>
                {d.history.map((b: any) => (
                  <tr key={b.id} className="border-t border-black/5 align-top">
                    <td className="p-1.5 whitespace-nowrap">
                      {new Date(b.from + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                      <span className="text-ink-700/40"> to {new Date(b.to + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
                      <div className="text-[10px] text-ink-700/40">{b.result.days} day{b.result.days === 1 ? '' : 's'}{b.result.thin ? ', too short to judge' : ''}{b.source === 'claude' ? ' · proposed here' : ''}</div>
                    </td>
                    <td className="p-1.5 text-right font-medium">
                      {usd(b.daily_budget)}
                      {b.previous_budget != null && <div className="text-[10px] text-ink-700/40">from {usd(b.previous_budget)}</div>}
                    </td>
                    <td className="p-1.5 text-right text-ink-700/60">{b.result.days ? usd(b.result.adPerDay) : '—'}</td>
                    <td className="p-1.5 text-right text-ink-700/60">{b.result.days ? usd(b.result.revPerDay) : '—'}</td>
                    <td className="p-1.5 text-right font-medium" style={{ color: '#1f9254' }}>{b.result.days ? usd(b.result.profitPerDay) : '—'}</td>
                    <td className="p-1.5 text-right">
                      {b.result.margin != null ? b.result.margin + '%' : '—'}
                      {b.vsPrevious && (
                        <div className="text-[10px]" style={{ color: b.vsPrevious.margin >= 0 ? '#1f9254' : '#b91c1c' }}>
                          {b.vsPrevious.margin >= 0 ? '+' : ''}{b.vsPrevious.margin} pts
                        </div>
                      )}
                    </td>
                    <td className="p-1.5 text-ink-700/70">{b.reason || ''}{b.expectation ? <div className="text-[10px] text-ink-700/45">expected: {b.expectation}</div> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {d.reviews?.length > 0 && (
            <div className="mt-3 pt-2 border-t border-black/10">
              <div className="text-[10px] uppercase tracking-wide text-ink-700/50 mb-1">Reviews</div>
              <ul className="text-[11px] text-ink-700/70 space-y-0.5">
                {d.reviews.map((r: any) => (
                  <li key={r.id}>
                    {new Date(r.reviewed_at).toLocaleDateString()} · <b className="capitalize">{r.action}</b> · {usd(r.rev_per_day)}/day revenue, {r.ad_share}% on ads, {r.margin}% margin{r.note ? ` · ${r.note}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
