import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { Card, StatBox, btnGhost, btnPrimary, inputCls } from '../ui';

type Order = { id: string; email: string; total: number; status: string; created_at: string };
type Item = { title: string; price_usd: number; qty: number; order_id: string };

const fmt = (n: number) => '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = (n: number) => '$' + Math.round(n).toLocaleString();
const dayKey = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

export default function Overview() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [recent, setRecent] = useState<any[]>([]);
  const [counts, setCounts] = useState({ products: 0, categories: 0, subscribers: 0 });
  const [donation, setDonation] = useState(0);
  const [loading, setLoading] = useState(true);
  // default range: last 30 days
  const today = dayKey(new Date());
  const [dateFrom, setDateFrom] = useState(dayKey(new Date(Date.now() - 29 * 86400000)));
  const [dateTo, setDateTo] = useState(today);

  useEffect(() => { load(); }, []);
  async function load() {
    setLoading(true);
    const [allOrdersRes, allItemsRes, recentRes, products, categories, subs, settings] = await Promise.all([
      supabase.from('orders').select('id,email,total,status,created_at').is('deleted_at', null).order('created_at', { ascending: false }).limit(5000),
      supabase.from('order_items').select('title,price_usd,qty,order_id').limit(20000),
      supabase.from('orders').select('id,email,total,status,created_at,order_items(qty)').is('deleted_at', null).order('created_at', { ascending: false }).limit(10),
      supabase.from('products').select('id', { count: 'exact', head: true }).eq('active', true),
      supabase.from('categories').select('id', { count: 'exact', head: true }),
      supabase.from('subscribers').select('id', { count: 'exact', head: true }),
      supabase.from('site_settings').select('donation_total').eq('id', 1).maybeSingle(),
    ]);
    setOrders((allOrdersRes.data ?? []) as any);
    setItems((allItemsRes.data ?? []) as any);
    setRecent(recentRes.data ?? []);
    setCounts({ products: products.count ?? 0, categories: categories.count ?? 0, subscribers: subs.count ?? 0 });
    setDonation(Number(settings.data?.donation_total || 0));
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

  return (
    <div className="space-y-5">
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

      {/* Revenue chart */}
      <Card title={`Revenue · ${dateFrom} → ${dateTo}`}>
        {stats.revenueRange === 0 ? (
          <p className="text-sm text-ink-700/60">No paid orders in this range. Pick a wider date range or check the Orders tab.</p>
        ) : (
          <>
            <div className="flex items-end gap-0.5 h-40 mb-2">
              {stats.buckets.map((b) => (
                <div key={b.day} className="flex-1 flex flex-col items-stretch group relative" title={`${b.day}: ${fmt(b.total)} (${b.orders} orders)`}>
                  <div className="flex-1 flex items-end">
                    <div className="w-full bg-bronze-600/80 rounded-t hover:bg-bronze-700 transition" style={{ height: `${(b.total / maxBucket) * 100}%`, minHeight: b.total > 0 ? 2 : 0 }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-between text-[10px] text-ink-700/50">
              <span>{stats.buckets[0]?.day}</span>
              <span>{stats.buckets[stats.buckets.length - 1]?.day}</span>
            </div>
          </>
        )}
      </Card>

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
