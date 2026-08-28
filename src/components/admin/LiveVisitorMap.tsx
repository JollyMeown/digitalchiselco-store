import { useEffect, useMemo, useRef, useState } from 'react';
import { geoNaturalEarth1, geoPath, geoGraticule10 } from 'd3-geo';
import { feature } from 'topojson-client';
// Natural Earth 1:110m land + country borders (public domain, bundled — no
// external tile servers, loads instantly, admin-only chunk).
import land110 from 'world-atlas/land-110m.json';
import countries110 from 'world-atlas/countries-110m.json';
import { supabase } from '../../lib/supabase';
import { Card } from './ui';

// ISO2 → [lat, lng] centroid for the visitor dots. Covers essentially all real
// traffic; a country not listed still appears in the side list.
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

type Row = { code: string; count: number; lastSeen?: string | null; tz?: string | null };

// Fallback local-time zone per country for visits logged before the browser
// beacon started sending the exact timezone (or when it is blocked).
const COUNTRY_TZ: Record<string, string> = {
  US: 'America/Chicago', CA: 'America/Toronto', MX: 'America/Mexico_City', BR: 'America/Sao_Paulo',
  AR: 'America/Argentina/Buenos_Aires', GB: 'Europe/London', IE: 'Europe/Dublin', FR: 'Europe/Paris',
  DE: 'Europe/Berlin', NL: 'Europe/Amsterdam', BE: 'Europe/Brussels', ES: 'Europe/Madrid',
  PT: 'Europe/Lisbon', IT: 'Europe/Rome', CH: 'Europe/Zurich', AT: 'Europe/Vienna', PL: 'Europe/Warsaw',
  CZ: 'Europe/Prague', SE: 'Europe/Stockholm', NO: 'Europe/Oslo', DK: 'Europe/Copenhagen',
  FI: 'Europe/Helsinki', UA: 'Europe/Kyiv', RO: 'Europe/Bucharest', GR: 'Europe/Athens',
  TR: 'Europe/Istanbul', RU: 'Europe/Moscow', IL: 'Asia/Jerusalem', SA: 'Asia/Riyadh',
  AE: 'Asia/Dubai', PK: 'Asia/Karachi', IN: 'Asia/Kolkata', BD: 'Asia/Dhaka', TH: 'Asia/Bangkok',
  VN: 'Asia/Ho_Chi_Minh', CN: 'Asia/Shanghai', HK: 'Asia/Hong_Kong', TW: 'Asia/Taipei',
  JP: 'Asia/Tokyo', KR: 'Asia/Seoul', PH: 'Asia/Manila', ID: 'Asia/Jakarta', MY: 'Asia/Kuala_Lumpur',
  SG: 'Asia/Singapore', AU: 'Australia/Sydney', NZ: 'Pacific/Auckland', ZA: 'Africa/Johannesburg',
  EG: 'Africa/Cairo', NG: 'Africa/Lagos', KE: 'Africa/Nairobi',
};
const clock = (d: Date) => d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
function localTimeIn(tz: string | null | undefined, code: string): string | null {
  const zone = tz || COUNTRY_TZ[code];
  if (!zone) return null;
  try { return new Date().toLocaleTimeString(undefined, { timeZone: zone, hour: '2-digit', minute: '2-digit' }); }
  catch { return null; }
}
const WINDOWS: [string, string, number][] = [['30 min', 'live', 30 * 60000], ['24 h', 'today', 24 * 3600000], ['7 days', 'week', 7 * 86400000]];

