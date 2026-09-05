// YouTube dashboard.
//
// The site never calls the YouTube API. The OAuth refresh token lives in BRS on
// the owner's machine (it can edit and delete videos), so BRS pulls hourly and
// writes these tables; this tab only reads:
//   youtube_stats / youtube_stats_daily   Data API, realtime counts per video
//   youtube_analytics                     Analytics API per video (lags ~2 days)
//   youtube_video_daily                   per-video finalised daily history
//   youtube_channel / youtube_channel_daily  channel snapshot + 90-day history
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { Card } from '../ui';

type Row = {
  video_id: string; title: string | null; thumb_url: string | null; duration_s: number | null;
  published_at: string | null; privacy: string | null; views: number; likes: number; comments: number;
  product_id: string | null; synced_at: string | null;
};
type Day = { video_id: string; day: string; views: number };
type Deep = {
  video_id: string; since: string | null; through: string | null; views: number; engaged_views: number;
  minutes_watched: number; avg_view_secs: number; avg_view_pct: number; likes: number; dislikes: number;
  shares: number; comments: number; subs_gained: number; subs_lost: number; playlist_adds: number;
  traffic: [string, number, number][]; by_day: [string, number][]; countries: [string, number][];
  retention: [number, number, number][]; devices: [string, number][]; subscribed: [string, number, number][];
  demographics: [string, string, number][]; search_terms: [string, number][];
  exit_secs: number | null; verdict: string | null; synced_at: string;
};
type VDay = { video_id: string; day: string; views: number; engaged_views: number; minutes_watched: number; likes: number; shares: number; comments: number; subs_gained: number };
type Channel = {
  subscribers: number; total_views: number; video_count: number; title: string | null; through: string | null; note: string | null;
  traffic: [string, number, number][]; countries: [string, number][]; devices: [string, number][];
  demographics: [string, string, number][]; subscribed: [string, number, number][]; synced_at: string;
};
type CDay = { day: string; views: number; engaged_views: number; minutes_watched: number; avg_view_pct: number; likes: number; shares: number; comments: number; subs_gained: number; subs_lost: number };

