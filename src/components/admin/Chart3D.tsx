// Isometric 3D bar chart, drawn as plain SVG so it needs no library and
// inherits the shop's palette. Each bar is a real box: a lit top face, a
// shaded right face and a gradient front face, standing on a receding grid
// floor. Used for the money charts in Finance, where three series per month
// (revenue, what the platform took, what is left) have to be compared at a
// glance.
import { useState } from 'react';

export type Series = { key: string; label: string; color: string };
export type Point = { label: string; values: Record<string, number>; muted?: boolean };

const money = (n: number) => {
  if (n >= 1000) { const k = n / 1000; return '$' + (Number.isInteger(k) ? k : k.toFixed(k >= 10 ? 0 : 1)) + 'k'; }
  const r = Math.round(n * 100) / 100;
  return '$' + (Number.isInteger(r) ? r : r.toFixed(2));
};

/** Lighten or darken a #rrggbb colour by a factor. */
function shade(hex: string, f: number) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  const cl = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = cl(((n >> 16) & 255) * f), g = cl(((n >> 8) & 255) * f), b = cl((n & 255) * f);
  return `rgb(${r},${g},${b})`;
}

export default function Chart3D({
  points, series, height = 210, depth = 9, title,
}: { points: Point[]; series: Series[]; height?: number; depth?: number; title?: string }) {
  const [hover, setHover] = useState<{ i: number; k: string } | null>(null);
  if (!points.length) return <p className="text-xs text-ink-700/50 py-8 text-center">Nothing to chart yet.</p>;

  const H = height;
  const BAR = 13, GAP = 3, PAD_L = 44, PAD_R = 14, PAD_T = 16;
  const groupW = series.length * BAR + (series.length - 1) * GAP;
  const slot = groupW + 26;
  const W = PAD_L + points.length * slot + PAD_R;
  const maxV = Math.max(1, ...points.flatMap((p) => series.map((s) => p.values[s.key] || 0)));
  // Axis lines land on round numbers: pick the smallest 1 / 2 / 2.5 / 5 / 10
  // times a power of ten that still fits about five gridlines under the peak.
  const rough = maxV / 5;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= rough) || 10) * mag;
  const top = Math.ceil(maxV / step) * step || 1;
  const y = (v: number) => PAD_T + H - (v / top) * H;
  const ticks: number[] = [];
  for (let t = 0; t <= top + 1e-9; t += step) ticks.push(+t.toFixed(6));

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H + PAD_T + 34}`} width="100%" style={{ maxWidth: '100%', overflow: 'visible' }}
        role="img" aria-label={title || '3D bar chart'} onMouseLeave={() => setHover(null)}>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`g3d-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={shade(s.color, 1.18)} />
              <stop offset="100%" stopColor={shade(s.color, 0.86)} />
            </linearGradient>
          ))}
          <filter id="bar3dShadow" x="-30%" y="-30%" width="180%" height="180%">
            <feDropShadow dx="1" dy="2" stdDeviation="1.6" floodColor="#3a2a1a" floodOpacity="0.18" />
          </filter>
        </defs>

        {/* receding floor + grid, drawn in the same isometric direction as the bars */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(t)} y2={y(t)} stroke="#e6e2d8" strokeWidth={1} />
            <line x1={W - PAD_R} x2={W - PAD_R + depth} y1={y(t)} y2={y(t) - depth * 0.72} stroke="#eeeae1" strokeWidth={1} />
            <text x={PAD_L - 6} y={y(t) + 3} fontSize={9} textAnchor="end" fill="#9a8b78">{money(t)}</text>
          </g>
        ))}
        <polygon points={`${PAD_L},${y(0)} ${W - PAD_R},${y(0)} ${W - PAD_R + depth},${y(0) - depth * 0.72} ${PAD_L + depth},${y(0) - depth * 0.72}`} fill="#f0ece3" />

        {points.map((p, i) => {
          const x0 = PAD_L + i * slot + 13;
          return (
            <g key={i}>
              {series.map((s, j) => {
                const v = p.values[s.key] || 0;
                const x = x0 + j * (BAR + GAP);
                const h = Math.max(0, (v / top) * H);
                const yTop = y(v);
                const isHot = hover?.i === i && hover?.k === s.key;
                const dim = p.muted ? 0.35 : 1;
                if (v <= 0) {
                  return <rect key={s.key} x={x} y={y(0) - 1.5} width={BAR} height={1.5} fill="#ddd8cd" opacity={dim} />;
                }
                return (
                  <g key={s.key} opacity={dim} filter={isHot ? 'url(#bar3dShadow)' : undefined}
                    onMouseEnter={() => setHover({ i, k: s.key })} style={{ cursor: 'pointer' }}>
                    {/* front */}
                    <rect x={x} y={yTop} width={BAR} height={h} fill={`url(#g3d-${s.key})`} rx={1} />
                    {/* top face */}
                    <polygon points={`${x},${yTop} ${x + depth},${yTop - depth * 0.72} ${x + BAR + depth},${yTop - depth * 0.72} ${x + BAR},${yTop}`}
                      fill={shade(s.color, 1.32)} />
                    {/* right face */}
                    <polygon points={`${x + BAR},${yTop} ${x + BAR + depth},${yTop - depth * 0.72} ${x + BAR + depth},${yTop + h - depth * 0.72} ${x + BAR},${yTop + h}`}
                      fill={shade(s.color, 0.68)} />
                    {isHot && (
                      <text x={x + BAR / 2 + depth / 2} y={yTop - depth * 0.72 - 5} fontSize={9.5} textAnchor="middle" fill="#3a2a1a" fontWeight={600}>
                        {money(v)}
                      </text>
                    )}
                    <title>{`${p.label} · ${s.label}: ${money(v)}`}</title>
                  </g>
                );
              })}
              <text x={x0 + groupW / 2} y={H + PAD_T + 15} fontSize={9.5} textAnchor="middle"
                fill={p.muted ? '#c3bbae' : '#8a7a68'} fontWeight={hover?.i === i ? 700 : 400}>{p.label}</text>
            </g>
          );
        })}
      </svg>

      <div className="flex flex-wrap gap-x-4 gap-y-1 justify-center -mt-1">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5 text-[11px] text-ink-700/70">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: s.color, boxShadow: `2px -2px 0 ${shade(s.color, 0.7)}` }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
