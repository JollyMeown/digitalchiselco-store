import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { Card } from '../ui';
import { useLiveRefresh } from '../useLiveRefresh';

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

function StackedBars({ buckets, order }: { buckets: { label: string; seg: Record<string, number>; total: number }[]; order: string[] }) {
  const H = 170, BW = 46;
  const max = Math.max(1, ...buckets.map((b) => b.total));
  const W = Math.max(buckets.length * BW, 200);
  return (
    <svg viewBox={`0 0 ${W} ${H + 26}`} width="100%" style={{ maxWidth: '100%' }} role="img" aria-label="revenue by period">
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <line key={f} x1={0} x2={W} y1={H - f * H} y2={H - f * H} stroke="#e1e0d9" strokeWidth={1} />
      ))}
      {buckets.map((b, i) => {
        let y = H;
        return (
          <g key={i}>
            {order.filter((k) => b.seg[k]).map((k) => {
              const h = (b.seg[k] / max) * H; y -= h;
              return <rect key={k} x={i * BW + 10} y={y} width={BW - 20} height={Math.max(0, h)} fill={CHANNELS[k]?.color || '#999'} rx={2}><title>{CHANNELS[k]?.label}: {usd(b.seg[k])}</title></rect>;
            })}
            <text x={i * BW + BW / 2} y={H + 16} fontSize={9} textAnchor="middle" fill="#8a7a68">{b.label}</text>
          </g>
        );
      })}
    </svg>
  );
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

export default function Finance() {
  const [daily, setDaily] = useState<Daily[]>([]);
  const [status, setStatus] = useState<any>({});
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [gran, setGran] = useState<Gran>('month');
  const [loading, setLoading] = useState(true);

  const [web30, setWeb30] = useState(0);
  useEffect(() => { load(); }, []);
  useLiveRefresh(() => load(true), 30000);   // keep this tab live (silent, pauses while editing)
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
        <button className="underline text-bronze-700" onClick={load}>reload</button>
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
        {revBuckets.length ? <StackedBars buckets={revBuckets} order={['website', 'etsy', 'cults']} /> : <p className="text-xs text-ink-700/50 py-8 text-center">No revenue in range.</p>}
      </Card>

      {/* Ad spend graph */}
      <Card>
        <div className="text-sm font-medium text-ink-900 mb-2">Etsy ad spend by {gran}</div>
        {adBuckets.some((b) => b.total > 0) ? <StackedBars buckets={adBuckets.map((b) => ({ ...b, seg: { etsy: b.seg.etsy || 0 } }))} order={['etsy']} /> : <p className="text-xs text-ink-700/50 py-8 text-center">No ad spend recorded in range.</p>}
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
