import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { Card } from '../ui';
import LiveVisitorMap from '../LiveVisitorMap';
import ChannelStats from '../ChannelStats';
import MerchantStats from '../MerchantStats';

type Visit = { day: string; path: string; referrer_host: string | null; device: string | null; country: string | null; visitor_hash: string | null; campaign?: string | null };

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

type Ev = { day: string; type: string; product_id: string | null; q: string | null; n: number | null; visitor_hash: string | null; ts?: string };

export default function Traffic() {
  const [days, setDays] = useState<number>(30);
  const [rows, setRows] = useState<Visit[]>([]);
  const [events, setEvents] = useState<Ev[]>([]);
  const [eventsExt, setEventsExt] = useState<Ev[]>([]);   // ≥30d window for the Shopper-actions panel
  const [paidCount, setPaidCount] = useState(0);
  const [prodNames, setProdNames] = useState<Record<string, string>>({});
  const [salesByProduct, setSalesByProduct] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [capped, setCapped] = useState(false);

  useEffect(() => { load(); }, [days]);
  // Keep the whole page LIVE, not just the on-site-now strip: refresh the
  // event/visit data every 30s and whenever the tab regains focus, so an
  // action taken while the admin was open shows up without a manual reload.
  // (Owner test: hearted → carted → checkout while watching the panel; the
  // events landed in the DB instantly but the counters were a stale snapshot.)
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(true); }, 30000);
    const onFocus = () => load(true);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(true); });
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [days]);
  async function load(silent = false) {
    if (!silent) setLoading(true);   // background refreshes must not blank the panel
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const sinceTs = new Date(Date.now() - days * 86400000).toISOString();
    const out: Visit[] = [];
    for (let from = 0; from < 60000; from += 1000) {
      const { data } = await supabase.from('site_visits')
        .select('day, path, referrer_host, device, country, visitor_hash, campaign')
        .gte('day', since).order('day').range(from, from + 999);
      out.push(...((data || []) as Visit[]));
      if (!data || data.length < 1000) { setCapped(false); break; }
      if (from + 1000 >= 60000) setCapped(true);
    }
    setRows(out);

    // funnel events + paid orders + product-heat context. Events are fetched
    // for at least 30 days so the Shopper-actions panel can offer its own
    // Today / week / month ranges regardless of the global range buttons;
    // the other cards keep seeing only the global range (filtered below).
    const evDays = Math.max(days, 30);
    const evSince = new Date(Date.now() - evDays * 86400000).toISOString().slice(0, 10);
    const [{ data: evsAll }, { count: paid }, { data: oi }] = await Promise.all([
      supabase.from('site_events').select('day, type, product_id, q, n, visitor_hash, ts').gte('day', evSince).order('ts', { ascending: false }).limit(20000),
      supabase.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'paid').gte('created_at', sinceTs),
      supabase.from('order_items').select('product_id, orders!inner(status, created_at)').eq('orders.status', 'paid').gte('orders.created_at', sinceTs).limit(5000),
    ]);
    const evs = (evsAll || []).filter((e: any) => e.day >= since);
    setEventsExt((evsAll || []) as Ev[]);
    setEvents((evs || []) as Ev[]);
    setPaidCount(paid || 0);
    const sales: Record<string, number> = {};
    for (const r of (oi || []) as any[]) if (r.product_id) sales[r.product_id] = (sales[r.product_id] || 0) + 1;
    setSalesByProduct(sales);

    // resolve product titles for the heat + shopper-action lists (extended set
    // so panel drill-downs across 30d always resolve)
    const viewCounts: Record<string, number> = {};
    for (const e of (evsAll || []) as Ev[]) {
      if (e.product_id && ['view_product', 'add_to_cart', 'buy_now', 'wishlist_add'].includes(e.type)) {
        viewCounts[e.product_id] = (viewCounts[e.product_id] || 0) + 1;
      }
    }
    const ids = [...new Set([...Object.keys(viewCounts), ...Object.keys(sales)])].slice(0, 400);
    if (ids.length) {
      const { data: ps } = await supabase.from('products').select('id, title').in('id', ids);
      setProdNames(Object.fromEntries((ps || []).map((p: any) => [p.id, p.title.split('|')[0].trim()])));
    } else setProdNames({});
    setLoading(false);
  }

  const stats = useMemo(() => {
    const byDay = new Map<string, { pv: number; uniq: Set<string> }>();
    const pages = new Map<string, number>(), refs = new Map<string, number>(), devices = new Map<string, number>(), countries = new Map<string, number>(), camps = new Map<string, number>();
    const allUniq = new Set<string>();
    for (const r of rows) {
      const d = byDay.get(r.day) || { pv: 0, uniq: new Set<string>() };
      d.pv++; if (r.visitor_hash) { d.uniq.add(r.visitor_hash); allUniq.add(r.day + r.visitor_hash); }
      byDay.set(r.day, d);
      pages.set(r.path, (pages.get(r.path) || 0) + 1);
      if (r.referrer_host) refs.set(r.referrer_host, (refs.get(r.referrer_host) || 0) + 1);
      if (r.device) devices.set(r.device, (devices.get(r.device) || 0) + 1);
      if (r.country) countries.set(r.country, (countries.get(r.country) || 0) + 1);
      if (r.campaign) camps.set(r.campaign, (camps.get(r.campaign) || 0) + 1);
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
      topPages: top(pages, 10), topRefs: top(refs), devices: top(devices, 4), countries: top(countries), campaigns: top(camps, 12),
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

          <ShopperActions events={eventsExt} names={prodNames} paid={paidCount} days={days} />

          <LampStudio days={days} />

          <MerchantStats />

          <ChannelStats />

          <LiveVisitorMap />

          <Card>
            <div className="flex items-center gap-4 mb-2">
              <div className="text-sm font-medium text-ink-900">Daily traffic</div>
              <span className="flex items-center gap-1 text-xs text-ink-700/60"><span style={{ width: 10, height: 10, borderRadius: 2, background: '#854F0B', display: 'inline-block' }} />Unique visitors</span>
              <span className="flex items-center gap-1 text-xs text-ink-700/60"><span style={{ width: 10, height: 10, borderRadius: 2, background: '#d8c9b3', display: 'inline-block' }} />Pageviews</span>
            </div>
            <BarChart points={stats.points} />
            {capped && <p className="text-[11px] text-ink-700/50 mt-1">Showing the first 60k rows of the range.</p>}
          </Card>

          <FunnelCard visitors={stats.visitors} events={events} paid={paidCount} days={days} />

          <OrdersCalendar />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <HeatList events={events} names={prodNames} sales={salesByProduct} />
            <SearchTerms events={events} />
            <TopList title="Top pages" rows={stats.topPages} total={stats.pv} />
            <TopList title="Referrer sources" rows={stats.topRefs} total={stats.pv} />
            <TopList title="Campaigns (?src= links)" rows={stats.campaigns} total={stats.pv} />
            <TopList title="Devices" rows={stats.devices} total={stats.pv} />
            <TopList title="Countries" rows={stats.countries} total={stats.pv} />
          </div>
        </>
      )}
    </div>
  );
}

