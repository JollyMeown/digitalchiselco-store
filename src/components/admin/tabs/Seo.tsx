// SEO Review tab. Shows AI-generated copy staged in the proposed_* columns
// next to the current live copy. The admin edits if needed, then Approves
// (promotes proposed -> live) or Rejects. Generation happens offline via
// `npm run seo:generate`; this tab is the human review gate.
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { Card, Modal, btnGhost, btnPrimary, btnDanger, inputCls, labelCls } from '../ui';

type Row = {
  id: string; title: string; slug: string; image_url: string | null;
  description: string | null; seo_title: string | null; seo_description: string | null;
  seo_status: string; image_alt: string | null;
  proposed_title: string | null; proposed_seo_title: string | null;
  proposed_seo_description: string | null; proposed_body: string | null;
  proposed_alt_text: string | null; seo_keywords: string[] | null;
  seo_generated_at: string | null;
};

const STATUS_TABS = [
  { key: 'generated', label: 'Needs review' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
] as const;

const SELECT = 'id,title,slug,image_url,description,seo_title,seo_description,seo_status,image_alt,proposed_title,proposed_seo_title,proposed_seo_description,proposed_body,proposed_alt_text,seo_keywords,seo_generated_at';

export default function Seo() {
  const [status, setStatus] = useState<'generated' | 'approved' | 'rejected'>('generated');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [open, setOpen] = useState<Row | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkMsg, setBulkMsg] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => { load(); loadCounts(); setSelected(new Set()); }, [status]);

  function toggle(id: string) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAllOnPage() {
    setSelected((s) => {
      const allSel = rows.length > 0 && rows.every((r) => s.has(r.id));
      return allSel ? new Set() : new Set(rows.map((r) => r.id));
    });
  }

  async function approveSelected() {
    if (selected.size === 0) return;
    if (!confirm(`Approve and publish ${selected.size} product${selected.size === 1 ? '' : 's'}? Their titles, descriptions, and SEO meta go live.`)) return;
    setBulkBusy(true); setBulkMsg('Publishing…');
    const { data, error } = await supabase.rpc('approve_seo', { p_ids: Array.from(selected) });
    setBulkBusy(false);
    if (error) { setBulkMsg('Error: ' + error.message); return; }
    setBulkMsg(`✓ Published ${data}`); setSelected(new Set()); load(); loadCounts();
  }

  async function approveAll() {
    const n = counts['generated'] ?? rows.length;
    if (!confirm(`Approve and publish ALL ${n} products awaiting review? This goes live for every one of them. The original titles are backed up so you can revert.`)) return;
    setBulkBusy(true); setBulkMsg('Publishing all…');
    const { data, error } = await supabase.rpc('approve_seo', { p_ids: null });
    setBulkBusy(false);
    if (error) { setBulkMsg('Error: ' + error.message); return; }
    setBulkMsg(`✓ Published ${data}`); setSelected(new Set()); load(); loadCounts();
  }

  async function load() {
    setLoading(true);
    const all: Row[] = [];
    for (let from = 0; from < 4000; from += 1000) {
      const { data, error } = await supabase.from('products').select(SELECT)
        .eq('seo_status', status).order('seo_generated_at', { ascending: false }).range(from, from + 999);
      if (error) { console.error(error); break; }
      if (!data?.length) break;
      all.push(...(data as any));
      if (data.length < 1000) break;
    }
    setRows(all);
    setLoading(false);
  }
  async function loadCounts() {
    const out: Record<string, number> = {};
    await Promise.all(STATUS_TABS.map(async (t) => {
      const { count } = await supabase.from('products').select('*', { count: 'exact', head: true }).eq('seo_status', t.key);
      out[t.key] = count ?? 0;
    }));
    setCounts(out);
  }

  return (
    <div className="space-y-4">
      <Card>
        <p className="text-sm text-ink-700/80">
          AI-generated titles and descriptions land here for your review. Generate more from the terminal with
          {' '}<code className="bg-cream px-1.5 py-0.5 rounded text-xs">npm run seo:generate -- --limit 20</code>.
          Approving promotes the proposed copy live; the original title is backed up so you can always revert.
        </p>
      </Card>

      <div className="flex gap-2">
        {STATUS_TABS.map((t) => (
          <button key={t.key} onClick={() => setStatus(t.key)}
            className={`px-3 py-1.5 text-sm rounded-md border ${status === t.key ? 'bg-bronze-600 text-cream border-bronze-600' : 'border-black/15 hover:bg-cream'}`}>
            {t.label} <span className="opacity-70">({counts[t.key] ?? '…'})</span>
          </button>
        ))}
      </div>

      {status === 'generated' && rows.length > 0 && (
        <div className="sticky top-0 z-10 bg-cream/95 backdrop-blur border border-bronze-600/20 rounded-md px-3 py-2 flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={rows.length > 0 && rows.every((r) => selected.has(r.id))} onChange={toggleAllOnPage} />
            Select all ({rows.length})
          </label>
          <span className="text-ink-700/60">·</span>
          <span className="text-ink-700/70">{selected.size} selected</span>
          <button className={btnPrimary} disabled={bulkBusy || selected.size === 0} onClick={approveSelected}>✓ Approve selected ({selected.size})</button>
          <button className={btnGhost} disabled={bulkBusy} onClick={approveAll}>✓ Approve ALL {counts['generated'] ?? ''}</button>
          {selected.size > 0 && <button className={btnGhost} disabled={bulkBusy} onClick={() => setSelected(new Set())}>Clear</button>}
          <span className={'ml-auto text-xs ' + (bulkMsg.startsWith('✓') ? 'text-green-700' : bulkMsg.startsWith('Error') ? 'text-red-600' : 'text-ink-700/60')}>{bulkMsg}</span>
        </div>
      )}

      {loading ? <div className="text-sm text-ink-700/60">Loading…</div> : rows.length === 0 ? (
        <Card><div className="text-center py-8 text-ink-700/60 text-sm">Nothing here. {status === 'generated' && 'Run npm run seo:generate to stage some copy.'}</div></Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {rows.map((r) => (
            <div key={r.id} className={`bg-white border rounded-lg overflow-hidden ${selected.has(r.id) ? 'border-bronze-600 ring-1 ring-bronze-600' : 'border-black/10'}`}>
              <div className="h-28 bg-cream relative">
                {r.image_url && <img src={r.image_url} className="w-full h-full object-cover" />}
                {status === 'generated' && (
                  <label className="absolute top-2 left-2 bg-white/90 rounded px-1.5 py-1 flex items-center cursor-pointer shadow-sm">
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                  </label>
                )}
              </div>
              <div className="p-3">
                <div className="font-medium text-sm text-ink-800 line-clamp-2 min-h-[2.5em]">{r.proposed_title || r.title}</div>
                <div className="text-xs text-ink-700/50 mt-1 font-mono truncate">{r.slug}</div>
                <button className={btnPrimary + ' mt-2 w-full justify-center'} onClick={() => setOpen(r)}>Review</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {open && (
        <ReviewModal row={open} onClose={() => setOpen(null)} onDone={() => { setOpen(null); load(); loadCounts(); }} />
      )}
    </div>
  );
}

function Field({ label, current, proposed, onChange, textarea, rows }: any) {
  return (
    <div className="grid md:grid-cols-2 gap-3 border-t border-black/10 pt-3">
      <div>
        <label className={labelCls}>{label} <span className="text-ink-700/40">— current</span></label>
        <div className="text-sm text-ink-700/70 bg-cream/40 rounded p-2 whitespace-pre-wrap min-h-[2.5em]">{current || <em className="text-ink-700/40">(empty)</em>}</div>
      </div>
      <div>
        <label className={labelCls}>{label} <span className="text-green-700">— proposed (editable)</span></label>
        {textarea
          ? <textarea value={proposed || ''} onChange={(e) => onChange(e.target.value)} rows={rows || 6} className={inputCls} />
          : <input value={proposed || ''} onChange={(e) => onChange(e.target.value)} className={inputCls} />}
      </div>
    </div>
  );
}

function ReviewModal({ row, onClose, onDone }: { row: Row; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({
    proposed_title: row.proposed_title || '',
    proposed_seo_title: row.proposed_seo_title || '',
    proposed_seo_description: row.proposed_seo_description || '',
    proposed_body: row.proposed_body || '',
    proposed_alt_text: row.proposed_alt_text || '',
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));

  // Warn if an em-dash slipped through editing.
  const hasDash = useMemo(() => /[—–]/.test(Object.values(f).join(' ')), [f]);

  async function saveProposed() {
    setBusy(true); setMsg('Saving…');
    const { error } = await supabase.from('products').update({
      proposed_title: f.proposed_title, proposed_seo_title: f.proposed_seo_title,
      proposed_seo_description: f.proposed_seo_description, proposed_body: f.proposed_body,
      proposed_alt_text: f.proposed_alt_text,
    }).eq('id', row.id);
    setBusy(false);
    setMsg(error ? 'Error: ' + error.message : '✓ Saved proposal');
  }

  async function approve() {
    if (row.seo_status !== 'approved' && !confirm('Approve and publish this copy live? The product title, description, and SEO meta will be updated.')) return;
    setBusy(true); setMsg('Publishing…');
    const { error } = await supabase.from('products').update({
      // promote proposed -> live
      title: f.proposed_title || row.title,
      description: f.proposed_body || row.description,
      seo_title: f.proposed_seo_title || null,
      seo_description: f.proposed_seo_description || null,
      image_alt: f.proposed_alt_text || null,
      // keep the edited proposals in sync
      proposed_title: f.proposed_title, proposed_seo_title: f.proposed_seo_title,
      proposed_seo_description: f.proposed_seo_description, proposed_body: f.proposed_body,
      proposed_alt_text: f.proposed_alt_text,
      seo_status: 'approved', seo_reviewed_at: new Date().toISOString(),
    }).eq('id', row.id);
    setBusy(false);
    if (error) { setMsg('Error: ' + error.message); return; }
    setMsg('✓ Published'); setTimeout(onDone, 500);
  }

  async function reject() {
    setBusy(true);
    const { error } = await supabase.from('products').update({ seo_status: 'rejected', seo_reviewed_at: new Date().toISOString() }).eq('id', row.id);
    setBusy(false);
    if (error) { setMsg('Error: ' + error.message); return; }
    onDone();
  }

  return (
    <Modal open onClose={onClose} title={`Review SEO: ${(row.proposed_title || row.title).slice(0, 60)}`} wide>
      <div className="space-y-3">
        <div className="flex gap-3 items-start">
          {row.image_url && <img src={row.image_url} className="w-24 h-24 rounded object-cover flex-shrink-0" />}
          <div className="text-xs text-ink-700/60">
            <div className="font-mono">{row.slug}</div>
            <a href={`/product/${row.slug}`} target="_blank" className="text-bronze-600 underline">View live page ↗</a>
            {row.seo_generated_at && <div className="mt-1">Generated {new Date(row.seo_generated_at).toLocaleString()}</div>}
          </div>
        </div>

        <Field label="Display title (H1)" current={row.title} proposed={f.proposed_title} onChange={(v: string) => set('proposed_title', v)} />
        <Field label="SEO meta title" current={row.seo_title} proposed={f.proposed_seo_title} onChange={(v: string) => set('proposed_seo_title', v)} />
        <Field label="SEO meta description" current={row.seo_description} proposed={f.proposed_seo_description} onChange={(v: string) => set('proposed_seo_description', v)} textarea rows={3} />
        <Field label="Description" current={row.description} proposed={f.proposed_body} onChange={(v: string) => set('proposed_body', v)} textarea rows={10} />
        <Field label="Image alt text" current={row.image_alt} proposed={f.proposed_alt_text} onChange={(v: string) => set('proposed_alt_text', v)} />

        {row.seo_keywords && row.seo_keywords.length > 0 && (
          <div className="border-t border-black/10 pt-3">
            <label className={labelCls}>Keywords <span className="text-ink-700/40">(stored for SEO + Pinterest)</span></label>
            <div className="flex flex-wrap gap-1.5">
              {row.seo_keywords.map((k, i) => <span key={i} className="text-xs bg-cream px-2 py-0.5 rounded">{k}</span>)}
            </div>
          </div>
        )}

        {hasDash && <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">⚠ An em-dash or en-dash is present in the proposed copy. Replace it with a comma or period before approving.</div>}
      </div>

      <div className="mt-4 flex items-center gap-2 border-t border-black/10 pt-4 flex-wrap">
        <button className={btnPrimary} disabled={busy} onClick={approve}>{row.seo_status === 'approved' ? 'Re-publish edits' : '✓ Approve & publish'}</button>
        <button className={btnGhost} disabled={busy} onClick={saveProposed}>Save proposal (don't publish)</button>
        {row.seo_status !== 'rejected' && <button className={btnDanger} disabled={busy} onClick={reject}>Reject</button>}
        <span className={'text-xs ml-auto ' + (msg.startsWith('✓') ? 'text-green-700' : msg.startsWith('Error') ? 'text-red-600' : 'text-ink-700/60')}>{msg}</span>
      </div>
    </Modal>
  );
}
