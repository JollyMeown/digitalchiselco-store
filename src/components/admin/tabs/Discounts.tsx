// Discounts tab — three concerns under one roof:
//  1) Sales       — Etsy-style time-bounded auto-discount (no code required)
//  2) Promo Codes — customer enters at checkout (item-count/total minimum)
//  3) Announcement strip on the homepage
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { Card, Modal, btnGhost, btnDanger, btnPrimary, inputCls, labelCls, Toast } from '../ui';
import ProductSearchPicker, { type PickerProduct } from '../ProductSearchPicker';

type Sale = { id: string; name: string; percent_off: number; starts_at: string; expires_at: string; active: boolean; scope: string; scope_ids: string[] | null; terms: string | null };
type Category = { id: string; name: string; slug: string };
type Coupon = {
  id: string; code: string; description: string | null; active: boolean;
  percent_off: number | null; fixed_amount_off: number | null;
  min_items: number | null; min_subtotal: number | null;
  max_redemptions: number | null; redemption_count: number;
  single_use_per_buyer: boolean;
  starts_at: string | null; expires_at: string | null;
  scope: string; scope_ids: string[] | null;
};

const today = () => new Date().toISOString().slice(0, 10);
const isoDate = (s: string | null) => s ? new Date(s).toISOString().slice(0, 10) : '';
const toIsoStart = (s: string) => s ? new Date(s + 'T00:00:00').toISOString() : new Date().toISOString();
const toIsoEnd = (s: string) => s ? new Date(s + 'T23:59:59').toISOString() : new Date(Date.now() + 30 * 86400000).toISOString();

export default function Discounts() {
  const [view, setView] = useState<'announcement' | 'sales' | 'codes'>('announcement');

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-black/10 -mt-1">
        {([['announcement', '📢 Announcement strip'], ['sales', '🏷️ Sales'], ['codes', '🎟️ Promo codes']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setView(k)}
            className={`px-4 py-2 text-sm border-b-2 -mb-px transition ${view === k ? 'border-bronze-600 text-bronze-700 font-medium' : 'border-transparent text-ink-700 hover:text-bronze-700'}`}>
            {label}
          </button>
        ))}
      </div>
      {view === 'announcement' && <Announcement />}
      {view === 'sales' && <Sales />}
      {view === 'codes' && <Codes />}
    </div>
  );
}

