import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { Card } from '../ui';

type Visit = { day: string; path: string; referrer_host: string | null; device: string | null; country: string | null; visitor_hash: string | null };

const RANGES = [7, 30, 90] as const;

function BarChart({ points }: { points: { label: string; visitors: number; pageviews: number }[] }) {
  const H = 160, BW = Math.max(10, Math.min(34, Math.floor(560 / Math.max(1, points.length))));
  const W = points.length * BW;
  const max = Math.max(1, ...points.map((p) => p.pageviews));
  return (
    <svg viewBox={`0 0 ${W} ${H + 24}`} width="100%" role="img" aria-label="daily visitors and pageviews">
      {[0.5, 1].map((f) => <line key={f} x1={0} x2={W} y1={H - f * H} y2={H - f * H} stroke="#e1e0d9" strokeWidth={1} />)}
      {points.map((p, i) => {
        const pvH = (p.pageviews / max) * H, vH = (p.visitors / max) * H;
        return (
          <g key={i}>
            <rect x={i * BW + 2} y={H - pvH} width={BW - 4} height={pvH} fill="#d8c9b3" rx={2}><title>{p.label}: {p.pageviews} views</title></rect>
            <rect x={i * BW + 2} y={H - vH} width={BW - 4} height={vH} fill="#854F0B" rx={2}><title>{p.label}: {p.visitors} visitors</title></rect>
            {(points.length <= 14 || i % Math.ceil(points.length / 12) === 0) && (
              <text x={i * BW + BW / 2} y={H + 14} fontSize={8.5} textAnchor="middle" fill="#8a7a68">{p.label}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function TopList({ title, rows, total }: { title: string; rows: [string, number][]; total: number }) {
  return (
    <Card>
      <div className="text-sm font-medium text-ink-900 mb-2">{title}</div>
      {rows.length === 0 ? <p className="text-xs text-ink-700/50">No data yet.</p> : (
        <div className="space-y-1.5">
          {rows.map(([name, n]) => (
            <div key={name} className="text-xs">
              <div className="flex justify-between gap-2 mb-0.5">
                <span className="truncate text-ink-800">{name}</span>
                <span className="text-ink-700/60 whitespace-nowrap">{n.toLocaleString()}</span>
              </div>
              <div className="h-1 bg-cream rounded overflow-hidden"><div className="h-full bg-bronze-600/70" style={{ width: `${Math.round((n / Math.max(1, total)) * 100)}%` }} /></div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function Traffic() {
  const [days, setDays] = useState<number>(30);
  const [rows, setRows] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(true);
  const [capped, setCapped] = useState(false);

  useEffect(() => { load(); }, [days]);
  async function load() {
    setLoading(true);
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const out: Visit[] = [];
    for (let from = 0; from < 60000; from += 1000) {
      const { data } = await supabase.from('site_visits')
        .select('day, path, referrer_host, device, country, visitor_hash')
        .gte('day', since).order('day').range(from, from + 999);
      out.push(...((data || []) as Visit[]));
      if (!data || data.length < 1000) { setCapped(false); break; }
      if (from + 1000 >= 60000) setCapped(true);
    }
    setRows(out); setLoading(false);
  }

  const stats = useMemo(() => {
    const byDay = new Map<string, { pv: number; uniq: Set<string> }>();
    const pages = new Map<string, number>(), refs = new Map<string, number>(), devices = new Map<string, number>(), countries = new Map<string, number>();
    const allUniq = new Set<string>();
    for (const r of rows) {
      const d = byDay.get(r.day) || { pv: 0, uniq: new Set<string>() };
      d.pv++; if (r.visitor_hash) { d.uniq.add(r.visitor_hash); allUniq.add(r.day + r.visitor_hash); }
      byDay.set(r.day, d);
      pages.set(r.path, (pages.get(r.path) || 0) + 1);
      if (r.referrer_host) refs.set(r.referrer_host, (refs.get(r.referrer_host) || 0) + 1);
      if (r.device) devices.set(r.device, (devices.get(r.device) || 0) + 1);
      if (r.country) countries.set(r.country, (countries.get(r.country) || 0) + 1);
    }
    // fill missing days with zeros for an honest chart
    const points: { label: string; visitors: number; pageviews: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      const d = byDay.get(day);
      points.push({ label: day.slice(5).replace('-', '/'), visitors: d?.uniq.size || 0, pageviews: d?.pv || 0 });
    }
    const top = (m: Map<string, number>, n = 8) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n) as [string, number][];
    const todayKey = new Date().toISOString().slice(0, 10);
    return {
      points, pv: rows.length, visitors: allUniq.size,
      today: { pv: byDay.get(todayKey)?.pv || 0, uniq: byDay.get(todayKey)?.uniq.size || 0 },
      topPages: top(pages, 10), topRefs: top(refs), devices: top(devices, 4), countries: top(countries),
    };
  }, [rows, days]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-ink-700/60">📊 First-party analytics (no cookies) — collecting since deploy. Direct visits have no referrer.</span>
        <div className="ml-auto flex gap-1">
          {RANGES.map((r) => (
            <button key={r} onClick={() => setDays(r)} className={`text-xs px-2 py-1 rounded ${days === r ? 'bg-bronze-600 text-cream' : 'bg-cream text-ink-700'}`}>{r}d</button>
          ))}
          <button className="text-xs px-2 py-1 rounded bg-cream text-bronze-700 underline" onClick={load}>reload</button>
        </div>
      </div>

      {loading ? <div className="text-sm text-ink-700/60">Loading traffic…</div> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card><div className="text-[11px] uppercase tracking-wide text-ink-700/50">Visitors ({days}d)</div><div className="text-2xl font-medium text-bronze-800 mt-1">{stats.visitors.toLocaleString()}</div></Card>
            <Card><div className="text-[11px] uppercase tracking-wide text-ink-700/50">Pageviews ({days}d)</div><div className="text-2xl font-medium text-bronze-800 mt-1">{stats.pv.toLocaleString()}</div></Card>
            <Card><div className="text-[11px] uppercase tracking-wide text-ink-700/50">Today · visitors</div><div className="text-2xl font-medium text-bronze-800 mt-1">{stats.today.uniq.toLocaleString()}</div></Card>
            <Card><div className="text-[11px] uppercase tracking-wide text-ink-700/50">Today · pageviews</div><div className="text-2xl font-medium text-bronze-800 mt-1">{stats.today.pv.toLocaleString()}</div></Card>
          </div>

          <Card>
            <div className="flex items-center gap-4 mb-2">
              <div className="text-sm font-medium text-ink-900">Daily traffic</div>
              <span className="flex items-center gap-1 text-xs text-ink-700/60"><span style={{ width: 10, height: 10, borderRadius: 2, background: '#854F0B', display: 'inline-block' }} />Unique visitors</span>
              <span className="flex items-center gap-1 text-xs text-ink-700/60"><span style={{ width: 10, height: 10, borderRadius: 2, background: '#d8c9b3', display: 'inline-block' }} />Pageviews</span>
            </div>
            <BarChart points={stats.points} />
            {capped && <p className="text-[11px] text-ink-700/50 mt-1">Showing the first 60k rows of the range.</p>}
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <TopList title="Top pages" rows={stats.topPages} total={stats.pv} />
            <TopList title="Referrer sources" rows={stats.topRefs} total={stats.pv} />
            <TopList title="Devices" rows={stats.devices} total={stats.pv} />
            <TopList title="Countries" rows={stats.countries} total={stats.pv} />
          </div>
        </>
      )}
    </div>
  );
}
