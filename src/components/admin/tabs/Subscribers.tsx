import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { Card, Modal, btnGhost, btnDanger, btnPrimary, inputCls, labelCls, Toast } from '../ui';

type Sub = { id: string; email: string; source: string | null; created_at: string };

export default function Subscribers() {
  const [rows, setRows] = useState<Sub[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Sub | 'new' | null>(null);

  useEffect(() => { load(); }, []);
  async function load() {
    setLoading(true);
    const { data } = await supabase.from('subscribers').select('*').order('created_at', { ascending: false }).limit(2000);
    setRows((data ?? []) as Sub[]); setLoading(false);
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter((r) => r.email.toLowerCase().includes(q) || (r.source || '').toLowerCase().includes(q));
  }, [rows, search]);

  async function del(s: Sub) {
    if (!confirm(`Delete subscriber ${s.email}? This cannot be undone.`)) return;
    await supabase.from('subscribers').delete().eq('id', s.id);
    load();
  }

  function exportCsv() {
    const head = 'email,source,signed_up\n';
    const body = filtered.map((r) => [r.email, r.source || '', r.created_at].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([head + body], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `subscribers-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by email or source…" className={inputCls + ' max-w-xs'} />
          <span className="text-sm text-ink-700/60">{filtered.length} of {rows.length}</span>
          <div className="ml-auto flex gap-2">
            <button className={btnGhost} onClick={exportCsv}>Export CSV</button>
            <button className={btnPrimary} onClick={() => setOpen('new')}>+ Add subscriber</button>
          </div>
        </div>
      </Card>
      {loading ? <div className="text-sm text-ink-700/60">Loading…</div> : filtered.length === 0 ? (
        <Card><p className="text-sm text-ink-700/60">No subscribers match the current filters.</p></Card>
      ) : (
        <div className="bg-white border border-black/10 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-xs text-ink-700/60 text-left bg-cream/40">
              <tr><th className="p-2">Email</th><th className="p-2">Source</th><th className="p-2">Signed up</th><th className="p-2 text-right">Actions</th></tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-t border-black/5 hover:bg-cream/30">
                  <td className="p-2">{r.email}</td>
                  <td className="p-2 text-xs text-ink-700/60">{r.source || '—'}</td>
                  <td className="p-2 text-xs text-ink-700/60">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="p-2 text-right whitespace-nowrap">
                    <button className={btnGhost} onClick={() => setOpen(r)}>Edit</button>
                    <button className={btnDanger + ' ml-1'} onClick={() => del(r)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!open} onClose={() => setOpen(null)} title={open === 'new' ? 'Add subscriber' : (open ? 'Edit subscriber' : '')}>
        {open && <SubForm s={open === 'new' ? null : (open as Sub)} onDone={() => { setOpen(null); load(); }} />}
      </Modal>
    </div>
  );
}

function SubForm({ s, onDone }: { s: Sub | null; onDone: () => void }) {
  const [email, setEmail] = useState(s?.email || '');
  const [source, setSource] = useState(s?.source || 'admin');
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'info'; text: string }>({ kind: 'info', text: '' });
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setMsg({ kind: 'error', text: 'Please enter a valid email.' }); return; }
    setBusy(true);
    const payload = { email: email.toLowerCase().trim(), source: source || null };
    const { error } = s
      ? await supabase.from('subscribers').update(payload).eq('id', s.id)
      : await supabase.from('subscribers').upsert(payload, { onConflict: 'email' });
    setBusy(false);
    if (error) { setMsg({ kind: 'error', text: error.message }); return; }
    setMsg({ kind: 'success', text: '✓ Saved' });
    setTimeout(onDone, 500);
  }

  return (
    <div className="space-y-3">
      <div>
        <label className={labelCls}>Email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
      </div>
      <div>
        <label className={labelCls}>Source <span className="text-ink-700/40">(internal tag)</span></label>
        <input value={source} onChange={(e) => setSource(e.target.value)} className={inputCls} placeholder="free-pack, membership, manual, …" />
      </div>
      <div className="flex items-center gap-3 border-t border-black/10 pt-3">
        <button disabled={busy} onClick={save} className={btnPrimary}>{busy ? 'Saving…' : (s ? 'Save changes' : 'Add subscriber')}</button>
        <Toast message={msg.text} kind={msg.kind} />
      </div>
    </div>
  );
}