const SRC: Record<string, string> = {
  SHORTS: 'Shorts feed', YT_SEARCH: 'YouTube search', BROWSE: 'Browse / home', PLAYLIST: 'Playlists',
  EXT_URL: 'External links', NOTIFICATION: 'Notifications', SUBSCRIBER: 'Subscriptions feed',
  RELATED_VIDEO: 'Suggested videos', CHANNEL: 'Channel page', YT_OTHER_PAGE: 'Other YouTube pages',
  NO_LINK_OTHER: 'Direct / unknown', ADVERTISING: 'Ads', YT_CHANNEL: 'Channel page', SOUND_PAGE: 'Sound page',
  HASHTAGS: 'Hashtag pages', END_SCREEN: 'End screens', ANNOTATION: 'Cards', PROMOTED: 'Promoted', NO_LINK_EMBEDDED: 'Embedded',
};
const DEV: Record<string, string> = { MOBILE: 'Phone', DESKTOP: 'Desktop', TABLET: 'Tablet', TV: 'TV', GAME_CONSOLE: 'Console', UNKNOWN_PLATFORM: 'Unknown' };
const fmt = (n: number) => n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(Math.round(n));
const pct = (a: number, b: number) => b ? Math.round((a / b) * 100) : 0;
const ago = (iso: string | null) => {
  if (!iso) return '';
  const h = (Date.now() - new Date(iso).getTime()) / 36e5;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min ago`;
  if (h < 48) return `${Math.round(h)} h ago`;
  return `${Math.round(h / 24)} days ago`;
};
const BRONZE = '#854F0B', RED = '#c0392b', BLUE = '#4285f4';

// ── small chart primitives ────────────────────────────────────────────
function AreaLine({ rows, keyA, keyB, labelA, labelB, height = 180 }: { rows: any[]; keyA: string; keyB?: string; labelA: string; labelB?: string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 760, H = height, PL = 6, PR = 6, PT = 12, PB = 24, iw = W - PL - PR, ih = H - PT - PB;
  if (!rows.length) return <div className="text-xs text-ink-700/50 py-6 text-center">No finalised days yet.</div>;
  const maxA = Math.max(1, ...rows.map((r) => Number(r[keyA]) || 0));
  const maxB = keyB ? Math.max(1, ...rows.map((r) => Math.abs(Number(r[keyB]) || 0))) : 1;
  const x = (i: number) => PL + (rows.length <= 1 ? iw / 2 : (i / (rows.length - 1)) * iw);
  const yA = (v: number) => PT + ih - (v / maxA) * ih;
  const line = rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${yA(Number(r[keyA]) || 0).toFixed(1)}`).join('');
  const area = line + `L${x(rows.length - 1).toFixed(1)},${PT + ih}L${x(0).toFixed(1)},${PT + ih}Z`;
  const h = hover != null ? rows[hover] : null;
  const bw = Math.max(2, iw / rows.length - 1);
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={labelA}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => { const b = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); const rel = ((e.clientX - b.left) / b.width) * W; setHover(Math.max(0, Math.min(rows.length - 1, Math.round(((rel - PL) / iw) * (rows.length - 1))))); }}>
        <defs><linearGradient id="ytFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={BRONZE} stopOpacity="0.28" /><stop offset="100%" stopColor={BRONZE} stopOpacity="0.02" /></linearGradient></defs>
        {[0.25, 0.5, 0.75, 1].map((f) => <line key={f} x1={PL} x2={W - PR} y1={PT + ih - f * ih} y2={PT + ih - f * ih} stroke="#e6e2d8" strokeWidth={1} />)}
        {keyB && rows.map((r, i) => { const v = Number(r[keyB]) || 0; const hh = (Math.abs(v) / maxB) * ih * 0.5; return <rect key={i} x={x(i) - bw / 2} y={v >= 0 ? PT + ih - hh : PT + ih} width={bw} height={Math.max(0.5, hh)} fill={v >= 0 ? BLUE : RED} opacity={0.35} />; })}
        <path d={area} fill="url(#ytFill)" />
        <path d={line} fill="none" stroke={BRONZE} strokeWidth={2} strokeLinejoin="round" />
        {h && <g><line x1={x(hover!)} x2={x(hover!)} y1={PT} y2={PT + ih} stroke="#9c8f7a" strokeDasharray="3 3" /><circle cx={x(hover!)} cy={yA(Number(h[keyA]) || 0)} r={3.5} fill={BRONZE} /></g>}
        {rows.length > 1 && [0, rows.length - 1].map((i) => <text key={i} x={x(i)} y={H - 8} textAnchor={i === 0 ? 'start' : 'end'} fontSize="11" fill="#8a7c68">{String(rows[i].day).slice(5)}</text>)}
      </svg>
      {h && (
        <div className="absolute top-0 right-0 bg-ink-800 text-cream text-[11px] rounded-lg px-2.5 py-1.5 pointer-events-none shadow">
          <div className="font-bold">{h.day}</div>
          <div style={{ color: '#f0c98a' }}>{Number(h[keyA]).toLocaleString()} {labelA}</div>
          {keyB && <div style={{ color: '#9dc0ff' }}>{Number(h[keyB]) >= 0 ? '+' : ''}{Number(h[keyB]).toLocaleString()} {labelB}</div>}
        </div>
      )}
    </div>
  );
}

