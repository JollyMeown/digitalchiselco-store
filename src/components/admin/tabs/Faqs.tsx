import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { Card, Modal, btnGhost, btnPrimary, btnDanger, inputCls, labelCls } from '../ui';

export default function Faqs() {
  const [rows, setRows] = useState<any[]>([]);
  const [editing, setEditing] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => { load(); }, []);
  async function load() {
    const { data } = await supabase.from('faqs').select('*').order('sort_order').order('created_at');
    setRows(data ?? []);
  }
  async function remove(id: string) {
    if (!confirm('Delete this FAQ?')) return;
    const { error } = await supabase.from('faqs').delete().eq('id', id);
    if (error) return alert(error.message);
    load();
  }
  async function toggleActive(r: any) {
    await supabase.from('faqs').update({ active: !r.active }).eq('id', r.id);
    load();
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex justify-between items-center">
          <span className="text-sm text-ink-700/60">{rows.length} FAQs · shown on homepage "Frequently asked questions" section (active only)</span>
          <button className={btnPrimary} onClick={() => setCreating(true)}>+ New FAQ</button>
        </div>
      </Card>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.id} className={`border rounded-lg p-4 ${r.active ? 'bg-white border-black/10' : 'bg-gray-100 border-gray-300 opacity-60'}`}>
            <div className="flex justify-between items-start gap-3">
              <div className="flex-1">
                <div className="font-medium text-ink-800">{r.question}</div>
                <div className="text-sm text-ink-700/80 mt-1 leading-relaxed">{r.answer}</div>
                <div className="text-xs text-ink-700/50 mt-2">#{r.sort_order}</div>
              </div>
              <div className="flex gap-1 flex-shrink-0">
                <button className={btnGhost} onClick={() => setEditing(r)}>Edit</button>
                <button className={btnGhost} onClick={() => toggleActive(r)}>{r.active ? 'Hide' : 'Show'}</button>
                <button className={btnDanger} onClick={() => remove(r.id)}>Delete</button>
              </div>
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
  const [f, setF] = useState({ question: '', answer: '', sort_order: 0, active: true });
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (existing) setF({ ...existing });
    else setF({ question: '', answer: '', sort_order: 0, active: true });
    setMsg('');
  }, [existing, open]);
  async function save() {
    if (!f.question.trim() || !f.answer.trim()) return setMsg('Both fields required');
    setMsg('Saving…');
    const payload = { ...f, sort_order: Number(f.sort_order) || 0 };
    const { error } = existing
      ? await supabase.from('faqs').update(payload).eq('id', existing.id)
      : await supabase.from('faqs').insert(payload);
    if (error) return setMsg('Error: ' + error.message);
    setMsg('✓ Saved'); setTimeout(onSaved, 300);
  }
  return (
    <Modal open={open} onClose={onClose} title={existing ? 'Edit FAQ' : 'New FAQ'}>
      <div className="space-y-3">
        <div><label className={labelCls}>Question</label><input value={f.question} onChange={(e) => setF({ ...f, question: e.target.value })} className={inputCls} /></div>
        <div><label className={labelCls}>Answer</label><textarea value={f.answer} onChange={(e) => setF({ ...f, answer: e.target.value })} rows={5} className={inputCls} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls}>Sort</label><input type="number" value={f.sort_order} onChange={(e) => setF({ ...f, sort_order: Number(e.target.value) })} className={inputCls} /></div>
          <label className="flex items-center gap-2 text-sm self-end"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active</label>
        </div>
      </div>
      <div className="mt-4 flex gap-3 border-t border-black/10 pt-4">
        <button className={btnPrimary} onClick={save}>{existing ? 'Save changes' : 'Create FAQ'}</button>
        <button className={btnGhost} onClick={onClose}>Cancel</button>
        <span className={'text-xs self-center ' + (msg.startsWith('✓') ? 'text-green-700' : msg.startsWith('Error') ? 'text-red-600' : 'text-ink-700/60')}>{msg}</span>
      </div>
    </Modal>
  );
}
