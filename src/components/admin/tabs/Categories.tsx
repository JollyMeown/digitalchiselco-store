import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { Card, Modal, btnGhost, btnPrimary, btnDanger, inputCls, labelCls } from '../ui';
import ImageUpload from '../ImageUpload';

const slugify = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80);

export default function Categories() {
  const [rows, setRows] = useState<any[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [editing, setEditing] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => { load(); }, []);
  async function load() {
    const { data } = await supabase.from('categories').select('*').order('sort_order').order('name');
    setRows(data ?? []);
    // counts
    const out: Record<string, number> = {};
    await Promise.all((data ?? []).map(async (c: any) => {
      const { count } = await supabase.from('product_categories').select('*', { count: 'exact', head: true }).eq('category_id', c.id);
      out[c.id] = count ?? 0;
    }));
    setCounts(out);
  }
  async function remove(c: any) {
    if (!confirm(`Delete "${c.name}"? Products will lose this category but won't be deleted.`)) return;
    const { error } = await supabase.from('categories').delete().eq('id', c.id);
    if (error) return alert('Delete failed: ' + error.message);
    load();
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex justify-between items-center">
          <span className="text-sm text-ink-700/60">{rows.length} categories · drag the sort number to reorder</span>
          <button className={btnPrimary} onClick={() => setCreating(true)}>+ New category</button>
        </div>
      </Card>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {rows.map((c) => (
          <div key={c.id} className="bg-white border border-black/10 rounded-lg overflow-hidden">
            <div className="h-28 bg-cream flex items-center justify-center">
              {c.image_url
                ? <img src={c.image_url} className="w-full h-full object-cover" />
                : <span className="text-bronze-600/40 font-serif">{c.name}</span>}
            </div>
            <div className="p-3">
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-medium text-sm text-ink-800">{c.name}</div>
                  <div className="text-xs text-ink-700/60">/{c.slug} · {counts[c.id] ?? '…'} products</div>
                </div>
                <span className="text-xs bg-cream rounded px-1.5 py-0.5">#{c.sort_order || 0}</span>
              </div>
              <div className="mt-2 flex gap-1">
                <button className={btnGhost} onClick={() => setEditing(c)}>Edit</button>
                <button className={btnDanger} onClick={() => remove(c)}>Delete</button>
                <a href={`/collections/${c.slug}`} target="_blank" className={btnGhost}>View ↗</a>
              </div>
            </div>
          </div>
        ))}
      </div>
      <CategoryForm
        open={!!editing || creating}
        onClose={() => { setEditing(null); setCreating(false); }}
        onSaved={() => { setEditing(null); setCreating(false); load(); }}
        existing={editing}
      />
    </div>
  );
}

function CategoryForm({ open, onClose, onSaved, existing }: any) {
  const [f, setF] = useState({ name: '', slug: '', description: '', image_url: '', sort_order: 0 });
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [autoSlug, setAutoSlug] = useState(true);

  useEffect(() => {
    if (existing) {
      setAutoSlug(false);
      setF({
        name: existing.name || '', slug: existing.slug || '',
        description: existing.description || '', image_url: existing.image_url || '',
        sort_order: existing.sort_order || 0,
      });
    } else {
      setF({ name: '', slug: '', description: '', image_url: '', sort_order: 0 });
      setAutoSlug(true);
    }
    setMsg('');
  }, [existing, open]);

  async function save() {
    if (!f.name.trim()) return setMsg('Name is required');
    if (!f.slug.trim()) return setMsg('Slug is required');
    setBusy(true); setMsg('Saving…');
    const payload = {
      name: f.name.trim(), slug: f.slug.trim(),
      description: f.description || null, image_url: f.image_url || null,
      sort_order: Number(f.sort_order) || 0,
    };
    const { error } = existing
      ? await supabase.from('categories').update(payload).eq('id', existing.id)
      : await supabase.from('categories').insert(payload);
    setBusy(false);
    if (error) return setMsg('Error: ' + error.message);
    setMsg('✓ Saved'); setTimeout(onSaved, 350);
  }

  return (
    <Modal open={open} onClose={onClose} title={existing ? 'Edit category' : 'New category'}>
      <div className="space-y-3">
        <div>
          <label className={labelCls}>Name</label>
          <input value={f.name} onChange={(e) => {
            setF((s) => ({ ...s, name: e.target.value, slug: autoSlug ? slugify(e.target.value) : s.slug }));
          }} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Slug</label>
          <input value={f.slug} onChange={(e) => { setAutoSlug(false); setF((s) => ({ ...s, slug: e.target.value })); }} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Sort order <span className="text-ink-700/40">(lower = earlier)</span></label>
          <input type="number" value={f.sort_order} onChange={(e) => setF((s) => ({ ...s, sort_order: Number(e.target.value) }))} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Description</label>
          <textarea value={f.description} onChange={(e) => setF((s) => ({ ...s, description: e.target.value }))} rows={3} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Image</label>
          <ImageUpload value={f.image_url} onChange={(url) => setF((s) => ({ ...s, image_url: url }))} folder="categories" />
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3 border-t border-black/10 pt-4">
        <button className={btnPrimary} disabled={busy} onClick={save}>{busy ? 'Saving…' : (existing ? 'Save changes' : 'Create category')}</button>
        <button className={btnGhost} onClick={onClose}>Cancel</button>
        <span className={'text-xs ' + (msg.startsWith('✓') ? 'text-green-700' : msg.startsWith('Error') ? 'text-red-600' : 'text-ink-700/60')}>{msg}</span>
      </div>
    </Modal>
  );
}
