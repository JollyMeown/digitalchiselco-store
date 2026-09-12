// Google Shopping, scored from the shop's own books.
//
// Google reports its own conversions, and with a 30-day click window it can
// credit itself with a sale that email or Etsy produced. So the first figures
// here are what WE can prove: a click that arrived carrying Google's own click
// id, and an order that carried that id through checkout. Google's claim is
// shown beside it. When the two disagree, the difference is the attribution
// window, and ours is the number to spend against.
//
// Cost is the single figure that cannot be measured here: this account has no
// Ads API, so it is typed in or pasted from the Ads export.
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Card, btnPrimary, btnGhost, inputCls } from './ui';

const usd = (n: number | null | undefined) => (n == null ? '—' : '$' + (Math.round(Number(n) * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 }));
const pkr = (n: number | null | undefined) => (n == null ? '—' : 'Rs ' + Math.round(Number(n)).toLocaleString());

export default function GoogleAdsPanel() {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [form, setForm] = useState({ day: new Date().toISOString().slice(0, 10), cost_pkr: '', clicks: '', impressions: '', conversions: '' });

  async function load() {
    const { data: { session } } = await supabase.auth.getSession();
    const r = await fetch('/api/admin/google-ads-stats?days=30', { headers: { authorization: `Bearer ${session?.access_token || ''}` } })
      .then((x) => x.json()).catch(() => ({ error: 'bad response' }));
    if (r?.error) setErr(r.error); else { setD(r); setErr(''); }
  }
  useEffect(() => { load(); }, []);

  async function saveCost() {
    setBusy(true);
    const { data: { session } } = await supabase.auth.getSession();
    const r = await fetch('/api/admin/google-ads-stats', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${session?.access_token || ''}` },
      body: JSON.stringify({ day: form.day, cost_pkr: Number(form.cost_pkr) || 0, clicks: Number(form.clicks) || 0, impressions: Number(form.impressions) || 0, conversions: Number(form.conversions) || 0 }),
    }).then((x) => x.json()).catch(() => ({ error: 'bad response' }));
    setBusy(false);
    setMsg(r?.error || `Saved ${form.day}.`);
    if (!r?.error) { setForm({ ...form, cost_pkr: '', clicks: '', impressions: '', conversions: '' }); load(); }
  }

  if (err) return <Card><p className="text-sm text-red-600">Google Ads panel: {err}</p></Card>;
  if (!d) return <Card><p className="text-sm text-ink-700/60">Reading the Google Shopping numbers…</p></Card>;

  const m = d.measured, g = d.reported, k = d.derived;
  const verdictText: Record<string, string> = {
    'too-early': 'Too early to judge. Let it run.',
    'working': 'Paying its way so far.',
    'too-expensive': `Each sale is costing more than an order is worth (${usd(d.thresholds.maxCostPerSaleUsd)}).`,
    'no-sales': 'Over 100 clicks and not one sale. Pause and rethink the offer.',
  };
  const verdictTone: Record<string, string> = {
    'too-early': 'border-black/10 bg-cream/40 text-ink-800',
    'working': 'border-green-300 bg-green-50 text-green-900',
    'too-expensive': 'border-red-300 bg-red-50 text-red-900',
    'no-sales': 'border-red-300 bg-red-50 text-red-900',
  };

  return (
    <Card>
      <div className="flex items-baseline gap-2 mb-1 flex-wrap">
        <h3 className="font-medium text-ink-900 text-sm">🔍 Google Shopping, last {d.days} days</h3>
        <span className="text-xs text-ink-700/55">measured from our own orders, not from Google's claims</span>
        <button className={btnGhost + ' ml-auto'} onClick={load}>Refresh</button>
      </div>

      <div className={`rounded-lg border px-3 py-2 text-xs mb-3 ${verdictTone[d.verdict]}`}>
        <b>{verdictText[d.verdict]}</b>{' '}
        The test passes at <b>{d.thresholds.targetSales30d} sales</b> in 30 days. So far: <b>{m.sales}</b>.
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-lg border border-black/10 bg-white px-4 py-3">
          <div className="text-[10px] uppercase tracking-wide text-ink-700/50">Ad clicks that arrived</div>
          <div className="text-2xl font-bold text-ink-900">{m.clicks.toLocaleString()}</div>
          <div className="text-[11px] text-ink-700/55">{g.clicks ? `Google billed for ${g.clicks.toLocaleString()}` : 'no cost entered yet'}</div>
        </div>
        <div className="rounded-lg border border-black/10 bg-white px-4 py-3">
          <div className="text-[10px] uppercase tracking-wide text-ink-700/50">Sales we can prove</div>
          <div className="text-2xl font-bold text-ink-900">{m.sales}</div>
          <div className="text-[11px] text-ink-700/55">
            {m.conversionRate}% of clicks{k.claimGap != null ? ` · Google claims ${g.conversions}` : ''}
          </div>
        </div>
        <div className="rounded-lg border border-black/10 bg-white px-4 py-3">
          <div className="text-[10px] uppercase tracking-wide text-ink-700/50">Cost per sale</div>
          <div className="text-2xl font-medium" style={{ color: k.costPerSaleUsd != null && k.costPerSaleUsd > d.thresholds.maxCostPerSaleUsd ? '#b91c1c' : '#1f9254' }}>
            {usd(k.costPerSaleUsd)}
          </div>
          <div className="text-[11px] text-ink-700/55">an order is worth {usd(d.thresholds.maxCostPerSaleUsd)} net</div>
        </div>
        <div className="rounded-lg border-2 border-black/10 bg-white px-4 py-3">
          <div className="text-[10px] uppercase tracking-wide text-ink-700/50">Profit after ad spend</div>
          <div className="text-2xl font-bold" style={{ color: k.profitUsd >= 0 ? '#1f9254' : '#b91c1c' }}>{usd(k.profitUsd)}</div>
          <div className="text-[11px] text-ink-700/55">{usd(m.netRevenue)} net revenue, {usd(g.costUsd)} spent</div>
        </div>
      </div>

      {k.claimGap != null && Math.abs(k.claimGap) >= 1 && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Google claims <b>{g.conversions}</b> conversions where our orders show <b>{m.sales}</b>. That gap is the 30-day
          click window at work: a click can claim a sale that email or Etsy really produced. Spend against our number.
        </div>
      )}

      <div className="mt-4 pt-3 border-t border-black/10">
        <div className="text-[11px] text-ink-700/60 mb-2">
          Enter what Google charged (Ads, Campaigns, pick the day). Spend is in rupees, converted at Rs {d.pkrPerUsd} to the dollar.
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block"><span className="text-[10px] uppercase tracking-wide text-ink-700/50">Day</span>
            <input type="date" value={form.day} onChange={(e) => setForm({ ...form, day: e.target.value })} className={inputCls + ' w-36'} /></label>
          <label className="block"><span className="text-[10px] uppercase tracking-wide text-ink-700/50">Cost (PKR)</span>
            <input value={form.cost_pkr} onChange={(e) => setForm({ ...form, cost_pkr: e.target.value })} placeholder="1680" className={inputCls + ' w-24'} /></label>
          <label className="block"><span className="text-[10px] uppercase tracking-wide text-ink-700/50">Clicks</span>
            <input value={form.clicks} onChange={(e) => setForm({ ...form, clicks: e.target.value })} placeholder="12" className={inputCls + ' w-20'} /></label>
          <label className="block"><span className="text-[10px] uppercase tracking-wide text-ink-700/50">Impressions</span>
            <input value={form.impressions} onChange={(e) => setForm({ ...form, impressions: e.target.value })} placeholder="340" className={inputCls + ' w-24'} /></label>
          <label className="block"><span className="text-[10px] uppercase tracking-wide text-ink-700/50">Google's conversions</span>
            <input value={form.conversions} onChange={(e) => setForm({ ...form, conversions: e.target.value })} placeholder="1" className={inputCls + ' w-24'} /></label>
          <button className={btnPrimary} disabled={busy} onClick={saveCost}>{busy ? 'Saving…' : 'Save day'}</button>
          {msg && <span className="text-xs text-bronze-800 basis-full">{msg}</span>}
        </div>
      </div>

      {d.byDay?.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-ink-700/60 text-left">
              <tr><th className="p-1.5">Day</th><th className="p-1.5 text-right">Clicks</th><th className="p-1.5 text-right">Sales</th><th className="p-1.5 text-right">Revenue</th><th className="p-1.5 text-right">Spend</th><th className="p-1.5 text-right">Profit</th></tr>
            </thead>
            <tbody>
              {d.byDay.slice().reverse().slice(0, 14).map((r: any) => {
                const profit = r.revenue * 0.922 - r.cost_usd;
                return (
                  <tr key={r.day} className="border-t border-black/5">
                    <td className="p-1.5 whitespace-nowrap">{new Date(r.day + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</td>
                    <td className="p-1.5 text-right">{r.clicks}</td>
                    <td className="p-1.5 text-right font-medium">{r.sales}</td>
                    <td className="p-1.5 text-right">{usd(r.revenue)}</td>
                    <td className="p-1.5 text-right text-ink-700/60">{r.cost_pkr ? pkr(r.cost_pkr) : '—'}</td>
                    <td className="p-1.5 text-right font-medium" style={{ color: profit >= 0 ? '#1f9254' : '#b91c1c' }}>{r.cost_usd || r.revenue ? usd(profit) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {d.recentSales?.length > 0 && (
        <div className="mt-3 text-[11px] text-ink-700/70">
          <b>Sales traced to an ad click:</b>{' '}
          {d.recentSales.map((s: any) => `${new Date(s.at).toLocaleDateString()} ${usd(s.total)}`).join(' · ')}
        </div>
      )}
    </Card>
  );
}
