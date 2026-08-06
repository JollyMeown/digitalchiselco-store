import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { Card, btnGhost, btnPrimary, btnDanger, inputCls, labelCls } from '../ui';

const STATUSES = ['open', 'planned', 'in_progress', 'done', 'declined'];
const STATUS_LABEL: Record<string, string> = { open: 'Idea', planned: 'Planned', in_progress: 'In progress', done: '✓ Made', declined: 'Declined' };

export default function DesignBoard() {
  const [rows, setRows] = useState<any[]>([]);
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState<Record<string, any>>({});

  useEffect(() => { load(); }, []);
  async function load() {
    const { data } = await supabase.from('design_requests').select('*').order('votes', { ascending: false }).order('created_at', { ascending: false });
    setRows(data ?? []);
  }
  async function save(r: any) {
    const patch = editing[r.id] || {};
    await supabase.from('design_requests').update({
      status: patch.status ?? r.status,
      admin_response: patch.admin_response ?? r.admin_response,
      product_slug: patch.product_slug ?? r.product_slug,
    }).eq('id', r.id);
    setEditing((e) => { const n = { ...e }; delete n[r.id]; return n; });
    load();
  }
  async function remove(id: string) {
    if (!confirm('Delete this idea?')) return;
    await supabase.from('design_requests').delete().eq('id', id);
    load();
  }
  function setField(id: string, field: string, value: any) {
    setEditing((e) => ({ ...e, [id]: { ...(e[id] || {}), [field]: value } }));
  }
  const shown = filter === 'all' ? rows : rows.filter((r) => r.status === filter);

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="text-sm text-ink-700/60">{rows.length} ideas · ranked by votes. Public board at <a href="/requests" target="_blank" className="text-bronze-700 underline">/requests</a>.</span>
          <select value={filter} onChange={(e) => setFilter(e.target.value)} className={inputCls + ' max-w-[180px]'}>
            <option value="all">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </div>
      </Card>
      <div className="space-y-3">
        {shown.map((r) => {
          const p = editing[r.id] || {};
          return (
            <div key={r.id} className="border border-black/10 rounded-lg bg-white p-4">
              <div className="flex gap-4">
                <div className="flex flex-col items-center justify-center w-12 flex-shrink-0">
                  <span className="text-bronze-600">▲</span>
                  <span className="font-medium">{r.votes}</span>
                </div>
                {r.image_url && <img src={r.image_url} alt="" className="w-16 h-16 rounded object-cover flex-shrink-0" />}
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-ink-800">{r.title}</div>
                  {r.description && <p className="text-sm text-ink-700/80 mt-1">{r.description}</p>}
                  <div className="text-xs text-ink-700/50 mt-1">{r.name || 'anonymous'}{r.email ? ` · ${r.email}` : ''} · {new Date(r.created_at).toLocaleDateString()}</div>
                  <div className="grid sm:grid-cols-3 gap-2 mt-3">
                    <div>
                      <label className={labelCls}>Status</label>
                      <select value={p.status ?? r.status} onChange={(e) => setField(r.id, 'status', e.target.value)} className={inputCls}>
                        {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                      </select>
                    </div>
                    <div className="sm:col-span-2">
                      <label className={labelCls}>Public reply (optional)</label>
                      <input value={p.admin_response ?? r.admin_response ?? ''} onChange={(e) => setField(r.id, 'admin_response', e.target.value)} className={inputCls} placeholder="e.g. Great idea — added to the queue!" />
                    </div>
                    <div className="sm:col-span-3">
                      <label className={labelCls}>Linked product slug (when made)</label>
                      <input value={p.product_slug ?? r.product_slug ?? ''} onChange={(e) => setField(r.id, 'product_slug', e.target.value)} className={inputCls} placeholder="bald-eagle-relief-…" />
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button className={btnPrimary} onClick={() => save(r)}>Save</button>
                    <button className={btnDanger} onClick={() => remove(r.id)}>Delete</button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {shown.length === 0 && <Card><p className="text-sm text-ink-700/60">No ideas in this view yet.</p></Card>}
      </div>
    </div>
  );
}
