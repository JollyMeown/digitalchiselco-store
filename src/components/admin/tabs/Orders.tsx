import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { Card, Modal, btnGhost, btnDanger, btnPrimary, inputCls } from '../ui';

export default function Orders() {
  const [rows, setRows] = useState<any[]>([]);
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showDeleted, setShowDeleted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<any | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => { load(); }, [status, dateFrom, dateTo, showDeleted]);
  async function load() {
    setLoading(true);
    let q = supabase.from('orders').select('id,email,total,status,currency,provider,provider_order_id,created_at,deleted_at,admin_note,order_items(id,title,price_usd,qty,order_item_customizations(fields))').order('created_at', { ascending: false }).limit(500);
    if (status !== 'all') q = q.eq('status', status);
    if (dateFrom) q = q.gte('created_at', new Date(dateFrom).toISOString());
    if (dateTo) {
      const end = new Date(dateTo); end.setHours(23, 59, 59, 999);
      q = q.lte('created_at', end.toISOString());
    }
    if (!showDeleted) q = q.is('deleted_at', null);
    const { data } = await q;
    setRows(data ?? []); setLoading(false);
  }
  async function setStatusFor(id: string, s: string) {
    await supabase.from('orders').update({ status: s }).eq('id', id);
    setRows((r) => r.map((x) => x.id === id ? { ...x, status: s } : x));
    if (open?.id === id) setOpen({ ...open, status: s });
  }
  async function saveNote(id: string, note: string) {
    await supabase.from('orders').update({ admin_note: note }).eq('id', id);
    if (open?.id === id) setOpen({ ...open, admin_note: note });
  }
  async function softDelete(id: string) {
    if (!confirm('Hide this order from the list? It will be marked deleted but kept in the database for audit.')) return;
    await supabase.from('orders').update({ deleted_at: new Date().toISOString() }).eq('id', id);
    setOpen(null); load();
  }
  async function restore(id: string) {
    await supabase.from('orders').update({ deleted_at: null }).eq('id', id);
    setOpen(null); load();
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter((r) => r.email?.toLowerCase().includes(q) || r.id.includes(q) || r.provider_order_id?.toLowerCase().includes(q));
  }, [rows, search]);

  const totals = useMemo(() => {
    const paid = filtered.filter((r) => r.status === 'paid');
    return {
      count: filtered.length,
      paid: paid.length,
      revenue: paid.reduce((s, r) => s + Number(r.total || 0), 0),
    };
  }, [filtered]);

  function exportCsv() {
    const head = 'created_at,order_id,email,status,provider,provider_order_id,items,total_usd,admin_note\n';
    const lines = filtered.map((r) => [
      r.created_at, r.id, r.email, r.status, r.provider || '', r.provider_order_id || '',
      (r.order_items || []).map((it: any) => `${it.qty}x ${it.title}`).join(' | '),
      Number(r.total || 0).toFixed(2), r.admin_note || '',
    ].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
    const blob = new Blob([head + lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  const badge = (s: string) => ({
    paid: 'bg-green-100 text-green-800', pending: 'bg-yellow-100 text-yellow-800',
    refunded: 'bg-purple-100 text-purple-800', failed: 'bg-red-100 text-red-800', canceled: 'bg-gray-100 text-gray-700',
  } as Record<string, string>)[s] || 'bg-gray-100 text-gray-700';

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <div className="text-xs text-ink-700/60 mb-1">Status</div>
            <div className="flex flex-wrap gap-1">
              {['all', 'paid', 'pending', 'refunded', 'failed', 'canceled'].map((s) => (
                <button key={s} onClick={() => setStatus(s)}
                  className={`px-2.5 py-1 text-xs rounded-md border ${status === s ? 'bg-bronze-600 text-cream border-bronze-600' : 'border-black/15 hover:bg-cream'}`}>
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs text-ink-700/60 mb-1">From</div>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={inputCls + ' w-36'} />
          </div>
          <div>
            <div className="text-xs text-ink-700/60 mb-1">To</div>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={inputCls + ' w-36'} />
          </div>
          <div className="flex-1 min-w-[180px]">
            <div className="text-xs text-ink-700/60 mb-1">Search</div>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="email, order id, Paddle id…" className={inputCls} />
          </div>
          <label className="flex items-center gap-1.5 text-xs text-ink-700/70 pb-2"><input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} /> include hidden</label>
          <button className={btnGhost} onClick={() => { setStatus('all'); setSearch(''); setDateFrom(''); setDateTo(''); setShowDeleted(false); }}>Reset</button>
        </div>
        <div className="mt-3 pt-3 border-t border-black/5 flex flex-wrap items-center gap-4 text-xs text-ink-700/70">
          <span><strong className="text-ink-800">{totals.count}</strong> shown</span>
          <span><strong className="text-green-700">{totals.paid}</strong> paid · revenue <strong className="text-ink-800">${totals.revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></span>
          <button className={btnGhost + ' ml-auto'} onClick={() => setShowHelp(true)}>How do refund / cancel work?</button>
          <button className={btnPrimary} onClick={exportCsv}>Export CSV</button>
        </div>
      </Card>

      {loading ? <div className="text-sm text-ink-700/60">Loading…</div> : filtered.length === 0 ? (
        <Card><p className="text-sm text-ink-700/60">No orders match the current filters.</p></Card>
      ) : (
        <div className="bg-white border border-black/10 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-xs text-ink-700/60 text-left bg-cream/40">
              <tr><th className="p-2">When</th><th className="p-2">Order</th><th className="p-2">Email</th><th className="p-2">Items</th><th className="p-2">Status</th><th className="p-2 text-right">Total</th><th className="p-2"></th></tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className={`border-t border-black/5 hover:bg-cream/30 ${r.deleted_at ? 'opacity-50' : ''}`}>
                  <td className="p-2 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="p-2 font-mono text-xs">{r.id.slice(0, 8)}{r.deleted_at && <span className="ml-1 text-red-600">(hidden)</span>}</td>
                  <td className="p-2">{r.email}</td>
                  <td className="p-2">{(r.order_items || []).length}</td>
                  <td className="p-2"><span className={`text-xs px-2 py-0.5 rounded ${badge(r.status)}`}>{r.status}</span></td>
                  <td className="p-2 text-right">${Number(r.total).toFixed(2)}</td>
                  <td className="p-2 text-right whitespace-nowrap">
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
                  {(open.order_items || []).map((it: any) => {
                    const custom = (it.order_item_customizations || []).flatMap((c: any) => Array.isArray(c.fields) ? c.fields : []);
                    return (
                      <>
                        <tr key={it.id} className="border-t border-black/5"><td className="p-2">{it.title}{custom.length > 0 && <span className="ml-2 inline-block bg-bronze-100 text-bronze-700 text-[10px] font-medium px-1.5 py-0.5 rounded">✎ customized</span>}</td><td className="p-2 text-right">{it.qty}</td><td className="p-2 text-right">${Number(it.price_usd).toFixed(2)}</td></tr>
                        {custom.length > 0 && (
                          <tr><td colSpan={3} className="p-0">
                            <div className="bg-bronze-50/50 border-t border-bronze-600/20 px-3 py-2 text-xs">
                              <div className="font-medium text-bronze-700 mb-1 text-[11px] tracking-wider uppercase">✎ Customer's customization</div>
                              <dl className="space-y-1">
                                {custom.map((f: any, i: number) => (
                                  <div key={i} className="grid grid-cols-[140px_1fr] gap-2">
                                    <dt className="text-ink-700/60">{f.label || f.key}</dt>
                                    <dd className="text-ink-800 break-words">
                                      {f.type === 'file_url' && f.value
                                        ? <a href={f.value} target="_blank" className="text-bronze-600 underline break-all">{f.value}</a>
                                        : <span className="whitespace-pre-wrap">{f.value || <em className="text-ink-700/40">(empty)</em>}</span>}
                                    </dd>
                                  </div>
                                ))}
                              </dl>
                            </div>
                          </td></tr>
                        )}
                      </>
                    );
                  })}
                  <tr className="border-t border-black/10 font-medium"><td className="p-2" colSpan={2}>Total</td><td className="p-2 text-right">${Number(open.total).toFixed(2)}</td></tr>
                </tbody>
              </table>
            </div>
            <div>
              <div className="text-xs text-ink-700/60 mb-1">Admin note <span className="text-ink-700/40">(internal)</span></div>
              <textarea defaultValue={open.admin_note || ''} onBlur={(e) => saveNote(open.id, e.target.value)} rows={2} placeholder="e.g. Refunded via Paddle on 27 Jun: customer changed mind" className={inputCls} />
              <p className="text-xs text-ink-700/40 mt-1">Saved automatically when you click outside this box.</p>
            </div>
            <div className="flex flex-wrap gap-2 pt-2 border-t border-black/10 items-center">
              <span className="text-xs text-ink-700/60 self-center mr-2">Mark as:</span>
              {['paid', 'pending', 'refunded', 'failed', 'canceled'].map((s) => (
                <button key={s} className={btnGhost} onClick={() => setStatusFor(open.id, s)}>{s}</button>
              ))}
              <a href={`/admin/invoice/${open.id}`} target="_blank" className={btnGhost}>Invoice ↗</a>
              <div className="ml-auto flex gap-2">
                {open.deleted_at
                  ? <button className={btnPrimary} onClick={() => restore(open.id)}>Restore</button>
                  : <button className={btnDanger} onClick={() => softDelete(open.id)}>Hide order</button>}
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={showHelp} onClose={() => setShowHelp(false)} title="How refund / cancel work">
        <div className="space-y-3 text-sm leading-relaxed text-ink-700">
          <p><strong>The status flags in this admin are <em>display</em>-only. They don't actually move money.</strong> Here's the real flow for each:</p>
          <div>
            <p className="font-medium text-ink-800">Refund</p>
            <ol className="list-decimal ml-5 space-y-1 mt-1">
              <li>Open the order in your <a href="https://vendors.paddle.com" target="_blank" className="text-bronze-600 underline">Paddle dashboard</a> and click <em>Refund</em>. Paddle returns the money to the customer's card.</li>
              <li>Paddle then POSTs <code className="bg-cream px-1">transaction.payment.refunded</code> to our webhook (`/api/paddle/webhook`), which automatically sets this order's status to <code className="bg-cream px-1">refunded</code>.</li>
              <li>If a refund happens by phone / Stripe / outside Paddle, mark the status as <em>refunded</em> manually here so your records match.</li>
            </ol>
          </div>
          <div>
            <p className="font-medium text-ink-800">Cancel</p>
            <ol className="list-decimal ml-5 space-y-1 mt-1">
              <li>Digital orders can't be "canceled" once paid — they're already delivered. Use <em>refunded</em> instead.</li>
              <li><em>Pending</em> orders (cart abandoned, Paddle session expired) can be marked <em>canceled</em> here to stop them showing in revenue stats.</li>
              <li>Subscription cancellations happen in the Paddle Customer Portal; the webhook flips the order to <code className="bg-cream px-1">canceled</code>.</li>
            </ol>
          </div>
          <div>
            <p className="font-medium text-ink-800">Hide order</p>
            <p>Soft-delete — the order is hidden from this list but kept in the database for tax and audit. Tick "include hidden" above to bring them back into view, then click <em>Restore</em>.</p>
          </div>
        </div>
      </Modal>
    </div>
  );
}
