// Custom-design pitch: paste the addresses of people who asked us to copy
// another shop's design, add a personal line, preview, test, send now (or hand
// them to the nightly drip). Below it: the inbox of /custom-design requests
// with status, quote and notes. The ledger guarantees nobody gets the pitch twice.
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Card, btnPrimary, btnGhost, inputCls } from './ui';

type LogRow = { email: string; sent_at: string; note: string | null; source: string | null };
type Req = { id: string; name: string | null; email: string; photo_url: string | null; description: string | null; size_note: string | null; material: string | null; deadline: string | null; status: string; quote_usd: number | null; admin_notes: string | null; created_at: string };
const STATUSES = ['new', 'quoted', 'paid', 'in_progress', 'delivered', 'declined'];
const STATUS_CLS: Record<string, string> = { new: 'bg-amber-100 text-amber-800', quoted: 'bg-blue-100 text-blue-800', paid: 'bg-green-100 text-green-800', in_progress: 'bg-purple-100 text-purple-800', delivered: 'bg-green-200 text-green-900', declined: 'bg-gray-200 text-gray-700' };

function parseLines(text: string): { email: string; name?: string | null }[] {
  const rows: { email: string; name?: string | null }[] = [];
  for (const raw of text.split(/\r?\n|,|;/)) {
    const line = raw.trim(); if (!line) continue;
    const m = line.match(/^(.*?)<\s*([^>\s]+@[^>\s]+)\s*>$/) || line.match(/^([^@\s]+@[^@\s]+\.[^@\s]+)\s+(.+)$/);
    if (m) { const a = m[1].includes('@') ? m[1] : m[2]; const n = m[1].includes('@') ? m[2] : m[1]; rows.push({ email: a.trim().toLowerCase(), name: n.replace(/["']/g, '').trim() || null }); }
    else if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(line)) rows.push({ email: line.toLowerCase() });
  }
  return rows;
}

export default function CustomPitch() {
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [log, setLog] = useState<LogRow[]>([]);
  const [reqs, setReqs] = useState<Req[]>([]);
  const [waiting, setWaiting] = useState(0);
  const [weekDesigns, setWeekDesigns] = useState(0);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [result, setResult] = useState<{ email: string; result: string }[]>([]);
  const [open, setOpen] = useState('');
  const [draft, setDraft] = useState<Record<string, Partial<Req>>>({});

  async function call(payload: any) {
    const { data: { session } } = await supabase.auth.getSession();
    return fetch('/api/admin/custom-pitch', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${session?.access_token}` }, body: JSON.stringify(payload) })
      .then((r) => r.json()).catch(() => ({ error: 'bad response' }));
  }
  async function load() { const r = await call({ action: 'list' }); if (r?.ok) { setLog(r.log); setReqs(r.requests); setWaiting(r.waiting); setWeekDesigns(r.weekDesigns); } }
  useEffect(() => { load(); }, []);

  const rows = parseLines(text);
  async function act(action: 'preview' | 'test' | 'send' | 'queue', dry = false) {
    setBusy(action); setMsg(''); setResult([]);
    const r = await call(action === 'preview' ? { action, name: rows[0]?.name || null, note } : action === 'test' ? { action, note } : { action, rows, note, dry });
    setBusy('');
    if (r?.error) { setMsg(r.error); return; }
    if (action === 'preview') {
      const url = URL.createObjectURL(new Blob([`<title>${r.subject}</title>` + r.html], { type: 'text/html' }));
      window.open(url, '_blank'); setTimeout(() => URL.revokeObjectURL(url), 60000);
      setMsg(`Preview opened. Subject: ${r.subject}`); return;
    }
    setMsg(r.message || 'Done.'); setResult(r.rows || []);
    if (action === 'send' && !dry) setText('');
    load();
  }
  const field = (q: Req, k: keyof Req) => (draft[q.id]?.[k] ?? q[k]) as any;
  async function saveReq(q: Req) {
    setBusy('req:' + q.id);
    const r = await call({ action: 'request_update', id: q.id, status: field(q, 'status'), quote_usd: field(q, 'quote_usd'), admin_notes: field(q, 'admin_notes') });
    setBusy(''); setMsg(r?.error || 'Request saved.');
    if (!r?.error) { setDraft((d) => { const c = { ...d }; delete c[q.id]; return c; }); load(); }
  }
  const fresh = reqs.filter((q) => q.status === 'new').length;

  return (
    <Card title="🖼 Custom-design pitch" subtitle={`For people who asked us to copy another shop's design: we say no to copies and offer an original from their own photo, from $30, with the /custom-design upload link. Page two lists this week's ${weekDesigns} new design${weekDesigns === 1 ? '' : 's'}. Nobody receives it twice.`}>
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-medium block mb-1">Addresses, one per line <span className="text-ink-700/50 font-normal">("Jane Doe &lt;jane@x.com&gt;" or "jane@x.com Jane" keeps the first name)</span></label>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} className={inputCls + ' font-mono text-xs'} placeholder={'buyer@example.com\nJohn Smith <john@example.com>'} />
          <div className="text-[11px] text-ink-700/60 mt-1">{rows.length} address{rows.length === 1 ? '' : 'es'} recognised</div>
        </div>
        <div>
          <label className="text-xs font-medium block mb-1">Personal line <span className="text-ink-700/50 font-normal">(optional, shown after the opening paragraph)</span></label>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className={inputCls} placeholder="e.g. The eagle you sent us is a lovely subject. If you have a photo of the bird or the pose you like, we can model our own version of it for you." />
          <div className="flex flex-wrap gap-2 mt-3">
            <button className={btnGhost} disabled={!!busy} onClick={() => act('preview')}>{busy === 'preview' ? '…' : '👁 Preview'}</button>
            <button className={btnGhost} disabled={!!busy} onClick={() => act('test')}>{busy === 'test' ? '…' : '✉ Test to me'}</button>
            <button className={btnGhost} disabled={!!busy || !rows.length} onClick={() => act('send', true)}>{busy === 'send' ? '…' : 'Dry run'}</button>
            <button className={btnPrimary} disabled={!!busy || !rows.length} onClick={() => { if (confirm(`Send the custom-design pitch now to ${rows.length} address(es)?`)) act('send'); }}>{busy === 'send' ? 'Sending…' : `Send now to ${rows.length}`}</button>
            <button className={btnGhost} disabled={!!busy || !rows.length} onClick={() => act('queue')} title="Adds them as subscribers (source custom-ask); the nightly drip sends the pitch when the toggle is on">{busy === 'queue' ? '…' : 'Add to drip instead'}</button>
          </div>
          {msg && <div className="text-xs mt-2 text-bronze-800">{msg}</div>}
          {result.length > 0 && <ul className="text-[11px] mt-1 space-y-0.5 max-h-28 overflow-auto">{result.map((r) => <li key={r.email}><span className="font-mono">{r.email}</span> · {r.result}</li>)}</ul>}
          <div className="text-[11px] text-ink-700/60 mt-2">{waiting} waiting in the drip queue · {log.length} sent so far</div>
        </div>
      </div>

      <details className="mt-4 text-xs">
        <summary className="cursor-pointer text-ink-700/70">Sent ledger ({log.length})</summary>
        <div className="overflow-x-auto mt-2 max-h-56 overflow-y-auto">
          <table className="w-full text-[11px]"><thead><tr className="text-left text-ink-700/60"><th className="py-1 pr-3">Email</th><th className="py-1 pr-3">Sent</th><th className="py-1 pr-3">Via</th><th className="py-1">Personal line</th></tr></thead>
            <tbody>{log.map((l) => <tr key={l.email} className="border-t border-black/5"><td className="py-1 pr-3 font-mono">{l.email}</td><td className="py-1 pr-3 whitespace-nowrap">{new Date(l.sent_at).toLocaleString()}</td><td className="py-1 pr-3">{l.source || ''}</td><td className="py-1 text-ink-700/70">{l.note || ''}</td></tr>)}</tbody></table>
        </div>
      </details>

      <div className="mt-5 pt-4 border-t border-black/10">
        <div className="flex items-baseline justify-between flex-wrap gap-2 mb-2">
          <h4 className="font-medium text-sm">Custom design requests <span className="text-ink-700/50 font-normal">from <a href="/custom-design" target="_blank" className="text-bronze-700 underline">/custom-design</a></span></h4>
          <span className="text-xs text-ink-700/60">{fresh} new · {reqs.length} total</span>
        </div>
        {reqs.length === 0 && <p className="text-xs text-ink-700/60">No requests yet. Every submission lands here, in your inbox, and on Telegram.</p>}
        <div className="space-y-2">
          {reqs.map((q) => (
            <div key={q.id} className="border border-black/10 rounded-lg bg-white">
              <button className="w-full text-left px-3 py-2 flex items-center gap-3" onClick={() => setOpen(open === q.id ? '' : q.id)}>
                {q.photo_url ? <img src={q.photo_url} alt="" className="w-10 h-10 rounded object-cover shrink-0" /> : <div className="w-10 h-10 rounded bg-cream shrink-0" />}
                <div className="min-w-0 flex-1">
                  <div className="text-sm truncate"><span className="font-medium">{q.name || q.email}</span> {q.name && <span className="text-ink-700/50 text-xs">{q.email}</span>}</div>
                  <div className="text-[11px] text-ink-700/60 truncate">{q.description}</div>
                </div>
                <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded shrink-0 ${STATUS_CLS[q.status] || ''}`}>{q.status.replace('_', ' ')}</span>
                <span className="text-[11px] text-ink-700/50 shrink-0 whitespace-nowrap">{new Date(q.created_at).toLocaleDateString()}</span>
              </button>
              {open === q.id && (
                <div className="px-3 pb-3 grid md:grid-cols-[200px_1fr] gap-3 text-xs">
                  <div>{q.photo_url && <a href={q.photo_url} target="_blank" rel="noreferrer"><img src={q.photo_url} alt="" className="w-full rounded border border-black/10" /></a>}</div>
                  <div className="space-y-2">
                    <p className="whitespace-pre-wrap">{q.description}</p>
                    <div className="text-ink-700/70">Size: {q.size_note || '-'} · Material: {q.material || '-'} · Needed by: {q.deadline || '-'} · <a href={`mailto:${q.email}?subject=Your custom design quote`} className="text-bronze-700 underline">reply by email</a></div>
                    <div className="flex flex-wrap gap-2 items-center">
                      <select value={field(q, 'status')} onChange={(e) => setDraft((d) => ({ ...d, [q.id]: { ...d[q.id], status: e.target.value } }))} className={inputCls + ' max-w-[150px]'}>{STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select>
                      <input type="number" step="0.01" min="0" value={field(q, 'quote_usd') ?? ''} onChange={(e) => setDraft((d) => ({ ...d, [q.id]: { ...d[q.id], quote_usd: e.target.value === '' ? null : Number(e.target.value) } }))} placeholder="Quote $" className={inputCls + ' max-w-[110px]'} />
                      <input value={field(q, 'admin_notes') ?? ''} onChange={(e) => setDraft((d) => ({ ...d, [q.id]: { ...d[q.id], admin_notes: e.target.value } }))} placeholder="Notes (private)" className={inputCls + ' flex-1 min-w-[180px]'} />
                      <button className={btnPrimary} disabled={busy === 'req:' + q.id} onClick={() => saveReq(q)}>{busy === 'req:' + q.id ? '…' : 'Save'}</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