// ── Lamp Studio engagement — page views, playground tries, live-now. ────
// The /lamp-studio landing page embeds the live Vase Lampshade Studio
// playground (an iframe). Landing-page views land in site_visits; the deeper
// "actually used the app" signal is the 'lamp_try' site_event, fired when the
// playground scrolls into view. Live-now = distinct visitors on /lamp-studio
// in the last 5 minutes (same signal as the LIVE strip, filtered to this page).
function LampStudio({ days }: { days: number }) {
  const [d, setD] = useState<{ views: number; viewers: number; tries: number; triers: number; live: number } | null>(null);
  const load = async () => {
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const liveSince = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const [{ data: visits }, { data: tries }, { data: liveRows }] = await Promise.all([
      supabase.from('site_visits').select('visitor_hash').eq('path', '/lamp-studio').gte('day', since).limit(20000),
      supabase.from('site_events').select('visitor_hash').eq('type', 'lamp_try').gte('day', since).limit(20000),
      supabase.from('site_visits').select('visitor_hash').eq('path', '/lamp-studio').gte('ts', liveSince).limit(2000),
    ]);
    const uniq = (rows: any[]) => new Set((rows || []).map((r) => r.visitor_hash || Math.random())).size;
    setD({
      views: (visits || []).length, viewers: uniq(visits || []),
      tries: (tries || []).length, triers: uniq(tries || []),
      live: uniq(liveRows || []),
    });
  };
  useEffect(() => {
    load();
    const t = setInterval(load, 20000);   // keep live-now fresh
    return () => clearInterval(t);
  }, [days]);
  if (!d) return null;
  const convo = d.viewers ? Math.round((d.triers / d.viewers) * 100) : 0;
  return (
    <Card>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="text-sm font-bold text-ink-900">💡 Lamp Studio engagement</div>
        <span className="text-[11px] text-ink-700/50">the /lamp-studio page + its live playground · last {days}d</span>
        <a href="/lamp-studio" target="_blank" rel="noreferrer" className="text-[11px] text-bronze-600 hover:underline ml-auto">open page ↗</a>
        <span className={`flex items-center gap-1 text-xs font-medium ${d.live > 0 ? 'text-green-700' : 'text-ink-700/40'}`}>
          <span className={`inline-block w-2 h-2 rounded-full ${d.live > 0 ? 'bg-green-500 animate-pulse' : 'bg-ink-700/20'}`} />
          {d.live > 0 ? `${d.live} on this page now` : 'nobody on it right now'}
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg border border-bronze-600/15 bg-cream/40 px-4 py-3">
          <div className="text-[10px] uppercase tracking-wide text-ink-700/50 font-medium">Page views</div>
          <div className="text-2xl font-extrabold text-bronze-800 leading-tight">{d.views}</div>
          <div className="text-[11px] text-ink-700/50 mt-0.5"><b>{d.viewers}</b> unique visitors</div>
        </div>
        <div className="rounded-lg border border-bronze-600/15 bg-cream/40 px-4 py-3">
          <div className="text-[10px] uppercase tracking-wide text-ink-700/50 font-medium">Tried the playground</div>
          <div className="text-2xl font-extrabold text-bronze-800 leading-tight">{d.triers}</div>
          <div className="text-[11px] text-ink-700/50 mt-0.5"><b>{d.tries}</b> total opens</div>
        </div>
        <div className="rounded-lg border border-bronze-600/15 bg-cream/40 px-4 py-3">
          <div className="text-[10px] uppercase tracking-wide text-ink-700/50 font-medium">Play rate</div>
          <div className="text-2xl font-extrabold text-bronze-800 leading-tight">{convo}%</div>
          <div className="text-[11px] text-ink-700/50 mt-0.5">of visitors tried it</div>
        </div>
        <div className={`rounded-lg border px-4 py-3 ${d.live > 0 ? 'border-green-200 bg-green-50' : 'border-black/10 bg-cream/40'}`}>
          <div className={`text-[10px] uppercase tracking-wide font-medium ${d.live > 0 ? 'text-green-700/70' : 'text-ink-700/50'}`}>Live now</div>
          <div className={`text-2xl font-extrabold leading-tight ${d.live > 0 ? 'text-green-700' : 'text-ink-700/60'}`}>{d.live}</div>
          <div className="text-[11px] text-ink-700/50 mt-0.5">on the page (5 min)</div>
        </div>
      </div>
    </Card>
  );
}

