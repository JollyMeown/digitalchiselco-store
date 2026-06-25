import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { Card, Modal, btnGhost, btnPrimary, btnDanger, inputCls, labelCls, linkColor } from '../ui';

type Cat = { id: string; name: string; slug: string };
type Row = {
  id: string; title: string; slug: string; price_usd: number; image_url: string | null;
  link_status: string; active: boolean; is_bundle: boolean; description?: string;
  gallery?: string[]; product_categories?: { categories: Cat | null }[];
};

const slugify = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80);

export default function Products() {
  const [rows, setRows] = useState<Row[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [q, setQ] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Row | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => { loadCats(); load(); }, []);
  useEffect(() => { load(); }, [q, catFilter, statusFilter]);

  async function loadCats() {
    const { data } = await supabase.from('categories').select('id,name,slug').order('name');
    setCats(data ?? []);
  }
  async function load() {
    setLoading(true);
    let qb = supabase
      .from('products')
      .select('id,title,slug,price_usd,image_url,link_status,active,is_bundle,product_categories(categories(id,name,slug))')
      .order('title')
      .limit(200);
    if (q.trim()) qb = qb.ilike('title', `%${q.trim()}%`);
    if (statusFilter === 'active') qb = qb.eq('active', true);
    if (statusFilter === 'inactive') qb = qb.eq('active', false);
    if (catFilter) {
      // filter by category via the join — need inner
      qb = supabase
        .from('products')
        .select('id,title,slug,price_usd,image_url,link_status,active,is_bundle,product_categories!inner(categories(id,name,slug))')
        .eq('product_categories.category_id', catFilter)
        .order('title')
        .limit(200);
      if (q.trim()) qb = qb.ilike('title', `%${q.trim()}%`);
      if (statusFilter === 'active') qb = qb.eq('active', true);
      if (statusFilter === 'inactive') qb = qb.eq('active', false);
    }
    const { data, error } = await qb;
    if (error) console.error(error);
    setRows((data ?? []) as any);
    setLoading(false);
  }

  async function remove(id: string) {
    if (!confirm('Delete this product permanently? This also removes its download links and category links.')) return;
    const { error } = await supabase.from('products').delete().eq('id', id);
    if (error) return alert('Delete failed: ' + error.message);
    setRows((r) => r.filter((x) => x.id !== id));
  }

  const totalFiltered = rows.length;
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap gap-2 items-center">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by title…" className={inputCls + ' max-w-xs'} />
          <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className={inputCls + ' max-w-xs'}>
            <option value="">All categories</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className={inputCls + ' max-w-xs'}>
            <option value="all">All status</option>
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
          </select>
          <span className="text-xs text-ink-700/60 ml-auto">{totalFiltered} shown</span>
          <button className={btnPrimary} onClick={() => setCreating(true)}>+ New product</button>
        </div>
      </Card>

      {loading ? <div className="text-sm text-ink-700/60">Loading…</div> : (
        <div className="bg-white border border-black/10 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-xs text-ink-700/60 text-left bg-cream/40">
              <tr>
                <th className="p-2 w-10"></th><th className="p-2 w-14"></th><th className="p-2">Title</th>
                <th className="p-2">Categories</th><th className="p-2 w-20">Price</th>
                <th className="p-2 w-20">Active</th><th className="p-2 w-32 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-black/5 hover:bg-cream/30">
                  <td className="p-2"><span className={`inline-block w-2.5 h-2.5 rounded-full ${linkColor[r.link_status] || 'bg-gray-400'}`} /></td>
                  <td className="p-2">{r.image_url ? <img src={r.image_url} className="w-10 h-10 object-cover rounded" /> : <div className="w-10 h-10 bg-cream rounded" />}</td>
                  <td className="p-2"><a href={`/product/${r.slug}`} target="_blank" className="text-ink-800 hover:text-bronze-600">{r.title.slice(0, 60)}</a></td>
                  <td className="p-2 text-xs text-ink-700/70">{(r.product_categories ?? []).map((pc) => pc.categories?.name).filter(Boolean).join(', ') || '—'}</td>
                  <td className="p-2">${Number(r.price_usd).toFixed(2)}</td>
                  <td className="p-2">{r.active ? '✓' : '—'}</td>
                  <td className="p-2 text-right space-x-1">
                    <button className={btnGhost} onClick={() => setEditing(r)}>Edit</button>
                    <button className={btnDanger} onClick={() => remove(r.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ProductForm
        open={!!editing || creating}
        onClose={() => { setEditing(null); setCreating(false); }}
        onSaved={() => { setEditing(null); setCreating(false); load(); }}
        existing={editing}
        cats={cats}
      />
    </div>
  );
}

function ProductForm({ open, onClose, onSaved, existing, cats }: any) {
  const blank = useMemo(() => ({
    title: '', slug: '', description: '', price_usd: 9.99, image_url: '',
    gallery: '', is_bundle: false, active: true, link_status: 'review',
    seo_title: '', seo_description: '', download_link: '', category_ids: [] as string[],
  }), []);
  const [f, setF] = useState<any>(blank);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [autoSlug, setAutoSlug] = useState(true);

  useEffect(() => {
    if (existing) {
      setAutoSlug(false);
      loadExisting(existing.id);
    } else {
      setF(blank); setAutoSlug(true); setMsg('');
    }
  }, [existing, open]);

  async function loadExisting(id: string) {
    const { data: p } = await supabase
      .from('products')
      .select('*, product_categories(category_id), product_downloads(download_link)')
      .eq('id', id).maybeSingle();
    if (!p) return;
    setF({
      title: p.title || '', slug: p.slug || '', description: p.description || '',
      price_usd: p.price_usd || 0, image_url: p.image_url || '',
      gallery: Array.isArray(p.gallery) ? p.gallery.join('\n') : '',
      is_bundle: !!p.is_bundle, active: p.active !== false,
      link_status: p.link_status || 'review',
      seo_title: p.seo_title || '', seo_description: p.seo_description || '',
      download_link: p.product_downloads?.[0]?.download_link || '',
      category_ids: (p.product_categories || []).map((pc: any) => pc.category_id),
    });
  }

  function set(k: string, v: any) {
    setF((s: any) => {
      const next = { ...s, [k]: v };
      if (k === 'title' && autoSlug) next.slug = slugify(v);
      return next;
    });
  }

  async function save() {
    if (!f.title.trim()) return setMsg('Title is required');
    if (!f.slug.trim()) return setMsg('Slug is required');
    setBusy(true); setMsg('Saving…');
    const gallery = f.gallery.split('\n').map((s: string) => s.trim()).filter(Boolean);
    const payload: any = {
      title: f.title.trim(), slug: f.slug.trim(), description: f.description || null,
      price_usd: Number(f.price_usd) || 0, image_url: f.image_url || null,
      gallery, is_bundle: !!f.is_bundle, active: !!f.active,
      link_status: f.link_status, seo_title: f.seo_title || null, seo_description: f.seo_description || null,
    };
    let id = existing?.id;
    if (existing) {
      const { error } = await supabase.from('products').update(payload).eq('id', existing.id);
      if (error) { setBusy(false); return setMsg('Error: ' + error.message); }
    } else {
      const { data, error } = await supabase.from('products').insert(payload).select('id').single();
      if (error) { setBusy(false); return setMsg('Error: ' + error.message); }
      id = data.id;
    }
    // categories
    await supabase.from('product_categories').delete().eq('product_id', id);
    if (f.category_ids.length) {
      await supabase.from('product_categories').insert(f.category_ids.map((c: string) => ({ product_id: id, category_id: c })));
    }
    // download link (single, simple). If we already have downloads, update first; else insert.
    if (f.download_link.trim()) {
      const { data: existingDl } = await supabase.from('product_downloads').select('id').eq('product_id', id).limit(1);
      if (existingDl && existingDl.length) {
        await supabase.from('product_downloads').update({ download_link: f.download_link.trim() }).eq('id', existingDl[0].id);
      } else {
        await supabase.from('product_downloads').insert({ product_id: id, download_link: f.download_link.trim(), file_name: f.title.trim() });
      }
    }
    setBusy(false); setMsg('✓ Saved');
    setTimeout(onSaved, 350);
  }

  return (
    <Modal open={open} onClose={onClose} title={existing ? 'Edit product' : 'New product'} wide>
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Title</label>
          <input value={f.title} onChange={(e) => set('title', e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Slug <span className="text-ink-700/40">(URL)</span></label>
          <input value={f.slug} onChange={(e) => { setAutoSlug(false); set('slug', e.target.value); }} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Price (USD)</label>
          <input type="number" step="0.01" value={f.price_usd} onChange={(e) => set('price_usd', e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Link status</label>
          <select value={f.link_status} onChange={(e) => set('link_status', e.target.value)} className={inputCls}>
            {['certain', 'likely', 'review', 'bundle_manual', 'verified', 'broken'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className={labelCls}>Main image URL</label>
          <input value={f.image_url} onChange={(e) => set('image_url', e.target.value)} placeholder="https://…" className={inputCls} />
        </div>
        <div className="md:col-span-2">
          <label className={labelCls}>Gallery URLs <span className="text-ink-700/40">(one per line)</span></label>
          <textarea value={f.gallery} onChange={(e) => set('gallery', e.target.value)} rows={4} className={inputCls} />
        </div>
        <div className="md:col-span-2">
          <label className={labelCls}>Description</label>
          <textarea value={f.description} onChange={(e) => set('description', e.target.value)} rows={5} className={inputCls} />
        </div>
        <div className="md:col-span-2">
          <label className={labelCls}>Categories</label>
          <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto border border-black/15 rounded-md p-2">
            {cats.map((c: any) => (
              <label key={c.id} className="flex items-center gap-1.5 text-xs bg-cream px-2 py-1 rounded cursor-pointer">
                <input type="checkbox" checked={f.category_ids.includes(c.id)}
                  onChange={(e) => set('category_ids', e.target.checked ? [...f.category_ids, c.id] : f.category_ids.filter((x: string) => x !== c.id))} />
                {c.name}
              </label>
            ))}
          </div>
        </div>
        <div className="md:col-span-2">
          <label className={labelCls}>Download link (Google Drive)</label>
          <input value={f.download_link} onChange={(e) => set('download_link', e.target.value)} placeholder="https://drive.google.com/uc?export=download&id=…" className={inputCls} />
          <p className="text-xs text-ink-700/50 mt-1">Customers receive this after purchase. Server-only — never shown publicly.</p>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} /> Active (visible in catalog)</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.is_bundle} onChange={(e) => set('is_bundle', e.target.checked)} /> Bundle</label>
        </div>
      </div>
      <div className="mt-5 flex items-center gap-3 border-t border-black/10 pt-4">
        <button className={btnPrimary} disabled={busy} onClick={save}>{busy ? 'Saving…' : (existing ? 'Save changes' : 'Create product')}</button>
        <button className={btnGhost} onClick={onClose}>Cancel</button>
        <span className={'text-xs ' + (msg.startsWith('✓') ? 'text-green-700' : msg.startsWith('Error') ? 'text-red-600' : 'text-ink-700/60')}>{msg}</span>
      </div>
    </Modal>
  );
}
