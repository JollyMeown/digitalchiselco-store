// "Carved by you" — customer creations showcase.
// Shown on the homepage. Admin adds maker name, photos, description, and (optional)
// a link to the source product in the catalog so visitors can shop the same design.
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { Card, Modal, btnGhost, btnDanger, btnPrimary, inputCls, labelCls, Toast } from '../ui';
import ImageUpload from '../ImageUpload';

type Creation = {
  id: string; name: string; description: string | null; gallery: string[];
  product_id: string | null; product_url: string | null; active: boolean;
  is_featured: boolean; sort_order: number; created_at: string;
  products?: { title: string; slug: string } | null;
};
type ProductPick = { id: string; title: string; slug: string };

export default function Creations() {
  const [rows, setRows] = useState<Creation[]>([]);
  const [products, setProducts] = useState<ProductPick[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Creation | 'new' | null>(null);

  useEffect(() => { load(); }, []);
  async function load() {
    setLoading(true);
    const [{ data: cs }, { data: ps }] = await Promise.all([
      supabase.from('customer_creations').select('*,products(title,slug)').order('sort_order', { ascending: true }).order('created_at', { ascending: false }),
      supabase.from('products').select('id,title,slug').eq('active', true).order('title').limit(2000),
    ]);
    setRows((cs ?? []) as any);
    setProducts((ps ?? []) as any);
    setLoading(false);
  }
  async function del(c: Creation) {
    if (!confirm(`Delete "${c.name}"'s creation?`)) return;
    await supabase.from('customer_creations').delete().eq('id', c.id);
    load();
  }
  async function toggleActive(c: Creation) {
    await supabase.from('customer_creations').update({ active: !c.active }).eq('id', c.id);
    setRows((r) => r.map((x) => x.id === c.id ? { ...x, active: !c.active } : x));
  }
  async function toggleFeatured(c: Creation) {
    await supabase.from('customer_creations').update({ is_featured: !c.is_featured }).eq('id', c.id);
    setRows((r) => r.map((x) => x.id === c.id ? { ...x, is_featured: !c.is_featured } : x));
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm">Customer creations — real makers, real finished pieces. Shown on the homepage in the "Carved by you" section. Each entry can link back to the source product so visitors can shop it.</p>
            <p className="text-xs text-ink-700/60 mt-1">Tip: ask makers in your free-pack thank-you email to share photos to <a href="mailto:jolly@digitalchiselco.com" className="text-bronze-600 underline">jolly@digitalchiselco.com</a>.</p>
          </div>
          <button className={btnPrimary} onClick={() => setOpen('new')}>+ Add creation</button>
        </div>
      </Card>

      {loading ? <div className="text-sm text-ink-700/60">Loading…</div> : rows.length === 0 ? (
        <Card><p className="text-sm text-ink-700/60">No creations yet. Add your first one to populate the homepage showcase.</p></Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {rows.map((c) => (
            <div key={c.id} className={`bg-white border rounded-lg overflow-hidden ${c.active ? 'border-black/10' : 'border-black/10 opacity-60'}`}>
              <div className="aspect-square bg-cream overflow-hidden">
                {c.gallery?.[0]
                  ? <img src={c.gallery[0]} alt={`Creation by ${c.name}`} className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center text-bronze-600/40 text-xs">No image</div>}
              </div>
              <div className="p-3">
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <div className="text-sm font-medium">{c.name}</div>
                    {c.products && <a href={`/product/${c.products.slug}`} target="_blank" className="text-xs text-bronze-600 hover:underline">{c.products.title.slice(0, 50)} ↗</a>}
                  </div>
                  <div className="flex flex-col items-end gap-0.5">
                    {c.is_featured && <span className="text-[10px] bg-bronze-100 text-bronze-700 px-1.5 py-0.5 rounded">★ featured</span>}
                    {!c.active && <span className="text-[10px] bg-gray-200 text-gray-700 px-1.5 py-0.5 rounded">hidden</span>}
                  </div>
                </div>
                {c.description && <p className="text-xs text-ink-700/70 mt-2 line-clamp-2">{c.description}</p>}
                <div className="flex gap-1 mt-3 pt-2 border-t border-black/5">
                  <button className={btnGhost + ' flex-1 justify-center'} onClick={() => setOpen(c)}>Edit</button>
                  <button className={btnGhost} onClick={() => toggleFeatured(c)} title="Featured">{c.is_featured ? '★' : '☆'}</button>
                  <button className={btnGhost} onClick={() => toggleActive(c)} title={c.active ? 'Hide' : 'Show'}>{c.active ? '👁' : '🚫'}</button>
                  <button className={btnDanger} onClick={() => del(c)}>✕</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={!!open} onClose={() => setOpen(null)} title={open === 'new' ? 'Add customer creation' : (open && open !== 'new' ? `Edit: ${(open as Creation).name}` : '')} wide>
        {open && <CreationForm c={open === 'new' ? null : (open as Creation)} products={products} onDone={() => { setOpen(null); load(); }} />}
      </Modal>
    </div>
  );
}

function CreationForm({ c, products, onDone }: { c: Creation | null; products: ProductPick[]; onDone: () => void }) {
  const [name, setName] = useState(c?.name || '');
  const [description, setDescription] = useState(c?.description || '');
  const [gallery, setGallery] = useState<string[]>(c?.gallery || []);
  const [productId, setProductId] = useState<string>(c?.product_id || '');
  const [productUrl, setProductUrl] = useState(c?.product_url || '');
  const [active, setActive] = useState(c?.active ?? true);
  const [isFeatured, setIsFeatured] = useState(c?.is_featured ?? false);
  const [sortOrder, setSortOrder] = useState<number | string>(c?.sort_order ?? 0);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'info'; text: string }>({ kind: 'info', text: '' });
  const [busy, setBusy] = useState(false);

  function addImage(url: string) { if (url) setGallery([...gallery, url]); }
  function removeImage(i: number) { setGallery(gallery.filter((_, x) => x !== i)); }
  function moveImage(i: number, dir: -1 | 1) {
    const t = i + dir; if (t < 0 || t >= gallery.length) return;
    const next = gallery.slice(); [next[i], next[t]] = [next[t], next[i]]; setGallery(next);
  }

  async function save() {
    if (!name.trim()) { setMsg({ kind: 'error', text: 'Maker name is required.' }); return; }
    if (gallery.length === 0) { setMsg({ kind: 'error', text: 'Add at least one photo.' }); return; }
    setBusy(true);
    const payload = {
      name, description: description || null, gallery,
      product_id: productId || null, product_url: productUrl || null,
      active, is_featured: isFeatured, sort_order: Number(sortOrder) || 0,
    };
    const { error } = c
      ? await supabase.from('customer_creations').update(payload).eq('id', c.id)
      : await supabase.from('customer_creations').insert(payload);
    setBusy(false);
    if (error) { setMsg({ kind: 'error', text: error.message }); return; }
    setMsg({ kind: 'success', text: '✓ Saved' });
    setTimeout(onDone, 500);
  }

  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-3">
          <div>
            <label className={labelCls}>Maker name <span className="text-red-600">*</span></label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mike T." className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Description / story</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="A short story — wood used, finish, occasion, anything they shared." className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Source product <span className="text-ink-700/40">(optional — links the creation to the catalog)</span></label>
            <select value={productId} onChange={(e) => setProductId(e.target.value)} className={inputCls}>
              <option value="">— None —</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.title.slice(0, 60)}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>External URL <span className="text-ink-700/40">(if not in catalog)</span></label>
            <input value={productUrl} onChange={(e) => setProductUrl(e.target.value)} placeholder="https://…" className={inputCls} />
          </div>
          <div className="flex items-center gap-4 flex-wrap pt-1">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isFeatured} onChange={(e) => setIsFeatured(e.target.checked)} /> ★ Featured</label>
            <label className="flex items-center gap-2 text-sm">Order <input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} className={inputCls + ' w-20'} /></label>
          </div>
        </div>
        <div>
          <label className={labelCls}>Photos ({gallery.length})</label>
          <p className="text-xs text-ink-700/60 mb-2">First photo is the main image shown on the homepage. Drag the arrows to reorder.</p>
          <ImageUpload value="" onChange={addImage} folder="creations" />
          {gallery.length > 0 && (
            <div className="mt-3 grid grid-cols-3 gap-2">
              {gallery.map((g, i) => (
                <div key={i} className="relative group border border-black/10 rounded overflow-hidden">
                  <img src={g} alt={`${name} creation ${i + 1}`} className="w-full aspect-square object-cover" />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition flex items-center justify-center opacity-0 group-hover:opacity-100 gap-1">
                    <button onClick={() => moveImage(i, -1)} disabled={i === 0} className="bg-white/90 px-1.5 rounded text-xs">←</button>
                    <button onClick={() => moveImage(i, 1)} disabled={i === gallery.length - 1} className="bg-white/90 px-1.5 rounded text-xs">→</button>
                    <button onClick={() => removeImage(i)} className="bg-red-600 text-white px-1.5 rounded text-xs">✕</button>
                  </div>
                  {i === 0 && <span className="absolute top-1 left-1 bg-bronze-600 text-cream text-[10px] px-1.5 py-0.5 rounded">main</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3 border-t border-black/10 pt-4">
        <button disabled={busy} onClick={save} className={btnPrimary}>{busy ? 'Saving…' : (c ? 'Save changes' : 'Add creation')}</button>
        <Toast message={msg.text} kind={msg.kind} />
      </div>
    </div>
  );
}