// ── Shopper actions v2 — bold, clickable, ranged, LIVE. ─────────────────
// • Its own Today / This week / This month range (independent of the global
//   range buttons; events are always loaded ≥30d for this panel).
// • Click any metric card → drill-down: which designs + which emails we know
//   (wishlists come from favorite signals, carts/checkouts from cart-email
//   capture, orders from the orders table) + the latest raw events with times.
// • LIVE strip: visitors on site in the last 5 min (pulsing) and a BLINKING
//   heart/cart when someone is on the cart or in checkout right now. 15s poll.
const PANEL_RANGES = [
  { key: 'today', label: 'Today', days: 1 },
  { key: 'week', label: 'This week', days: 7 },
  { key: 'month', label: 'This month', days: 30 },
] as const;

function LiveNow() {
  const [live, setLive] = useState<{ onSite: number; onCart: number } | null>(null);
  useEffect(() => {
    let stop = false;
    async function poll() {
      try {
        const since = new Date(Date.now() - 5 * 60000).toISOString();
        const { data } = await supabase.from('site_visits').select('visitor_hash, path').gte('ts', since).limit(2000);
        const rows = data || [];
        const onSite = new Set(rows.map((r: any) => r.visitor_hash || Math.random())).size;
        const onCart = new Set(rows.filter((r: any) => r.path === '/cart' || r.path.startsWith('/checkout')).map((r: any) => r.visitor_hash || Math.random())).size;
        if (!stop) setLive({ onSite, onCart });
      } catch { /* keep last value */ }
    }
    poll();
    const t = setInterval(poll, 15000);
    return () => { stop = true; clearInterval(t); };
  }, []);
  if (!live) return null;
  return (
    <div className="flex items-center gap-4 flex-wrap ml-auto">
      <style>{`@keyframes dccblink{0%,49%{opacity:1}50%,100%{opacity:.15}} .dcc-blink{animation:dccblink 1s step-start infinite}`}</style>
      <span className={`inline-flex items-center gap-1.5 text-xs font-bold ${live.onSite > 0 ? 'text-green-700' : 'text-ink-700/40'}`}>
        <span className={`inline-block w-2.5 h-2.5 rounded-full ${live.onSite > 0 ? 'bg-green-500 animate-pulse' : 'bg-ink-700/20'}`} />
        LIVE · <span className="text-lg leading-none">{live.onSite}</span> on site now
      </span>
      {live.onCart > 0 && (
        <span className="inline-flex items-center gap-1.5 text-xs font-bold text-red-600 bg-red-50 border border-red-200 rounded-full px-2.5 py-1">
          <span className="dcc-blink text-sm leading-none" aria-hidden="true">❤️🛒</span>
          {live.onCart} at cart / checkout RIGHT NOW
        </span>
      )}
    </div>
  );
}

