import { useEffect, useMemo, useRef, useState } from 'react';
import { geoNaturalEarth1, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import land110 from 'world-atlas/land-110m.json';
import countries110 from 'world-atlas/countries-110m.json';

// Country + US-state centroids so makers spread realistically. US states matter
// most (the launch region); everything else falls back to a country centroid.
const COUNTRY: Record<string, [number, number]> = {
  'united states': [39.8, -98.6], usa: [39.8, -98.6], us: [39.8, -98.6],
  canada: [56.1, -106.3], mexico: [23.6, -102.5], 'united kingdom': [54.4, -3.4], uk: [54.4, -3.4],
  ireland: [53.4, -8.2], france: [46.2, 2.2], germany: [51.2, 10.4], spain: [40.5, -3.7], italy: [41.9, 12.6],
  netherlands: [52.1, 5.3], poland: [51.9, 19.1], sweden: [60.1, 18.6], australia: [-25.3, 133.8],
  'new zealand': [-40.9, 172.9], india: [22.6, 79.0], pakistan: [30.4, 69.3], brazil: [-14.2, -51.9],
  'south africa': [-30.6, 22.9], japan: [36.2, 138.3], philippines: [12.9, 121.8],
};
const US_STATE: Record<string, [number, number]> = {
  al: [32.8, -86.8], ak: [64.2, -149], az: [34.2, -111.7], ar: [34.9, -92.4], ca: [37.2, -119.3],
  co: [39, -105.5], ct: [41.6, -72.7], de: [39, -75.5], fl: [28.6, -82.4], ga: [32.6, -83.4],
  hi: [20.3, -156.4], id: [44.4, -114.6], il: [40, -89.2], in: [39.9, -86.3], ia: [42, -93.5],
  ks: [38.5, -98.4], ky: [37.5, -85.3], la: [31.1, -92, ], me: [45.4, -69.2], md: [39, -76.8],
  ma: [42.3, -71.8], mi: [44.3, -85.4], mn: [46.3, -94.3], ms: [32.7, -89.7], mo: [38.4, -92.5],
  mt: [46.9, -110], ne: [41.5, -99.8], nv: [39.3, -116.6], nh: [43.7, -71.6], nj: [40.1, -74.7],
  nm: [34.4, -106.1], ny: [42.9, -75.5], nc: [35.6, -79.4], nd: [47.5, -100.3], oh: [40.3, -82.8],
  ok: [35.6, -97.5], or: [43.9, -120.6], pa: [40.9, -77.8], ri: [41.7, -71.6], sc: [33.9, -80.9],
  sd: [44.4, -100.2], tn: [35.9, -86.4], tx: [31.5, -99.3], ut: [39.3, -111.7], vt: [44.1, -72.7],
  va: [37.5, -78.9], wa: [47.4, -120.5], wv: [38.6, -80.6], wi: [44.6, -89.9], wy: [43, -107.6],
  'new york': [42.9, -75.5], california: [37.2, -119.3], texas: [31.5, -99.3], florida: [28.6, -82.4],
};

const W = 960, H = 520;
const projection = geoNaturalEarth1().fitExtent([[6, 6], [W - 6, H - 6]], { type: 'Sphere' } as any);
const path = geoPath(projection);
const SPHERE = path({ type: 'Sphere' } as any) || '';
const LAND = path(feature(land110 as any, (land110 as any).objects.land) as any) || '';
const BORDERS = (feature(countries110 as any, (countries110 as any).objects.countries) as any).features as any[];

type Maker = { name: string; city?: string; region?: string; country?: string; rating: number; reviews: number; jobs: number; machines: string[]; photo?: string | null };
function hash(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

export default function MakerMap() {
  const [makers, setMakers] = useState<Maker[] | null>(null);
  const [hover, setHover] = useState<{ m: Maker; x: number; y: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => { fetch('/api/mp/makers-public').then((r) => r.json()).then((j) => setMakers(j.makers || [])).catch(() => setMakers([])); }, []);

  const dots = useMemo(() => {
    if (!makers) return [];
    return makers.map((m, i) => {
      const region = (m.region || '').toLowerCase().trim();
      const country = (m.country || '').toLowerCase().trim();
      let ll: [number, number] | undefined;
      if ((country.includes('united states') || country === 'usa' || country === 'us') && US_STATE[region]) ll = US_STATE[region];
      else ll = COUNTRY[country] || US_STATE[region];
      if (!ll) ll = [39.8, -98.6]; // default drop into the US so the launch region always looks alive
      const jx = ((hash(m.name + 'x') % 100) / 100 - 0.5) * 6;
      const jy = ((hash(m.name + 'y') % 100) / 100 - 0.5) * 6;
      const pt = projection([ll[1] + jx, ll[0] + jy]);
      if (!pt) return null;
      return { m, x: pt[0], y: pt[1], i };
    }).filter(Boolean) as { m: Maker; x: number; y: number; i: number }[];
  }, [makers]);

  const count = makers?.length ?? 0;

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Map of Cut Local makers" style={{ display: 'block' }}>
        <defs>
          <radialGradient id="ocean" cx="50%" cy="38%" r="80%">
            <stop offset="0%" stopColor="#1c1408" />
            <stop offset="100%" stopColor="#0e0a04" />
          </radialGradient>
          <linearGradient id="landg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3a2c19" />
            <stop offset="100%" stopColor="#2a2012" />
          </linearGradient>
          <radialGradient id="glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#f6b25a" stopOpacity="0.9" />
            <stop offset="40%" stopColor="#d98a2b" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#d98a2b" stopOpacity="0" />
          </radialGradient>
          <filter id="soft"><feGaussianBlur stdDeviation="2.2" /></filter>
        </defs>

        <rect x="0" y="0" width={W} height={H} fill="url(#ocean)" />
        <path d={SPHERE} fill="none" />
        <path d={LAND} fill="url(#landg)" />
        {BORDERS.map((f, i) => <path key={i} d={path(f) || undefined} fill="none" stroke="#4a3a22" strokeWidth={0.5} />)}

        {/* ambient connection shimmer between a few makers → "network" feel */}
        {dots.length > 1 && dots.slice(0, 24).map((d, i) => {
          const n = dots[(i + 1) % Math.min(24, dots.length)];
          return <line key={'l' + i} x1={d.x} y1={d.y} x2={n.x} y2={n.y} stroke="#d98a2b" strokeWidth={0.4} opacity={0.08} />;
        })}

        {/* maker dots — glowing, pulsing, staggered (pure artwork) */}
        {dots.map((d) => (
          <g key={d.i} transform={`translate(${d.x} ${d.y})`}
            onMouseEnter={() => setHover({ m: d.m, x: d.x, y: d.y })} onMouseLeave={() => setHover(null)} style={{ cursor: 'pointer' }}>
            <circle r="16" fill="url(#glow)" className="mm-glow" style={{ animationDelay: `${(d.i % 12) * 0.25}s` }} />
            <circle r="5" fill="none" stroke="#f6b25a" strokeWidth="1.2" className="mm-ring" style={{ animationDelay: `${(d.i % 12) * 0.25}s` }} />
            <circle r="2.6" fill="#ffd9a0" />
            <circle r="2.6" fill="#f6b25a" className="mm-core" />
          </g>
        ))}
      </svg>

      {hover && (
        <div style={{ position: 'absolute', left: `${(hover.x / W) * 100}%`, top: `${(hover.y / H) * 100}%`, transform: 'translate(-50%,-120%)', pointerEvents: 'none', background: 'rgba(20,14,7,.96)', color: '#f3e6d2', border: '1px solid #6b4a1e', borderRadius: 10, padding: '9px 12px', fontSize: 13, minWidth: 150, boxShadow: '0 8px 24px rgba(0,0,0,.5)', zIndex: 5 }}>
          <div style={{ fontWeight: 600 }}>{hover.m.name}</div>
          <div style={{ fontSize: 12, color: '#e0b876' }}>
            {hover.m.reviews > 0 ? `★ ${hover.m.rating.toFixed(1)} · ${hover.m.reviews} reviews · ${hover.m.jobs} jobs` : 'New maker'}
          </div>
          <div style={{ fontSize: 11.5, color: '#b9a88f', marginTop: 2 }}>{[hover.m.city, hover.m.region].filter(Boolean).join(', ')}</div>
          <div style={{ fontSize: 10.5, color: '#8a7a63', marginTop: 3, fontFamily: 'monospace' }}>{(hover.m.machines || []).join(' · ')}</div>
        </div>
      )}

      <div style={{ textAlign: 'center', marginTop: 14, fontSize: 14, color: 'var(--mm-count,#6f6151)' }}>
        {makers === null ? 'Loading makers…' : count > 0
          ? <span><b style={{ color: '#854F0B' }}>{count}</b> maker{count === 1 ? '' : 's'} ready to build near you</span>
          : <span>Makers are joining now — be one of the first in your area.</span>}
      </div>

      <style>{`
        @keyframes mmGlow{0%,100%{opacity:.35}50%{opacity:.9}}
        @keyframes mmRing{0%{r:5;opacity:.9}100%{r:15;opacity:0}}
        @keyframes mmCore{0%,100%{opacity:1}50%{opacity:.55}}
        .mm-glow{animation:mmGlow 3.2s ease-in-out infinite}
        .mm-ring{animation:mmRing 3.2s ease-out infinite}
        .mm-core{animation:mmCore 2.4s ease-in-out infinite}
        @media (prefers-reduced-motion: reduce){.mm-glow,.mm-ring,.mm-core{animation:none}.mm-ring{opacity:.4}}
      `}</style>
    </div>
  );
}
