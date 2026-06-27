// Customizable products admin. Phase 1: define which products require custom
// input at checkout, and what fields the customer must fill. Phase 2 (separate)
// wires the customer-facing form into product pages, cart, and orders.
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { Card, Modal, btnGhost, btnPrimary, btnDanger, inputCls, labelCls, Toast } from '../ui';
import ProductSearchPicker, { type PickerProduct } from '../ProductSearchPicker';

type CustomField = {
  id?: string;
  product_id?: string;
  label: string;
  field_key: string;
  field_type: 'text' | 'email' | 'date' | 'textarea' | 'file_url' | 'phone' | 'number';
  required: boolean;
  placeholder: string | null;
  help_text: string | null;
  max_length: number | null;
  sort_order: number;
};

type CustomizableProduct = {
  id: string;
  title: string;
  slug: string;
  image_url: string | null;
  active: boolean;
  product_custom_fields: CustomField[];
};

const FIELD_TYPES = [
  { value: 'text', label: 'Short text' },
  { value: 'textarea', label: 'Long text' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'date', label: 'Date' },
  { value: 'number', label: 'Number' },
  { value: 'file_url', label: 'File URL (Drive / Dropbox)' },
] as const;

const PRESETS: { label: string; field: Omit<CustomField, 'sort_order'> }[] = [
  { label: '+ Customer name', field: { label: 'Customer name', field_key: 'customer_name', field_type: 'text', required: true, placeholder: 'Full name', help_text: null, max_length: 80 } },
  { label: '+ Email',         field: { label: 'Email', field_key: 'email', field_type: 'email', required: true, placeholder: 'you@example.com', help_text: null, max_length: 120 } },
  { label: '+ Event date',    field: { label: 'Event date', field_key: 'event_date', field_type: 'date', required: false, placeholder: null, help_text: null, max_length: null } },
  { label: '+ Photo URL',     field: { label: 'Photo URL', field_key: 'photo_url', field_type: 'file_url', required: true, placeholder: 'https://drive.google.com/...', help_text: 'Upload to Google Drive / Dropbox / Imgur first, then paste the shareable URL here.', max_length: 500 } },
  { label: '+ Special notes', field: { label: 'Special notes', field_key: 'notes', field_type: 'textarea', required: false, placeholder: 'Anything special we should know?', help_text: null, max_length: 500 } },
];