// ─── Announcement strip ─────────────────────────────────────────────────────
function Announcement() {
  const [s, setS] = useState<any>(null);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'info'; text: string }>({ kind: 'info', text: '' });
  useEffect(() => { supabase.from('site_settings').select('announcement_active,announcement_text,announcement_link,announcement_cta_label,announcement_font_size,announcement_speed_seconds,cart_promos_active').eq('id', 1).maybeSingle().then(({ data }) => setS(data)); }, []);
  if (!s) return <div className="text-sm text-ink-700/60">Loading…</div>;
  const fontPx = Math.min(20, Math.max(10, Number(s.announcement_font_size) || 13));
  const speed = Math.min(120, Math.max(10, Number(s.announcement_speed_seconds) || 35));
  async function save() {
    setMsg({ kind: 'info', text: 'Saving…' });
    const { error } = await supabase.from('site_settings').update({
      announcement_active: !!s.announcement_active,
      announcement_text: s.announcement_text || null,
      announcement_link: s.announcement_link || null,
      announcement_cta_label: s.announcement_cta_label || null,
      announcement_font_size: fontPx,
      announcement_speed_seconds: speed,
      cart_promos_active: !!s.cart_promos_active,
    }).eq('id', 1);
    setMsg(error ? { kind: 'error', text: 'Error: ' + error.message } : { kind: 'success', text: '✓ Saved. Live on all pages now.' });
  }
  // Live preview line (mimics the storefront's flatten)
  const previewLine = (s.announcement_text || '').replace(/\s*\n+\s*/g, ' · ').trim();
  return (
    <Card title="Homepage announcement strip">
      <p className="text-xs text-ink-700/60 mb-3">A thin one-liner shown at the very top of every page. Line breaks in the text are flattened into "·" separators. The strip slowly scrolls — hover to pause.</p>
      <label className="flex items-center gap-2 text-sm mb-2">
        <input type="checkbox" checked={!!s.announcement_active} onChange={(e) => setS({ ...s, announcement_active: e.target.checked })} />
        Active (show the scrolling strip on all pages)
      </label>
      <label className="flex items-center gap-2 text-sm mb-3">
        <input type="checkbox" checked={s.cart_promos_active !== false} onChange={(e) => setS({ ...s, cart_promos_active: e.target.checked })} />
        🛒 Show the bulk-discount promo codes on the cart page
      </label>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-3">
          <div>
            <label className={labelCls}>Message <span className="text-ink-700/40">(line breaks become "·" separators)</span></label>
            <textarea
              value={s.announcement_text || ''}
              onChange={(e) => setS({ ...s, announcement_text: e.target.value })}
              rows={5}
              placeholder={`✨ Wild Bulk Discount is LIVE!\n☑ 6 items → 15% OFF · 2026OFF15\n☑ 10 items → 20% OFF · 2026OFF20\n☑ 25 items → 35% OFF · 2026OFF35`}
              className={inputCls + ' font-mono text-xs'}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Font size: <span className="font-mono text-bronze-700">{fontPx}px</span></label>
              <input type="range" min="10" max="20" value={fontPx}
                onChange={(e) => setS({ ...s, announcement_font_size: Number(e.target.value) })}
                className="w-full accent-bronze-600" />
              <div className="text-[10px] text-ink-700/50 flex justify-between"><span>10</span><span>20</span></div>
            </div>
            <div>
              <label className={labelCls}>Scroll speed: <span className="font-mono text-bronze-700">{speed}s / loop</span></label>
              <input type="range" min="10" max="120" value={speed}
                onChange={(e) => setS({ ...s, announcement_speed_seconds: Number(e.target.value) })}
                className="w-full accent-bronze-600" />
              <div className="text-[10px] text-ink-700/50 flex justify-between"><span>fast</span><span>slow</span></div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>CTA label <span className="text-ink-700/40">(optional link)</span></label>
              <input value={s.announcement_cta_label || ''} onChange={(e) => setS({ ...s, announcement_cta_label: e.target.value })} placeholder="Shop the catalog" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>CTA link</label>
              <input value={s.announcement_link || ''} onChange={(e) => setS({ ...s, announcement_link: e.target.value })} placeholder="/catalog" className={inputCls} />
            </div>
          </div>
        </div>
        <div>
          <div className={labelCls}>Live preview</div>
          <div className="border border-black/10 rounded-lg overflow-hidden bg-white">
            <div className="bg-[#2b1d10] text-[#FAEEDA] overflow-hidden py-1.5" style={{ fontSize: fontPx + 'px' }}>
              <div className="whitespace-nowrap" style={{ animation: `dcc-ann-preview ${speed}s linear infinite` }}>
                <span className="font-medium tracking-wide">{previewLine || '— empty —'}</span>
                {s.announcement_cta_label && <a className="ml-6 text-[#FAC775] underline">{s.announcement_cta_label} →</a>}
                <span className="ml-6 text-[#FAC775] opacity-60">★</span>
                <span className="ml-6 font-medium tracking-wide">{previewLine || '— empty —'}</span>
                {s.announcement_cta_label && <a className="ml-6 text-[#FAC775] underline">{s.announcement_cta_label} →</a>}
              </div>
            </div>
            <div className="px-3 py-3 bg-cream/30 text-xs text-ink-700/70">
              Hover the live strip on the storefront to pause it. Customers on devices with "reduced motion" enabled see a stationary version automatically.
            </div>
          </div>
          <style>{`@keyframes dcc-ann-preview { from { transform: translateX(0); } to { transform: translateX(-50%); } }`}</style>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3 border-t border-black/10 pt-4">
        <button className={btnPrimary} onClick={save}>Save announcement</button>
        <Toast message={msg.text} kind={msg.kind} />
      </div>
    </Card>
  );
}

