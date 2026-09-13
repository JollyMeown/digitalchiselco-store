import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabase';

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
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number(n) || 0)));
const VIEW_KEY = 'dcc_catmgr_view';

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
  const grid = useRef<HTMLDivElement | null>(null);   // the right panel's own scrollport
  const cols = useRef<HTMLDivElement | null>(null);
  const rightCol = useRef<HTMLDivElement | null>(null);
  const [scrollH, setScrollH] = useState<number | null>(null);
  const [panelH, setPanelH] = useState<number | null>(null);
  const [rowsFit, setRowsFit] = useState<number | null>(null);
  const metrics = useRef({ room: 0, cardH: 0, cardW: 0 });

  // "Fit": pick the picture size that makes the chosen number of rows actually
  // land on screen. A card is its picture plus a fixed block of text underneath,
  // so the sum is solvable; the only fudge is that a column stretches past the
  // size floor to fill the row, which the measured ratio accounts for.
  function fitRows() {
    const { room, cardH, cardW } = metrics.current;
    if (!cardH || !cardW) return;
    const gap = 12, textH = cardH - cardW;
    const targetCard = (room - (view.rows - 1) * gap) / view.rows - textH;
    const stretch = cardW / view.size || 1;
    setView((v) => ({ ...v, size: clamp(targetCard / stretch, 90, 340) }));
  }

  // How big the pictures are, and how many rows of them are on screen before the
  // rest goes under the scrollbar. Remembered per browser: whoever files designs
  // settles on a size and should not have to set it again every visit.
  const [view, setView] = useState<{ size: number; rows: number }>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(VIEW_KEY) || '');
      if (v && Number(v.size) && Number(v.rows)) return { size: clamp(v.size, 90, 340), rows: clamp(v.rows, 1, 8) };
    } catch { /* first visit, or storage blocked */ }
    return { size: 140, rows: 3 };
  });
  useEffect(() => { try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch { /* nothing worth failing over */ } }, [view]);

  // The scrollport is exactly N rows tall, measured from a real card rather than
  // assumed: the card's height depends on the picture size, on a two-line title
  // wrapping to three, and on the browser's own select height. Capped at the room
  // left on screen, so asking for 8 big rows cannot push the page into scrolling
  // again, which is the thing this panel exists to avoid.
  useEffect(() => {
    const fit = () => {
      const port = grid.current, col = rightCol.current, outer = cols.current;
      if (!port || !col || !outer) return;
      if (window.innerWidth < 768) { setScrollH(null); return; }   // phones: flow with the page
      const card = port.querySelector<HTMLElement>('[data-card]');
      const gap = 12;                                              // gap-3
      const wanted = card ? view.rows * card.offsetHeight + (view.rows - 1) * gap : 0;
      const chrome = col.offsetHeight - port.offsetHeight;         // header + pager + padding, independent of the height we set
      const room = Math.round(window.innerHeight - outer.getBoundingClientRect().top - 24 - chrome);
      const next = Math.max(220, Math.min(wanted || room, room));
      setScrollH((h) => (h != null && Math.abs(h - next) < 2 ? h : next));
      // A tall card at a big picture size can want more height than the screen
      // has. The screen wins, because a panel taller than the window brings back
      // the page-scrolling this layout exists to stop. So report what actually
      // fits rather than letting the slider claim a number it did not deliver.
      setRowsFit(card ? Math.max(1, Math.floor((next + gap) / (card.offsetHeight + gap))) : view.rows);
      metrics.current = { room, cardH: card?.offsetHeight || 0, cardW: card?.offsetWidth || 0 };
      // the category list matches the panel beside it instead of setting its own
      // height, so the two columns always end on the same line
      setPanelH((h) => { const p = next + chrome; return h != null && Math.abs(h - p) < 2 ? h : p; });
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [view.rows, view.size, products]);

  const catName = useMemo(() => Object.fromEntries(cats.map((c) => [c.id, c.name])), [cats]);
  const loadCats = () => api({ view: 'categories' }).then((d) => { if (d.ok) { setCats(d.categories); if (!sel && d.categories[0]) setSel(d.categories[0].id); } });
  useEffect(() => { loadCats(); }, []);

  const loadProducts = () => {
    if (!sel) return;
    setLoading(true);
    api({ view: 'products', category_id: sel, page: String(page) })
      .then((d) => {
        if (d.ok) { setProducts(d.products); setTotal(d.total); }
        // a new category or page starts at its first card, not wherever the
        // last one was left scrolled to
        grid.current?.scrollTo({ top: 0 });
      }).finally(() => setLoading(false));
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
  const compact = view.size < 150;

  return (
    <div className="space-y-4">
      <div className="text-xs text-ink-700/70 bg-cream/40 border border-bronze-600/15 rounded-lg px-3 py-2">
        🗂 <b>Category Manager.</b> Pick a category on the left to preview its products as a customer sees them. To fix a mis-filed design, <b>drag its card onto the correct category</b> on the left — or use the “Move to” menu on the card. {msg && <b className="text-bronze-700 ml-1">{msg}</b>}
      </div>
      {/* Each column owns its own scrollbar and the pair is exactly as tall as
          the chosen number of picture rows, so scrolling through 169 designs
          never carries the category list off the top of the screen: you can
          always see where you are about to drop a card. Below md the columns
          stack and scroll with the page, which is right on a phone. */}
      <div ref={cols} className="grid md:grid-cols-[220px_1fr] gap-4 md:items-start">
        {/* Left: categories (drop targets) */}
        <div style={panelH ? { height: panelH } : undefined}
          className="min-w-0 bg-white border border-black/10 rounded-lg p-5 flex flex-col md:overflow-hidden">
          <div className="text-[11px] uppercase tracking-wider text-ink-700/50 mb-2 shrink-0">Categories</div>
          <div className="dcc-scroll space-y-0.5 max-h-[70vh] md:max-h-none md:flex-1 overflow-y-auto -mr-2 pr-2">
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
        </div>

        {/* Right: products in the selected category.
            min-w-0 is insurance, not a fix for anything currently broken: a grid
            track defaults to min-width:auto, so a card's "Move to" <select> full
            of long category names is the one element here that could set a floor
            on the column width and push the panel (and its scrollbar) off the
            right of the screen. Chrome shrinks the select today; this makes sure
            a longer category name later cannot change that. */}
        <div ref={rightCol} className="min-w-0 bg-white border border-black/10 rounded-lg p-5 flex flex-col md:overflow-hidden">
          <div className="flex items-center gap-x-4 gap-y-2 mb-3 flex-wrap shrink-0">
            <h3 className="font-medium text-ink-900 text-sm">{catName[sel] || 'Category'}</h3>
            <span className="text-xs text-ink-700/55">{total} designs{loading ? ' · loading…' : ''}</span>
            <div className="ml-auto flex items-center gap-4">
              <label className="flex items-center gap-2 text-[11px] text-ink-700/60" title="How big the pictures are">
                <span className="text-sm leading-none">🖼</span>
                <input type="range" min={90} max={340} step={10} value={view.size}
                  onChange={(e) => setView((v) => ({ ...v, size: Number(e.target.value) }))}
                  className="w-24 accent-bronze-600 cursor-pointer" />
                <span className="tabular-nums w-9">{view.size}px</span>
              </label>
              <label className="flex items-center gap-2 text-[11px] text-ink-700/60" title="How many rows to show before the rest goes under the scrollbar">
                <span>Rows</span>
                <input type="range" min={1} max={8} step={1} value={view.rows}
                  onChange={(e) => setView((v) => ({ ...v, rows: Number(e.target.value) }))}
                  className="w-20 accent-bronze-600 cursor-pointer" />
                <span className="tabular-nums">{view.rows}</span>
                {rowsFit != null && rowsFit < view.rows && (
                  <button type="button" onClick={fitRows}
                    className="text-bronze-700 underline decoration-dotted underline-offset-2 hover:text-bronze-900"
                    title={`Only ${rowsFit} rows fit at this picture size. Click to shrink the pictures until ${view.rows} do.`}>
                    {rowsFit} fit · shrink
                  </button>
                )}
              </label>
            </div>
          </div>
          <div ref={grid} style={scrollH ? { height: scrollH } : undefined}
            className="dcc-scroll md:overflow-y-auto md:-mr-3 md:pr-3">
          {!products.length && !loading && <p className="text-sm text-ink-700/50 py-8 text-center">No products in this category.</p>}
          {/* auto-fill, so the size slider decides how many fit per row instead of
              the breakpoint deciding it for you */}
          <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${view.size}px, 1fr))` }}>
            {products.map((p) => (
              <div key={p.id} draggable data-card
                onDragStart={() => setDragId(p.id)} onDragEnd={() => setDragId(null)}
                className={`min-w-0 border border-black/10 rounded-lg overflow-hidden bg-white flex flex-col cursor-grab active:cursor-grabbing ${dragId === p.id ? 'opacity-50' : ''}`}>
                <div className="aspect-square bg-cream overflow-hidden">
                  {p.image_url ? <img src={p.image_url} alt="" className="w-full h-full object-cover pointer-events-none" /> : null}
                </div>
                <div className={compact ? 'p-1.5 flex flex-col flex-1' : 'p-2 flex flex-col flex-1'}>
                  {/* Below ~150px the words under the picture are too small to
                      read anyway, and every pixel of text is a pixel of picture
                      lost from the next row. So the small sizes drop to one line
                      of title and a tight control, which is what buys the fourth
                      row on a laptop screen. The title stays in the tooltip. */}
                  <div title={title1(p.title)}
                    className={`text-ink-800 ${compact ? 'text-[11px] leading-tight line-clamp-1' : 'text-xs line-clamp-2 min-h-[2.4em]'}`}>
                    {title1(p.title)}
                  </div>
                  <div className={`text-bronze-600 font-medium ${compact ? 'text-[10px]' : 'text-xs mt-0.5'}`}>${Number(p.price_usd || 0).toFixed(2)}</div>
                  {!compact && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {(p.category_ids || []).filter((id: string) => id !== sel).slice(0, 2).map((id: string) => (
                        <span key={id} className="text-[10px] bg-cream border border-black/10 rounded px-1 py-0.5 text-ink-700/70">{catName[id] || '…'}</span>
                      ))}
                    </div>
                  )}
                  <select value="" onChange={(e) => { if (e.target.value) move(p.id, e.target.value); }}
                    className={`w-full min-w-0 border border-black/15 rounded-md bg-white focus:outline-none focus:border-bronze-600
                      ${compact ? 'mt-1 px-1 py-0 text-[10px]' : 'mt-1.5 px-3 py-1 text-xs'}`}>
                    <option value="">Move to…</option>
                    {cats.filter((c) => c.id !== sel).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>
            ))}
          </div>
          </div>
          {pages > 1 && (
            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-black/5 text-sm shrink-0">
              <button disabled={page === 0} onClick={() => setPage(page - 1)} className="px-2 py-1 rounded border border-black/10 disabled:opacity-40">‹ Prev</button>
              <span className="text-ink-700/60">Page {page + 1} / {pages}</span>
              <button disabled={page + 1 >= pages} onClick={() => setPage(page + 1)} className="px-2 py-1 rounded border border-black/10 disabled:opacity-40">Next ›</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
