// Google Merchant Center performance, graphed.
//
// Impressions are drawn as an area (they are 100x larger than clicks, so they
// get their own scale) with clicks as a line on a second axis. A shared hover
// rail reads both series for one day, which is the only way a dual-axis chart
// stays honest: the curves are not comparable in height, only in shape.
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Card } from './ui';

type Row = { day: string; impressions: number; clicks: number; ctr: number; conversions: number; conversion_value: number };
type Prod = { offer_id: string; title: string | null; impressions: number; clicks: number };
const RANGES = [7, 30, 90] as const;
const IMP = '#4285f4', CLK = '#854F0B';
const fmt = (n: number) => n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(Math.round(n));

function Chart({ rows }: { rows: Row[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 760, H = 240, PAD_L = 6, PAD_R = 6, PAD_T = 14, PAD_B = 26;
  const iw = W - PAD_L - PAD_R, ih = H - PAD_T - PAD_B;
  const maxI = Math.max(1, ...rows.map((r) => r.impressions));
  const maxC = Math.max(1, ...rows.map((r) => r.clicks));
  const x = (i: number) => PAD_L + (rows.length <= 1 ? iw / 2 : (i / (rows.length - 1)) * iw);
  const yI = (v: number) => PAD_T + ih - (v / maxI) * ih;
  const yC = (v: number) => PAD_T + ih - (v / maxC) * ih;

  const areaPath = rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${yI(r.impressions).toFixed(1)}`).join('')
    + `L${x(rows.length - 1).toFixed(1)},${PAD_T + ih}L${x(0).toFixed(1)},${PAD_T + ih}Z`;
  const linePath = rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${yC(r.clicks).toFixed(1)}`).join('');
  const h = hover != null ? rows[hover] : null;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Merchant Center impressions and clicks by day"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const box = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const rel = ((e.clientX - box.left) / box.width) * W;
          const i = Math.round(((rel - PAD_L) / iw) * (rows.length - 1));
          setHover(Math.max(0, Math.min(rows.length - 1, i)));
        }}>
        <defs>
          <linearGradient id="impFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={IMP} stopOpacity="0.30" />
            <stop offset="100%" stopColor={IMP} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={PAD_L} x2={W - PAD_R} y1={PAD_T + ih - f * ih} y2={PAD_T + ih - f * ih} stroke="#e6e2d8" strokeWidth={1} />
        ))}
        <path d={areaPath} fill="url(#impFill)" />
        <path d={rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${yI(r.impressions).toFixed(1)}`).join('')} fill="none" stroke={IMP} strokeWidth={1.6} />
        <path d={linePath} fill="none" stroke={CLK} strokeWidth={2.2} strokeLinejoin="round" />
        {h && (
          <g>
            <line x1={x(hover!)} x2={x(hover!)} y1={PAD_T} y2={PAD_T + ih} stroke="#9c8f7a" strokeWidth={1} strokeDasharray="3 3" />
            <circle cx={x(hover!)} cy={yI(h.impressions)} r={3.5} fill={IMP} />
            <circle cx={x(hover!)} cy={yC(h.clicks)} r={3.5} fill={CLK} />
          </g>
        )}
        {rows.length > 1 && [0, rows.length - 1].map((i) => (
          <text key={i} x={x(i)} y={H - 8} textAnchor={i === 0 ? 'start' : 'end'} fontSize="11" fill="#8a7c68">
            {rows[i].day.slice(5)}
          </text>
        ))}
      </svg>
      {h && (
        <div className="absolute top-0 right-0 bg-ink-800 text-cream text-[11px] rounded-lg px-2.5 py-1.5 pointer-events-none shadow">
          <div className="font-bold">{h.day}</div>
          <div style={{ color: '#9dc0ff' }}>{h.impressions.toLocaleString()} impressions</div>
          <div style={{ color: '#f0c98a' }}>{h.clicks.toLocaleString()} clicks · {(h.ctr * 100).toFixed(2)}% CTR</div>
        </div>
      )}
    </div>
  );
}

export default function MerchantStats() {
  const [days, setDays] = useState<number>(30);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [meta, setMeta] = useState<{ at: string | null; err: string | null }>({ at: null, err: null });
  const [products, setProducts] = useState<Prod[]>([]);
  const [tab, setTab] = useState<'impressions' | 'clicks'>('impressions');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = async () => {
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const [{ data }, { data: gs }, { data: prods }] = await Promise.all([
      supabase.from('merchant_stats_daily').select('*').gte('day', since).order('day'),
      supabase.from('growth_settings').select('merchant_sync_at, merchant_sync_error').eq('id', 1).maybeSingle(),
      supabase.from('merchant_product_stats').select('offer_id, title, impressions, clicks').order('impressions', { ascending: false }).limit(200),
    ]);
    setRows((data || []) as Row[]);
    setMeta({ at: gs?.merchant_sync_at || null, err: gs?.merchant_sync_error || null });
    setProducts((prods || []) as Prod[]);
  };
  useEffect(() => { load(); }, [days]);

  async function refresh() {
    setBusy(true); setMsg('');
    try {
      const { data: s } = await supabase.auth.getSession();
      const r = await fetch('/api/admin/merchant-sync?days=90', {
        method: 'POST', headers: { authorization: `Bearer ${s.session?.access_token || ''}` },
      });
      const j = await r.json();
      setMsg(j.ok ? `✓ ${j.status}` : j.error || 'failed');
    } catch (e: any) { setMsg(String(e?.message || e)); }
    setBusy(false);
    load();
  }

  if (!rows) return null;
  const tot = rows.reduce((a, r) => ({ i: a.i + r.impressions, c: a.c + r.clicks }), { i: 0, c: 0 });
  const ctr = tot.i ? (tot.c / tot.i) * 100 : 0;
  // trend vs the previous window of the same length
  const half = Math.floor(rows.length / 2);
  const recent = rows.slice(half).reduce((a, r) => a + r.clicks, 0);
  const prior = rows.slice(0, half).reduce((a, r) => a + r.clicks, 0);
  const delta = prior ? Math.round(((recent - prior) / prior) * 100) : 0;

  return (
    <Card>
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-1">
        <div className="text-sm font-bold text-ink-900">🛒 Google Shopping — daily impressions &amp; clicks</div>
        <div className="flex items-center gap-1">
          {RANGES.map((r) => (
            <button key={r} onClick={() => setDays(r)} className={`text-xs px-2 py-1 rounded ${days === r ? 'bg-bronze-600 text-cream' : 'bg-cream text-ink-700'}`}>{r}d</button>
          ))}
          <button onClick={refresh} disabled={busy} className="text-xs px-2 py-1 rounded border border-black/15 hover:border-bronze-600 ml-1">{busy ? 'Syncing…' : 'Refresh'}</button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="text-xs text-ink-700/70 bg-cream/50 border border-bronze-600/20 rounded-lg p-4">
          <b>Not connected yet.</b> Add <code className="bg-cream px-1 rounded">GOOGLE_MERCHANT_ID</code>, <code className="bg-cream px-1 rounded">GOOGLE_SA_EMAIL</code> and <code className="bg-cream px-1 rounded">GOOGLE_SA_PRIVATE_KEY</code> in Netlify, then press Refresh.
          {meta.err && <div className="mt-2 text-red-700">Last error: {meta.err}</div>}
          {msg && <div className="mt-2 text-red-700">{msg}</div>}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-3 my-3">
            <div className="rounded-lg border border-black/10 bg-cream/40 px-4 py-2.5 min-w-[120px]">
              <div className="text-[10px] uppercase tracking-wide text-ink-700/50 font-medium">Impressions</div>
              <div className="text-2xl font-extrabold" style={{ color: IMP }}>{fmt(tot.i)}</div>
            </div>
            <div className="rounded-lg border border-black/10 bg-cream/40 px-4 py-2.5 min-w-[120px]">
              <div className="text-[10px] uppercase tracking-wide text-ink-700/50 font-medium">Clicks</div>
              <div className="text-2xl font-extrabold" style={{ color: CLK }}>{tot.c.toLocaleString()}</div>
              {half > 0 && <div className={`text-[10px] font-medium ${delta >= 0 ? 'text-green-700' : 'text-red-600'}`}>{delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}% vs earlier half</div>}
            </div>
            <div className="rounded-lg border border-black/10 bg-cream/40 px-4 py-2.5 min-w-[120px]">
              <div className="text-[10px] uppercase tracking-wide text-ink-700/50 font-medium">Click-through</div>
              <div className="text-2xl font-extrabold text-ink-900">{ctr.toFixed(2)}%</div>
            </div>
          </div>

          <Chart rows={rows} />

          <div className="flex items-center gap-4 mt-1 text-[11px] text-ink-700/60">
            <span className="flex items-center gap-1"><span style={{ width: 10, height: 10, borderRadius: 2, background: IMP, display: 'inline-block' }} />Impressions (left scale)</span>
            <span className="flex items-center gap-1"><span style={{ width: 10, height: 10, borderRadius: 2, background: CLK, display: 'inline-block' }} />Clicks (own scale)</span>
            <span className="ml-auto">{meta.at ? `synced ${new Date(meta.at).toLocaleString()}` : ''}</span>
          </div>
          {products.length > 0 && (
            <div className="mt-4 border-t border-black/10 pt-3">
              <div className="flex items-baseline justify-between flex-wrap gap-2 mb-1">
                <div className="text-xs font-bold text-ink-900">Top designs on Google (last 30 days)</div>
                <div className="flex gap-1">
                  <button onClick={() => setTab('impressions')} className={`text-[11px] px-2 py-0.5 rounded ${tab === 'impressions' ? 'bg-bronze-600 text-cream' : 'bg-cream text-ink-700'}`}>Most shown</button>
                  <button onClick={() => setTab('clicks')} className={`text-[11px] px-2 py-0.5 rounded ${tab === 'clicks' ? 'bg-bronze-600 text-cream' : 'bg-cream text-ink-700'}`}>Most clicked</button>
                </div>
              </div>
              <p className="text-[11px] text-ink-700/55 mb-2">
                {tab === 'impressions'
                  ? 'Google shows these most. If a design has many impressions and no clicks, the image or title is losing the click.'
                  : 'These actually earn clicks. Worth studying what they have in common.'}
              </p>
              <div className="grid sm:grid-cols-2 gap-x-6">
                {[...products]
                  .sort((a, b) => tab === 'clicks' ? (b.clicks - a.clicks) || (b.impressions - a.impressions) : b.impressions - a.impressions)
                  .slice(0, 10)
                  .map((p) => (
                    <div key={p.offer_id} className="flex items-baseline justify-between gap-2 border-b border-black/5 py-1">
                      <span className="text-[13px] text-ink-800 truncate" title={p.title || p.offer_id}>{p.title || p.offer_id}</span>
                      <span className="text-[12px] shrink-0 tabular-nums">
                        <b style={{ color: IMP }}>{p.impressions.toLocaleString()}</b>
                        <span className="text-ink-700/40"> / </span>
                        <b style={{ color: p.clicks ? CLK : '#b9b0a1' }}>{p.clicks}</b>
                      </span>
                    </div>
                  ))}
              </div>
              <div className="text-[10px] text-ink-700/45 mt-1">impressions / clicks</div>
            </div>
          )}
          {meta.err && <div className="mt-2 text-[11px] text-red-700">Last sync error: {meta.err}</div>}
          {msg && <div className="mt-2 text-[11px] text-ink-700/70">{msg}</div>}
        </>
      )}
    </Card>
  );
}
