// Custom design requests: photo-to-STL commissions from /custom-design.
//
// These used to live inside the custom-pitch card on the Automations tab, and
// the admin bell pointed there, so a real customer (Brano, 2026-09-16) sat
// unanswered while the only trace was a marketing card. Owner: "as this is
// hidden it should be somewhere I can see". This is that place.
//
// /custom-design promises a firm price within 24 hours, so every open request
// shows how long is left on that promise, and turns red once it has lapsed.
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { inputCls, btnPrimary } from '../ui';
import { shrink } from '../ImageUpload';

const MAX_SAMPLES = 8;

/** Sample pictures for a reply: resized in the browser first, then stored. */
function SamplePicker({ reqId, urls, onChange }: { reqId: string; urls: string[]; onChange: (u: string[]) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function add(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true); setErr('');
    const next = [...urls];
    try {
      for (const picked of Array.from(files).slice(0, MAX_SAMPLES - next.length)) {
        const f = await shrink(picked);
        const ext = (f.name.split('.').pop() || 'jpg').toLowerCase();
        const path = `custom-replies/${reqId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error } = await supabase.storage.from('site-media').upload(path, f, { upsert: false, contentType: f.type });
        if (error) throw error;
        next.push(supabase.storage.from('site-media').getPublicUrl(path).data.publicUrl);
        onChange([...next]);
      }
    } catch (e: any) { setErr(e.message || 'Upload failed'); }
    finally { setBusy(false); }
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className={`text-xs px-3 py-1.5 rounded-md border border-bronze-600 text-bronze-700 cursor-pointer hover:bg-cream ${busy || urls.length >= MAX_SAMPLES ? 'opacity-50 pointer-events-none' : ''}`}>
          {busy ? 'Uploading…' : '🖼 Add sample pictures'}
          <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
        </label>
        <span className="text-[11px] text-ink-700/60">up to {MAX_SAMPLES}, shown in the email under your message</span>
        {err && <span className="text-xs text-red-700">{err}</span>}
      </div>
      {urls.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {urls.map((u) => (
            <div key={u} className="relative">
              <img src={u} alt="" className="w-20 h-20 object-cover rounded-md border border-black/10" />
              <button onClick={() => onChange(urls.filter((x) => x !== u))} title="Remove"
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-white border border-black/20 text-xs leading-none">×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type Req = {
  id: string; name: string | null; email: string; photo_url: string | null;
  description: string | null; size_note: string | null; material: string | null;
  deadline: string | null; status: string; quote_usd: number | null;
  admin_notes: string | null; created_at: string; updated_at: string | null;
  replied_at?: string | null; reply_body?: string | null; reply_count?: number | null; reply_images?: string[] | null;
};

/** A starting point for the reply, in the owner's voice. */
function starterReply(r: Req, quote: number | null): string {
  const first = (r.name || '').trim().split(/\s+/)[0] || 'there';
  return [
    `Hi ${first},`,
    'Thank you for the request and the reference picture.',
    `I can make this for you${r.size_note ? ` at ${r.size_note}` : ''}.`,
    `The price would be $${quote ? quote.toFixed(2) : '___'}, with the finished STL delivered within ___ days of your approval.`,
    'Let me know if that works for you and I will get started.',
    'Jolly, DigitalChiselCo',
  ].join('\n\n');
}
/** The owner sometimes drafts the letter in the notes box; offer it as the reply. */
const looksLikeLetter = (s: string | null | undefined) => !!s && /^\s*(hi|hello|dear)\b/i.test(s);

const PROMISE_HOURS = 24;
const STATUSES = ['new', 'quoted', 'paid', 'in_progress', 'delivered', 'declined'] as const;
const LABEL: Record<string, string> = {
  new: 'Needs a reply', quoted: 'Quote sent', paid: 'Paid', in_progress: 'Being made',
  delivered: 'Delivered', declined: 'Declined',
};
const CHIP: Record<string, string> = {
  new: 'bg-amber-100 text-amber-900 border-amber-300',
  quoted: 'bg-blue-50 text-blue-800 border-blue-200',
  paid: 'bg-green-50 text-green-800 border-green-200',
  in_progress: 'bg-purple-50 text-purple-800 border-purple-200',
  delivered: 'bg-green-100 text-green-900 border-green-300',
  declined: 'bg-gray-100 text-gray-600 border-gray-200',
};

/** Hours left on the 24-hour reply promise; negative once it has passed. */
function hoursLeft(createdIso: string): number {
  return PROMISE_HOURS - (Date.now() - new Date(createdIso).getTime()) / 3600e3;
}
function ago(iso: string): string {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} days ago`;
}
function promiseText(iso: string): { text: string; cls: string } {
  const h = hoursLeft(iso);
  if (h <= 0) {
    const over = Math.abs(h);
    return { text: `Reply overdue by ${over < 1 ? `${Math.round(over * 60)} min` : `${Math.round(over)} h`}`, cls: 'bg-red-600 text-white' };
  }
  if (h < 6) return { text: `${h < 1 ? `${Math.round(h * 60)} min` : `${Math.round(h)} h`} left to reply`, cls: 'bg-red-100 text-red-800' };
  return { text: `${Math.round(h)} h left to reply`, cls: 'bg-amber-100 text-amber-900' };
}

export default function CustomRequests() {
  const [reqs, setReqs] = useState<Req[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [show, setShow] = useState<'open' | 'all'>('open');
  const [draft, setDraft] = useState<Record<string, Partial<Req>>>({});
  const [, tick] = useState(0);

  async function call(payload: any) {
    const { data: { session } } = await supabase.auth.getSession();
    const r = await fetch('/api/admin/custom-pitch', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify(payload),
    });
    return r.json();
  }
  async function load() {
    const r = await call({ action: 'list' });
    if (r?.ok) setReqs(r.requests || []);
    setLoading(false);
  }
  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    const c = setInterval(() => tick((n) => n + 1), 30000);   // keep the countdowns moving
    return () => { clearInterval(t); clearInterval(c); };
  }, []);

  const open = (r: Req) => !['delivered', 'declined'].includes(r.status);
  const list = useMemo(() => {
    const rows = show === 'open' ? reqs.filter(open) : reqs;
    // Unanswered first, oldest first among them: that is the order of urgency.
    return [...rows].sort((a, b) =>
      (a.status === 'new' ? 0 : 1) - (b.status === 'new' ? 0 : 1)
      || (a.status === 'new' ? new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        : new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
  }, [reqs, show]);

  const counts = useMemo(() => ({
    needsReply: reqs.filter((r) => r.status === 'new').length,
    overdue: reqs.filter((r) => r.status === 'new' && hoursLeft(r.created_at) <= 0).length,
    active: reqs.filter((r) => ['quoted', 'paid', 'in_progress'].includes(r.status)).length,
    quotedValue: reqs.filter((r) => ['quoted', 'paid', 'in_progress'].includes(r.status))
      .reduce((s, r) => s + Number(r.quote_usd || 0), 0),
  }), [reqs]);

  const f = (r: Req, k: keyof Req) => (draft[r.id]?.[k] !== undefined ? draft[r.id]![k] : r[k]) as any;
  const setF = (id: string, k: keyof Req, v: any) => setDraft((d) => ({ ...d, [id]: { ...d[id], [k]: v } }));

  async function save(r: Req) {
    setMsg('Saving…');
    const res = await call({
      action: 'request_update', id: r.id,
      status: f(r, 'status'), quote_usd: f(r, 'quote_usd'), admin_notes: f(r, 'admin_notes'),
    });
    setMsg(res?.ok ? 'Saved.' : `Could not save: ${res?.error || 'unknown error'}`);
    if (res?.ok) { setDraft((d) => { const n = { ...d }; delete n[r.id]; return n; }); load(); }
  }

  const [replies, setReplies] = useState<Record<string, string>>({});
  const [sending, setSending] = useState<string | null>(null);
  const [samples, setSamples] = useState<Record<string, string[]>>({});
  const replyText = (r: Req) => replies[r.id] ?? (looksLikeLetter(f(r, 'admin_notes')) ? f(r, 'admin_notes') : starterReply(r, f(r, 'quote_usd')));

  async function sendReply(r: Req) {
    const text = replyText(r).trim();
    if (/_{3,}/.test(text)) { setMsg('Fill in the blanks (___) in the reply before sending.'); return; }
    if (!window.confirm(`Send this reply to ${r.email}?`)) return;
    setSending(r.id); setMsg('Sending…');
    const res = await call({ action: 'request_reply', id: r.id, message: text, quote_usd: f(r, 'quote_usd'), images: samples[r.id] || [] });
    setSending(null);
    if (res?.ok) {
      setMsg(res.message || 'Sent.');
      setReplies((d) => { const n = { ...d }; delete n[r.id]; return n; });
      setSamples((d) => { const n = { ...d }; delete n[r.id]; return n; });
      load();
    } else setMsg(`Not sent: ${res?.error || 'unknown error'}`);
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-serif text-2xl text-bronze-800">Custom design requests</h2>
        <p className="text-sm text-ink-700/70">
          Photo-to-STL commissions from the <a href="/custom-design" target="_blank" className="underline">custom design page</a>.
          That page promises a firm price within {PROMISE_HOURS} hours.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile n={counts.needsReply} label="Need a reply" tone={counts.needsReply ? 'amber' : 'plain'} />
        <Tile n={counts.overdue} label="Past the 24 h promise" tone={counts.overdue ? 'red' : 'plain'} />
        <Tile n={counts.active} label="Quoted or in progress" tone="plain" />
        <Tile n={`$${counts.quotedValue.toFixed(0)}`} label="Value of open quotes" tone="plain" />
      </div>

      <div className="flex items-center gap-2 text-sm">
        {(['open', 'all'] as const).map((k) => (
          <button key={k} onClick={() => setShow(k)}
            className={`px-3 py-1 rounded-full border ${show === k ? 'bg-bronze-700 text-cream border-bronze-700' : 'bg-white border-black/15'}`}>
            {k === 'open' ? 'Open' : 'Everything'}
          </button>
        ))}
        {msg && <span className="ml-3 text-xs text-ink-700/70">{msg}</span>}
      </div>

      {loading && <p className="text-sm text-ink-700/60">Loading…</p>}
      {!loading && list.length === 0 && (
        <p className="text-sm text-ink-700/60 bg-white border border-black/10 rounded-lg p-6 text-center">
          {show === 'open' ? 'Nothing waiting. Every request has been answered.' : 'No requests yet.'}
        </p>
      )}

      <div className="space-y-4">
        {list.map((r) => {
          const p = r.status === 'new' ? promiseText(r.created_at) : null;
          const dirty = !!draft[r.id];
          return (
            <div key={r.id} className={`bg-white border rounded-xl overflow-hidden ${r.status === 'new' ? 'border-amber-400 shadow-sm' : 'border-black/10'}`}>
              <div className="flex flex-col md:flex-row">
                <a href={r.photo_url || '#'} target="_blank" rel="noreferrer"
                  className="md:w-72 shrink-0 bg-cream/60 flex items-center justify-center min-h-[160px]">
                  {r.photo_url
                    ? <img src={r.photo_url} alt="Customer reference" className="w-full h-full object-contain max-h-64" loading="lazy" />
                    : <span className="text-xs text-ink-700/40">no picture</span>}
                </a>
                <div className="flex-1 p-4 space-y-3 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-[11px] px-2 py-0.5 rounded-full border ${CHIP[r.status] || ''}`}>{LABEL[r.status] || r.status}</span>
                    {p && <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${p.cls}`}>{p.text}</span>}
                    <span className="text-xs text-ink-700/60 ml-auto">{ago(r.created_at)} · {new Date(r.created_at).toLocaleString()}</span>
                  </div>

                  <div>
                    <div className="font-medium text-ink-900">{r.name || '(no name)'}</div>
                    <a href={`mailto:${r.email}`} className="text-sm text-bronze-700 underline break-all">{r.email}</a>
                  </div>

                  {r.description && <p className="text-sm text-ink-800 whitespace-pre-wrap">{r.description}</p>}

                  <dl className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                    <Fact k="Size" v={r.size_note} />
                    <Fact k="Machine and material" v={r.material} />
                    <Fact k="Needed by" v={r.deadline} />
                  </dl>

                  <div className="flex flex-wrap items-end gap-2 pt-2 border-t border-black/5">
                    <label className="text-xs">Status
                      <select value={f(r, 'status')} onChange={(e) => setF(r.id, 'status', e.target.value)} className={inputCls + ' mt-1 max-w-[160px]'}>
                        {STATUSES.map((s) => <option key={s} value={s}>{LABEL[s]}</option>)}
                      </select>
                    </label>
                    <label className="text-xs">Quote (USD)
                      <input type="number" step="0.01" min="0" value={f(r, 'quote_usd') ?? ''}
                        onChange={(e) => setF(r.id, 'quote_usd', e.target.value === '' ? null : Number(e.target.value))}
                        placeholder="e.g. 60" className={inputCls + ' mt-1 max-w-[110px]'} />
                    </label>
                    <button onClick={() => save(r)} disabled={!dirty}
                      className={btnPrimary + (dirty ? '' : ' opacity-40 cursor-not-allowed')}>Save</button>
                  </div>

                  <div className="rounded-lg border border-bronze-600/40 bg-cream/30 p-3 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-bronze-800">✉ Reply to {r.name || 'the customer'}</span>
                      <span className="text-[11px] text-ink-700/60">sent from the site to {r.email}, their replies come back to your inbox</span>
                      {r.replied_at && (
                        <span className="ml-auto text-[11px] px-2 py-0.5 rounded-full bg-green-100 text-green-800">
                          Reply sent {ago(r.replied_at)}{(r.reply_count || 0) > 1 ? ` · ${r.reply_count} replies` : ''}
                        </span>
                      )}
                    </div>
                    <textarea rows={9} value={replyText(r)}
                      onChange={(e) => setReplies((d) => ({ ...d, [r.id]: e.target.value }))}
                      className={inputCls + ' font-normal'} />
                    <SamplePicker reqId={r.id} urls={samples[r.id] || []}
                      onChange={(u) => setSamples((d) => ({ ...d, [r.id]: u }))} />
                    <div className="flex flex-wrap items-center gap-2">
                      <button onClick={() => sendReply(r)} disabled={sending === r.id}
                        className={btnPrimary + (sending === r.id ? ' opacity-50' : '')}>
                        {sending === r.id ? 'Sending…' : 'Send reply'}
                      </button>
                      <button onClick={() => setReplies((d) => ({ ...d, [r.id]: starterReply(r, f(r, 'quote_usd')) }))}
                        className="text-xs underline text-ink-700/70">Start from the template</button>
                      {/_{3,}/.test(replyText(r)) && (
                        <span className="text-xs text-red-700">Fill in the ___ blanks before sending.</span>
                      )}
                      <span className="text-[11px] text-ink-700/50 ml-auto">Blank lines make paragraphs. **word** makes it bold. The quote above is added as a line.</span>
                    </div>
                    {r.reply_body && (
                      <details className="text-xs">
                        <summary className="cursor-pointer text-ink-700/70">Last reply sent</summary>
                        <pre className="whitespace-pre-wrap font-sans text-ink-800 mt-1">{r.reply_body}</pre>
                        {(r.reply_images || []).length > 0 && (
                          <div className="flex flex-wrap gap-2 mt-2">
                            {(r.reply_images || []).map((u) => <img key={u} src={u} alt="" className="w-16 h-16 object-cover rounded border border-black/10" />)}
                          </div>
                        )}
                      </details>
                    )}
                  </div>

                  <label className="text-xs block">Private notes (only you see these)
                    <textarea rows={2} value={f(r, 'admin_notes') || ''} onChange={(e) => setF(r.id, 'admin_notes', e.target.value)}
                      placeholder="What you quoted, what they asked, anything to remember" className={inputCls + ' mt-1'} />
                  </label>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Tile({ n, label, tone }: { n: number | string; label: string; tone: 'amber' | 'red' | 'plain' }) {
  const cls = tone === 'red' ? 'bg-red-600 text-white border-red-700'
    : tone === 'amber' ? 'bg-amber-50 text-amber-900 border-amber-300'
    : 'bg-white text-ink-900 border-black/10';
  return (
    <div className={`rounded-xl border p-4 ${cls}`}>
      <div className="text-2xl font-semibold tabular-nums">{n}</div>
      <div className="text-xs opacity-80">{label}</div>
    </div>
  );
}
function Fact({ k, v }: { k: string; v: string | null }) {
  return (
    <div className="bg-cream/40 rounded-md px-2 py-1.5">
      <dt className="text-[10px] uppercase tracking-wide text-ink-700/60">{k}</dt>
      <dd className="text-ink-800">{v || '-'}</dd>
    </div>
  );
}