function slugifyKey(s: string) {
  return (s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_').replace(/_+/g, '_').slice(0, 60) || 'field';
}

export default function Customized() {
  const [rows, setRows] = useState<CustomizableProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<CustomizableProduct | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'info'; text: string }>({ kind: 'info', text: '' });

  useEffect(() => { load(); }, []);
  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from('products')
      .select('id,title,slug,image_url,active,product_custom_fields(id,label,field_key,field_type,required,placeholder,help_text,max_length,sort_order)')
      .eq('is_customizable', true)
      .order('title');
    if (error) console.error(error);
    setRows((data ?? []) as any);
    setLoading(false);
  }

  async function mark(p: PickerProduct) {
    const { error } = await supabase.from('products').update({ is_customizable: true }).eq('id', p.id);
    if (error) { setMsg({ kind: 'error', text: error.message }); return; }
    setAddOpen(false);
    setMsg({ kind: 'success', text: `"${p.title.slice(0, 50)}" is now customizable. Configure its fields next.` });
    await load();
    const fresh = await fetchProduct(p.id);
    if (fresh) setEditing(fresh);
  }

  async function fetchProduct(id: string): Promise<CustomizableProduct | null> {
    const { data } = await supabase
      .from('products')
      .select('id,title,slug,image_url,active,product_custom_fields(id,label,field_key,field_type,required,placeholder,help_text,max_length,sort_order)')
      .eq('id', id).maybeSingle();
    return (data as any) || null;
  }

  async function unmark(p: CustomizableProduct) {
    if (!confirm(`Remove customization from "${p.title}"?\n\nAll ${p.product_custom_fields.length} field definition${p.product_custom_fields.length === 1 ? '' : 's'} will be deleted. The product itself stays in the catalog.`)) return;
    // FK cascade wipes fields when is_customizable goes false? No — flag is separate.
    // Explicitly wipe fields, then flip the flag.
    await supabase.from('product_custom_fields').delete().eq('product_id', p.id);
    const { error } = await supabase.from('products').update({ is_customizable: false }).eq('id', p.id);
    if (error) { setMsg({ kind: 'error', text: error.message }); return; }
    setMsg({ kind: 'success', text: `Customization removed from "${p.title.slice(0, 50)}"` });
    load();
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="text-sm text-ink-700/80 max-w-2xl">
            <p>Customizable products require the buyer to fill in extra fields (name, email, photo URL, etc.) before they can check out. Phase 1: define which products are customizable and what fields they need. Phase 2 (later) wires the form into the product page and checkout flow.</p>
          </div>
          <button className={btnPrimary} onClick={() => setAddOpen(true)}>+ Mark a product as customizable</button>
        </div>
      </Card>
      <Toast message={msg.text} kind={msg.kind} />

      {loading ? <div className="text-sm text-ink-700/60">Loading…</div> : rows.length === 0 ? (
        <Card>
          <div className="text-center py-8 text-ink-700/60 text-sm">No customizable products yet. Click <strong>+ Mark a product as customizable</strong> above to get started.</div>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {rows.map((p) => (
            <div key={p.id} className="bg-white border border-black/10 rounded-lg overflow-hidden">
              <div className="h-28 bg-cream flex items-center justify-center">
                {p.image_url ? <img src={p.image_url} className="w-full h-full object-cover" /> : <span className="text-bronze-600/40 font-serif text-xs">{p.title}</span>}
              </div>
              <div className="p-3">
                <div className="font-medium text-sm text-ink-800 line-clamp-2 min-h-[2.5em]">{p.title}</div>
                <div className="text-xs text-ink-700/60 mt-1">
                  {(p.product_custom_fields || []).length === 0
                    ? <span className="text-amber-700">⚠ no fields configured</span>
                    : <span className="text-green-700">{p.product_custom_fields.length} field{p.product_custom_fields.length === 1 ? '' : 's'} configured</span>}
                  {!p.active && <span className="ml-2 text-ink-700/40">· inactive</span>}
                </div>
                <div className="mt-3 flex gap-1 flex-wrap">
                  <button className={btnPrimary} onClick={() => setEditing(p)}>Edit fields</button>
                  <a href={`/product/${p.slug}`} target="_blank" className={btnGhost}>View ↗</a>
                  <button className={btnDanger} onClick={() => unmark(p)}>Remove</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Mark a product as customizable" wide>
        <div className="space-y-3">
          <p className="text-sm text-ink-700/70">Search the catalog for the product you want to mark customizable. Picking it flips its <code>is_customizable</code> flag and opens the field editor.</p>
          <ProductSearchPicker
            onPick={mark}
            placeholder="Search by title…"
            compact
            excludeBundles={false}
            showPrice
          />
        </div>
      </Modal>

      {editing && (
        <Modal open={!!editing} onClose={() => setEditing(null)} title={`Configure fields: ${editing.title.slice(0, 60)}`} wide>
          <FieldsEditor
            product={editing}
            onSaved={async () => {
              setMsg({ kind: 'success', text: '✓ Fields saved' });
              await load();
              const fresh = await fetchProduct(editing.id);
              if (fresh) setEditing(fresh);
            }}
            onClose={() => setEditing(null)}
          />
        </Modal>
      )}
    </div>
  );
}

function FieldsEditor({ product, onSaved, onClose }: { product: CustomizableProduct; onSaved: () => void; onClose: () => void }) {
  const [fields, setFields] = useState<CustomField[]>(() =>
    (product.product_custom_fields || [])
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  function addBlank() {
    setFields((arr) => [...arr, {
      label: '', field_key: '', field_type: 'text', required: false,
      placeholder: null, help_text: null, max_length: null, sort_order: arr.length,
    }]);
  }
  function addPreset(p: typeof PRESETS[number]) {
    setFields((arr) => {
      // Avoid duplicate field_key — append a numeric suffix if needed
      let key = p.field.field_key, n = 2;
      while (arr.some((f) => f.field_key === key)) key = `${p.field.field_key}_${n++}`;
      return [...arr, { ...p.field, field_key: key, sort_order: arr.length }];
    });
  }
  function update(i: number, patch: Partial<CustomField>) {
    setFields((arr) => arr.map((f, idx) => idx === i ? { ...f, ...patch } : f));
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= fields.length) return;
    setFields((arr) => {
      const next = arr.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next.map((f, idx) => ({ ...f, sort_order: idx }));
    });
  }
  function remove(i: number) {
    setFields((arr) => arr.filter((_, idx) => idx !== i).map((f, idx) => ({ ...f, sort_order: idx })));
  }

  async function save() {
    setErr('');
    // Validate
    for (const [i, f] of fields.entries()) {
      if (!f.label.trim()) { setErr(`Field #${i + 1}: label is required.`); return; }
      const key = f.field_key.trim() || slugifyKey(f.label);
      f.field_key = key;
    }
    const keys = fields.map((f) => f.field_key);
    if (new Set(keys).size !== keys.length) { setErr('Two fields share the same internal key. Rename one.'); return; }

    setBusy(true);
    // Wipe + re-insert. Simpler than diff. Cascade-deletes any old values too
    // when Phase 2 lands (we'll re-evaluate then).
    await supabase.from('product_custom_fields').delete().eq('product_id', product.id);
    if (fields.length) {
      const payload = fields.map((f, i) => ({
        product_id: product.id,
        label: f.label.trim(),
        field_key: f.field_key,
        field_type: f.field_type,
        required: !!f.required,
        placeholder: f.placeholder || null,
        help_text: f.help_text || null,
        max_length: f.field_type === 'text' || f.field_type === 'textarea' || f.field_type === 'file_url' ? (f.max_length || null) : null,
        sort_order: i,
      }));
      const { error } = await supabase.from('product_custom_fields').insert(payload);
      if (error) { setErr(error.message); setBusy(false); return; }
    }
    setBusy(false);
    onSaved();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5 text-xs">
        <span className="text-ink-700/60 mr-1 self-center">Quick presets:</span>
        {PRESETS.map((p) => (
          <button key={p.field.field_key} className={btnGhost} onClick={() => addPreset(p)}>{p.label}</button>
        ))}
      </div>

      {fields.length === 0 ? (
        <div className="text-center py-8 text-ink-700/60 text-sm border border-dashed border-black/15 rounded">
          No fields yet. Use a preset above or click <strong>+ Add custom field</strong> below.
        </div>
      ) : (
        <div className="space-y-3">
          {fields.map((f, i) => (
            <div key={i} className="border border-black/10 rounded-md p-3 bg-cream/30">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs text-ink-700/60 font-mono">#{i + 1}</span>
                <input value={f.label} onChange={(e) => update(i, { label: e.target.value, field_key: f.field_key || slugifyKey(e.target.value) })}
                  placeholder="Field label (what the customer sees)" className={inputCls + ' flex-1'} />
                <select value={f.field_type} onChange={(e) => update(i, { field_type: e.target.value as any })} className={inputCls + ' max-w-[180px]'}>
                  {FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                <label className="text-xs flex items-center gap-1 whitespace-nowrap">
                  <input type="checkbox" checked={f.required} onChange={(e) => update(i, { required: e.target.checked })} /> required
                </label>
                <button className="text-bronze-700 px-2" onClick={() => move(i, -1)} disabled={i === 0} title="Move up">↑</button>
                <button className="text-bronze-700 px-2" onClick={() => move(i, 1)} disabled={i === fields.length - 1} title="Move down">↓</button>
                <button className="text-red-600 px-2" onClick={() => remove(i)} title="Delete">✕</button>
              </div>
              <div className="grid sm:grid-cols-2 gap-2 mt-1">
                <input value={f.placeholder || ''} onChange={(e) => update(i, { placeholder: e.target.value })}
                  placeholder="Placeholder text (optional)" className={inputCls + ' text-xs'} />
                <input value={f.help_text || ''} onChange={(e) => update(i, { help_text: e.target.value })}
                  placeholder="Help text shown under the field (optional)" className={inputCls + ' text-xs'} />
                {(f.field_type === 'text' || f.field_type === 'textarea' || f.field_type === 'file_url') && (
                  <input type="number" min="1" value={f.max_length ?? ''} onChange={(e) => update(i, { max_length: e.target.value ? Number(e.target.value) : null })}
                    placeholder="Max length (optional)" className={inputCls + ' text-xs'} />
                )}
                <input value={f.field_key} onChange={(e) => update(i, { field_key: slugifyKey(e.target.value) })}
                  placeholder="Internal key (auto-filled from label)" className={inputCls + ' text-xs font-mono'} />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-between items-center pt-2 border-t border-black/10">
        <button className={btnGhost} onClick={addBlank}>+ Add custom field</button>
        <div className="flex items-center gap-3">
          {err && <span className="text-xs text-red-600">{err}</span>}
          <button className={btnGhost} onClick={onClose}>Cancel</button>
          <button className={btnPrimary} disabled={busy} onClick={save}>{busy ? 'Saving…' : `Save ${fields.length} field${fields.length === 1 ? '' : 's'}`}</button>
        </div>
      </div>
    </div>
  );
}