function Retention({ ret, duration, exit }: { ret: [number, number, number][]; duration: number; exit: number | null }) {
  const pts = (ret || []).filter((p) => p && p.length >= 2);
  if (pts.length < 4) return <div className="text-xs text-ink-700/50 py-4">Retention curve not available yet.</div>;
  const W = 760, H = 150, PL = 30, PR = 6, PT = 8, PB = 22, iw = W - PL - PR, ih = H - PT - PB;
  const x = (r: number) => PL + r * iw, y = (w: number) => PT + ih - Math.min(1.2, w) / 1.2 * ih;
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="audience retention">
      {[0, 0.5, 1].map((f) => <g key={f}><line x1={PL} x2={W - PR} y1={y(f)} y2={y(f)} stroke={f === 0.5 ? '#c9a15a' : '#e6e2d8'} strokeDasharray={f === 0.5 ? '4 3' : undefined} /><text x={PL - 4} y={y(f) + 4} fontSize="10" textAnchor="end" fill="#8a7c68">{Math.round(f * 100)}%</text></g>)}
      <path d={d + `L${x(pts[pts.length - 1][0]).toFixed(1)},${PT + ih}L${x(pts[0][0]).toFixed(1)},${PT + ih}Z`} fill={BRONZE} opacity={0.12} />
      <path d={d} fill="none" stroke={BRONZE} strokeWidth={2.2} />
      {exit != null && duration > 0 && <g><line x1={x(exit / duration)} x2={x(exit / duration)} y1={PT} y2={PT + ih} stroke={RED} strokeDasharray="3 3" /><text x={x(exit / duration) + 4} y={PT + 12} fontSize="10" fill={RED}>half gone at {exit}s</text></g>}
      {[0, 0.25, 0.5, 0.75, 1].map((f) => <text key={f} x={x(f)} y={H - 6} fontSize="10" textAnchor="middle" fill="#8a7c68">{Math.round(f * duration)}s</text>)}
    </svg>
  );
}

