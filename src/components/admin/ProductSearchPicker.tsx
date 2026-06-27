// Reusable product search picker with debounced server-side ilike, optional
// description search, and a right-side image preview pane. Used by:
//   - Customer Creations: pick a "source product" the maker carved
//   - Bundle Composer:    pick which products belong in the bundle
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { inputCls, labelCls } from './ui';

export type PickerProduct = { id: string; title: string; slug: string; image_url: string | null; price_usd?: number };

interface Props {
  /** Currently selected ids (for showing checkmarks). Empty array if single-pick mode used externally. */
  selectedIds?: string[];
  /** Called when a product is clicked. The host decides single vs multi. */
  onPick: (p: PickerProduct) => void;
  /** Show price column on the right of each row */
  showPrice?: boolean;
  /** Optional initial product to render as preview before any search */
  initialPreview?: PickerProduct | null;
  /** Optional placeholder for the search box */
  placeholder?: string;
  /** Optional: restrict to non-bundle products (default true for both call sites) */
  excludeBundles?: boolean;
  /** Compact = no right-side preview, for narrow modals */
  compact?: boolean;
}

export default function ProductSearchPicker({
  selectedIds = [], onPick, showPrice = false, initialPreview = null,
  placeholder = 'Type to search products…',
  excludeBundles = true, compact = false,
}: Props) {
  const [query, setQuery] = useState('');
  const [searchDescriptions, setSearchDescriptions] = useState(false);
  const [results, setResults] = useState<PickerProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const reqIdRef = useRef(0);

  const selectedSet = new Set(selectedIds);
  const previewProduct = hoverId
    ? results.find((p) => p.id === hoverId)
    : initialPreview;

  useEffect(() => {
    const t = setTimeout(() => { run(query, searchDescriptions); }, 220);
    return () => clearTimeout(t);
  }, [query, searchDescriptions, excludeBundles]);

  async function run(q: string, descToo: boolean) {
    const myReq = ++reqIdRef.current;
    setLoading(true);
    const fields = 'id,title,slug,image_url,price_usd';
    const baseSelect = supabase
      .from('products')
      .select(fields, { count: 'exact' })
      .eq('active', true)
      .order('title');
    let qb = excludeBundles ? baseSelect.neq('is_bundle', true) : baseSelect;
    const term = q.trim();
    if (term) {
      // Server-side ilike. Escape commas + parentheses that would break PostgREST's
      // `or` filter syntax.
      const safe = term.replace(/[,()]/g, ' ');
      if (descToo) {
        qb = qb.or(`title.ilike.*${safe}*,description.ilike.*${safe}*`);
      } else {
        qb = qb.ilike('title', `%${safe}%`);
      }
    }
    qb = qb.limit(100);
    const { data, error, count } = await qb;
    if (myReq !== reqIdRef.current) return; // stale
    if (error) console.error('product search failed', error);
    setResults((data ?? []) as any);
    setTotalCount(count ?? null);
    setLoading(false);
  }

  const list = (
    <div className="border border-black/15 rounded-md overflow-y-auto max-h-72 bg-white relative" onMouseLeave={() => setHoverId(null)}>
      {loading && <div className="absolute top-1 right-2 text-[10px] text-ink-700/40">Searching…</div>}
      {results.length === 0 && !loading ? (
        <div className="p-3 text-xs text-ink-700/60">
          {query.trim() ? <>No products match "{query}". Try a broader term or toggle "Also search descriptions".</> : 'Type to search the catalog.'}
        </div>
      ) : (
        results.map((p) => (
          <button
            key={p.id} type="button"
            onMouseEnter={() => setHoverId(p.id)}
            onClick={() => onPick(p)}
            className={`w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-cream/60 border-b border-black/5 last:border-b-0 ${selectedSet.has(p.id) ? 'bg-bronze-600/10' : ''}`}>
            {selectedIds.length > 0 && <input type="checkbox" readOnly checked={selectedSet.has(p.id)} />}
            {p.image_url
              ? <img src={p.image_url} alt="" className="w-8 h-8 rounded object-cover flex-shrink-0" loading="lazy" />
              : <div className="w-8 h-8 rounded bg-cream flex-shrink-0" />}
            <span className="flex-1 truncate">{p.title}</span>
            {showPrice && p.price_usd != null && <span className="text-ink-700/60 ml-2">${Number(p.price_usd).toFixed(2)}</span>}
          </button>
        ))
      )}
      {results.length === 100 && totalCount != null && totalCount > 100 && (
        <div className="p-2 text-center text-[10px] text-ink-700/50 border-t border-black/5 bg-cream/30 sticky bottom-0">
          Showing 100 of {totalCount.toLocaleString()} matches. Refine search to narrow.
        </div>
      )}
    </div>
  );

  return (
    <div className={compact ? '' : 'flex gap-3 items-stretch'}>
      <div className="flex-1 min-w-0 space-y-1.5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className={inputCls}
          autoFocus
        />
        <label className="flex items-center gap-1.5 text-[11px] text-ink-700/70 cursor-pointer select-none">
          <input type="checkbox" checked={searchDescriptions} onChange={(e) => setSearchDescriptions(e.target.checked)} />
          Also search descriptions (slower, fuller)
        </label>
        {list}
      </div>
      {!compact && (
        <div className="w-32 flex-shrink-0 border border-black/15 rounded-md overflow-hidden bg-cream/40 flex items-center justify-center">
          {previewProduct?.image_url ? (
            <div className="w-full">
              <img src={previewProduct.image_url} alt={previewProduct.title} className="w-full h-28 object-cover" />
              <div className="p-1.5 text-[10px] text-ink-700/70 truncate" title={previewProduct.title}>{previewProduct.title}</div>
            </div>
          ) : (
            <div className="text-[10px] text-ink-700/40 p-2 text-center">Hover an item<br />to preview</div>
          )}
        </div>
      )}
    </div>
  );
}
