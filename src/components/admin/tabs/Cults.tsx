import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { Card, btnGhost, btnPrimary } from '../ui';

type Sale = {
  id: string;
  createdAt: string;
  payedOutAt: string | null;
  income?: { value: number; currency: string; formatted: string };
  totalTaxed?: { value: number; formatted: string };
  commission?: { value: number; formatted: string };
  orderCountry?: { name: string; code: string } | null;
  creation?: { name: string; slug: string; url: string } | null;
};
type Data = {
  ok?: boolean;
  error?: string;
  currency?: string;
  totalIncome?: number;
  pendingPayout?: number;
  salesCount?: number;
  listed?: number;
  sales?: Sale[];
};

const money = (v?: number, c = 'EUR') =>
  v == null ? '—' : new Intl.NumberFormat('en-IE', { style: 'currency', currency: c }).format(v);

export default function Cults() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string>('');

  async function load() {
    setLoading(true); setErr('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch('/api/admin/cults-sales', { headers: { authorization: `Bearer ${token}` } });
      const j: Data = await res.json();
      if (!res.ok || j.error) { setErr(j.error || `Request failed (${res.status})`); setData(j); }
      else setData(j);
    } catch (e: any) { setErr(String(e?.message || e)); }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  function exportCsv() {
    const rows = data?.sales || [];
    const head = ['date', 'product', 'slug', 'country', 'income', 'currency', 'commission', 'paid_out_at', 'cults_url'];
    const esc = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const lines = [head.join(',')].concat(rows.map((s) => [
      s.createdAt, s.creation?.name, s.creation?.slug, s.orderCountry?.name,
      s.income?.value, s.income?.currency, s.commission?.value, s.payedOutAt || '', s.creation?.url,
    ].map(esc).join(',')));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'cults3d-sales.csv'; a.click();
  }

  const cur = data?.currency || 'EUR';
  const sales = data?.sales || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-ink-700/70">Live sales pulled from your Cults3D account.</p>
        <div className="flex gap-2">
          <button className={btnGhost} onClick={load} disabled={loading}>{loading ? 'Loading…' : '↻ Refresh'}</button>
          {sales.length > 0 && <button className={btnPrimary} onClick={exportCsv}>Export CSV</button>}
        </div>
      </div>

      {err && (
        <Card>
          <p className="text-sm text-red-700 font-medium">Couldn’t load Cults3D data</p>
          <p className="text-xs text-ink-700/70 mt-1">{err}</p>
          {err.includes('not configured') && (
            <p className="text-xs text-ink-700/70 mt-2">
              Add <code>CULTS3D_USERNAME</code> and <code>CULTS3D_API_KEY</code> to the Netlify environment variables, then redeploy.
            </p>
          )}
        </Card>
      )}

      {data?.ok && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Products listed" value={String(data.listed ?? 0)} sub="on Cults3D" />
            <Stat label="Total sales" value={String(data.salesCount ?? 0)} sub="all-time" />
            <Stat label="Total income" value={money(data.totalIncome, cur)} sub="after commission" />
            <Stat label="Pending payout" value={money(data.pendingPayout, cur)} sub="not yet paid out" />
          </div>

          {sales.length === 0 ? (
            <Card><p className="text-sm text-ink-700/70">No sales yet. Listings are live and being added daily — sales will appear here as they happen.</p></Card>
          ) : (
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-ink-700/60 border-b border-ink-700/10">
                      <th className="py-2 pr-3 font-medium">Date</th>
                      <th className="py-2 pr-3 font-medium">Product</th>
                      <th className="py-2 pr-3 font-medium">Country</th>
                      <th className="py-2 pr-3 font-medium text-right">Income</th>
                      <th className="py-2 pr-3 font-medium">Payout</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sales.map((s) => (
                      <tr key={s.id} className="border-b border-ink-700/5">
                        <td className="py-2 pr-3 whitespace-nowrap text-ink-700/80">{String(s.createdAt).slice(0, 10)}</td>
                        <td className="py-2 pr-3">
                          {s.creation?.url
                            ? <a href={s.creation.url} target="_blank" rel="noreferrer" className="text-bronze-600 hover:underline">{s.creation?.name || s.creation?.slug}</a>
                            : (s.creation?.name || '—')}
                        </td>
                        <td className="py-2 pr-3 text-ink-700/70">{s.orderCountry?.name || '—'}</td>
                        <td className="py-2 pr-3 text-right font-medium">{s.income?.formatted || money(s.income?.value, cur)}</td>
                        <td className="py-2 pr-3">{s.payedOutAt ? <span className="text-green-700">Paid</span> : <span className="text-ink-700/50">Pending</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <p className="text-xs text-ink-700/60">{label}</p>
      <p className="text-2xl font-serif text-ink-800 mt-1">{value}</p>
      {sub && <p className="text-[11px] text-ink-700/50 mt-0.5">{sub}</p>}
    </Card>
  );
}
