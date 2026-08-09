import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { Card, inputCls } from '../ui';

// Category Manager: pick a category on the left (drop target), see its products
// as a customer would on the right, then DRAG a product onto the correct
// category to move it (or use the "Move to" dropdown). Fixes miscategorized items.

const token = async () => (await supabase.auth.getSession()).data?.session?.access_token || '';
async function api(params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`/api/admin/categorize?${qs}`, { headers: { authorization: `Bearer ${await token()}` } });
  return res.json();
}
async function post(body: any) {
  const res = await fetch('/api/admin/categorize', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${await token()}` }, body: JSON.stringify(body) });
  return res.json();
}
const title1 = (t?: string) => (t || '').split('|')[0].trim();

export default function CategoryManager() {
  const [cats, setCats] = useState<any[]>([]);
  const [sel, setSel] = useState<string>('');
  const [products, setProducts] = useState<any[]>([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [msg, setMsg] = useState('');

  const catName = useMemo(() => Object.fromEntries(cats.map((c) => [c.id, c.name])), [cats]);
  const loadCats = () => api({ view: 'categories' }).then((d) => { if (d.ok) { setCats(d.categories); if (!sel && d.categories[0]) setSel(d.categories[0].id); } });
  useEffect(() => { loadCats(); }, []);

  const loadProducts = () => {
    if (!sel) return;
    setLoading(true);
    api({ view: 'products', category_id: sel, page: String(page) })
      .then((d) => { if (d.ok) { setProducts(d.products); setTotal(d.total); } }).finally(() => setLoading(false));
  };
  useEffect(() => { setPage(0); }, [sel]);
  useEffect(() => { loadProducts(); }, [sel, page]);

  async function move(productId: string, toCat: string) {
    if (toCat === sel) return;
    setMsg('Moving…');
    const r = await post({ product_id: productId, move_to: toCat, move_from: sel });
    if (r.ok) {
      setProducts((ps) => ps.filter((p) => p.id !== productId));   // it left the current category
      setTotal((t) => Math.max(0, t - 1));
      setCats((cs) => cs.map((c) => c.id === sel ? { ...c, count: Math.max(0, c.count - 1) } : c.id === toCat ? { ...c, count: c.count + 1 } : c));
      setMsg(`✓ Moved to “${catName[toCat]}”`);
    } else setMsg(`✗ ${r.error || 'failed'}`);
    setTimeout(() => setMsg(''), 2500);
  }

  const pages = Math.ceil(total / 60);

  return (
    <div className="space-y-4">
      <div className="text-xs text-ink-700/70 bg-cream/40 border border-bronze-600/15 rounded-lg px-3 py-2">
        🗂 <b>Category Manager.</b> Pick a category on the left to preview its products as a customer sees them. To fix a mis-filed design, <b>drag its card onto the correct category</b> on the left — or use the “Move to” menu on the card. {msg && <b className="text-bronze-700 ml-1">{msg}</b>}
      </div>
      <div className="grid md:grid-cols-[220px_1fr] gap-4">
        {/* Left: categories (drop targets) */}
        <Card>
          <div className="text-[11px] uppercase tracking-wider text-ink-700/50 mb-2">Categories</div>
          <div className="space-y-0.5 max-h-[70vh] overflow-y-auto">
            {cats.map((c) => (
              <button key={c.id}
                onClick={() => setSel(c.id)}
                onDragOver={(e) => { e.preventDefault(); setDropTarget(c.id); }}
                onDragLeave={() => setDropTarget((d) => (d === c.id ? null : d))}
                onDrop={(e) => { e.preventDefault(); setDropTarget(null); if (dragId) move(dragId, c.id); }}
                className={`w-full text-left px-2.5 py-1.5 rounded text-sm flex items-center justify-between gap-2 transition
                  ${sel === c.id ? 'bg-bronze-600 text-cream' : 'text-ink-800 hover:bg-cream'}
                  ${dropTarget === c.id ? 'ring-2 ring-green-500 bg-green-50' : ''}`}>
                <span className="truncate">{c.name}</span>
                <span className={`text-[11px] ${sel === c.id ? 'text-cream/80' : 'text-ink-700/50'}`}>{c.count}</span>
              </button>
            ))}
          </div>
        </Card>

        {/* Right: products in the selected category */}
        <Card>
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <h3 className="font-medium text-ink-900 text-sm">{catName[sel] || 'Category'}</h3>
            <span className="text-xs text-ink-700/55">{total} designs{loading ? ' · loading…' : ''}</span>
            <span className="text-xs text-ink-700/40 ml-auto">drag a card → a category on the left</span>
          </div>
          {!products.length && !loading && <p className="text-sm text-ink-700/50 py-8 text-center">No products in this category.</p>}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {products.map((p) => (
              <div key={p.id} draggable
                onDragStart={() => setDragId(p.id)} onDragEnd={() => setDragId(null)}
                className={`border border-black/10 rounded-lg overflow-hidden bg-white flex flex-col cursor-grab active:cursor-grabbing ${dragId === p.id ? 'opacity-50' : ''}`}>
                <div className="aspect-square bg-cream overflow-hidden">
                  {p.image_url ? <img src={p.image_url} alt="" className="w-full h-full object-cover pointer-events-none" /> : null}
                </div>
                <div className="p-2 flex flex-col flex-1">
                  <div className="text-xs text-ink-800 line-clamp-2 min-h-[2.4em]">{title1(p.title)}</div>
                  <div className="text-xs text-bronze-600 font-medium mt-0.5">${Number(p.price_usd || 0).toFixed(2)}</div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {(p.category_ids || []).filter((id: string) => id !== sel).slice(0, 2).map((id: string) => (
                      <span key={id} className="text-[10px] bg-cream border border-black/10 rounded px-1 py-0.5 text-ink-700/70">{catName[id] || '…'}</span>
                    ))}
                  </div>
                  <select value="" onChange={(e) => { if (e.target.value) move(p.id, e.target.value); }}
                    className={inputCls + ' mt-1.5 text-xs py-1'}>
                    <option value="">Move to…</option>
                    {cats.filter((c) => c.id !== sel).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>
            ))}
          </div>
          {pages > 1 && (
            <div className="flex items-center gap-2 mt-3 text-sm">
              <button disabled={page === 0} onClick={() => setPage(page - 1)} className="px-2 py-1 rounded border border-black/10 disabled:opacity-40">‹ Prev</button>
              <span className="text-ink-700/60">Page {page + 1} / {pages}</span>
              <button disabled={page + 1 >= pages} onClick={() => setPage(page + 1)} className="px-2 py-1 rounded border border-black/10 disabled:opacity-40">Next ›</button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
