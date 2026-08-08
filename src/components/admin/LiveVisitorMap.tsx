import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Card } from './ui';

// ISO2 → [lat, lng] centroid. Covers essentially all real traffic; a country
// not listed still appears in the side list, just without a map dot.
const CENTROID: Record<string, [number, number]> = {
  US: [39.8, -98.6], CA: [56.1, -106.3], MX: [23.6, -102.5], BR: [-14.2, -51.9], AR: [-38.4, -63.6],
  CL: [-35.7, -71.5], CO: [4.6, -74.3], PE: [-9.2, -75.0], EC: [-1.8, -78.2], VE: [6.4, -66.6],
  LC: [13.9, -60.9], DO: [18.7, -70.2], GT: [15.8, -90.2], CR: [9.7, -83.8], PA: [8.5, -80.8],
  GB: [54.4, -3.4], IE: [53.4, -8.2], FR: [46.2, 2.2], DE: [51.2, 10.4], IT: [41.9, 12.6],
  ES: [40.5, -3.7], PT: [39.4, -8.2], NL: [52.1, 5.3], BE: [50.5, 4.5], CH: [46.8, 8.2],
  AT: [47.5, 14.6], PL: [51.9, 19.1], CZ: [49.8, 15.5], SE: [60.1, 18.6], NO: [60.5, 8.5],
  FI: [61.9, 25.7], DK: [56.3, 9.5], UA: [48.4, 31.2], RU: [61.5, 90.3], RO: [45.9, 24.9],
  GR: [39.1, 21.8], HU: [47.2, 19.5], SK: [48.7, 19.7], HR: [45.1, 15.2], SI: [46.1, 14.8],
  RS: [44.0, 21.0], BG: [42.7, 25.5], LT: [55.2, 23.9], LV: [56.9, 24.6], EE: [58.6, 25.0],
  TR: [38.9, 35.2], IL: [31.0, 34.9], SA: [23.9, 45.1], AE: [23.4, 53.8], QA: [25.3, 51.2],
  EG: [26.8, 30.8], MA: [31.8, -7.1], DZ: [28.0, 1.7], TN: [33.9, 9.6], NG: [9.1, 8.7],
  KE: [0.2, 37.9], ZA: [-30.6, 22.9], GH: [7.9, -1.0], PS: [31.9, 35.2],
  IN: [22.6, 79.0], PK: [30.4, 69.3], BD: [23.7, 90.4], CN: [35.9, 104.2], JP: [36.2, 138.3],
  KR: [35.9, 127.8], TW: [23.7, 121.0], HK: [22.3, 114.2], TH: [15.9, 100.9], VN: [14.1, 108.3],
  PH: [12.9, 121.8], ID: [-0.8, 113.9], MY: [4.2, 101.9], SG: [1.35, 103.8], LK: [7.9, 80.8],
  NP: [28.4, 84.1], IR: [32.4, 53.7], IQ: [33.2, 43.7], AU: [-25.3, 133.8], NZ: [-40.9, 172.9],
};

// Simplified continent silhouettes in equirectangular space (x = lng+180,
// y = 90-lat). Rough but recognizable — enough to read as a world map behind
// the visitor dots.
const LAND: string[] = [
  '12,25 90,18 128,43 112,48 100,66 82,74 64,60 56,50 40,32 20,30',                    // North America
  '100,80 122,80 146,92 140,112 124,128 112,143 106,132 102,110 98,92',                // South America
  '120,12 137,12 141,25 124,28',                                                       // Greenland
  '168,54 172,44 182,38 196,36 210,30 222,26 223,38 214,46 200,52 184,55',             // Europe
  '164,70 166,56 186,52 210,54 224,60 232,74 226,92 212,112 198,126 190,120 186,92 178,80 168,76', // Africa
  '210,50 222,26 248,16 280,12 310,16 342,20 360,26 360,42 336,44 316,50 300,54 300,70 288,84 272,84 256,78 240,64 224,58', // Asia
  '292,110 312,101 326,104 334,116 328,128 312,124 298,126',                           // Australia
];

type Row = { code: string; count: number };
const WINDOWS: [string, string, number][] = [['30 min', 'live', 30 * 60000], ['24 h', 'today', 24 * 3600000], ['7 days', 'week', 7 * 86400000]];

