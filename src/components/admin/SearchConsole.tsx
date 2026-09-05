// Google Search performance, from Search Console via the nightly sync.
//
// Same dual-axis idea as the Merchant panel: impressions as an area on its
// own scale, clicks as a line on another, one hover rail reading both. Below
// it, the scoreboard that matters for the blog work: which pages and queries
// earn clicks, and for each blog post the searches that bring people to it.
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Card } from './ui';

type Day = { day: string; clicks: number; impressions: number; ctr: number; position: number };
type PageRow = { page: string; clicks: number; impressions: number; position: number };
type QueryRow = { query: string; clicks: number; impressions: number; position: number };
type PQ = { page: string; query: string; clicks: number; impressions: number; position: number };
const RANGES = [7, 30, 90] as const;
const IMP = '#4285f4', CLK = '#854F0B';
const fmt = (n: number) => n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(Math.round(n));
const pathOf = (u: string) => { try { return new URL(u).pathname; } catch { return u; } };

function Chart({ rows }: { rows: Day[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 760, H = 220, PAD_L = 6, PAD_R = 6, PAD_T = 14, PAD_B = 26;
  const iw = W - PAD_L - PAD_R, ih = H - PAD_T - PAD_B;
  const maxI = Math.max(1, ...rows.map((r) => r.impressions));
  const maxC = Math.max(1, ...rows.map((r) => r.clicks));
  const x = (i: number) => PAD_L + (rows.length <= 1 ? iw / 2 : (i / (rows.length - 1)) * iw);
  const yI = (v: number) => PAD_T + ih - (v / maxI) * ih;
  const yC = (v: number) => PAD_T + ih - (v / maxC) * ih;
  const impLine = rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${yI(r.impressions).toFixed(1)}`).join('');
  const areaPath = impLine + `L${x(rows.length - 1).toFixed(1)},${PAD_T + ih}L${x(0).toFixed(1)},${PAD_T + ih}Z`;
  const linePath = rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${yC(r.clicks).toFixed(1)}`).join('');
  const h = hover != null ? rows[hover] : null;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Google Search impressions and clicks by day"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const box = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const rel = ((e.clientX - box.left) / box.width) * W;
          const i = Math.round(((rel - PAD_L) / iw) * (rows.length - 1));
          setHover(Math.max(0, Math.min(rows.length - 1, i)));
        }}>
        <defs>
          <linearGradient id="gscImpFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={IMP} stopOpacity="0.30" />
            <stop offset="100%" stopColor={IMP} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={PAD_L} x2={W - PAD_R} y1={PAD_T + ih - f * ih} y2={PAD_T + ih - f * ih} stroke="#e6e2d8" strokeWidth={1} />
        ))}
        <path d={areaPath} fill="url(#gscImpFill)" />
        <path d={impLine} fill="none" stroke={IMP} strokeWidth={1.6} />
        <path d={linePath} fill="none" stroke={CLK} strokeWidth={2.2} strokeLinejoin="round" />
        {h && (
          <g>
            <line x1={x(hover!)} x2={x(hover!)} y1={PAD_T} y2={PAD_T + ih} stroke="#9c8f7a" strokeWidth={1} strokeDasharray="3 3" />
            <circle cx={x(hover!)} cy={yI(h.impressions)} r={3.5} fill={IMP} />
            <circle cx={x(hover!)} cy={yC(h.clicks)} r={3.5} fill={CLK} />
          </g>
        )}
        {rows.length > 1 && [0, rows.length - 1].map((i) => (
          <text key={i} x={x(i)} y={H - 8} textAnchor={i === 0 ? 'start' : 'end'} fontSize="11" fill="#8a7c68">{rows[i].day.slice(5)}</text>
        ))}
      </svg>
      {h && (
        <div className="absolute top-0 right-0 bg-ink-800 text-cream text-[11px] rounded-lg px-2.5 py-1.5 pointer-events-none shadow">
          <div className="font-bold">{h.day}</div>
          <div style={{ color: '#9dc0ff' }}>{h.impressions.toLocaleString()} impressions</div>
          <div style={{ color: '#f0c98a' }}>{h.clicks.toLocaleString()} clicks · {(h.ctr * 100).toFixed(1)}% CTR · pos {h.position.toFixed(1)}</div>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-lg border border-black/10 bg-cream/40 px-4 py-2.5 min-w-[120px]">
      <div className="text-[10px] uppercase tracking-wide text-ink-700/50 font-medium">{label}</div>
      <div className="text-2xl font-extrabold" style={{ color: color || '#2b2118' }}>{value}</div>
      {sub && <div className="text-[10px] text-ink-700/50">{sub}</div>}
    </div>
  );
}