// ─── Sales ──────────────────────────────────────────────────────────────────
function Sales() {
  const [rows, setRows] = useState<Sale[]>([]);
  const [open, setOpen] = useState<Sale | 'new' | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { load(); }, []);
  async function load() {
    setLoading(true);
    const { data } = await supabase.from('sales').select('*').order('starts_at', { ascending: false });
    setRows((data ?? []) as any); setLoading(false);
  }
  async function del(s: Sale) { if (!confirm(`Delete sale "${s.name}"?`)) return; await supabase.from('sales').delete().eq('id', s.id); load(); }
  async function toggle(s: Sale) { await supabase.from('sales').update({ active: !s.active }).eq('id', s.id); load(); }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between">
          <p className="text-sm">Time-bounded auto-discounts. The percentage comes off every eligible product price; customers don't need a code.</p>
          <button onClick={() => setOpen('new')} className={btnPrimary}>+ New sale</button>
        </div>
      </Card>
      {loading ? <div className="text-sm text-ink-700/60">Loading…</div> : rows.length === 0 ? (
        <Card><p className="text-sm text-ink-700/60">No sales yet. Click "+ New sale" to schedule one.</p></Card>
      ) : (
        <div className="bg-white border border-black/10 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-ink-700/60 text-left bg-cream/40">
              <tr><th className="p-2">Name</th><th className="p-2">% off</th><th className="p-2">From</th><th className="p-2">To</th><th className="p-2">Scope</th><th className="p-2">Status</th><th className="p-2 text-right">Actions</th></tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const now = Date.now();
                const live = s.active && Date.parse(s.starts_at) <= now && now <= Date.parse(s.expires_at);
                return (
                  <tr key={s.id} className="border-t border-black/5">
                    <td className="p-2">{s.name}</td>
                    <td className="p-2">{s.percent_off}%</td>
                    <td className="p-2 text-xs">{isoDate(s.starts_at)}</td>
                    <td className="p-2 text-xs">{isoDate(s.expires_at)}</td>
                    <td className="p-2 text-xs text-ink-700/60">{s.scope}{s.scope_ids?.length ? ` · ${s.scope_ids.length} items` : ''}</td>
                    <td className="p-2"><span className={`text-xs px-2 py-0.5 rounded ${live ? 'bg-green-100 text-green-800' : s.active ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-700'}`}>{live ? 'live' : s.active ? 'scheduled' : 'inactive'}</span></td>
                    <td className="p-2 text-right whitespace-nowrap">
                      <button className={btnGhost} onClick={() => setOpen(s)}>Edit</button>
                      <button className={btnGhost + ' ml-1'} onClick={() => toggle(s)}>{s.active ? 'Pause' : 'Resume'}</button>
                      <button className={btnDanger + ' ml-1'} onClick={() => del(s)}>Delete</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={!!open} onClose={() => setOpen(null)} title={open === 'new' ? 'New sale' : (open ? `Edit: ${(open as Sale).name}` : '')} wide>
        {open && <SaleForm s={open === 'new' ? null : (open as Sale)} onDone={() => { setOpen(null); load(); }} />}
      </Modal>
    </div>
  );
}

// Shared "apply this discount to…" picker used by Sales and Promo Codes.
// Renders:
//   - radio: All listings | Specific categories | Specific products
//   - when "category": multi-checkbox list of categories
//   - when "product":  ProductSearchPicker + a removable picked-list
function ScopePicker({
  scope, setScope, scopeIds, setScopeIds,
}: {
  scope: 'all' | 'category' | 'product';
  setScope: (s: 'all' | 'category' | 'product') => void;
  scopeIds: string[];
  setScopeIds: (ids: string[]) => void;
}) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [pickedProducts, setPickedProducts] = useState<Record<string, PickerProduct>>({});

  useEffect(() => {
    supabase.from('categories').select('id,name,slug').order('name').then(({ data }) => setCategories((data ?? []) as any));
  }, []);

  // When editing an existing scope=product discount, fetch the picked product
  // details so they can be shown in the removable list.
  useEffect(() => {
    if (scope !== 'product' || scopeIds.length === 0) return;
    const missing = scopeIds.filter((id) => !pickedProducts[id]);
    if (missing.length === 0) return;
    supabase.from('products').select('id,title,slug,image_url,price_usd').in('id', missing).then(({ data }) => {
      const next = { ...pickedProducts };
      (data ?? []).forEach((p: any) => { next[p.id] = p; });
      setPickedProducts(next);
    });
  }, [scope, scopeIds]);

  function toggleProduct(p: PickerProduct) {
    if (scopeIds.includes(p.id)) setScopeIds(scopeIds.filter((id) => id !== p.id));
    else { setScopeIds([...scopeIds, p.id]); setPickedProducts({ ...pickedProducts, [p.id]: p }); }
  }
  function toggleCategory(id: string) {
    if (scopeIds.includes(id)) setScopeIds(scopeIds.filter((x) => x !== id));
    else setScopeIds([...scopeIds, id]);
  }

  return (
    <div>
      <div className={labelCls}>Apply to</div>
      <div className="flex gap-3 items-center flex-wrap text-sm">
        <label className="flex items-center gap-1.5"><input type="radio" checked={scope === 'all'} onChange={() => { setScope('all'); setScopeIds([]); }} /> All listings</label>
        <label className="flex items-center gap-1.5"><input type="radio" checked={scope === 'category'} onChange={() => { setScope('category'); setScopeIds([]); }} /> Specific categories</label>
        <label className="flex items-center gap-1.5"><input type="radio" checked={scope === 'product'} onChange={() => { setScope('product'); setScopeIds([]); }} /> Specific products</label>
      </div>

      {scope === 'category' && (
        <div className="mt-2 border border-black/10 rounded-md p-2 max-h-44 overflow-y-auto grid grid-cols-2 gap-1 text-xs">
          {categories.length === 0 ? <div className="text-ink-700/60 p-2">Loading…</div> : categories.map((c) => (
            <label key={c.id} className="flex items-center gap-1.5 cursor-pointer px-1 py-0.5 hover:bg-cream/40 rounded">
              <input type="checkbox" checked={scopeIds.includes(c.id)} onChange={() => toggleCategory(c.id)} />
              {c.name}
            </label>
          ))}
        </div>
      )}

      {scope === 'product' && (
        <div className="mt-2 space-y-2">
          {scopeIds.length > 0 && (
            <div className="border border-black/10 rounded-md max-h-32 overflow-y-auto">
              {scopeIds.map((id) => {
                const p = pickedProducts[id];
                return (
                  <div key={id} className="flex items-center gap-2 px-2 py-1.5 text-xs border-b border-black/5 last:border-b-0">
                    {p?.image_url ? <img src={p.image_url} alt="" className="w-7 h-7 rounded object-cover" /> : <div className="w-7 h-7 rounded bg-cream" />}
                    <span className="flex-1 truncate">{p?.title || id}</span>
                    <button type="button" className="text-red-600 hover:underline" onClick={() => setScopeIds(scopeIds.filter((x) => x !== id))}>Remove</button>
                  </div>
                );
              })}
            </div>
          )}
          <ProductSearchPicker
            selectedIds={scopeIds}
            onPick={toggleProduct}
            placeholder="Search products to add to scope…"
            compact
            showFilters
          />
        </div>
      )}
    </div>
  );
}