function ShopperActions({ events, names, paid, days }: { events: Ev[]; names: Record<string, string>; paid: number; days: number }) {
  const [range, setRange] = useState<'today' | 'week' | 'month'>('today');
  const [open, setOpen] = useState<string | null>(null);      // drill-down metric type
  const [people, setPeople] = useState<{ label: string; rows: { who: string; what: string; when: string }[] } | null>(null);
  const [peopleBusy, setPeopleBusy] = useState(false);
  const [idMap, setIdMap] = useState<Record<string, string>>({});   // visitor_hash → email (identity bridge)

  const rangeDef = PANEL_RANGES.find((r) => r.key === range)!;
  const sinceDay = new Date(Date.now() - (rangeDef.days - 1) * 86400000).toISOString().slice(0, 10);
  const inRange = events.filter((e) => e.day >= sinceDay);
  const todayKey = new Date().toISOString().slice(0, 10);
  const count = (t: string) => inRange.filter((e) => e.type === t).length;
  const todayCount = (t: string) => events.filter((e) => e.type === t && e.day === todayKey).length;
  const metrics = [
    { icon: '🛒', label: 'Added to cart', type: 'add_to_cart' },
    { icon: '⚡', label: 'Buy-now taps', type: 'buy_now' },
    { icon: '❤️', label: 'Wishlist saves', type: 'wishlist_add' },
    { icon: '🚪', label: 'Checkout started', type: 'checkout_start' },
    { icon: '💳', label: 'Reached payment', type: 'txn_created' },
  ];
  // only show designs that resolve to a real product (hides deleted/test ids)
  const topBy = (t: string, n = 8) => {
    const c: Record<string, number> = {};
    for (const e of inRange) if (e.type === t && e.product_id && names[e.product_id]) c[e.product_id] = (c[e.product_id] || 0) + 1;
    return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, n);
  };

  // Drill-down "who": best-effort identity per metric. Wishlists → favorite
  // signals; cart/checkout/payment → the email captured in the cart field;
  // most shoppers stay anonymous until they type an email — that's expected.
  async function loadPeople(type: string) {
    setPeopleBusy(true); setPeople(null);
    const sinceTs = new Date(Date.now() - rangeDef.days * 86400000).toISOString();
    const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    // Identity bridge: resolve visitor hashes on this metric's events to emails
    // captured when those visitors identified themselves (cart / subscribe).
    try {
      const hashes = [...new Set(inRange.filter((e) => e.type === type && e.visitor_hash).map((e) => e.visitor_hash as string))].slice(0, 200);
      if (hashes.length) {
        const { data: ids } = await supabase.from('visitor_identities').select('visitor_hash, email').in('visitor_hash', hashes);
        setIdMap(Object.fromEntries((ids || []).map((r: any) => [r.visitor_hash, r.email])));
      } else setIdMap({});
    } catch { setIdMap({}); }
    try {
      if (type === 'wishlist_add') {
        const { data } = await supabase.from('browse_events')
          .select('email, product_id, created_at').eq('source', 'favorite')
          .gte('created_at', sinceTs).order('created_at', { ascending: false }).limit(30);
        setPeople({
          label: 'Wishlist saves where we know the email (subscribed / typed at cart)',
          rows: (data || []).map((r: any) => ({ who: r.email, what: names[r.product_id] || 'a design', when: fmt(r.created_at) })),
        });
      } else if (type === 'txn_created' || type === 'checkout_start' || type === 'add_to_cart' || type === 'buy_now') {
        const { data } = await supabase.from('abandoned_carts')
          .select('email, cart, subtotal, updated_at, recovered_at')
          .gte('updated_at', sinceTs).order('updated_at', { ascending: false }).limit(30);
        setPeople({
          label: 'Emails captured at the cart (♻ = later completed checkout)',
          rows: (data || []).map((r: any) => ({
            who: (r.recovered_at ? '♻ ' : '') + r.email,
            what: `${(Array.isArray(r.cart) ? r.cart : []).length} item(s) · $${Number(r.subtotal || 0).toFixed(2)}`,
            when: fmt(r.updated_at),
          })),
        });
      } else setPeople({ label: '', rows: [] });
    } catch { setPeople({ label: 'Could not load details.', rows: [] }); }
    setPeopleBusy(false);
  }

  function toggle(type: string) {
    const next = open === type ? null : type;
    setOpen(next);
    if (next) loadPeople(next);
  }

  const wishRemoved = count('wishlist_remove');
  const openMetric = metrics.find((m) => m.type === open);
  const recentOf = (t: string) => inRange.filter((e) => e.type === t && (!e.product_id || names[e.product_id])).slice(0, 10);

  return (
    <Card>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="text-sm font-bold text-ink-900">🔥 Shopper actions</div>
        <div className="flex gap-1">
          {PANEL_RANGES.map((r) => (
            <button key={r.key} onClick={() => setRange(r.key)}
              className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${range === r.key ? 'bg-bronze-600 text-cream' : 'bg-cream text-ink-700 hover:bg-bronze-600/10'}`}>{r.label}</button>
          ))}
        </div>
        <span className="text-[11px] text-ink-700/50">tap a card for details</span>
        <LiveNow />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {metrics.map((m) => (
          <button key={m.type} onClick={() => toggle(m.type)}
            className={`rounded-lg p-3 text-center border transition cursor-pointer ${open === m.type ? 'bg-bronze-600/10 border-bronze-600 ring-2 ring-bronze-600/30' : 'bg-cream/50 border-bronze-600/15 hover:border-bronze-600/40'}`}>
            <div className="text-lg" aria-hidden="true">{m.icon}</div>
            <div className="text-3xl font-extrabold text-bronze-800 leading-tight">{count(m.type).toLocaleString()}</div>
            <div className="text-[11px] font-bold text-ink-800 mt-0.5">{m.label}</div>
            <div className="text-[11px] text-ink-700/60">today: <span className="font-bold text-ink-900">{todayCount(m.type)}</span></div>
          </button>
        ))}
        <div className="bg-[#5E380A] rounded-lg p-3 text-center">
          <div className="text-lg" aria-hidden="true">✅</div>
          <div className="text-3xl font-extrabold text-[#FAC775] leading-tight">{paid.toLocaleString()}</div>
          <div className="text-[11px] font-bold text-[#F5EFE3] mt-0.5">Paid orders ({days}d)</div>
        </div>
      </div>

      {open && openMetric && (
        <div className="mt-4 bg-cream/40 border border-bronze-600/20 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-base" aria-hidden="true">{openMetric.icon}</span>
            <span className="text-sm font-bold text-ink-900">{openMetric.label} — {rangeDef.label.toLowerCase()} in detail</span>
            <button onClick={() => setOpen(null)} className="ml-auto text-ink-700/40 hover:text-ink-800 text-lg leading-none">×</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <div className="text-xs font-bold text-ink-900 mb-1.5">Designs</div>
              {topBy(open).length === 0 ? <p className="text-xs text-ink-700/50">None in this range.</p> : topBy(open).map(([pid, n]) => (
                <div key={pid} className="flex justify-between gap-2 text-xs py-0.5">
                  <span className="truncate text-ink-800">{names[pid]}</span>
                  <span className="font-bold text-bronze-800 whitespace-nowrap">{n}×</span>
                </div>
              ))}
            </div>
            <div>
              <div className="text-xs font-bold text-ink-900 mb-1.5">Latest activity</div>
              {recentOf(open).length === 0 ? <p className="text-xs text-ink-700/50">None in this range.</p> : recentOf(open).map((e, i) => (
                <div key={i} className="text-xs py-0.5">
                  <div className="flex justify-between gap-2">
                    <span className="truncate text-ink-800">{e.product_id ? names[e.product_id] : (e.type === 'checkout_start' || e.type === 'txn_created' ? 'cart' : '—')}</span>
                    <span className="text-ink-700/50 whitespace-nowrap">{e.ts ? new Date(e.ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : e.day}</span>
                  </div>
                  {e.visitor_hash && idMap[e.visitor_hash] && (
                    <div className="text-[10px] text-green-700 font-medium truncate">👤 {idMap[e.visitor_hash]}</div>
                  )}
                </div>
              ))}
            </div>
            <div>
              <div className="text-xs font-bold text-ink-900 mb-1.5">Who (when we know)</div>
              {peopleBusy ? <p className="text-xs text-ink-700/50">Loading…</p> : !people || people.rows.length === 0 ? (
                <p className="text-xs text-ink-700/50">No identified people in this range — most shoppers are anonymous until they type their email at the cart or subscribe.</p>
              ) : (
                <>
                  <p className="text-[10px] text-ink-700/50 mb-1">{people.label}</p>
                  {people.rows.slice(0, 10).map((r, i) => (
                    <div key={i} className="text-xs py-0.5">
                      <span className="text-bronze-800 font-medium">{r.who}</span>
                      <span className="text-ink-700/60"> · {r.what} · {r.when}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        <div>
          <div className="text-xs font-bold text-ink-900 mb-1.5">🛒 Most added to cart ({rangeDef.label.toLowerCase()})</div>
          {topBy('add_to_cart', 6).length === 0 ? <p className="text-xs text-ink-700/50">Nothing yet in this range.</p> : topBy('add_to_cart', 6).map(([pid, n]) => (
            <div key={pid} className="flex justify-between gap-2 text-xs py-0.5">
              <span className="truncate text-ink-800">{names[pid]}</span>
              <span className="font-bold text-bronze-800 whitespace-nowrap">{n}×</span>
            </div>
          ))}
        </div>
        <div>
          <div className="text-xs font-bold text-ink-900 mb-1.5">❤️ Most wishlisted ({rangeDef.label.toLowerCase()}) {wishRemoved > 0 && <span className="font-normal text-ink-700/50">({wishRemoved} removed)</span>}</div>
          {topBy('wishlist_add', 6).length === 0 ? <p className="text-xs text-ink-700/50">Nothing yet in this range.</p> : topBy('wishlist_add', 6).map(([pid, n]) => (
            <div key={pid} className="flex justify-between gap-2 text-xs py-0.5">
              <span className="truncate text-ink-800">{names[pid]}</span>
              <span className="font-bold text-bronze-800 whitespace-nowrap">{n}×</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function FunnelCard({ visitors, events, paid, days }: { visitors: number; events: Ev[]; paid: number; days: number }) {
  const uniq = (t: string) => new Set(events.filter((e) => e.type === t).map((e) => e.day + (e.visitor_hash || ''))).size;
  const steps = [
    { label: 'Visitors', n: visitors },
    { label: 'Viewed a product', n: uniq('view_product') },
    { label: 'Added to cart', n: uniq('add_to_cart') },
    { label: 'Started checkout', n: uniq('checkout_start') },
    // txn_created is logged SERVER-side by checkout-init (ad-block proof): the
    // buyer got as far as the Paddle payment frame. A big drop from here to
    // "Paid orders" means people bail INSIDE payment (price shock, card issues).
    { label: 'Reached payment', n: events.filter((e) => e.type === 'txn_created').length },
    { label: 'Paid orders', n: paid },
  ];
  const max = Math.max(1, ...steps.map((s) => s.n));
  return (
    <Card>
      <div className="text-sm font-medium text-ink-900 mb-3">Conversion funnel ({days}d)</div>
      <div className="space-y-2">
        {steps.map((s, i) => {
          const prev = i > 0 ? steps[i - 1].n : 0;
          const pct = i > 0 && prev > 0 ? Math.round((s.n / prev) * 100) : null;
          return (
            <div key={s.label} className="flex items-center gap-3 text-xs">
              <span className="w-32 text-ink-700/70">{s.label}</span>
              <div className="flex-1 h-4 bg-cream rounded overflow-hidden"><div className="h-full bg-bronze-600" style={{ width: `${Math.max(2, Math.round((s.n / max) * 100))}%` }} /></div>
              <span className="w-14 text-right font-medium text-ink-900">{s.n.toLocaleString()}</span>
              <span className="w-12 text-right text-ink-700/50">{pct != null ? pct + '%' : ''}</span>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-ink-700/50 mt-2">Percentages are step-to-step. Product/cart/checkout counts collect from the latest deploy onward.</p>
    </Card>
  );
}

function HeatList({ events, names, sales }: { events: Ev[]; names: Record<string, string>; sales: Record<string, number> }) {
  const views: Record<string, number> = {};
  for (const e of events) if (e.type === 'view_product' && e.product_id) views[e.product_id] = (views[e.product_id] || 0) + 1;
  const top = Object.entries(views).sort((a, b) => b[1] - a[1]).slice(0, 10);
  return (
    <Card>
      <div className="text-sm font-medium text-ink-900 mb-1">Product heat — views vs sales</div>
      <p className="text-[11px] text-ink-700/50 mb-2">High views + zero sales = fix price, images or copy.</p>
      {top.length === 0 ? <p className="text-xs text-ink-700/50">No product views recorded yet.</p> : (
        <div className="space-y-1.5">
          {top.map(([pid, v]) => (
            <div key={pid} className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-ink-800">{names[pid] || pid.slice(0, 8)}</span>
              <span className="whitespace-nowrap text-ink-700/60">{v} views · <span className={sales[pid] ? 'text-green-700' : 'text-red-600'}>{sales[pid] || 0} sold</span></span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function SearchTerms({ events }: { events: Ev[] }) {
  const terms: Record<string, { n: number; zero: boolean }> = {};
  for (const e of events) if (e.type === 'search' && e.q) {
    const t = terms[e.q] || { n: 0, zero: false };
    t.n++; if ((e.n ?? 0) === 0) t.zero = true;
    terms[e.q] = t;
  }
  const top = Object.entries(terms).sort((a, b) => b[1].n - a[1].n).slice(0, 12);
  return (
    <Card>
      <div className="text-sm font-medium text-ink-900 mb-1">Search terms</div>
      <p className="text-[11px] text-ink-700/50 mb-2"><span className="text-red-600 font-medium">Red</span> = searched but found nothing → a design you should make.</p>
      {top.length === 0 ? <p className="text-xs text-ink-700/50">No searches recorded yet.</p> : (
        <div className="flex flex-wrap gap-1.5">
          {top.map(([q, t]) => (
            <span key={q} className={`text-xs px-2 py-0.5 rounded border ${t.zero ? 'border-red-300 text-red-700 bg-red-50' : 'border-black/10 text-ink-700 bg-cream/50'}`}>{q} · {t.n}</span>
          ))}
        </div>
      )}
    </Card>
  );
}

// ── Orders heatmap calendar — GitHub-style, 16 weeks of buying days. ──
// Square intensity = paid orders that day; tooltip shows orders + revenue.
// The footer line names your strongest day of the week for launches/drops.
function OrdersCalendar() {
  const [byDay, setByDay] = useState<Record<string, { n: number; rev: number }>>({});
  const [loaded, setLoaded] = useState(false);
  const WEEKS = 16;

  useEffect(() => {
    (async () => {
      const since = new Date(Date.now() - WEEKS * 7 * 86400000).toISOString();
      const { data } = await supabase.from('orders')
        .select('created_at, total').eq('status', 'paid').gte('created_at', since).limit(10000);
      const m: Record<string, { n: number; rev: number }> = {};
      for (const o of data || []) {
        const d = String(o.created_at).slice(0, 10);
        (m[d] ||= { n: 0, rev: 0 });
        m[d].n++; m[d].rev += Number(o.total) || 0;
      }
      setByDay(m); setLoaded(true);
    })();
  }, []);

  // Build the grid: columns = weeks (oldest → newest), rows = Mon..Sun.
  const today = new Date();
  const cols: { day: string; n: number; rev: number }[][] = [];
  const start = new Date(today.getTime() - (WEEKS * 7 - 1) * 86400000);
  // align the first column so rows are true weekdays (Mon = row 0)
  const startDow = (start.getDay() + 6) % 7;
  const first = new Date(start.getTime() - startDow * 86400000);
  for (let w = 0; w < WEEKS + 1; w++) {
    const col: { day: string; n: number; rev: number }[] = [];
    for (let d = 0; d < 7; d++) {
      const dt = new Date(first.getTime() + (w * 7 + d) * 86400000);
      if (dt > today) break;
      const key = dt.toISOString().slice(0, 10);
      col.push({ day: key, ...(byDay[key] || { n: 0, rev: 0 }) });
    }
    if (col.length) cols.push(col);
  }
  const maxN = Math.max(1, ...Object.values(byDay).map((v) => v.n));
  const shade = (n: number) => n === 0 ? '#f1ece1' : n <= maxN * 0.34 ? '#e0c391' : n <= maxN * 0.67 ? '#b8834a' : '#854F0B';

  // strongest day of week by orders
  const dowTotals = new Array(7).fill(0);
  for (const [day, v] of Object.entries(byDay)) dowTotals[(new Date(day + 'T12:00:00Z').getUTCDay() + 6) % 7] += v.n;
  const DOW = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const bestDow = dowTotals.some((n) => n > 0) ? DOW[dowTotals.indexOf(Math.max(...dowTotals))] : null;
  const CELL = 15, GAP = 3;

  return (
    <Card>
      <div className="flex items-baseline gap-2 mb-2 flex-wrap">
        <div className="text-sm font-bold text-ink-900">📅 Buying days — last {WEEKS} weeks</div>
        {bestDow && <span className="text-xs text-ink-700/60">your strongest day is <b className="text-bronze-800">{bestDow}</b> — launch drops then</span>}
      </div>
      {!loaded ? <p className="text-xs text-ink-700/50">Loading…</p> : (
        <div className="overflow-x-auto">
          <svg width={(cols.length * (CELL + GAP)) + 30} height={7 * (CELL + GAP) + 6}>
            {['Mon', 'Wed', 'Fri', 'Sun'].map((lbl, i) => (
              <text key={lbl} x={0} y={[0, 2, 4, 6][i] * (CELL + GAP) + CELL - 3} fontSize={9} fill="#8a7a68">{lbl}</text>
            ))}
            {cols.map((col, w) => col.map((c, d) => (
              <rect key={c.day} x={30 + w * (CELL + GAP)} y={d * (CELL + GAP)} width={CELL} height={CELL} rx={3}
                fill={shade(c.n)} stroke={c.n > 0 ? '#5E380A22' : 'none'}>
                <title>{c.day}: {c.n} order{c.n === 1 ? '' : 's'}{c.rev > 0 ? ` · $${c.rev.toFixed(2)}` : ''}</title>
              </rect>
            )))}
          </svg>
          <div className="flex items-center gap-1.5 mt-1 text-[10px] text-ink-700/50">
            less
            {['#f1ece1', '#e0c391', '#b8834a', '#854F0B'].map((c) => <span key={c} className="inline-block w-3 h-3 rounded" style={{ background: c }} />)}
            more · hover a square for the day's orders + revenue
          </div>
        </div>
      )}
    </Card>
  );
}