export default function SearchConsole() {
  const [days, setDays] = useState<number>(30);
  const [rows, setRows] = useState<Day[] | null>(null);
  const [pages, setPages] = useState<PageRow[]>([]);
  const [queries, setQueries] = useState<QueryRow[]>([]);
  const [pq, setPq] = useState<PQ[]>([]);
  const [meta, setMeta] = useState<{ at: string | null; err: string | null }>({ at: null, err: null });
  const [setup, setSetup] = useState<{ sa_email: string | null; site: string; configured: boolean } | null>(null);
  const [tab, setTab] = useState<'blog' | 'pages' | 'queries'>('blog');
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = async () => {
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const [{ data: d }, { data: gs }, { data: pd }, { data: qd }, { data: pqd }] = await Promise.all([
      supabase.from('gsc_daily').select('*').gte('day', since).order('day'),
      supabase.from('growth_settings').select('gsc_sync_at, gsc_sync_error').eq('id', 1).maybeSingle(),
      supabase.from('gsc_page_daily').select('page, clicks, impressions, position').gte('day', since).limit(20000),
      supabase.from('gsc_query_daily').select('query, clicks, impressions, position').gte('day', since).limit(20000),
      supabase.from('gsc_page_query').select('page, query, clicks, impressions, position').order('clicks', { ascending: false }).limit(5000),
    ]);
    setRows((d || []) as Day[]);
    setMeta({ at: gs?.gsc_sync_at || null, err: gs?.gsc_sync_error || null });
    // fold the per-day rows into per-page / per-query totals over the range;
    // position is impression-weighted, which is how Search Console averages it
    const fold = <T extends string>(list: any[], key: T) => {
      const m = new Map<string, { clicks: number; impressions: number; posW: number }>();
      for (const r of list || []) {
        const cur = m.get(r[key]) || { clicks: 0, impressions: 0, posW: 0 };
        cur.clicks += r.clicks; cur.impressions += r.impressions; cur.posW += r.position * r.impressions;
        m.set(r[key], cur);
      }
      return [...m.entries()].map(([k, v]) => ({ [key]: k, clicks: v.clicks, impressions: v.impressions, position: v.impressions ? v.posW / v.impressions : 0 }))
        .sort((a: any, b: any) => (b.clicks - a.clicks) || (b.impressions - a.impressions));
    };
    setPages(fold(pd || [], 'page') as unknown as PageRow[]);
    setQueries(fold(qd || [], 'query') as unknown as QueryRow[]);
    setPq((pqd || []) as PQ[]);
  };
  useEffect(() => { load(); }, [days]);
  useEffect(() => {
    (async () => {
      try {
        const { data: s } = await supabase.auth.getSession();
        const r = await fetch('/api/admin/gsc-sync', { headers: { authorization: `Bearer ${s.session?.access_token || ''}` } });
        const j = await r.json();
        if (j.ok) setSetup({ sa_email: j.sa_email, site: j.site, configured: j.configured });
      } catch { /* the setup hint is optional */ }
    })();
  }, []);

  async function refresh(backfill = false) {
    setBusy(true); setMsg('');
    try {
      const { data: s } = await supabase.auth.getSession();
      const r = await fetch(`/api/admin/gsc-sync?days=${backfill ? 480 : 30}`, { method: 'POST', headers: { authorization: `Bearer ${s.session?.access_token || ''}` } });
      const j = await r.json();
      setMsg(j.ok ? `✓ ${j.status}` : j.error || 'failed');
    } catch (e: any) { setMsg(String(e?.message || e)); }
    setBusy(false);
    load();
  }

  const blog = useMemo(() => pages.filter((p) => pathOf(p.page).startsWith('/blog/')), [pages]);
  if (!rows) return null;
  const tot = rows.reduce((a, r) => ({ i: a.i + r.impressions, c: a.c + r.clicks, pw: a.pw + r.position * r.impressions }), { i: 0, c: 0, pw: 0 });
  const ctr = tot.i ? (tot.c / tot.i) * 100 : 0;
  const pos = tot.i ? tot.pw / tot.i : 0;
  const half = Math.floor(rows.length / 2);
  const recent = rows.slice(half).reduce((a, r) => a + r.clicks, 0);
  const prior = rows.slice(0, half).reduce((a, r) => a + r.clicks, 0);
  const delta = prior ? Math.round(((recent - prior) / prior) * 100) : 0;
  const list: any[] = tab === 'blog' ? blog : tab === 'pages' ? pages : queries;
  const queriesFor = (page: string) => pq.filter((r) => r.page === page).slice(0, 8);

  return (
    <Card>
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-1">
        <div className="text-sm font-bold text-ink-900">🔎 Google Search — clicks, impressions &amp; position</div>
        <div className="flex items-center gap-1">
          {RANGES.map((r) => (
            <button key={r} onClick={() => setDays(r)} className={`text-xs px-2 py-1 rounded ${days === r ? 'bg-bronze-600 text-cream' : 'bg-cream text-ink-700'}`}>{r}d</button>
          ))}
          <button onClick={() => refresh(false)} disabled={busy} className="text-xs px-2 py-1 rounded border border-black/15 hover:border-bronze-600 ml-1">{busy ? 'Syncing…' : 'Refresh'}</button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="text-xs text-ink-700/70 bg-cream/50 border border-bronze-600/20 rounded-lg p-4 space-y-2">
          <div><b>Not connected yet.</b> Two steps, then press Refresh:</div>
          <ol className="list-decimal pl-5 space-y-1">
            <li>
              Search Console &gt; Settings &gt; Users and permissions &gt; Add user, permission <b>Full</b>:
              {setup?.sa_email
                ? <code className="block mt-1 bg-cream px-2 py-1 rounded select-all break-all">{setup.sa_email}</code>
                : <span> the service account email (GOOGLE_SA_EMAIL in Netlify)</span>}
            </li>
            <li>Google Cloud &gt; APIs &amp; Services &gt; Library &gt; <b>Google Search Console API</b> &gt; Enable (in the project that owns that account).</li>
          </ol>
          <div className="text-ink-700/50">Property: {setup?.site || 'sc-domain:digitalchiselco.com'}</div>
          {meta.err && <div className="text-red-700 break-all">Last error: {meta.err}</div>}
          {msg && <div className={msg.startsWith('✓') ? 'text-green-700' : 'text-red-700'}>{msg}</div>}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-3 my-3">
            <Kpi label="Clicks" value={tot.c.toLocaleString()} color={CLK} sub={half > 0 ? `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)}% vs earlier half` : undefined} />
            <Kpi label="Impressions" value={fmt(tot.i)} color={IMP} />
            <Kpi label="Click-through" value={ctr.toFixed(2) + '%'} />
            <Kpi label="Avg position" value={pos ? pos.toFixed(1) : '–'} sub="lower is better" />
          </div>
          <Chart rows={rows} />
          <div className="flex items-center gap-4 mt-1 text-[11px] text-ink-700/60">
            <span className="flex items-center gap-1"><span style={{ width: 10, height: 10, borderRadius: 2, background: IMP, display: 'inline-block' }} />Impressions (left scale)</span>
            <span className="flex items-center gap-1"><span style={{ width: 10, height: 10, borderRadius: 2, background: CLK, display: 'inline-block' }} />Clicks (own scale)</span>
            <span className="ml-auto">{meta.at ? `synced ${new Date(meta.at).toLocaleString()}` : ''}</span>
          </div>

          <div className="mt-4 border-t border-black/10 pt-3">
            <div className="flex items-baseline justify-between flex-wrap gap-2 mb-1">
              <div className="text-xs font-bold text-ink-900">What earns the clicks (last {days} days)</div>
              <div className="flex gap-1">
                {([['blog', 'Blog posts'], ['pages', 'All pages'], ['queries', 'Searches']] as const).map(([k, l]) => (
                  <button key={k} onClick={() => { setTab(k); setOpen(null); }} className={`text-[11px] px-2 py-0.5 rounded ${tab === k ? 'bg-bronze-600 text-cream' : 'bg-cream text-ink-700'}`}>{l}</button>
                ))}
              </div>
            </div>
            <p className="text-[11px] text-ink-700/55 mb-2">
              {tab === 'blog' ? 'Every article Google has shown. Tap one to see the searches that bring people to it. A post with impressions at position 8 to 20 is one to strengthen; one with impressions and no clicks needs a better title.'
                : tab === 'pages' ? 'Every page on the site that appeared in Google search, ranked by clicks.'
                : 'What people typed into Google before landing here. Position is the impression-weighted average rank.'}
            </p>
            {list.length === 0 ? <p className="text-xs text-ink-700/50">Nothing in this range yet{tab === 'blog' ? ' (new posts take one to three weeks to appear)' : ''}.</p> : (
              <div className="space-y-0.5">
                <div className="grid grid-cols-[1fr_56px_64px_48px] gap-2 text-[10px] uppercase tracking-wide text-ink-700/45 px-1">
                  <span>{tab === 'queries' ? 'search' : 'page'}</span><span className="text-right">clicks</span><span className="text-right">shown</span><span className="text-right">pos</span>
                </div>
                {list.slice(0, 25).map((r: any) => {
                  const key = tab === 'queries' ? r.query : r.page;
                  const label = tab === 'queries' ? r.query : pathOf(r.page);
                  const isOpen = open === key && tab !== 'queries';
                  return (
                    <div key={key}>
                      <button onClick={() => tab !== 'queries' && setOpen(isOpen ? null : key)}
                        className={`w-full grid grid-cols-[1fr_56px_64px_48px] gap-2 items-baseline px-1 py-1 rounded text-left ${isOpen ? 'bg-bronze-600/10' : 'hover:bg-cream/70'} ${tab === 'queries' ? 'cursor-default' : ''}`}>
                        <span className="text-[13px] text-ink-800 truncate" title={key}>{label}</span>
                        <span className="text-right text-[12px] tabular-nums font-bold" style={{ color: r.clicks ? CLK : '#b9b0a1' }}>{r.clicks}</span>
                        <span className="text-right text-[12px] tabular-nums" style={{ color: IMP }}>{r.impressions.toLocaleString()}</span>
                        <span className="text-right text-[12px] tabular-nums text-ink-700/70">{r.position ? r.position.toFixed(1) : '–'}</span>
                      </button>
                      {isOpen && (
                        <div className="ml-3 mb-2 border-l-2 border-bronze-600/30 pl-3">
                          {queriesFor(key).length === 0 ? <p className="text-[11px] text-ink-700/50 py-1">No query detail for this page in the last 28 days.</p> : queriesFor(key).map((q) => (
                            <div key={q.query} className="grid grid-cols-[1fr_56px_64px_48px] gap-2 text-[12px] py-0.5">
                              <span className="text-ink-800 truncate">“{q.query}”</span>
                              <span className="text-right tabular-nums" style={{ color: q.clicks ? CLK : '#b9b0a1' }}>{q.clicks}</span>
                              <span className="text-right tabular-nums" style={{ color: IMP }}>{q.impressions}</span>
                              <span className="text-right tabular-nums text-ink-700/70">{q.position.toFixed(1)}</span>
                            </div>
                          ))}
                          <div className="text-[10px] text-ink-700/45 pt-0.5">searches for this page, last 28 days</div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          {meta.err && <div className="mt-2 text-[11px] text-red-700 break-all">Last sync error: {meta.err}</div>}
          {msg && <div className="mt-2 text-[11px] text-ink-700/70">{msg}</div>}
          <div className="mt-2 text-[10px] text-ink-700/45">
            Nightly sync re-reads the last 14 days (Google finalises numbers about 3 days late).
            {' '}<button onClick={() => refresh(true)} disabled={busy} className="underline hover:text-bronze-700">Backfill 16 months</button>
          </div>
        </>
      )}
    </Card>
  );
}