function SaleForm({ s, onDone }: { s: Sale | null; onDone: () => void }) {
  const [name, setName] = useState(s?.name || '');
  const [percent, setPercent] = useState<number | string>(s?.percent_off ?? 20);
  const [from, setFrom] = useState(s ? isoDate(s.starts_at) : today());
  const [to, setTo] = useState(s ? isoDate(s.expires_at) : new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10));
  const [terms, setTerms] = useState(s?.terms || '');
  const [active, setActive] = useState(s?.active ?? true);
  const [scope, setScope] = useState<'all' | 'category' | 'product'>((s?.scope as any) || 'all');
  const [scopeIds, setScopeIds] = useState<string[]>(s?.scope_ids || []);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'info'; text: string }>({ kind: 'info', text: '' });
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim()) { setMsg({ kind: 'error', text: 'Name required.' }); return; }
    const pct = Number(percent);
    if (!pct || pct < 1 || pct > 100) { setMsg({ kind: 'error', text: 'Percent off must be 1–100.' }); return; }
    if (scope !== 'all' && scopeIds.length === 0) { setMsg({ kind: 'error', text: `Pick at least one ${scope}.` }); return; }
    setBusy(true);
    const payload = {
      name: name.trim().toUpperCase().replace(/\s+/g, ''),
      percent_off: pct, starts_at: toIsoStart(from), expires_at: toIsoEnd(to),
      terms: terms || null, active,
      scope, scope_ids: scope === 'all' ? null : scopeIds,
    };
    const { error } = s
      ? await supabase.from('sales').update(payload).eq('id', s.id)
      : await supabase.from('sales').insert(payload);
    setBusy(false);
    if (error) { setMsg({ kind: 'error', text: error.message }); return; }
    setMsg({ kind: 'success', text: '✓ Saved' });
    setTimeout(onDone, 500);
  }

  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Sale name <span className="text-ink-700/40">(internal, no spaces)</span></label>
          <input value={name} onChange={(e) => setName(e.target.value.toUpperCase().replace(/\s+/g, ''))} placeholder="SUMMERSALE2026" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Percentage off</label>
          <input type="number" min="1" max="100" value={percent} onChange={(e) => setPercent(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Starts</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Ends</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
        </div>
      </div>
      <div>
        <label className={labelCls}>Terms (shown to buyer; optional)</label>
        <textarea value={terms} onChange={(e) => setTerms(e.target.value)} rows={3} className={inputCls} maxLength={500} placeholder="E.g. Discount applies to STL files only. Not combinable with promo codes." />
      </div>
      <ScopePicker scope={scope} setScope={setScope} scopeIds={scopeIds} setScopeIds={setScopeIds} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active</label>
      <div className="bg-cream/40 border border-bronze-600/20 rounded-md p-3 text-xs text-ink-700/70">
        Sales auto-apply at checkout to every eligible product in the chosen scope. For code-entry discounts with item-count or order-total minimums, use the <strong>Promo codes</strong> tab instead.
      </div>
      <div className="flex items-center gap-3 border-t border-black/10 pt-4">
        <button disabled={busy} onClick={save} className={btnPrimary}>{busy ? 'Saving…' : (s ? 'Save changes' : 'Create sale')}</button>
        <Toast message={msg.text} kind={msg.kind} />
      </div>
    </div>
  );
}