function flag(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return '🏳️';
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
let regionNames: Intl.DisplayNames | null = null;
try { regionNames = new Intl.DisplayNames(['en'], { type: 'region' }); } catch {}
const nameOf = (code: string) => { try { return regionNames?.of(code) || code; } catch { return code; } };

export default function LiveVisitorMap() {
  const [winMs, setWinMs] = useState(WINDOWS[0][2]);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [updated, setUpdated] = useState<Date | null>(null);
  const [hover, setHover] = useState<{ code: string; count: number } | null>(null);
  const timer = useRef<any>(null);

  async function load(ms: number) {
    const sinceIso = new Date(Date.now() - ms).toISOString();
    const { data } = await supabase.from('site_visits')
      .select('country, visitor_hash').gte('ts', sinceIso).neq('device', 'bot').limit(20000);
    // unique visitors per country
    const byCountry = new Map<string, Set<string>>();
    for (const r of data || []) {
      const code = (r.country || '').toUpperCase();
      if (!/^[A-Z]{2}$/.test(code)) continue;
      (byCountry.get(code) || byCountry.set(code, new Set()).get(code)!).add(r.visitor_hash || Math.random().toString());
    }
    const list = [...byCountry.entries()].map(([code, set]) => ({ code, count: set.size })).sort((a, b) => b.count - a.count);
    setRows(list);
    setTotal(list.reduce((s, r) => s + r.count, 0));
    setUpdated(new Date());
  }

  useEffect(() => {
    load(winMs);
    clearInterval(timer.current);
    timer.current = setInterval(() => load(winMs), 30000); // refresh every 30s
    return () => clearInterval(timer.current);
  }, [winMs]);

  const maxCount = Math.max(1, ...rows.map((r) => r.count));
  const dots = useMemo(() => rows.filter((r) => CENTROID[r.code]).map((r) => {
    const [lat, lng] = CENTROID[r.code];
    const x = lng + 180, y = 90 - lat;
    const rad = 2.2 + Math.sqrt(r.count / maxCount) * 7;
    return { ...r, x, y, rad };
  }), [rows, maxCount]);

  return (
    <Card>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <h3 className="font-medium text-ink-900 text-sm">🌍 Live visitors</h3>
        <span className="text-xs text-ink-700/60">{total} unique · {rows.length} countries</span>
        <span className="ml-auto flex items-center gap-1 text-xs">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          {updated ? `updated ${updated.toLocaleTimeString()}` : 'loading…'}
        </span>
        <div className="flex gap-1">
          {WINDOWS.map(([label, , ms]) => (
            <button key={label} onClick={() => setWinMs(ms)}
              className={`text-xs px-2 py-1 rounded border ${winMs === ms ? 'bg-bronze-600 text-cream border-bronze-600' : 'border-black/10 text-ink-700 hover:bg-cream'}`}>{label}</button>
          ))}
        </div>
      </div>
      <div className="grid lg:grid-cols-[1fr_180px] gap-4">
        <div className="relative">
          <svg viewBox="0 0 360 180" className="w-full rounded-lg" style={{ background: '#eaf1f5', aspectRatio: '2 / 1' }}>
            {/* continents */}
            {LAND.map((pts, i) => <polygon key={'land' + i} points={pts} fill="#e6dcc6" stroke="#d6c7a8" strokeWidth={0.4} />)}
            {/* graticule */}
            {[30, 60, 90, 120, 150, 210, 240, 270, 300, 330].map((x) => <line key={'v' + x} x1={x} y1={0} x2={x} y2={180} stroke="#c9d8de" strokeWidth={0.3} opacity={0.6} />)}
            {[30, 60, 90, 120, 150].map((y) => <line key={'h' + y} x1={0} y1={y} x2={360} y2={y} stroke="#c9d8de" strokeWidth={0.3} opacity={0.6} />)}
            {dots.map((d) => (
              <g key={d.code} onMouseEnter={() => setHover({ code: d.code, count: d.count })} onMouseLeave={() => setHover(null)} style={{ cursor: 'pointer' }}>
                <circle cx={d.x} cy={d.y} r={d.rad + 2} fill="#854F0B" opacity={0.12} />
                <circle cx={d.x} cy={d.y} r={d.rad} fill="#854F0B" opacity={0.75} />
              </g>
            ))}
          </svg>
          {hover && (
            <div className="absolute top-2 left-2 bg-white/95 border border-black/10 rounded px-2 py-1 text-xs shadow-sm pointer-events-none">
              {flag(hover.code)} {nameOf(hover.code)} · <b>{hover.count}</b> visitor{hover.count === 1 ? '' : 's'}
            </div>
          )}
          {rows.length === 0 && <p className="text-xs text-ink-700/50 mt-2">No visitors in this window yet — check back or widen the range.</p>}
        </div>
        <div className="max-h-[220px] overflow-y-auto">
          <div className="text-[11px] uppercase tracking-wider text-ink-700/50 mb-1">Top countries</div>
          {rows.slice(0, 25).map((r) => (
            <div key={r.code} className="flex items-center gap-2 text-sm py-0.5">
              <span>{flag(r.code)}</span>
              <span className="flex-1 truncate text-ink-800">{nameOf(r.code)}</span>
              <span className="text-bronze-700 font-medium">{r.count}</span>
            </div>
          ))}
          {rows.length === 0 && <div className="text-xs text-ink-700/50">—</div>}
        </div>
      </div>
    </Card>
  );
}
