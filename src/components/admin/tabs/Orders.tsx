import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { Card, Modal, btnGhost, btnPrimary, inputCls } from '../ui';

export default function Orders() {
  const [rows, setRows] = useState<any[]>([]);
  const [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<any | null>(null);

  useEffect(() => { load(); }, [status]);
  async function load() {
    setLoading(true);
    let q = supabase.from('orders').select('id,email,total,status,currency,provider,provider_order_id,created_at,order_items(id,title,price_usd,qty)').order('created_at', { ascending: false }).limit(200);
    if (status !== 'all') q = q.eq('status', status);
    const { data } = await q;
    setRows(data ?? []); setLoading(false);
  }
  async function setStatusFor(id: string, s: string) {
    await supabase.from('orders').update({ status: s }).eq('id', id);
    setRows((r) => r.map((x) => x.id === id ? { ...x, status: s } : x));
    if (open?.id === id) setOpen({ ...open, status: s });
  }

  const badge = (s: string) => ({
    paid: 'bg-green-100 text-green-800', pending: 'bg-yellow-100 text-yellow-800',
    refunded: 'bg-purple-100 text-purple-800', failed: 'bg-red-100 text-red-800', canceled: 'bg-gray-100 text-gray-700',
  } as Record<string, string>)[s] || 'bg-gray-100 text-gray-700';

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-700/60">Filter:</span>
          {['all', 'paid', 'pending', 'refunded', 'failed', 'canceled'].map((s) => (
            <button key={s} onClick={() => setStatus(s)}
              className={`px-2.5 py-1 text-xs rounded-md border ${status === s ? 'bg-bronze-600 text-cream border-bronze-600' : 'border-black/15 hover:bg-cream'}`}>
              {s}
            </button>
          ))}
          <span className="text-xs text-ink-700/60 ml-auto">{rows.length} shown</span>
        </div>
      </Card>

      {loading ? <div className="text-sm text-ink-700/60">Loading…</div> : rows.length === 0 ? (
        <Card><p className="text-sm text-ink-700/60">No orders yet. They'll appear here once Paddle checkout is live.</p></Card>
      ) : (
        <div className="bg-white border border-black/10 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-xs text-ink-700/60 text-left bg-cream/40">
              <tr><th className="p-2">When</th><th className="p-2">Order</th><th className="p-2">Email</th><th className="p-2">Items</th><th className="p-2">Status</th><th className="p-2 text-right">Total</th><th className="p-2"></th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-black/5 hover:bg-cream/30">
                  <td className="p-2">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="p-2 font-mono text-xs">{r.id.slice(0, 8)}</td>
                  <td className="p-2">{r.email}</td>
                  <td className="p-2">{(r.order_items || []).length}</td>
                  <td className="p-2"><span className={`text-xs px-2 py-0.5 rounded ${badge(r.status)}`}>{r.status}</span></td>
                  <td className="p-2 text-right">${Number(r.total).toFixed(2)}</td>
                  <td className="p-2 text-right">
                    <button className={btnGhost} onClick={() => setOpen(r)}>View</button>
                    <a className={btnGhost + ' ml-1'} href={`/admin/invoice/${r.id}`} target="_blank">Invoice</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? `Order ${open.id.slice(0, 8)}` : ''} wide>
        {open && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-ink-700/60 text-xs">Customer</span><div>{open.email}</div></div>
              <div><span className="text-ink-700/60 text-xs">Date</span><div>{new Date(open.created_at).toLocaleString()}</div></div>
              <div><span className="text-ink-700/60 text-xs">Provider</span><div>{open.provider || '—'} {open.provider_order_id ? `· ${open.provider_order_id}` : ''}</div></div>
              <div><span className="text-ink-700/60 text-xs">Status</span><div><span className={`text-xs px-2 py-0.5 rounded ${badge(open.status)}`}>{open.status}</span></div></div>
            </div>
            <div className="border border-black/10 rounded">
              <table className="w-full text-sm">
                <thead className="text-xs text-ink-700/60 bg-cream/40 text-left">
                  <tr><th className="p-2">Item</th><th className="p-2 text-right w-16">Qty</th><th className="p-2 text-right w-24">Price</th></tr>
                </thead>
                <tbody>
                  {(open.order_items || []).map((it: any) => (
                    <tr key={it.id} className="border-t border-black/5"><td className="p-2">{it.title}</td><td className="p-2 text-right">{it.qty}</td><td className="p-2 text-right">${Number(it.price_usd).toFixed(2)}</td></tr>
                  ))}
                  <tr className="border-t border-black/10 font-medium"><td className="p-2" colSpan={2}>Total</td><td className="p-2 text-right">${Number(open.total).toFixed(2)}</td></tr>
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-2 pt-2 border-t border-black/10">
              <span className="text-xs text-ink-700/60 self-center mr-2">Mark as:</span>
              {['paid', 'pending', 'refunded', 'failed', 'canceled'].map((s) => (
                <button key={s} className={btnGhost} onClick={() => setStatusFor(open.id, s)}>{s}</button>
              ))}
              <a href={`/admin/invoice/${open.id}`} target="_blank" className={btnPrimary + ' ml-auto'}>Open invoice ↗</a>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
