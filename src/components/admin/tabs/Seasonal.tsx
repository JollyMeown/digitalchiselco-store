import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { Card, Modal, btnGhost, btnPrimary, btnDanger, inputCls, labelCls } from '../ui';

const blank = { slug: '', title: '', subtitle: '', keywords: '', hero_image_url: '', starts_at: '', ends_at: '', active: true, sort_order: 0 };

export default function Seasonal() {
  const [rows, setRows] = useState<any[]>([]);
  const [editing, setEditing] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => { load(); }, []);
  async function load() {
    const { data } = await supabase.from('seasonal_collections').select('*').order('sort_order').order('created_at');
    setRows(data ?? []);
  }
  async function remove(id: string) {
    if (!confirm('Delete this seasonal collection?')) return;
    await supabase.from('seasonal_collections').delete().eq('id', id);
    load();
  }
  const now = new Date().toISOString();
  const isLive = (r: any) => r.active && (!r.starts_at || r.starts_at <= now) && (!r.ends_at || r.ends_at >= now);

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex justify-between items-center">
          <span className="text-sm text-ink-700/60">Seasonal landing pages at <code>/seasonal/&lt;slug&gt;</code> — auto-filled from keyword matches, auto-hidden outside their date window.</span>
          <button className={btnPrimary} onClick={() => setCreating(true)}>+ New collection</button>
        </div>
      </Card>
      <div className="grid sm:grid-cols-2 gap-3">
        {rows.map((r) => (
          <div key={r.id} className={`border rounded-lg p-4 ${isLive(r) ? 'bg-white border-green-300' : 'bg-gray-50 border-gray-200'}`}>
            <div className="flex items-center gap-2">
              <span className="font-medium text-ink-800">{r.title}</span>
              {isLive(r) ? <span className="text-[10px] uppercase bg-green-100 text-green-800 px-1.5 py-0.5 rounded">Live</span>
                : <span className="text-[10px] uppercase bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded">{r.active ? 'Scheduled/ended' : 'Off'}</span>}
            </div>
            <div className="text-xs text-ink-700/60 mt-1">/seasonal/{r.slug} · {(r.keywords || []).length} keywords</div>
            <div className="text-xs text-ink-700/50 mt-0.5">
              {r.starts_at ? new Date(r.starts_at).toLocaleDateString() : '—'} → {r.ends_at ? new Date(r.ends_at).toLocaleDateString() : '—'}
            </div>
            <div className="mt-3 flex gap-1">
              <a className={btnGhost} href={`/seasonal/${r.slug}`} target="_blank">View</a>
              <button className={btnGhost} onClick={() => setEditing(r)}>Edit</button>
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
  const [f, setF] = useState<any>(blank);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (existing) setF({
      ...existing,
      keywords: Array.isArray(existing.keywords) ? existing.keywords.join(', ') : '',
      starts_at: existing.starts_at ? existing.starts_at.slice(0, 10) : '',
      ends_at: existing.ends_at ? existing.ends_at.slice(0, 10) : '',
      subtitle: existing.subtitle || '', hero_image_url: existing.hero_image_url || '',
    });
    else setF(blank);
    setMsg('');
  }, [existing, open]);

  async function save() {
    if (!f.slug.trim() || !f.title.trim()) return setMsg('Slug + title required');
    setMsg('Saving…');
    const payload = {
      slug: f.slug.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-'),
      title: f.title.trim(),
      subtitle: f.subtitle.trim() || null,
      keywords: f.keywords.split(',').map((s: string) => s.trim()).filter(Boolean),
      hero_image_url: f.hero_image_url.trim() || null,
      starts_at: f.starts_at ? new Date(f.starts_at + 'T00:00:00Z').toISOString() : null,
      ends_at: f.ends_at ? new Date(f.ends_at + 'T23:59:59Z').toISOString() : null,
      active: !!f.active,
      sort_order: Number(f.sort_order) || 0,
    };
    const { error } = existing
      ? await supabase.from('seasonal_collections').update(payload).eq('id', existing.id)
      : await supabase.from('seasonal_collections').insert(payload);
    if (error) return setMsg('Error: ' + error.message);
    setMsg('✓ Saved'); setTimeout(onSaved, 300);
  }

  return (
    <Modal open={open} onClose={onClose} title={existing ? 'Edit seasonal collection' : 'New seasonal collection'}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div><label className={labelCls}>Title</label><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} className={inputCls} placeholder="Christmas Carvings 2026" /></div>
          <div><label className={labelCls}>Slug (URL)</label><input value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value })} className={inputCls} placeholder="christmas-2026" /></div>
        </div>
        <div><label className={labelCls}>Subtitle</label><input value={f.subtitle} onChange={(e) => setF({ ...f, subtitle: e.target.value })} className={inputCls} placeholder="Festive reliefs to carve before the holidays" /></div>
        <div><label className={labelCls}>Keywords (comma-separated — a design is included if its title contains ANY)</label>
          <input value={f.keywords} onChange={(e) => setF({ ...f, keywords: e.target.value })} className={inputCls} placeholder="christmas, santa, reindeer, snowflake, nativity, ornament" /></div>
        <div><label className={labelCls}>Hero image URL (optional)</label><input value={f.hero_image_url} onChange={(e) => setF({ ...f, hero_image_url: e.target.value })} className={inputCls} /></div>
        <div className="grid grid-cols-3 gap-2">
          <div><label className={labelCls}>Starts (optional)</label><input type="date" value={f.starts_at} onChange={(e) => setF({ ...f, starts_at: e.target.value })} className={inputCls} /></div>
          <div><label className={labelCls}>Ends (optional)</label><input type="date" value={f.ends_at} onChange={(e) => setF({ ...f, ends_at: e.target.value })} className={inputCls} /></div>
          <div><label className={labelCls}>Sort</label><input type="number" value={f.sort_order} onChange={(e) => setF({ ...f, sort_order: Number(e.target.value) })} className={inputCls} /></div>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active</label>
      </div>
      <div className="mt-4 flex gap-3 border-t border-black/10 pt-4">
        <button className={btnPrimary} onClick={save}>{existing ? 'Save changes' : 'Create'}</button>
        <button className={btnGhost} onClick={onClose}>Cancel</button>
        <span className={'text-xs self-center ' + (msg.startsWith('✓') ? 'text-green-700' : msg.startsWith('Error') ? 'text-red-600' : 'text-ink-700/60')}>{msg}</span>
      </div>
    </Modal>
  );
}
