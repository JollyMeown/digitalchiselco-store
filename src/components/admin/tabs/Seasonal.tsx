import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { Card, Modal, btnGhost, btnPrimary, btnDanger, inputCls, labelCls } from '../ui';
import { useLiveRefresh } from '../useLiveRefresh';

const blank = { slug: '', title: '', subtitle: '', keywords: '', hero_image_url: '', starts_at: '', ends_at: '', active: true, sort_order: 0 };

export default function Seasonal() {
  const [rows, setRows] = useState<any[]>([]);
  const [editing, setEditing] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => { load(); }, []);
  useLiveRefresh(() => load(true), 30000);   // keep this tab live (silent, pauses while editing)
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
        <div className="flex justify-between items-center gap-3 flex-wrap">
          <span className="text-sm text-ink-700/60">Seasonal landing pages at <code>/seasonal/&lt;slug&gt;</code>, filled from keyword matches, hidden outside their dates. The live one that ends soonest also fills the homepage "In season" row.</span>
          <button className={btnPrimary} onClick={() => setCreating(true)}>+ New collection</button>
        </div>
      </Card>

      {/* Owner asked (2026-09-15) for the keyword guidance to live on the page
          itself. The Halloween collection had 13 phrase keywords and matched
          nothing until the matcher was rewritten; this stops it happening again. */}
      <Card>
        <div className="text-xs font-medium text-bronze-800 uppercase tracking-wide mb-2">How to make a collection fill itself</div>
        <ul className="text-sm text-ink-800 space-y-1.5 list-disc pl-5">
          <li><b>Single subject words do the work.</b> <code>pumpkin, witch, skeleton, haunted, ghost, bat, reaper</code> each match every title that contains that word. A long phrase like <code>3D Halloween STL</code> is split into its subject words anyway, and words every design shares (STL, CNC, relief, wall art, wood) are ignored.</li>
          <li><b>A word that appears in a category name pulls in the whole category.</b> <code>halloween</code> brings every design filed under "Halloween Signs &amp; Decorations", <code>christmas</code> the whole Christmas collection, whatever their titles say.</li>
          <li><b>Check the count after saving.</b> Open Edit: the member list at the bottom is exactly what the public page will show, best sellers first. Zero members means no title or category carries any of your words.</li>
          <li><b>Curate by hand where the keywords are wrong.</b> Remove a design that matched by accident, or add one that did not match; both stick across future keyword changes.</li>
          <li><b>Watch the plurals and the near-misses.</b> <code>pumpkin</code> also matches "pumpkins"; <code>ghost</code> matches "ghosts"; but <code>tree</code> will not find "Xmas Trees" spelled differently, so add each spelling you use in titles.</li>
          <li><b>Dates do the tidying.</b> Set the end date and the page and the homepage row disappear by themselves; the next live collection takes the slot.</li>
        </ul>
      </Card>

      <div className="grid sm:grid-cols-2 gap-3">
        {rows.map((r) => (
          <div key={r.id} className={`border rounded-lg p-4 ${isLive(r) ? 'bg-white border-green-300' : 'bg-gray-50 border-gray-200'}`}>
            <div className="flex items-center gap-2">
              <span className="font-medium text-ink-800">{r.title}</span>
              {isLive(r) ? <span className="text-[10px] uppercase bg-green-100 text-green-800 px-1.5 py-0.5 rounded">Live</span>
                : <span className="text-[10px] uppercase bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded">{r.active ? 'Scheduled/ended' : 'Off'}</span>}
            </div>
            <div className="text-xs text-ink-700/60 mt-1">/seasonal/{r.slug} · {(r.keywords || []).length} keywords{(r.include_ids || []).length ? ` · ${(r.include_ids || []).length} added by hand` : ''}{(r.exclude_ids || []).length ? ` · ${(r.exclude_ids || []).length} removed` : ''}</div>
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
        <div><label className={labelCls}>Keywords (comma-separated; single subject words work best, see the tips above)</label>
          <input value={f.keywords} onChange={(e) => setF({ ...f, keywords: e.target.value })} className={inputCls} placeholder="pumpkin, witch, skeleton, haunted, ghost, bat, reaper, halloween" /></div>
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
      {existing && <Members col={existing} />}
    </Modal>
  );
}

// The member list: exactly what the public page renders, with remove and add.
// Removing writes exclude_ids; adding writes include_ids. Both are saved
// immediately, independent of the Save button above, and survive later
// keyword edits.
function Members({ col }: { col: any }) {
  const [members, setMembers] = useState<any[]>([]);
  const [words, setWords] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [include, setInclude] = useState<string[]>(Array.isArray(col.include_ids) ? col.include_ids : []);
  const [exclude, setExclude] = useState<string[]>(Array.isArray(col.exclude_ids) ? col.exclude_ids : []);

  async function auth() { const { data: { session } } = await supabase.auth.getSession(); return `Bearer ${session?.access_token || ''}`; }
  async function load() {
    setBusy(true);
    const r = await fetch(`/api/admin/seasonal-preview?id=${col.id}`, { headers: { authorization: await auth() } }).then((x) => x.json()).catch(() => ({}));
    setMembers(r.members || []); setWords(r.words || []); setBusy(false);
  }
  useEffect(() => { load(); }, [col.id]);

  async function persist(inc: string[], exc: string[]) {
    const { error } = await supabase.from('seasonal_collections').update({ include_ids: inc, exclude_ids: exc }).eq('id', col.id);
    if (error) alert('Could not save: ' + error.message);
    setInclude(inc); setExclude(exc);
    await load();
  }
  const removeOne = (id: string) => persist(include.filter((x) => x !== id), exclude.includes(id) ? exclude : [...exclude, id]);
  const addOne = (id: string) => persist(include.includes(id) ? include : [...include, id], exclude.filter((x) => x !== id));
  const restore = (id: string) => persist(include, exclude.filter((x) => x !== id));

  async function search(term: string) {
    setQ(term);
    if (term.trim().length < 2) { setResults([]); return; }
    const r = await fetch(`/api/admin/seasonal-preview?id=${col.id}&q=${encodeURIComponent(term.trim())}`, { headers: { authorization: await auth() } }).then((x) => x.json()).catch(() => ({}));
    setResults(r.results || []);
  }

  return (
    <div className="mt-5 border-t border-black/10 pt-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="text-sm font-medium text-ink-800">What this collection shows <span className="text-ink-700/50 font-normal">({members.length}{busy ? ', updating…' : ''})</span></div>
        <div className="text-[11px] text-ink-700/50">matching on: {words.length ? words.join(', ') : 'no usable words yet'}</div>
      </div>

      <div className="mt-2 flex gap-2">
        <input value={q} onChange={(e) => search(e.target.value)} className={inputCls} placeholder="Add a design by hand: type part of its title…" />
      </div>
      {results.length > 0 && (
        <div className="mt-1 border border-black/10 rounded-lg divide-y divide-black/5 max-h-56 overflow-y-auto bg-white">
          {results.map((p) => (
            <div key={p.id} className="flex items-center gap-2 px-2 py-1.5 text-xs">
              {p.image_url && <img src={p.image_url} className="w-8 h-8 rounded object-cover" alt="" />}
              <span className="flex-1 min-w-0 truncate">{String(p.title).split('|')[0].trim()}</span>
              <span className="text-ink-700/50">{p.etsy_sales_365 || 0} sold</span>
              {members.some((m) => m.id === p.id)
                ? <span className="text-green-700">already in</span>
                : <button className="text-bronze-700 underline" onClick={() => { addOne(p.id); setResults([]); setQ(''); }}>add</button>}
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-72 overflow-y-auto pr-1">
        {members.map((m) => (
          <div key={m.id} className="relative border border-black/10 rounded-lg overflow-hidden bg-white">
            {m.image_url ? <img src={m.image_url} className="w-full aspect-square object-cover" alt="" /> : <div className="w-full aspect-square bg-cream" />}
            <div className="p-1.5 text-[11px] leading-tight text-ink-800 line-clamp-2">{m.title}</div>
            <div className="px-1.5 pb-1.5 flex items-center justify-between text-[10px] text-ink-700/50">
              <span>{m.sales} sold{m.pinned ? ' · added by hand' : ''}</span>
              <button className="text-red-600 hover:underline" title="Leave this design out of the collection" onClick={() => removeOne(m.id)}>remove</button>
            </div>
          </div>
        ))}
        {!busy && !members.length && <p className="col-span-full text-xs text-ink-700/60">Nothing matches yet. Add subject words to the keywords (see the tips), or add designs by hand above.</p>}
      </div>

      {exclude.length > 0 && (
        <div className="mt-3 text-[11px] text-ink-700/60">
          Removed by hand: {exclude.length}.{' '}
          <button className="underline text-bronze-700" onClick={() => persist(include, [])}>Restore all</button>
        </div>
      )}
    </div>
  );
}
