import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { Card, Modal, btnGhost, btnPrimary, btnDanger, inputCls, labelCls } from '../ui';

export default function Membership() {
  const [plans, setPlans] = useState<any[]>([]);
  const [leads, setLeads] = useState<any[]>([]);
  const [editing, setEditing] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => { load(); }, []);
  async function load() {
    const [{ data: p }, { data: l }] = await Promise.all([
      supabase.from('membership_plans').select('*').order('sort_order'),
      supabase.from('membership_leads').select('*').order('created_at', { ascending: false }).limit(200),
    ]);
    setPlans(p ?? []); setLeads(l ?? []);
  }
  async function remove(id: string) {
    if (!confirm('Delete this plan?')) return;
    await supabase.from('membership_plans').delete().eq('id', id);
    load();
  }
  function exportLeads() {
    const head = 'name,email,plan_slug,source,created_at\n';
    const body = leads.map((r) => `${(r.name || '').replace(/,/g, ' ')},${r.email},${r.plan_slug || ''},${r.source || ''},${r.created_at}`).join('\n');
    const blob = new Blob([head + body], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `membership-leads-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  }

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex justify-between items-center">
          <span className="text-sm text-ink-700/60">{plans.length} plans · shown on /membership page</span>
          <button className={btnPrimary} onClick={() => setCreating(true)}>+ New plan</button>
        </div>
      </Card>
      <div className="grid sm:grid-cols-2 gap-3">
        {plans.map((p) => (
          <div key={p.id} className="bg-white border border-black/10 rounded-lg p-4">
            <div className="flex justify-between items-start">
              <div>
                <div className="font-medium text-ink-800">{p.name} {p.highlight && <span className="text-xs bg-bronze-600 text-cream px-2 py-0.5 rounded ml-1">★ Featured</span>}</div>
                <div className="text-xs text-ink-700/60">/{p.slug} · {p.months} months · {p.files_per_month} files/mo</div>
              </div>
              <div className="text-right">
                <div className="text-bronze-700 font-medium">${Number(p.price_usd).toFixed(2)}</div>
                {p.original_price_usd && <div className="text-xs text-ink-700/40 line-through">${Number(p.original_price_usd).toFixed(2)}</div>}
              </div>
            </div>
            <ul className="text-xs text-ink-700/70 mt-2 space-y-0.5">
              {(Array.isArray(p.features) ? p.features : []).slice(0, 4).map((f: string, i: number) => <li key={i}>• {f}</li>)}
            </ul>
            <div className="mt-3 flex gap-1">
              <button className={btnGhost} onClick={() => setEditing(p)}>Edit</button>
              <button className={btnDanger} onClick={() => remove(p.id)}>Delete</button>
            </div>
          </div>
        ))}
      </div>

      <Card title={`Membership leads (${leads.length})`} action={<button className={btnGhost} onClick={exportLeads}>Export CSV</button>}>
        {leads.length === 0 ? (
          <p className="text-sm text-ink-700/60">No leads yet. They'll appear here as people fill in the membership form.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-ink-700/60 text-left"><tr><th className="p-2">When</th><th className="p-2">Name</th><th className="p-2">Email</th><th className="p-2">Plan</th></tr></thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={l.id} className="border-t border-black/5">
                    <td className="p-2 text-xs">{new Date(l.created_at).toLocaleString()}</td>
                    <td className="p-2">{l.name || '—'}</td><td className="p-2">{l.email}</td><td className="p-2 text-xs">{l.plan_slug || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <PlanForm open={!!editing || creating} existing={editing}
        onClose={() => { setEditing(null); setCreating(false); }}
        onSaved={() => { setEditing(null); setCreating(false); load(); }} />
    </div>
  );
}

function PlanForm({ open, onClose, onSaved, existing }: any) {
  const [f, setF] = useState<any>({
    slug: '', name: '', months: 3, files_per_month: 8,
    price_usd: 20, original_price_usd: 192, features_text: '',
    active: true, sort_order: 0, highlight: false,
  });
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (existing) setF({
      ...existing,
      features_text: Array.isArray(existing.features) ? existing.features.join('\n') : '',
    });
    else setF({ slug: '', name: '', months: 3, files_per_month: 8, price_usd: 20, original_price_usd: 192, features_text: '', active: true, sort_order: 0, highlight: false });
    setMsg('');
  }, [existing, open]);
  async function save() {
    if (!f.slug.trim() || !f.name.trim()) return setMsg('Slug + name required');
    setMsg('Saving…');
    const features = f.features_text.split('\n').map((s: string) => s.trim()).filter(Boolean);
    const payload = {
      slug: f.slug.trim(), name: f.name.trim(),
      months: Number(f.months) || 0, files_per_month: Number(f.files_per_month) || 0,
      price_usd: Number(f.price_usd) || 0, original_price_usd: Number(f.original_price_usd) || null,
      features, active: !!f.active, sort_order: Number(f.sort_order) || 0, highlight: !!f.highlight,
    };
    const { error } = existing
      ? await supabase.from('membership_plans').update(payload).eq('id', existing.id)
      : await supabase.from('membership_plans').insert(payload);
    if (error) return setMsg('Error: ' + error.message);
    setMsg('✓ Saved'); setTimeout(onSaved, 300);
  }
  return (
    <Modal open={open} onClose={onClose} title={existing ? 'Edit plan' : 'New plan'} wide>
      <div className="grid md:grid-cols-2 gap-3">
        <div><label className={labelCls}>Name</label><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={inputCls} /></div>
        <div><label className={labelCls}>Slug</label><input value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value })} className={inputCls} /></div>
        <div><label className={labelCls}>Months</label><input type="number" value={f.months} onChange={(e) => setF({ ...f, months: e.target.value })} className={inputCls} /></div>
        <div><label className={labelCls}>Files per month</label><input type="number" value={f.files_per_month} onChange={(e) => setF({ ...f, files_per_month: e.target.value })} className={inputCls} /></div>
        <div><label className={labelCls}>Price (USD)</label><input type="number" step="0.01" value={f.price_usd} onChange={(e) => setF({ ...f, price_usd: e.target.value })} className={inputCls} /></div>
        <div><label className={labelCls}>Retail value (strikethrough)</label><input type="number" step="0.01" value={f.original_price_usd} onChange={(e) => setF({ ...f, original_price_usd: e.target.value })} className={inputCls} /></div>
        <div className="md:col-span-2"><label className={labelCls}>Features (one per line)</label><textarea rows={5} value={f.features_text} onChange={(e) => setF({ ...f, features_text: e.target.value })} className={inputCls} /></div>
        <div><label className={labelCls}>Sort</label><input type="number" value={f.sort_order} onChange={(e) => setF({ ...f, sort_order: e.target.value })} className={inputCls} /></div>
        <div className="flex items-end gap-4">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.highlight} onChange={(e) => setF({ ...f, highlight: e.target.checked })} /> Featured</label>
        </div>
      </div>
      <div className="mt-4 flex gap-3 border-t border-black/10 pt-4">
        <button className={btnPrimary} onClick={save}>{existing ? 'Save changes' : 'Create plan'}</button>
        <button className={btnGhost} onClick={onClose}>Cancel</button>
        <span className={'text-xs self-center ' + (msg.startsWith('✓') ? 'text-green-700' : msg.startsWith('Error') ? 'text-red-600' : 'text-ink-700/60')}>{msg}</span>
      </div>
    </Modal>
  );
}