// ─── Promo Codes ────────────────────────────────────────────────────────────
function Codes() {
  const [rows, setRows] = useState<Coupon[]>([]);
  const [open, setOpen] = useState<Coupon | 'new' | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { load(); }, []);
  async function load() {
    setLoading(true);
    const { data } = await supabase.from('coupons').select('*').order('created_at', { ascending: false }).limit(500);
    setRows((data ?? []) as any); setLoading(false);
  }
  async function del(c: Coupon) { if (!confirm(`Delete code "${c.code}"?`)) return; await supabase.from('coupons').delete().eq('id', c.id); load(); }
  async function toggle(c: Coupon) { await supabase.from('coupons').update({ active: !c.active }).eq('id', c.id); load(); }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between">
          <p className="text-sm">Codes the customer enters at checkout. Configure minimums (item count or subtotal), expiry, and redemption limits.</p>
          <button onClick={() => setOpen('new')} className={btnPrimary}>+ New promo code</button>
        </div>
      </Card>
      {loading ? <div className="text-sm text-ink-700/60">Loading…</div> : rows.length === 0 ? (
        <Card><p className="text-sm text-ink-700/60">No promo codes yet.</p></Card>
      ) : (
        <div className="bg-white border border-black/10 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-ink-700/60 text-left bg-cream/40">
              <tr><th className="p-2">Code</th><th className="p-2">Discount</th><th className="p-2">Minimum</th><th className="p-2">Expires</th><th className="p-2">Uses</th><th className="p-2">Status</th><th className="p-2 text-right">Actions</th></tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-t border-black/5">
                  <td className="p-2 font-mono text-xs">{c.code}</td>
                  <td className="p-2">{c.percent_off ? `${c.percent_off}% off` : c.fixed_amount_off ? `$${c.fixed_amount_off} off` : '—'}</td>
                  <td className="p-2 text-xs text-ink-700/60">{c.min_items ? `${c.min_items}+ items` : c.min_subtotal ? `$${c.min_subtotal}+` : 'None'}</td>
                  <td className="p-2 text-xs">{c.expires_at ? isoDate(c.expires_at) : 'no end'}</td>
                  <td className="p-2 text-xs">{c.redemption_count}{c.max_redemptions ? ` / ${c.max_redemptions}` : ''}</td>
                  <td className="p-2"><span className={`text-xs px-2 py-0.5 rounded ${c.active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}`}>{c.active ? 'active' : 'inactive'}</span></td>
                  <td className="p-2 text-right whitespace-nowrap">
                    <button className={btnGhost} onClick={() => setOpen(c)}>Edit</button>
                    <button className={btnGhost + ' ml-1'} onClick={() => toggle(c)}>{c.active ? 'Pause' : 'Resume'}</button>
                    <button className={btnDanger + ' ml-1'} onClick={() => del(c)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={!!open} onClose={() => setOpen(null)} title={open === 'new' ? 'New promo code' : (open ? `Edit: ${(open as Coupon).code}` : '')} wide>
        {open && <CodeForm c={open === 'new' ? null : (open as Coupon)} onDone={() => { setOpen(null); load(); }} />}
      </Modal>
    </div>
  );
}

function CodeForm({ c, onDone }: { c: Coupon | null; onDone: () => void }) {
  const [code, setCode] = useState(c?.code || '');
  const [description, setDescription] = useState(c?.description || '');
  const [discountType, setDiscountType] = useState<'percent' | 'fixed'>(c?.fixed_amount_off ? 'fixed' : 'percent');
  const [percent, setPercent] = useState<number | string>(c?.percent_off ?? 15);
  const [fixed, setFixed] = useState<number | string>(c?.fixed_amount_off ?? '');
  const [minType, setMinType] = useState<'none' | 'items' | 'total'>(c?.min_items ? 'items' : c?.min_subtotal ? 'total' : 'none');
  const [minItems, setMinItems] = useState<number | string>(c?.min_items ?? 6);
  const [minTotal, setMinTotal] = useState<number | string>(c?.min_subtotal ?? '');
  const [from, setFrom] = useState(c?.starts_at ? isoDate(c.starts_at) : '');
  const [to, setTo] = useState(c?.expires_at ? isoDate(c.expires_at) : '');
  const [noEnd, setNoEnd] = useState(!c?.expires_at);
  const [limitType, setLimitType] = useState<'no' | 'total' | 'single'>(c?.single_use_per_buyer ? 'single' : c?.max_redemptions ? 'total' : 'no');
  const [maxRed, setMaxRed] = useState<number | string>(c?.max_redemptions ?? '');
  const [active, setActive] = useState(c?.active ?? true);
  const [scope, setScope] = useState<'all' | 'category' | 'product'>((c?.scope as any) || 'all');
  const [scopeIds, setScopeIds] = useState<string[]>(c?.scope_ids || []);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'info'; text: string }>({ kind: 'info', text: '' });
  const [busy, setBusy] = useState(false);

  async function save() {
    const cleanCode = code.trim().toUpperCase().replace(/\s+/g, '');
    if (!/^[A-Z0-9]{3,32}$/.test(cleanCode)) { setMsg({ kind: 'error', text: 'Code must be 3–32 letters/digits.' }); return; }
    if (scope !== 'all' && scopeIds.length === 0) { setMsg({ kind: 'error', text: `Pick at least one ${scope}.` }); return; }
    setBusy(true);
    const payload: any = {
      code: cleanCode,
      description: description || null,
      percent_off: discountType === 'percent' ? Number(percent) || null : null,
      fixed_amount_off: discountType === 'fixed' ? Number(fixed) || null : null,
      min_items: minType === 'items' ? Number(minItems) || null : null,
      min_subtotal: minType === 'total' ? Number(minTotal) || null : null,
      starts_at: from ? toIsoStart(from) : null,
      expires_at: noEnd ? null : (to ? toIsoEnd(to) : null),
      max_redemptions: limitType === 'total' ? Number(maxRed) || null : null,
      single_use_per_buyer: limitType === 'single',
      active,
      scope, scope_ids: scope === 'all' ? null : scopeIds,
    };
    const { error } = c
      ? await supabase.from('coupons').update(payload).eq('id', c.id)
      : await supabase.from('coupons').insert(payload);
    setBusy(false);
    if (error) { setMsg({ kind: 'error', text: error.message }); return; }
    setMsg({ kind: 'success', text: '✓ Saved' });
    setTimeout(onDone, 500);
  }

  return (
    <div className="space-y-4 text-sm">
      <div>
        <label className={labelCls}>Custom promo code</label>
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. 2026OFF15" className={inputCls + ' font-mono'} />
        <p className="text-xs text-ink-700/50 mt-1">3–32 letters or digits. Customers enter this at checkout.</p>
      </div>
      <div>
        <label className={labelCls}>Description (internal note)</label>
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Bulk 6+ items — 15% off" className={inputCls} />
      </div>

      <div>
        <div className={labelCls}>Discount amount</div>
        <div className="flex gap-3 items-center">
          <select value={discountType} onChange={(e) => setDiscountType(e.target.value as any)} className={inputCls + ' w-44'}>
            <option value="percent">Percentage off</option>
            <option value="fixed">Fixed amount off (USD)</option>
          </select>
          {discountType === 'percent'
            ? <div className="flex items-center gap-1"><input type="number" min="1" max="100" value={percent} onChange={(e) => setPercent(e.target.value)} className={inputCls + ' w-24'} /><span>%</span></div>
            : <div className="flex items-center gap-1"><span>$</span><input type="number" min="0" step="0.01" value={fixed} onChange={(e) => setFixed(e.target.value)} className={inputCls + ' w-24'} /></div>}
        </div>
      </div>

      <div>
        <div className={labelCls}>Order minimum</div>
        <div className="flex gap-3 items-center flex-wrap">
          <label className="flex items-center gap-2"><input type="radio" checked={minType === 'none'} onChange={() => setMinType('none')} /> None</label>
          <label className="flex items-center gap-2"><input type="radio" checked={minType === 'items'} onChange={() => setMinType('items')} /> Number of items</label>
          <label className="flex items-center gap-2"><input type="radio" checked={minType === 'total'} onChange={() => setMinType('total')} /> Order total ($)</label>
          {minType === 'items' && <input type="number" min="1" value={minItems} onChange={(e) => setMinItems(e.target.value)} className={inputCls + ' w-24 ml-2'} />}
          {minType === 'total' && <input type="number" min="0" step="0.01" value={minTotal} onChange={(e) => setMinTotal(e.target.value)} className={inputCls + ' w-32 ml-2'} />}
        </div>
      </div>

      <div>
        <div className={labelCls}>Duration</div>
        <div className="flex gap-3 items-center flex-wrap">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} disabled={noEnd && false} className={inputCls + ' w-44'} />
          <span className="text-ink-700/50">→</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} disabled={noEnd} className={inputCls + ' w-44'} />
          <label className="flex items-center gap-2"><input type="checkbox" checked={noEnd} onChange={(e) => setNoEnd(e.target.checked)} /> No end date</label>
        </div>
      </div>

      <div>
        <div className={labelCls}>Redemption limit</div>
        <div className="flex gap-3 items-center flex-wrap">
          <label className="flex items-center gap-2"><input type="radio" checked={limitType === 'no'} onChange={() => setLimitType('no')} /> No limit</label>
          <label className="flex items-center gap-2"><input type="radio" checked={limitType === 'total'} onChange={() => setLimitType('total')} /> Total uses</label>
          <label className="flex items-center gap-2"><input type="radio" checked={limitType === 'single'} onChange={() => setLimitType('single')} /> Single use per buyer</label>
          {limitType === 'total' && <input type="number" min="1" value={maxRed} onChange={(e) => setMaxRed(e.target.value)} className={inputCls + ' w-24 ml-2'} placeholder="e.g. 100" />}
        </div>
      </div>

      <ScopePicker scope={scope} setScope={setScope} scopeIds={scopeIds} setScopeIds={setScopeIds} />

      <label className="flex items-center gap-2"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active</label>

      <div className="flex items-center gap-3 border-t border-black/10 pt-4">
        <button disabled={busy} onClick={save} className={btnPrimary}>{busy ? 'Saving…' : (c ? 'Save changes' : 'Create code')}</button>
        <Toast message={msg.text} kind={msg.kind} />
      </div>
    </div>
  );
}