function flag(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return '🌐';
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
let regionNames: Intl.DisplayNames | null = null;
try { regionNames = new Intl.DisplayNames(['en'], { type: 'region' }); } catch {}
const nameOf = (code: string) => {
  if (code === '??') return 'Unknown location';
  try { return regionNames?.of(code) || code; } catch { return code; }
};

// Projection + static geography, computed once at module load.
const W = 960, H = 500;
const projection = geoNaturalEarth1().fitExtent([[4, 4], [W - 4, H - 4]], { type: 'Sphere' } as any);
const path = geoPath(projection);
const SPHERE_D = path({ type: 'Sphere' } as any) || '';
const GRATICULE_D = path(geoGraticule10()) || '';
const LAND_D = path(feature(land110 as any, (land110 as any).objects.land) as any) || '';
const BORDERS = (feature(countries110 as any, (countries110 as any).objects.countries) as any).features as any[];

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
      .select('country, visitor_hash, ts, tz').gte('ts', sinceIso).neq('device', 'bot').order('ts', { ascending: false }).limit(20000);
    // unique visitors per country — visitors WITHOUT a resolvable country are
    // never dropped: they count toward the total and get a 🌐 Unknown row.
    const byCountry = new Map<string, Set<string>>();
    const lastSeen = new Map<string, string>();   // country -> newest ts (rows arrive newest-first)
    const tzOf = new Map<string, string>();       // country -> most recent known visitor tz
    const allUniq = new Set<string>();
    for (const r of data || []) {
      const vh = r.visitor_hash || Math.random().toString();
      allUniq.add(vh);
      const code = /^[A-Z]{2}$/i.test(r.country || '') ? (r.country as string).toUpperCase() : '??';
      (byCountry.get(code) || byCountry.set(code, new Set()).get(code)!).add(vh);
      if (!lastSeen.has(code) && (r as any).ts) lastSeen.set(code, (r as any).ts);
      if (!tzOf.has(code) && (r as any).tz) tzOf.set(code, (r as any).tz);
    }
    const list = [...byCountry.entries()].map(([code, set]) => ({
      code, count: set.size, lastSeen: lastSeen.get(code) || null, tz: tzOf.get(code) || null,
    })).sort((a, b) => b.count - a.count);
    setRows(list);
    setTotal(allUniq.size);
    setUpdated(new Date());
  }

  useEffect(() => {
    load(winMs);
    clearInterval(timer.current);
    timer.current = setInterval(() => load(winMs), 30000); // refresh every 30s
    return () => clearInterval(timer.current);
  }, [winMs]);

  const known = rows.filter((r) => r.code !== '??');
  const maxCount = Math.max(1, ...known.map((r) => r.count));
  const dots = useMemo(() => known.filter((r) => CENTROID[r.code]).map((r) => {
    const [lat, lng] = CENTROID[r.code];
    const pt = projection([lng, lat]);
    if (!pt) return null;
    const rad = 5 + Math.sqrt(r.count / maxCount) * 14;
    return { ...r, x: pt[0], y: pt[1], rad };
  }).filter(Boolean) as (Row & { x: number; y: number; rad: number })[], [rows, maxCount]);

  const isLiveWindow = winMs === WINDOWS[0][2];

  return (
    <Card>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <h3 className="font-medium text-ink-900 text-sm">🌍 Live visitors</h3>
        <span className="text-xs text-ink-700/60"><b className="text-bronze-800">{total}</b> unique · {known.length} countries</span>
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
      <div className="grid lg:grid-cols-[1fr_225px] gap-4">
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-xl" role="img" aria-label="visitor world map">
            <defs>
              <radialGradient id="dcc-ocean" cx="50%" cy="42%" r="75%">
                <stop offset="0%" stopColor="#dcebf2" />
                <stop offset="100%" stopColor="#bfd6e2" />
              </radialGradient>
            </defs>
            {/* ocean sphere + graticule + Natural Earth land + country borders */}
            <path d={SPHERE_D} fill="url(#dcc-ocean)" stroke="#a9c3d2" strokeWidth={1} />
            <path d={GRATICULE_D} fill="none" stroke="#ffffff" strokeWidth={0.5} opacity={0.5} />
            <path d={LAND_D} fill="#efe6d2" stroke="none" />
            {BORDERS.map((f: any, i: number) => (
              <path key={i} d={path(f) || undefined} fill="none" stroke="#d9c9a8" strokeWidth={0.6} />
            ))}
            {/* visitor dots — pulse in the 30-min (live) window */}
            {dots.map((d) => (
              <g key={d.code} onMouseEnter={() => setHover({ code: d.code, count: d.count })} onMouseLeave={() => setHover(null)} style={{ cursor: 'pointer' }}>
                {isLiveWindow && (
                  <circle cx={d.x} cy={d.y} r={d.rad} fill="#854F0B" opacity={0.35}>
                    <animate attributeName="r" values={`${d.rad};${d.rad * 2.2}`} dur="1.8s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.35;0" dur="1.8s" repeatCount="indefinite" />
                  </circle>
                )}
                <circle cx={d.x} cy={d.y} r={d.rad + 3} fill="#854F0B" opacity={0.15} />
                <circle cx={d.x} cy={d.y} r={d.rad} fill="#854F0B" opacity={0.85} stroke="#FFFBF4" strokeWidth={1.5} />
                {d.count > 1 && d.rad >= 8 && (
                  <text x={d.x} y={d.y + 3.5} textAnchor="middle" fontSize={Math.min(12, d.rad)} fontWeight={700} fill="#F5EFE3">{d.count}</text>
                )}
              </g>
            ))}
          </svg>
          {hover && (
            <div className="absolute top-2 left-2 bg-white/95 border border-black/10 rounded-md px-2.5 py-1.5 text-xs shadow pointer-events-none">
              {flag(hover.code)} <b>{nameOf(hover.code)}</b> · {hover.count} visitor{hover.count === 1 ? '' : 's'}
              {(() => { const rr = rows.find((x) => x.code === hover.code); const lt = rr ? localTimeIn(rr.tz, rr.code) : null; return lt ? <> · their time <b>{lt}</b></> : null; })()}
            </div>
          )}
          {total === 0 && <p className="text-xs text-ink-700/50 mt-2">No visitors in this window yet — check back or widen the range.</p>}
        </div>
        <div className="max-h-[260px] overflow-y-auto">
          <div className="text-[11px] uppercase tracking-wider text-ink-700/50 mb-1">Top countries</div>
          {rows.slice(0, 25).map((r) => {
            const seen = r.lastSeen ? new Date(r.lastSeen) : null;
            const ageMin = seen ? Math.max(0, Math.round((Date.now() - seen.getTime()) / 60000)) : null;
            const local = localTimeIn(r.tz, r.code);
            return (
              <div key={r.code} className="py-1 border-b border-black/5 last:border-0">
                <div className="flex items-center gap-2 text-sm">
                  <span>{flag(r.code)}</span>
                  <span className="flex-1 truncate text-ink-800">{nameOf(r.code)}</span>
                  <span className="text-bronze-700 font-medium">{r.count}</span>
                </div>
                <div className="text-[10.5px] text-ink-700/55 pl-6 leading-snug">
                  {seen && <>seen <b className="text-ink-700/80">{clock(seen)}</b>{ageMin !== null && ageMin < 90 && <> ({ageMin < 1 ? 'now' : ageMin + 'm ago'})</>}</>}
                  {local && <> · their time <b className="text-ink-700/80">{local}</b></>}
                </div>
              </div>
            );
          })}
          {rows.length === 0 && <div className="text-xs text-ink-700/50">—</div>}
        </div>
      </div>
    </Card>
  );
}
