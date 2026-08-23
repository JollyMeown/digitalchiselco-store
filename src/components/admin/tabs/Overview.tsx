import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { Card, StatBox, btnGhost, btnPrimary, inputCls } from '../ui';
import { useLiveRefresh } from '../useLiveRefresh';

type Order = { id: string; email: string; total: number; status: string; created_at: string };
type Item = { title: string; price_usd: number; qty: number; order_id: string };

const fmt = (n: number) => '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = (n: number) => '$' + Math.round(n).toLocaleString();
const eur = (n: number, c = 'EUR') => new Intl.NumberFormat('en-IE', { style: 'currency', currency: c }).format(n || 0);
// Local-time day key (not UTC) so buckets line up with the admin's calendar.
const dayKey = (d: Date | string) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

export default function Overview() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [recent, setRecent] = useState<any[]>([]);
  const [counts, setCounts] = useState({ products: 0, categories: 0, subscribers: 0 });
  const [donation, setDonation] = useState(0);
  const [etsyStats, setEtsyStats] = useState<any>(null);
  const [refStats, setRefStats] = useState<{ codes: number; referred: number; rewarded: number; revenue: number } | null>(null);
  const [cults, setCults] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  // default range: last 30 days
  const today = dayKey(new Date());
  const [dateFrom, setDateFrom] = useState(dayKey(new Date(Date.now() - 29 * 86400000)));
  const [dateTo, setDateTo] = useState(today);

  useEffect(() => { load(); }, []);
  useLiveRefresh(() => load(true), 30000);   // keep this tab live (silent, pauses while editing)
  async function load(silent = false) {
    if (!silent) setLoading(true);
    const [allOrdersRes, allItemsRes, recentRes, products, categories, subs, settings] = await Promise.all([
      supabase.from('orders').select('id,email,total,status,created_at').is('deleted_at', null).order('created_at', { ascending: false }).limit(5000),
      supabase.from('order_items').select('title,price_usd,qty,order_id').limit(20000),
      supabase.from('orders').select('id,email,total,status,created_at,order_items(qty)').is('deleted_at', null).order('created_at', { ascending: false }).limit(10),
      supabase.from('products').select('id', { count: 'exact', head: true }).eq('active', true),
      supabase.from('categories').select('id', { count: 'exact', head: true }),
      supabase.from('subscribers').select('id', { count: 'exact', head: true }),
      supabase.from('site_settings').select('donation_total, sales_count, rating, reviews_count, admirers_count, products_count, etsy_synced_at').eq('id', 1).maybeSingle(),
    ]);
    setOrders((allOrdersRes.data ?? []) as any);
    setItems((allItemsRes.data ?? []) as any);
    setRecent(recentRes.data ?? []);
    setCounts({ products: products.count ?? 0, categories: categories.count ?? 0, subscribers: subs.count ?? 0 });
    setDonation(Number(settings.data?.donation_total || 0));
    setEtsyStats(settings.data || null);
    try {
      const [{ count: codeCount }, { data: refs }] = await Promise.all([
        supabase.from('referral_codes').select('email', { count: 'exact', head: true }),
        supabase.from('referrals').select('status, amount_usd'),
      ]);
      const rr = refs || [];
      setRefStats({
        codes: codeCount || 0,
        referred: rr.length,
        rewarded: rr.filter((r: any) => r.status === 'rewarded').length,
        revenue: rr.reduce((s: number, r: any) => s + Number(r.amount_usd || 0), 0),
      });
    } catch { setRefStats(null); }
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/admin/cults-sales', { headers: { authorization: `Bearer ${session?.access_token}` } });
      if (res.ok) setCults(await res.json());
    } catch {}
    setLoading(false);
  }

  // Math derived from the date range
  const stats = useMemo(() => {
    const paid = orders.filter((o) => o.status === 'paid');
    const inRange = paid.filter((o) => {
      const d = dayKey(o.created_at);
      return d >= dateFrom && d <= dateTo;
    });
    const sum = (rows: Order[]) => rows.reduce((s, r) => s + Number(r.total || 0), 0);

    const orderIds = new Set(inRange.map((o) => o.id));
    const rangeItems = items.filter((it) => orderIds.has(it.order_id));
    const itemCount = rangeItems.reduce((s, it) => s + (it.qty || 1), 0);

    // last 7 days
    const d7 = dayKey(new Date(Date.now() - 6 * 86400000));
    const last7 = paid.filter((o) => dayKey(o.created_at) >= d7);

    // bucket by day across the chosen range (inclusive)
    const fromMs = Date.parse(dateFrom + 'T00:00:00');
    const toMs = Date.parse(dateTo + 'T00:00:00');
    const days = Math.min(180, Math.max(1, Math.round((toMs - fromMs) / 86400000) + 1));
    const buckets: { day: string; total: number; orders: number }[] = [];
    for (let i = 0; i < days; i++) {
      const k = dayKey(new Date(fromMs + i * 86400000));
      buckets.push({ day: k, total: 0, orders: 0 });
    }
    inRange.forEach((o) => {
      const idx = Math.round((Date.parse(dayKey(o.created_at) + 'T00:00:00') - fromMs) / 86400000);
      if (idx >= 0 && idx < buckets.length) {
        buckets[idx].total += Number(o.total || 0);
        buckets[idx].orders++;
      }
    });

    // top selling items in range
    const itemAgg: Record<string, { title: string; qty: number; revenue: number }> = {};
    rangeItems.forEach((it) => {
      const k = it.title;
      itemAgg[k] = itemAgg[k] || { title: k, qty: 0, revenue: 0 };
      itemAgg[k].qty += it.qty || 1;
      itemAgg[k].revenue += Number(it.price_usd || 0) * (it.qty || 1);
    });
    const topItems = Object.values(itemAgg).sort((a, b) => b.qty - a.qty).slice(0, 8);

    // status breakdown (all orders, not just range)
    const statusBreak: Record<string, { count: number; total: number }> = {};
    orders.forEach((o) => {
      statusBreak[o.status] = statusBreak[o.status] || { count: 0, total: 0 };
      statusBreak[o.status].count++;
      statusBreak[o.status].total += Number(o.total || 0);
    });

    return {
      revenueRange: sum(inRange),
      revenueAll: sum(paid),
      revenue7: sum(last7),
      ordersInRange: inRange.length,
      itemsInRange: itemCount,
      buckets,
      topItems,
      statusBreak,
      avg: paid.length ? sum(paid) / paid.length : 0,
    };
  }, [orders, items, dateFrom, dateTo]);

  function exportStats() {
    const lines = [
      'Section,Metric,Value',
      `Range,From,${dateFrom}`,
      `Range,To,${dateTo}`,
      `Revenue,All-time (paid),${stats.revenueAll.toFixed(2)}`,
      `Revenue,In range (paid),${stats.revenueRange.toFixed(2)}`,
      `Revenue,Last 7 days,${stats.revenue7.toFixed(2)}`,
      `Counts,Orders in range,${stats.ordersInRange}`,
      `Counts,Items sold in range,${stats.itemsInRange}`,
      `Counts,Products active,${counts.products}`,
      `Counts,Categories,${counts.categories}`,
      `Counts,Subscribers,${counts.subscribers}`,
      `Charity,Donated to charity,${donation.toFixed(2)}`,
      'Revenue · daily,,',
      'day,revenue,orders',
      ...stats.buckets.map((b) => `${b.day},${b.total.toFixed(2)},${b.orders}`),
      'Top items,,',
      'title,qty,revenue',
      ...stats.topItems.map((t) => `"${t.title.replace(/"/g, '""')}",${t.qty},${t.revenue.toFixed(2)}`),
      'Status breakdown,,',
      'status,orders,revenue',
      ...Object.entries(stats.statusBreak).map(([s, v]) => `${s},${v.count},${v.total.toFixed(2)}`),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `dashboard-${dateFrom}-to-${dateTo}.csv`;
    a.click();
  }

  function presetRange(days: number) {
    setDateTo(today); setDateFrom(dayKey(new Date(Date.now() - (days - 1) * 86400000)));
  }

  if (loading) return <div className="text-sm text-ink-700/60">Loading…</div>;

  const maxBucket = Math.max(1, ...stats.buckets.map((b) => b.total));
  const maxOrders = Math.max(1, ...stats.buckets.map((b) => b.orders));
  // Cumulative revenue across the range (for the running-total line chart)
  let run = 0;
  const cum = stats.buckets.map((b) => (run += b.total));
  const maxCum = Math.max(1, run);
  const n = stats.buckets.length;
  const cumPts = cum.map((v, i) => `${(i / Math.max(1, n - 1)) * 100},${100 - (v / maxCum) * 100}`).join(' ');
  const cumArea = `0,100 ${cumPts} 100,100`;

  return (
    <div className="space-y-5">
      <SystemHealth />
      {/* Date range picker */}
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <div className="text-xs text-ink-700/60 mb-1">From</div>
            <input type="date" value={dateFrom} max={dateTo} onChange={(e) => setDateFrom(e.target.value)} className={inputCls + ' w-40'} />
          </div>
          <div>
            <div className="text-xs text-ink-700/60 mb-1">To</div>
            <input type="date" value={dateTo} max={today} onChange={(e) => setDateTo(e.target.value)} className={inputCls + ' w-40'} />
          </div>
          <div className="flex gap-1">
            {[
              ['7d', 7], ['30d', 30], ['90d', 90], ['180d', 180],
            ].map(([label, n]) => (
              <button key={label} className={btnGhost} onClick={() => presetRange(n as number)}>{label}</button>
            ))}
          </div>
          <button className={btnPrimary + ' ml-auto'} onClick={exportStats}>Export CSV</button>
        </div>
      </Card>

      {/* Top stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox label="Revenue · in range" value={fmt0(stats.revenueRange)} sub={`${stats.ordersInRange} paid orders`} />
        <StatBox label="Revenue · all-time" value={fmt0(stats.revenueAll)} sub={`${(stats.statusBreak.paid?.count || 0)} paid total`} />
        <StatBox label="Revenue · last 7 days" value={fmt0(stats.revenue7)} />
        <StatBox label="Donated to charity" value={fmt0(donation)} sub="50% of every sale" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox label="Items sold · in range" value={stats.itemsInRange.toLocaleString()} sub="qty across all paid orders" />
        <StatBox label="Avg. order · all-time" value={stats.avg ? fmt(stats.avg) : '—'} />
        <StatBox label="Products" value={counts.products.toLocaleString()} sub="Active in catalog" />
        <StatBox label="Subscribers" value={counts.subscribers.toLocaleString()} sub="Free-pack list" />
      </div>

      {/* Etsy shop stats — refreshed by scripts/etsy_stats_sync.mjs (local, needs the Etsy token) */}
      {etsyStats && (
        <div>
          <div className="text-xs font-medium text-ink-700/60 mb-2">
            Etsy shop (live) {etsyStats.etsy_synced_at ? `· synced ${new Date(etsyStats.etsy_synced_at).toLocaleString()}` : '· never synced'}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <StatBox label="Etsy · files sold" value={Number(etsyStats.sales_count || 0).toLocaleString()} />
            <StatBox label="Etsy · rating" value={`${Number(etsyStats.rating || 0)} ★`} sub={`${Number(etsyStats.reviews_count || 0).toLocaleString()} reviews`} />
            <StatBox label="Etsy · favorites" value={Number(etsyStats.admirers_count || 0).toLocaleString()} />
            <StatBox label="Etsy · active listings" value={Number(etsyStats.products_count || 0).toLocaleString()} />
            <StatBox label="Refresh" value="↻" sub="run scripts/etsy_stats_sync.mjs" />
          </div>
        </div>
      )}

      {/* Referral program */}
      {refStats && refStats.codes > 0 && (
        <div>
          <div className="text-xs font-medium text-ink-700/60 mb-2">Referral program (give 15% / get 15%)</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatBox label="Share codes issued" value={refStats.codes.toLocaleString()} sub="one per customer" />
            <StatBox label="Friends referred" value={refStats.referred.toLocaleString()} sub="orders via a share link" />
            <StatBox label="Rewards paid" value={refStats.rewarded.toLocaleString()} sub="15% codes to referrers" />
            <StatBox label="Referral revenue" value={fmt0(refStats.revenue)} sub="from referred orders" />
          </div>
        </div>
      )}

      {/* Cults3D marketplace */}
      {cults?.ok && (
        <div>
          <div className="text-xs font-medium text-ink-700/60 mb-2">Cults3D marketplace</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatBox label="Cults3D · total sales" value={eur(cults.totalIncome, cults.currency)} sub={`${cults.salesCount} sale${cults.salesCount === 1 ? '' : 's'} · ${cults.listed} listed`} />
            <StatBox label="Cults3D · amount due" value={eur(cults.pendingPayout, cults.currency)} sub="not yet paid out" />
            <StatBox label="Cults3D · payout due (est.)" value={cults.nextPayoutEst || '—'} sub="Cults pays ~monthly (15th)" />
          </div>
        </div>
      )}

      {/* Revenue chart */}
      <Card title={`Revenue · ${dateFrom} → ${dateTo}`}>
        {stats.revenueRange === 0 ? (
          <p className="text-sm text-ink-700/60">No paid orders in this range. Pick a wider date range or check the Orders tab.</p>
        ) : (
          <>
            <div className="flex items-end gap-0.5 h-40 mb-2">
              {stats.buckets.map((b) => (
                <div key={b.day} className="flex-1 bg-bronze-600/80 rounded-t hover:bg-bronze-700 transition"
                  title={`${b.day}: ${fmt(b.total)} (${b.orders} orders)`}
                  style={{ height: b.total > 0 ? `${Math.max(4, (b.total / maxBucket) * 100)}%` : '0%' }} />
              ))}
            </div>
            <div className="flex justify-between text-[10px] text-ink-700/50">
              <span>{stats.buckets[0]?.day}</span>
              <span>{stats.buckets[stats.buckets.length - 1]?.day}</span>
            </div>
          </>
        )}
      </Card>

      {/* Orders per day + cumulative revenue */}
      <div className="grid lg:grid-cols-2 gap-5">
        <Card title={`Orders per day · ${stats.ordersInRange} in range`}>
          {stats.ordersInRange === 0 ? (
            <p className="text-sm text-ink-700/60">No orders in this range.</p>
          ) : (
            <>
              <div className="flex items-end gap-0.5 h-36 mb-2">
                {stats.buckets.map((b) => (
                  <div key={b.day} className="flex-1 bg-bronze-400 rounded-t hover:bg-bronze-600 transition"
                    title={`${b.day}: ${b.orders} order${b.orders === 1 ? '' : 's'}`}
                    style={{ height: b.orders > 0 ? `${Math.max(4, (b.orders / maxOrders) * 100)}%` : '0%' }} />
                ))}
              </div>
              <div className="flex justify-between text-[10px] text-ink-700/50"><span>{stats.buckets[0]?.day}</span><span>peak {maxOrders}/day</span><span>{stats.buckets[n - 1]?.day}</span></div>
            </>
          )}
        </Card>
        <Card title="Cumulative revenue · in range">
          {stats.revenueRange === 0 ? (
            <p className="text-sm text-ink-700/60">No revenue in this range.</p>
          ) : (
            <>
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-36">
                <polygon points={cumArea} fill="rgba(133,79,11,0.12)" />
                <polyline points={cumPts} fill="none" stroke="#854F0B" stroke-width="1.5" vector-effect="non-scaling-stroke" />
              </svg>
              <div className="flex justify-between text-[10px] text-ink-700/50"><span>{stats.buckets[0]?.day}</span><span>total {fmt0(maxCum)}</span><span>{stats.buckets[n - 1]?.day}</span></div>
            </>
          )}
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <Card title="Top selling items · in range">
          {stats.topItems.length === 0 ? (
            <p className="text-sm text-ink-700/60">No sales in this range.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-ink-700/60 text-left">
                <tr><th className="py-1.5">Item</th><th className="text-right">Qty</th><th className="text-right">Revenue</th></tr>
              </thead>
              <tbody>
                {stats.topItems.map((t) => (
                  <tr key={t.title} className="border-t border-black/5"><td className="py-1.5 pr-2">{t.title.slice(0, 60)}</td><td className="text-right">{t.qty}</td><td className="text-right">{fmt(t.revenue)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Status breakdown · all-time">
          <table className="w-full text-sm">
            <thead className="text-xs text-ink-700/60 text-left">
              <tr><th className="py-1.5">Status</th><th className="text-right">Orders</th><th className="text-right">Total</th></tr>
            </thead>
            <tbody>
              {Object.entries(stats.statusBreak).sort((a, b) => b[1].count - a[1].count).map(([s, v]) => (
                <tr key={s} className="border-t border-black/5">
                  <td className="py-1.5"><span className={`text-xs px-2 py-0.5 rounded ${({ paid: 'bg-green-100 text-green-800', pending: 'bg-yellow-100 text-yellow-800', refunded: 'bg-purple-100 text-purple-800', failed: 'bg-red-100 text-red-800', canceled: 'bg-gray-100 text-gray-700' } as any)[s] || 'bg-gray-100'}`}>{s}</span></td>
                  <td className="text-right">{v.count}</td>
                  <td className="text-right">{fmt(v.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <Card title="Recent orders">
        {recent.length === 0 ? (
          <p className="text-sm text-ink-700/60">No orders yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-ink-700/60 text-left">
              <tr><th className="py-1.5">When</th><th>Email</th><th>Items</th><th>Status</th><th className="text-right">Total</th></tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id} className="border-t border-black/5">
                  <td className="py-1.5">{new Date(r.created_at).toLocaleDateString()}</td>
                  <td>{r.email}</td>
                  <td>{(r.order_items || []).reduce((s: number, x: any) => s + (x.qty || 1), 0)}</td>
                  <td><span className={`text-xs px-2 py-0.5 rounded ${({ paid: 'bg-green-100 text-green-800', pending: 'bg-yellow-100 text-yellow-800', refunded: 'bg-purple-100 text-purple-800', failed: 'bg-red-100 text-red-800', canceled: 'bg-gray-100 text-gray-700' } as any)[r.status] || 'bg-gray-100'}`}>{r.status}</span></td>
                  <td className="text-right">{fmt(Number(r.total))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

// ── System health — the 10-second morning glance. ─────────────────────
// Six signals, each green / amber / red, computed live from the DB:
//   cron health · email quota (today's sends vs a soft daily cap) · bounce +
//   complaint rate (30d) · weekly digest pending queue · last order age ·
//   open carts awaiting reminder. Click any tile to jump to its detail tab.
function SystemHealth() {
  const [h, setH] = useState<any>(null);
  useEffect(() => {
    (async () => {
      const today = new Date().toISOString().slice(0, 10);
      const d30 = new Date(Date.now() - 30 * 86400000).toISOString();
      const [{ data: runs }, { count: sentToday }, { data: evs30 }, { data: wk }, { data: lastOrder }, { count: openCarts }, { data: cultsPoll }, { data: lastCults }] = await Promise.all([
        supabase.from('cron_runs').select('ran_at, ok, finished_at, error').order('ran_at', { ascending: false }).limit(1),
        supabase.from('email_send_log').select('id', { count: 'exact', head: true }).eq('status', 'sent').gte('sent_at', today + 'T00:00:00Z'),
        supabase.from('email_events').select('event').gte('created_at', d30).in('event', ['sent', 'delivered', 'bounced', 'complained']).limit(20000),
        supabase.from('weekly_digest_log').select('week_key, queued_count, drain_note').order('week_key', { ascending: false }).limit(1),
        supabase.from('orders').select('created_at, total, currency').eq('status', 'paid').order('created_at', { ascending: false }).limit(1),
        supabase.from('abandoned_carts').select('id', { count: 'exact', head: true }).is('recovered_at', null).is('reminded_at', null),
        supabase.from('poll_status').select('ran_at, ok, note, runner').eq('key', 'cults_sales').maybeSingle(),
        supabase.from('cults_sales').select('sold_at, income, currency, product_name').order('sold_at', { ascending: false }).limit(1),
      ]);
      // weekly pending count
      let pending = 0, sentWk = 0;
      if (wk?.[0]) {
        const [{ count: p }, { count: s }] = await Promise.all([
          supabase.from('weekly_send_queue').select('email', { count: 'exact', head: true }).eq('week_key', wk[0].week_key).eq('status', 'pending'),
          supabase.from('weekly_send_queue').select('email', { count: 'exact', head: true }).eq('week_key', wk[0].week_key).eq('status', 'sent'),
        ]);
        pending = p || 0; sentWk = s || 0;
      }
      const delivered = (evs30 || []).filter((e: any) => e.event === 'delivered' || e.event === 'sent').length;
      const bounced = (evs30 || []).filter((e: any) => e.event === 'bounced').length;
      const complained = (evs30 || []).filter((e: any) => e.event === 'complained').length;
      setH({ run: runs?.[0] || null, sentToday: sentToday || 0, delivered, bounced, complained, wk: wk?.[0] || null, pending, sentWk, lastOrder: lastOrder?.[0] || null, openCarts: openCarts || 0, cultsPoll: cultsPoll || null, lastCults: lastCults?.[0] || null });
    })();
  }, []);
  if (!h) return null;

  const DAILY_SOFT_CAP = Number((import.meta as any).env?.PUBLIC_RESEND_DAILY_CAP) || 300;   // Resend free tier ≈ 100/day; set PUBLIC_RESEND_DAILY_CAP to your plan
  const ageH = h.run ? (Date.now() - Date.parse(h.run.ran_at)) / 3600000 : Infinity;
  const cronState = !h.run ? 'red' : h.run.ok === null ? (ageH < 0.2 ? 'amber' : 'red') : h.run.ok === false ? 'red' : ageH > 26 ? 'red' : 'green';
  const cronText = !h.run ? 'never ran' : h.run.ok === null ? (ageH < 0.2 ? 'running…' : 'started, never finished') : h.run.ok === false ? 'FAILED' : `ok · ${ageH < 1 ? Math.round(ageH * 60) + 'm' : Math.round(ageH) + 'h'} ago`;
  const quotaPct = Math.round((h.sentToday / DAILY_SOFT_CAP) * 100);
  const quotaState = quotaPct >= 95 ? 'red' : quotaPct >= 75 ? 'amber' : 'green';
  const bounceRate = h.delivered ? ((h.bounced + h.complained) / h.delivered) * 100 : 0;
  const bounceState = bounceRate >= 5 ? 'red' : bounceRate >= 2 ? 'amber' : 'green';
  const wkState = !h.wk ? 'amber' : h.pending === 0 ? 'green' : 'amber';
  const lastAgeH = h.lastOrder ? (Date.now() - Date.parse(h.lastOrder.created_at)) / 3600000 : Infinity;
  const orderState = !h.lastOrder ? 'amber' : lastAgeH > 72 ? 'amber' : 'green';
  const cartsState = h.openCarts >= 20 ? 'amber' : 'green';
  // Cults3D poller: runs every 10 min (Netlify) + on every Cults-tab refresh.
  const cpAgeM = h.cultsPoll ? (Date.now() - Date.parse(h.cultsPoll.ran_at)) / 60000 : Infinity;
  const cultsState = !h.cultsPoll ? 'amber' : h.cultsPoll.ok === false ? 'red' : cpAgeM > 45 ? 'amber' : 'green';
  const cultsText = !h.cultsPoll ? 'not yet polled' : h.cultsPoll.ok === false ? 'poll FAILED' : `watching · ${cpAgeM < 1 ? 'just now' : cpAgeM < 90 ? Math.round(cpAgeM) + 'm ago' : Math.round(cpAgeM / 60) + 'h ago'}`;
  const lastCultsAgeH = h.lastCults ? (Date.now() - Date.parse(h.lastCults.sold_at)) / 3600000 : null;
  const cultsSub = h.cultsPoll?.ok === false ? (h.cultsPoll.note || 'error') : h.lastCults ? `last sale €${Number(h.lastCults.income).toFixed(2)} · ${lastCultsAgeH! < 1 ? 'just now' : lastCultsAgeH! < 48 ? Math.round(lastCultsAgeH!) + 'h ago' : Math.round(lastCultsAgeH! / 24) + 'd ago'}` : 'no Cults sales recorded yet';

  const dot: Record<string, string> = { green: 'bg-green-500', amber: 'bg-amber-500', red: 'bg-red-500 animate-pulse' };
  const bg: Record<string, string> = { green: 'bg-green-50 border-green-200', amber: 'bg-amber-50 border-amber-200', red: 'bg-red-50 border-red-300' };
  const Tile = ({ state, icon, label, value, sub, href }: { state: string; icon: string; label: string; value: string; sub?: string; href: string }) => (
    <a href={href} className={`block rounded-lg border px-3 py-2.5 hover:shadow transition ${bg[state]}`}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-ink-700/60 font-medium"><span className={`inline-block w-2 h-2 rounded-full ${dot[state]}`} />{icon} {label}</div>
      <div className="text-base font-bold text-ink-900 mt-0.5 leading-tight">{value}</div>
      {sub && <div className="text-[10px] text-ink-700/60 mt-0.5 truncate" title={sub}>{sub}</div>}
    </a>
  );
  const all = [cronState, quotaState, bounceState, wkState, orderState, cartsState, cultsState];
  const worst = all.includes('red') ? 'red' : all.includes('amber') ? 'amber' : 'green';

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className={`inline-block w-2.5 h-2.5 rounded-full ${dot[worst]}`} />
        <span className="text-sm font-bold text-ink-900">System health</span>
        <span className="text-[11px] text-ink-700/50">{worst === 'green' ? 'all systems normal' : worst === 'amber' ? 'something needs a look' : 'ATTENTION NEEDED'} · tap a tile for detail</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
        <Tile state={cronState} icon="⏱" label="Nightly automation" value={cronText} sub={h.run?.error || (h.run ? new Date(h.run.ran_at).toLocaleString() : 'scheduler has never reported in')} href="#automations" />
        <Tile state={quotaState} icon="📧" label="Email quota today" value={`${h.sentToday} / ${DAILY_SOFT_CAP}`} sub={`${quotaPct}% of soft daily cap`} href="#automations" />
        <Tile state={bounceState} icon="📉" label="Bounce + spam (30d)" value={`${bounceRate.toFixed(1)}%`} sub={`${h.bounced} bounced · ${h.complained} complaints · ${h.delivered} delivered`} href="#automations" />
        <Tile state={wkState} icon="📅" label="Weekly digest" value={h.wk ? `${h.sentWk}/${h.wk.queued_count || h.sentWk + h.pending}` : '—'} sub={h.wk ? (h.pending ? `${h.pending} pending · auto-retry nightly` : `${h.wk.week_key} complete`) : 'none yet'} href="#automations" />
        <Tile state={orderState} icon="🧾" label="Last order" value={h.lastOrder ? `$${Number(h.lastOrder.total).toFixed(2)}` : 'none'} sub={h.lastOrder ? (lastAgeH < 1 ? 'just now' : lastAgeH < 48 ? `${Math.round(lastAgeH)}h ago` : `${Math.round(lastAgeH / 24)}d ago`) : ''} href="#orders" />
        <Tile state={cartsState} icon="🛒" label="Open carts" value={String(h.openCarts)} sub="awaiting reminder" href="#insights" />
        <Tile state={cultsState} icon="◈" label="Cults3D sale alerts" value={cultsText} sub={cultsSub} href="#cults" />
      </div>
    </div>
  );
}