function Bars({ rows, label, total, map }: { rows: [string, number, ...any[]][]; label: string; total?: number; map?: Record<string, string> }) {
  const list = (rows || []).filter((r) => r && r.length >= 2).slice(0, 8);
  const sum = total || list.reduce((a, r) => a + (Number(r[1]) || 0), 0) || 1;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-ink-700/50 font-medium mb-1">{label}</div>
      {list.length === 0 ? <div className="text-xs text-ink-700/45">nothing yet</div> : list.map((r) => (
        <div key={String(r[0])} className="text-[12px] mb-1">
          <div className="flex justify-between gap-2"><span className="text-ink-800 truncate">{map?.[r[0]] || r[0]}</span><span className="tabular-nums text-ink-700/70 shrink-0">{fmt(Number(r[1]))} · {pct(Number(r[1]), sum)}%{r[2] != null && typeof r[2] === 'number' ? ` · ${Math.round(r[2])}% watched` : ''}</span></div>
          <div className="h-1 bg-cream rounded overflow-hidden"><div className="h-full bg-bronze-600/70" style={{ width: `${pct(Number(r[1]), sum)}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

function Demo({ rows }: { rows: [string, string, number][] }) {
  const list = (rows || []).filter((r) => r && r.length >= 3);
  if (!list.length) return <div><div className="text-[10px] uppercase tracking-wide text-ink-700/50 font-medium mb-1">Audience</div><div className="text-xs text-ink-700/45">nothing yet</div></div>;
  const byAge = new Map<string, number>(); const byGender = new Map<string, number>();
  for (const [age, g, p] of list) { byAge.set(age, (byAge.get(age) || 0) + Number(p)); byGender.set(g, (byGender.get(g) || 0) + Number(p)); }
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-ink-700/50 font-medium mb-1">Audience</div>
      <div className="text-[12px] text-ink-800 mb-1">{[...byGender.entries()].map(([g, p]) => `${g.toLowerCase().replace('_', ' ')} ${Math.round(p)}%`).join(' · ')}</div>
      {[...byAge.entries()].sort().map(([age, p]) => (
        <div key={age} className="text-[12px] mb-0.5"><div className="flex justify-between"><span>{age.replace('age', '').replace('-', ' to ')}</span><span className="tabular-nums text-ink-700/70">{Math.round(p)}%</span></div><div className="h-1 bg-cream rounded overflow-hidden"><div className="h-full bg-bronze-600/70" style={{ width: `${Math.min(100, p)}%` }} /></div></div>
      ))}
    </div>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="rounded-lg border border-black/10 bg-cream/40 px-3 py-2 min-w-[110px]">
      <div className="text-[10px] uppercase tracking-wide text-ink-700/50 font-medium">{label}</div>
      <div className="text-xl font-extrabold text-ink-900 leading-tight">{value}</div>
      {sub && <div className={`text-[10px] ${tone === 'good' ? 'text-green-700' : tone === 'bad' ? 'text-red-600' : 'text-ink-700/50'}`}>{sub}</div>}
    </div>
  );
}

// ── per-video detail ───────────────────────────────────────────────────
function VideoDetail({ r, d, daily, productName }: { r: Row; d?: Deep; daily: VDay[]; productName?: string }) {
  const dur = r.duration_s || 0;
  const has = !!d && d.views > 0;
  return (
    <div className="mt-3 border-t border-black/10 pt-3 space-y-4">
      {!has ? (
        <div className="text-xs text-ink-700/60 bg-cream/50 rounded-md px-3 py-2">
          Deep analytics not finalised yet for this video{d?.through ? ` (data through ${d.through})` : ''}. YouTube publishes finalised numbers two to three days behind; the counts above are realtime.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <Kpi label="Chose to watch" value={`${pct(d!.engaged_views, d!.views)}%`} sub={`${fmt(d!.engaged_views)} engaged of ${fmt(d!.views)}`} tone={pct(d!.engaged_views, d!.views) >= 65 ? 'good' : pct(d!.engaged_views, d!.views) < 50 ? 'bad' : undefined} />
            <Kpi label="Watched on average" value={`${Math.round(d!.avg_view_pct)}%`} sub={`${Math.round(d!.avg_view_secs)}s of ${dur}s`} tone={d!.avg_view_pct >= 85 ? 'good' : d!.avg_view_pct < 60 ? 'bad' : undefined} />
            <Kpi label="Watch time" value={`${fmt(Math.round(d!.minutes_watched))} min`} />
            <Kpi label="Likes" value={fmt(d!.likes)} sub={d!.views ? `${((d!.likes / d!.views) * 100).toFixed(1)}% of views` : undefined} />
            <Kpi label="Shares" value={fmt(d!.shares)} />
            <Kpi label="Comments" value={fmt(d!.comments)} />
            <Kpi label="Subscribers" value={`+${d!.subs_gained}`} sub={d!.subs_lost ? `${d!.subs_lost} lost` : 'from this video'} />
            {d!.playlist_adds > 0 && <Kpi label="Saved to playlists" value={String(d!.playlist_adds)} />}
          </div>
          {d!.verdict && <p className="text-[13px] text-ink-800 bg-[#FAEEDA] border-l-4 border-bronze-600 rounded-r-md px-3 py-2">{d!.verdict}</p>}
          <div>
            <div className="text-[10px] uppercase tracking-wide text-ink-700/50 font-medium mb-1">Views per day (finalised)</div>
            <AreaLine rows={daily} keyA="views" keyB="subs_gained" labelA="views" labelB="subscribers" height={150} />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-ink-700/50 font-medium mb-1">Audience retention through the film</div>
            <Retention ret={d!.retention} duration={dur} exit={d!.exit_secs} />
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
            <Bars rows={d!.traffic as any} label="Where the views came from" total={d!.views} map={SRC} />
            <Bars rows={d!.search_terms as any} label="Searches that found it" />
            <Bars rows={d!.countries as any} label="Countries" total={d!.views} />
            <Bars rows={d!.devices as any} label="Devices" total={d!.views} map={DEV} />
            <Bars rows={d!.subscribed as any} label="Subscribed vs not" total={d!.views} map={{ SUBSCRIBED: 'Subscribers', UNSUBSCRIBED: 'Not subscribed' }} />
            <Demo rows={d!.demographics} />
          </div>
          <div className="text-[10px] text-ink-700/45">analytics through {d!.through || '?'} · pulled {ago(d!.synced_at)}{productName ? ` · sells: ${productName}` : ''}</div>
        </>
      )}
    </div>
  );
}

// ── the tab ────────────────────────────────────────────────────────────
type SortKey = 'published' | 'views' | 'engaged' | 'avgpct' | 'likes' | 'shares' | 'subs' | 'gained';
export default function Shorts() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [days, setDays] = useState<Day[]>([]);
  const [deep, setDeep] = useState<Record<string, Deep>>({});
  const [vdaily, setVdaily] = useState<VDay[]>([]);
  const [channel, setChannel] = useState<Channel | null>(null);
  const [cdaily, setCdaily] = useState<CDay[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [range, setRange] = useState<7 | 28 | 90>(28);
  const [sort, setSort] = useState<SortKey>('published');
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState('');

  async function load() {
    const { data, error } = await supabase.from('youtube_stats').select('*').order('published_at', { ascending: false });
    if (error) { setErr(error.message); setRows([]); return; }
    const list = (data || []) as Row[];
    setRows(list);
    const since30 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const since90 = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
    const [{ data: d }, { data: a }, { data: vd }, { data: ch }, { data: cd }] = await Promise.all([
      supabase.from('youtube_stats_daily').select('video_id, day, views').gte('day', since30).order('day'),
      supabase.from('youtube_analytics').select('*'),
      supabase.from('youtube_video_daily').select('*').gte('day', since90).order('day').limit(20000),
      supabase.from('youtube_channel').select('*').eq('id', 1).maybeSingle(),
      supabase.from('youtube_channel_daily').select('*').gte('day', since90).order('day'),
    ]);
    setDays((d || []) as Day[]);
    const m: Record<string, Deep> = {}; for (const row of (a || []) as Deep[]) m[row.video_id] = row; setDeep(m);
    setVdaily((vd || []) as VDay[]);
    setChannel((ch as Channel) || null);
    setCdaily((cd || []) as CDay[]);
    const ids = [...new Set(list.map((r) => r.product_id).filter(Boolean))] as string[];
    if (ids.length) {
      const { data: ps } = await supabase.from('products').select('id, title').in('id', ids);
      setNames(Object.fromEntries((ps || []).map((p: any) => [p.id, String(p.title).split('|')[0].trim()])));
    }
  }
  useEffect(() => { load(); const t = setInterval(load, 5 * 60000); return () => clearInterval(t); }, []);

  const live = useMemo(() => (rows || []).filter((r) => r.privacy === 'public'), [rows]);
  const totals = useMemo(() => ({
    live: live.length, drafts: (rows || []).length - live.length,
    views: live.reduce((a, r) => a + (r.views || 0), 0),
    likes: live.reduce((a, r) => a + (r.likes || 0), 0),
    comments: live.reduce((a, r) => a + (r.comments || 0), 0),
  }), [rows, live]);
  const gained = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rows || []) { const mine = days.filter((d) => d.video_id === r.video_id); if (mine.length > 1) m[r.video_id] = r.views - mine[0].views; }
    return m;
  }, [rows, days]);

  // channel window numbers (finalised) vs the previous window
  const cwin = useMemo(() => {
    const cut = new Date(Date.now() - range * 864e5).toISOString().slice(0, 10);
    const prevCut = new Date(Date.now() - 2 * range * 864e5).toISOString().slice(0, 10);
    const cur = cdaily.filter((d) => d.day >= cut), prev = cdaily.filter((d) => d.day >= prevCut && d.day < cut);
    const sum = (l: CDay[], k: keyof CDay) => l.reduce((a, d) => a + (Number(d[k]) || 0), 0);
    const wpct = (l: CDay[]) => { const v = sum(l, 'views'); return v ? l.reduce((a, d) => a + d.avg_view_pct * d.views, 0) / v : 0; };
    return { rows: cur.map((d) => ({ ...d, net: d.subs_gained - d.subs_lost })), views: sum(cur, 'views'), pviews: sum(prev, 'views'), minutes: sum(cur, 'minutes_watched'), likes: sum(cur, 'likes'), shares: sum(cur, 'shares'), comments: sum(cur, 'comments'), net: sum(cur, 'subs_gained') - sum(cur, 'subs_lost'), pnet: sum(prev, 'subs_gained') - sum(prev, 'subs_lost'), engaged: sum(cur, 'engaged_views'), avgpct: wpct(cur) };
  }, [cdaily, range]);

  const sorted = useMemo(() => {
    const v = (r: Row) => deep[r.video_id];
    const k: Record<SortKey, (r: Row) => number> = {
      published: (r) => new Date(r.published_at || 0).getTime(), views: (r) => r.views,
      engaged: (r) => v(r)?.views ? v(r).engaged_views / v(r).views : -1, avgpct: (r) => v(r)?.avg_view_pct ?? -1,
      likes: (r) => r.likes, shares: (r) => v(r)?.shares ?? -1, subs: (r) => v(r)?.subs_gained ?? -1, gained: (r) => gained[r.video_id] || 0,
    };
    return [...(rows || [])].sort((a, b) => k[sort](b) - k[sort](a));
  }, [rows, deep, sort, gained]);

  // insights: who wins on each axis, from finalised data only
  const best = useMemo(() => {
    const withData = live.filter((r) => deep[r.video_id]?.views > 30);
    const top = (f: (d: Deep) => number) => withData.length ? withData.reduce((a, b) => f(deep[b.video_id]) > f(deep[a.video_id]) ? b : a) : null;
    return { hook: top((d) => d.views ? d.engaged_views / d.views : 0), hold: top((d) => d.avg_view_pct), subs: top((d) => d.subs_gained), shares: top((d) => d.shares) };
  }, [live, deep]);

  const stale = !!rows?.[0]?.synced_at && Date.now() - new Date(rows[0].synced_at as string).getTime() > 3 * 3600e3;
  if (rows === null) return <Card><div className="p-4 text-sm text-ink-500">Loading YouTube…</div></Card>;
  const delta = (a: number, b: number) => b ? `${a >= b ? '▲' : '▼'} ${Math.abs(Math.round(((a - b) / b) * 100))}% vs previous ${range}d` : undefined;
  const Th = ({ k, children, right }: { k?: SortKey; children: any; right?: boolean }) => (
    <th className={`px-2 py-1.5 text-[10px] uppercase tracking-wide font-medium text-ink-700/50 ${right ? 'text-right' : 'text-left'} ${k ? 'cursor-pointer hover:text-bronze-700' : ''} ${k && sort === k ? 'text-bronze-700' : ''}`} onClick={() => k && setSort(k)}>{children}{k && sort === k ? ' ▾' : ''}</th>
  );

  return (
    <div className="space-y-4">
      {channel?.note && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <b>Analytics not connected.</b> {channel.note} Realtime views and likes still update; the deeper numbers below fill in on the next hourly sync after that.
        </div>
      )}

      <Card>
        <div className="p-4">
          <div className="flex items-baseline justify-between flex-wrap gap-2">
            <h3 className="font-serif text-lg">YouTube {channel?.title ? `· ${channel.title}` : ''}</h3>
            <div className="flex items-center gap-2">
              {([7, 28, 90] as const).map((r) => <button key={r} onClick={() => setRange(r)} className={`text-xs px-2 py-1 rounded ${range === r ? 'bg-bronze-600 text-cream' : 'bg-cream text-ink-700'}`}>{r}d</button>)}
              <span className={`text-[11px] ${stale ? 'text-amber-700 font-medium' : 'text-ink-500'}`}>{rows[0]?.synced_at ? `${stale ? '⚠ stale, ' : ''}synced ${ago(rows[0].synced_at)} · hourly from BRS` : 'never synced'}</span>
            </div>
          </div>
          {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
          {!rows.length && <p className="mt-2 text-sm text-ink-500">No videos yet. In BRS: Video Studio → YouTube pack → Upload, then Sync stats.</p>}
          {!!rows.length && (
            <>
              <div className="mt-3 flex flex-wrap gap-2">
                <Kpi label="Subscribers" value={fmt(channel?.subscribers || 0)} sub={cwin.net || cwin.pnet ? `${cwin.net >= 0 ? '+' : ''}${cwin.net} in ${range}d` : 'realtime'} tone={cwin.net > 0 ? 'good' : cwin.net < 0 ? 'bad' : undefined} />
                <Kpi label={`Views · ${range}d`} value={fmt(cwin.views)} sub={delta(cwin.views, cwin.pviews)} tone={cwin.pviews ? (cwin.views >= cwin.pviews ? 'good' : 'bad') : undefined} />
                <Kpi label="Watch time" value={`${fmt(Math.round(cwin.minutes / 60))} h`} sub={`${fmt(Math.round(cwin.minutes))} minutes`} />
                <Kpi label="Chose to watch" value={cwin.views ? `${pct(cwin.engaged, cwin.views)}%` : '–'} sub="engaged views" />
                <Kpi label="Avg watched" value={cwin.avgpct ? `${Math.round(cwin.avgpct)}%` : '–'} sub="of each film" />
                <Kpi label="Likes" value={fmt(cwin.likes)} sub={cwin.views ? `${((cwin.likes / cwin.views) * 100).toFixed(1)}% of views` : undefined} />
                <Kpi label="Shares" value={fmt(cwin.shares)} />
                <Kpi label="Live / drafts" value={`${totals.live} / ${totals.drafts}`} sub={`${fmt(totals.views)} realtime views`} />
              </div>
              <div className="mt-4">
                <div className="text-[10px] uppercase tracking-wide text-ink-700/50 font-medium mb-1">Channel views per day (bronze) and net subscribers (blue), finalised</div>
                <AreaLine rows={cwin.rows} keyA="views" keyB="net" labelA="views" labelB="net subscribers" />
                <div className="text-[10px] text-ink-700/45 mt-1">{channel?.through ? `finalised through ${channel.through}` : ''} · YouTube publishes analytics two to three days behind; the KPIs above use finalised days only</div>
              </div>
              {channel && (
                <div className="mt-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-4 border-t border-black/10 pt-3">
                  <Bars rows={channel.traffic as any} label="Traffic sources · 28d" map={SRC} />
                  <Bars rows={channel.countries as any} label="Countries · 28d" />
                  <Bars rows={channel.devices as any} label="Devices · 28d" map={DEV} />
                  <Demo rows={channel.demographics} />
                </div>
              )}
            </>
          )}
        </div>
      </Card>

      {(best.hook || best.hold || best.subs) && (
        <Card>
          <div className="p-4">
            <div className="text-sm font-bold text-ink-900 mb-2">What is working</div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-[12px]">
              {[['Best hook', best.hook, (d: Deep) => `${pct(d.engaged_views, d.views)}% chose to watch`],
                ['Holds attention longest', best.hold, (d: Deep) => `${Math.round(d.avg_view_pct)}% watched on average`],
                ['Earns most subscribers', best.subs, (d: Deep) => `+${d.subs_gained} subscribers`],
                ['Most shared', best.shares, (d: Deep) => `${d.shares} shares`]].map(([label, r, f]: any) => r ? (
                  <button key={label} onClick={() => setOpen(r.video_id)} className="text-left rounded-lg border border-black/10 bg-cream/40 px-3 py-2 hover:border-bronze-600">
                    <div className="text-[10px] uppercase tracking-wide text-ink-700/50 font-medium">{label}</div>
                    <div className="text-ink-900 font-medium line-clamp-1">{r.title}</div>
                    <div className="text-bronze-700">{f(deep[r.video_id])}</div>
                  </button>
                ) : null)}
            </div>
            <p className="text-[11px] text-ink-700/55 mt-2">Copy what the best hook does in its first second, and what the longest-held film does at the point where the others lose people. Those two numbers are the whole Shorts game.</p>
          </div>
        </Card>
      )}

      <Card>
        <div className="p-2 overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead><tr>
              <Th>Video</Th><Th k="published">Published</Th><Th k="views" right>Views</Th><Th k="gained" right>+30d</Th><Th k="engaged" right>Chose to watch</Th><Th k="avgpct" right>Avg watched</Th><Th k="likes" right>Likes</Th><Th k="shares" right>Shares</Th><Th k="subs" right>Subs</Th><Th right>Top source</Th>
            </tr></thead>
            <tbody>
              {sorted.map((r) => {
                const d = deep[r.video_id]; const has = d && d.views > 0; const isOpen = open === r.video_id;
                return (
                  <>
                    <tr key={r.video_id} onClick={() => setOpen(isOpen ? null : r.video_id)} className={`cursor-pointer border-t border-black/5 ${isOpen ? 'bg-bronze-600/10' : 'hover:bg-cream/60'}`}>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-2 min-w-[220px]">
                          {r.thumb_url && <img src={r.thumb_url} alt="" className="w-8 h-11 object-cover rounded bg-ink-100 shrink-0" />}
                          <div className="min-w-0">
                            <div className="text-ink-900 font-medium line-clamp-1">{r.title || r.video_id}</div>
                            <div className="text-[10px] text-ink-700/50">{r.privacy === 'public' ? <span className="text-emerald-700">● live</span> : <span className="text-amber-700">● {r.privacy}</span>}{r.duration_s ? ` · ${r.duration_s}s` : ''}{r.product_id && names[r.product_id] ? ` · ${names[r.product_id]}` : ''}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-ink-700/70 whitespace-nowrap">{r.published_at ? new Date(r.published_at).toLocaleDateString() : ''}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-bold">{fmt(r.views)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-emerald-700">{gained[r.video_id] > 0 ? `+${fmt(gained[r.video_id])}` : ''}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{has ? `${pct(d.engaged_views, d.views)}%` : <span className="text-ink-700/30">–</span>}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{has ? `${Math.round(d.avg_view_pct)}%` : <span className="text-ink-700/30">–</span>}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.likes)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{has ? d.shares : <span className="text-ink-700/30">–</span>}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{has ? `+${d.subs_gained}` : <span className="text-ink-700/30">–</span>}</td>
                      <td className="px-2 py-1.5 text-right text-ink-700/70 whitespace-nowrap">{has && d.traffic?.[0] ? `${SRC[d.traffic[0][0]] || d.traffic[0][0]} ${pct(d.traffic[0][1], d.views)}%` : ''}</td>
                    </tr>
                    {isOpen && (
                      <tr key={r.video_id + '-d'} className="bg-cream/30"><td colSpan={10} className="px-3 pb-3">
                        <div className="flex flex-wrap gap-3 text-[11px] pt-2">
                          <a href={`https://youtube.com/shorts/${r.video_id}`} target="_blank" rel="noopener" className="underline text-bronze-700">open on YouTube ↗</a>
                          <a href={`https://studio.youtube.com/video/${r.video_id}/analytics`} target="_blank" rel="noopener" className="underline text-bronze-700">Studio analytics ↗</a>
                          {r.product_id && <a href={`/admin?tab=products&id=${r.product_id}`} className="underline text-bronze-700">the design it sells</a>}
                        </div>
                        <VideoDetail r={r} d={d} daily={vdaily.filter((v) => v.video_id === r.video_id)} productName={r.product_id ? names[r.product_id] : undefined} />
                      </td></tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
          <div className="text-[10px] text-ink-700/45 px-2 pt-2">Views, likes and comments are realtime (Data API). Chose-to-watch, average watched, shares, subscribers and every breakdown are finalised Analytics numbers, two to three days behind. Click a row for the full picture.</div>
        </div>
      </Card>
    </div>
  );
}
