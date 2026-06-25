import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { StatBox, Card } from '../ui';

export default function Overview() {
  const [stats, setStats] = useState<any>(null);
  const [recent, setRecent] = useState<any[]>([]);
  const [byDay, setByDay] = useState<{ day: string; total: number }[]>([]);

  useEffect(() => { load(); }, []);
  async function load() {
    const [products, categories, subs, paid, recentOrders, settings] = await Promise.all([
      supabase.from('products').select('id', { count: 'exact', head: true }).eq('active', true),
      supabase.from('categories').select('id', { count: 'exact', head: true }),
      supabase.from('subscribers').select('id', { count: 'exact', head: true }),
      supabase.from('orders').select('total,created_at,status').eq('status', 'paid'),
      supabase.from('orders').select('id,email,total,status,created_at,order_items(qty)').order('created_at', { ascending: false }).limit(8),
      supabase.from('site_settings').select('*').eq('id', 1).maybeSingle(),
    ]);
    const allPaid = paid.data ?? [];
    const now = Date.now();
    const d7 = now - 7 * 86400000;
    const d30 = now - 30 * 86400000;
    const sum = (rows: any[]) => rows.reduce((s, r) => s + Number(r.total || 0), 0);
    const last7 = allPaid.filter((r) => +new Date(r.created_at) >= d7);
    const last30 = allPaid.filter((r) => +new Date(r.created_at) >= d30);
    // group last 30 days by day
    const buckets: Record<string, number> = {};
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now - i * 86400000);
      const k = d.toISOString().slice(0, 10);
      buckets[k] = 0;
    }
    last30.forEach((r) => {
      const k = new Date(r.created_at).toISOString().slice(0, 10);
      if (k in buckets) buckets[k] += Number(r.total || 0);
    });
    setByDay(Object.entries(buckets).map(([day, total]) => ({ day, total })));
    setStats({
      revenueAll: sum(allPaid),
      revenue30: sum(last30),
      revenue7: sum(last7),
      orders: allPaid.length,
      products: products.count ?? 0,
      categories: categories.count ?? 0,
      subscribers: subs.count ?? 0,
      donation: Number(settings.data?.donation_total || 0),
    });
    setRecent(recentOrders.data ?? []);
  }

  if (!stats) return <div className="text-sm text-ink-700/60">Loading…</div>;

  const max = Math.max(1, ...byDay.map((d) => d.total));
  const fmt = (n: number) => '$' + n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox label="Revenue · all-time" value={fmt(stats.revenueAll)} sub={`${stats.orders} paid orders`} />
        <StatBox label="Revenue · last 30d" value={fmt(stats.revenue30)} />
        <StatBox label="Revenue · last 7d" value={fmt(stats.revenue7)} />
        <StatBox label="Donated to charity" value={fmt(stats.donation)} sub="50% of every sale" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox label="Products" value={stats.products.toLocaleString()} sub="Active in catalog" />
        <StatBox label="Categories" value={stats.categories} />
        <StatBox label="Subscribers" value={stats.subscribers.toLocaleString()} sub="Free-pack list" />
        <StatBox label="Avg. order" value={stats.orders ? fmt(stats.revenueAll / stats.orders) : '—'} />
      </div>

      <Card title="Revenue · last 30 days">
        {stats.revenue30 === 0 ? (
          <p className="text-sm text-ink-700/60">No sales yet. Once Paddle checkout goes live, this chart fills in automatically.</p>
        ) : (
          <div className="flex items-end gap-1 h-32">
            {byDay.map((d) => (
              <div key={d.day} className="flex-1 flex flex-col items-center" title={`${d.day}: ${fmt(d.total)}`}>
                <div className="w-full bg-bronze-600/80 rounded-t" style={{ height: `${(d.total / max) * 100}%` }} />
              </div>
            ))}
          </div>
        )}
      </Card>

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
                  <td><span className={`text-xs px-2 py-0.5 rounded ${r.status === 'paid' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>{r.status}</span></td>
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
