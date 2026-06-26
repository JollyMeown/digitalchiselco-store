import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { Card, Modal, btnGhost, btnPrimary, btnDanger, inputCls, labelCls } from '../ui';

export default function Reviews() {
  const [rows, setRows] = useState<any[]>([]);
  const [editing, setEditing] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => { load(); }, []);
  async function load() {
    const { data } = await supabase.from('reviews').select('*').order('sort_order').order('created_at');
    setRows(data ?? []);
  }
  async function remove(id: string) {
    if (!confirm('Delete this review?')) return;
    const { error } = await supabase.from('reviews').delete().eq('id', id);
    if (error) return alert(error.message);
    load();
  }
  async function toggleActive(r: any) {
    await supabase.from('reviews').update({ active: !r.active }).eq('id', r.id);
    load();
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex justify-between items-center">
          <span className="text-sm text-ink-700/60">{rows.length} reviews · shown on homepage "Loved by makers" carousel (active only)</span>
          <button className={btnPrimary} onClick={() => setCreating(true)}>+ New review</button>
        </div>
      </Card>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {rows.map((r) => (
          <div key={r.id} className={`border rounded-lg p-4 ${r.active ? 'bg-white border-black/10' : 'bg-gray-100 border-gray-300 opacity-60'}`}>
            <div className="text-bronze-600 text-sm mb-1">{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</div>
            <div className="text-sm text-ink-700 leading-relaxed">"{r.text.slice(0, 180)}{r.text.length > 180 ? '…' : ''}"</div>
            <div className="text-xs text-ink-700/60 mt-2">— {r.name} {r.source ? `· ${r.source}` : ''} · #{r.sort_order}</div>
            <div className="mt-3 flex gap-1 flex-wrap">
              <button className={btnGhost} onClick={() => setEditing(r)}>Edit</button>
              <button className={btnGhost} onClick={() => toggleActive(r)}>{r.active ? 'Hide' : 'Show'}</button>
              <button className={btnDanger} onClick={() => remove(r.id)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
      <Form open={!!editing || creating} existing={editing}
        onClose={() => { setEditing(null); setCreating(false); }}
        onSaved={() => { setEditing(null); setCreating(false); load(); }} />
    </div>
  );
}

function Form({ open, onClose, onSaved, existing }: any) {
  const [f, setF] = useState({ name: '', text: '', rating: 5, source: 'Etsy', sort_order: 0, active: true });
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (existing) setF({ ...existing });
    else setF({ name: '', text: '', rating: 5, source: 'Etsy', sort_order: 0, active: true });
    setMsg('');
  }, [existing, open]);
  async function save() {
    if (!f.name.trim() || !f.text.trim()) return setMsg('Name + text required');
    setMsg('Saving…');
    const payload = { ...f, sort_order: Number(f.sort_order) || 0, rating: Number(f.rating) || 5 };
    const { error } = existing
      ? await supabase.from('reviews').update(payload).eq('id', existing.id)
      : await supabase.from('reviews').insert(payload);
    if (error) return setMsg('Error: ' + error.message);
    setMsg('✓ Saved'); setTimeout(onSaved, 300);
  }
  return (
    <Modal open={open} onClose={onClose} title={existing ? 'Edit review' : 'New review'}>
      <div className="space-y-3">
        <div><label className={labelCls}>Name</label><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={inputCls} /></div>
        <div><label className={labelCls}>Text</label><textarea value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} rows={4} className={inputCls} /></div>
        <div className="grid grid-cols-3 gap-2">
          <div><label className={labelCls}>Rating (1-5)</label><input type="number" min={1} max={5} value={f.rating} onChange={(e) => setF({ ...f, rating: Number(e.target.value) })} className={inputCls} /></div>
          <div><label className={labelCls}>Source</label><input value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} className={inputCls} /></div>
          <div><label className={labelCls}>Sort</label><input type="number" value={f.sort_order} onChange={(e) => setF({ ...f, sort_order: Number(e.target.value) })} className={inputCls} /></div>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active</label>
      </div>
      <div className="mt-4 flex gap-3 border-t border-black/10 pt-4">
        <button className={btnPrimary} onClick={save}>{existing ? 'Save changes' : 'Create review'}</button>
        <button className={btnGhost} onClick={onClose}>Cancel</button>
        <span className={'text-xs self-center ' + (msg.startsWith('✓') ? 'text-green-700' : msg.startsWith('Error') ? 'text-red-600' : 'text-ink-700/60')}>{msg}</span>
      </div>
    </Modal>
  );
}
