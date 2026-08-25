import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { Card, Modal, btnGhost, btnDanger, btnPrimary, inputCls, labelCls, Toast } from '../ui';
import { useLiveRefresh } from '../useLiveRefresh';

type Sub = { id: string; email: string; source: string | null; created_at: string };

export default function Subscribers() {
  const [rows, setRows] = useState<Sub[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Sub | 'new' | null>(null);

  useEffect(() => { load(); }, []);
  useLiveRefresh(() => load(true), 30000);   // keep this tab live (silent, pauses while editing)
  async function load(silent = false) {
    if (!silent) setLoading(true);
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
      <PortalGuideSender subscribers={rows} />
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
        <div className="bg-white border border-black/10 rounded-lg overflow-x-auto">
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

// ── Send the "How your portal works" PDF to anyone who needs help ──────
// Single customer, a pasted list, or one-click groups (buyers / subscribers).
function PortalGuideSender({ subscribers }: { subscribers: Sub[] }) {
  const [recipients, setRecipients] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState('');
  const [results, setResults] = useState<{ email: string; ok: boolean; error?: string }[] | null>(null);

  const addEmails = (list: string[]) => {
    const valid = list.map((e) => e.toLowerCase().trim()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
    setRecipients((r) => [...new Set([...r, ...valid])]);
  };
  const suggestions = input.trim().length >= 2
    ? subscribers.filter((s) => s.email.toLowerCase().includes(input.toLowerCase()) && !recipients.includes(s.email.toLowerCase())).slice(0, 6)
    : [];

  async function addBuyers() {
    setBusy('buyers');
    // paid orders above $1 (the $1 orders are the owner's tests)
    const { data } = await supabase.from('orders').select('email,total').eq('status', 'paid').is('deleted_at', null).gt('total', 1).limit(2000);
    addEmails([...new Set((data || []).map((o: any) => String(o.email || '')))].filter((e) => e && !e.includes('unknown@')));
    setBusy('');
  }

  async function call(body: any) {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch('/api/admin/send-portal-guide', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${session?.access_token}` }, body: JSON.stringify(body) });
    return res.json();
  }
  async function doPreview() {
    setBusy('preview');
    try {
      const j = await call({ preview: true });
      if (j.ok) { const url = URL.createObjectURL(new Blob([j.html], { type: 'text/html' })); window.open(url, '_blank'); setTimeout(() => URL.revokeObjectURL(url), 60000); }
      else alert(j.error || 'preview failed');
    } catch (e: any) { alert(String(e?.message || e)); }
    setBusy('');
  }
  async function doSend(test = false) {
    if (!test && recipients.length === 0) { alert('Add at least one recipient first.'); return; }
    if (!test && recipients.length > 20 && !confirm(`Send the portal guide to ${recipients.length} people?`)) return;
    setBusy(test ? 'test' : 'send');
    setResults(null);
    try {
      const j = await call(test ? { test: true } : { emails: recipients });
      setResults(j.results || []);
      if (!test && j.ok) setRecipients((r) => r.filter((e) => !(j.results || []).some((x: any) => x.email === e && x.ok)));
    } catch (e: any) { alert(String(e?.message || e)); }
    setBusy('');
  }

  return (
    <Card title="📖 Send the portal guide (help a customer)">
      <p className="text-xs text-ink-700/60 mb-3">
        Emails the branded <strong>"How Your Portal Works"</strong> PDF (sign-in steps with pictures, lifetime re-downloads, points, referral link) to whoever needs it. Type any email, pick a subscriber from the suggestions, or add a whole group. Each address gets it at most once per day, and buyer order-emails always keep priority over big sends.
      </p>
      <div className="flex flex-wrap gap-2 items-start">
        <div className="relative">
          <input value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { addEmails(input.split(/[\s,;]+/)); setInput(''); } }}
            placeholder="Type an email (or search subscribers)…" className={inputCls + ' w-72'} />
          {suggestions.length > 0 && (
            <div className="absolute z-20 mt-1 w-72 bg-white border border-black/10 rounded-md shadow-lg">
              {suggestions.map((s) => (
                <button key={s.id} className="block w-full text-left px-3 py-1.5 text-sm hover:bg-cream/60"
                  onClick={() => { addEmails([s.email]); setInput(''); }}>{s.email}</button>
              ))}
            </div>
          )}
        </div>
        <button className={btnGhost} onClick={() => { addEmails(input.split(/[\s,;]+/)); setInput(''); }}>+ Add</button>
        <button className={btnGhost} disabled={busy === 'buyers'} onClick={addBuyers}>{busy === 'buyers' ? 'Loading…' : '+ All buyers'}</button>
        <button className={btnGhost} onClick={() => addEmails(subscribers.map((s) => s.email))}>+ All subscribers ({subscribers.length})</button>
        {recipients.length > 0 && <button className={btnGhost} onClick={() => setRecipients([])}>Clear</button>}
      </div>
      {recipients.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {recipients.slice(0, 40).map((e) => (
            <span key={e} className="inline-flex items-center gap-1 text-xs bg-cream border border-bronze-600/20 rounded-full px-2.5 py-1">
              {e}
              <button className="text-ink-700/50 hover:text-red-600" onClick={() => setRecipients((r) => r.filter((x) => x !== e))}>✕</button>
            </span>
          ))}
          {recipients.length > 40 && <span className="text-xs text-ink-700/60 self-center">+{recipients.length - 40} more</span>}
        </div>
      )}
      <div className="flex flex-wrap gap-2 mt-3">
        <button className={btnPrimary} disabled={!!busy || recipients.length === 0} onClick={() => doSend(false)}>
          {busy === 'send' ? 'Sending…' : `📧 Send guide${recipients.length ? ` to ${recipients.length}` : ''}`}
        </button>
        <button className={btnGhost} disabled={!!busy} onClick={doPreview}>{busy === 'preview' ? 'Building…' : '👁 Preview'}</button>
        <button className={btnGhost} disabled={!!busy} onClick={() => doSend(true)} title="Sends the exact email (with the PDF) to your own inbox">{busy === 'test' ? 'Sending…' : 'Send test to me'}</button>
      </div>
      {results && (
        <div className="mt-3 text-xs space-y-0.5">
          {results.map((r) => (
            <div key={r.email} className={r.ok ? 'text-green-700' : 'text-red-700'}>{r.ok ? '✓' : '✗'} {r.email}{r.error ? ` · ${r.error}` : ''}</div>
          ))}
        </div>
      )}
    </Card>
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
