import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { Card, Modal, btnPrimary, btnGhost, btnDanger, inputCls } from '../ui';
import { useLiveRefresh } from '../useLiveRefresh';

type Maker = any;
const STATUS_PILL: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800', approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-700', suspended: 'bg-gray-200 text-gray-700',
};
const labelArr = (a?: string[]) => (a || []).join(', ') || '—';

export default function Makers() {
  const [rows, setRows] = useState<Maker[]>([]);
  const [filter, setFilter] = useState<'pending' | 'approved' | 'all'>('pending');
  const [open, setOpen] = useState<Maker | null>(null);
  const [counts, setCounts] = useState({ invited: 0, applied: 0, pending: 0, approved: 0 });
  const [loading, setLoading] = useState(true);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    let q = supabase.from('makers').select('*').order('created_at', { ascending: false }).limit(500);
    if (filter !== 'all') q = q.eq('status', filter);
    const [{ data }, { count: invited }, { count: applied }, { count: pending }, { count: approved }] = await Promise.all([
      q,
      supabase.from('maker_invites').select('email', { count: 'exact', head: true }),
      supabase.from('makers').select('id', { count: 'exact', head: true }),
      supabase.from('makers').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('makers').select('id', { count: 'exact', head: true }).eq('status', 'approved'),
    ]);
    setRows(data || []);
    setCounts({ invited: invited || 0, applied: applied || 0, pending: pending || 0, approved: approved || 0 });
    setLoading(false);
  }
  useEffect(() => { load(); }, [filter]);
  useLiveRefresh(() => load(true), 30000);

  async function setStatus(id: string, status: string) {
    await supabase.from('makers').update({ status, reviewed_at: new Date().toISOString() }).eq('id', id);
    setOpen((o: Maker) => (o && o.id === id ? { ...o, status } : o));
    load(true);
  }
  async function saveNote(id: string, note: string) {
    await supabase.from('makers').update({ admin_note: note }).eq('id', id);
  }

  return (
    <div className="space-y-4">
      <div className="text-xs text-ink-700/70 bg-cream/40 border border-bronze-600/15 rounded-lg px-3 py-2">
        🛠️ <b>Cut Local — maker network · Phase 1 (testing).</b> The application form lives at <code>/become-a-maker</code> (noindex, not linked yet). Recruit subscribers, review + approve applications, and message approved makers as a separate list — all before anything goes live.
      </div>

      <RecruitSender />
      <MakerBroadcast />

      {/* funnel */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><div className="text-[11px] uppercase tracking-wide text-ink-700/50">Invited</div><div className="text-2xl font-bold text-bronze-800 mt-1">{counts.invited}</div></Card>
        <Card><div className="text-[11px] uppercase tracking-wide text-ink-700/50">Applied</div><div className="text-2xl font-bold text-bronze-800 mt-1">{counts.applied}</div></Card>
        <Card><div className="text-[11px] uppercase tracking-wide text-ink-700/50">Pending review</div><div className="text-2xl font-bold text-amber-700 mt-1">{counts.pending}</div></Card>
        <Card><div className="text-[11px] uppercase tracking-wide text-ink-700/50">Approved makers</div><div className="text-2xl font-bold text-green-700 mt-1">{counts.approved}</div></Card>
      </div>

      <div className="flex gap-2">
        {(['pending', 'approved', 'all'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`text-xs px-3 py-1.5 rounded-full font-medium ${filter === f ? 'bg-bronze-600 text-cream' : 'bg-cream text-ink-700 hover:bg-bronze-600/10'}`}>{f}</button>
        ))}
      </div>

      {loading ? <div className="text-sm text-ink-700/60">Loading…</div> : rows.length === 0 ? (
        <Card><p className="text-sm text-ink-700/60">No maker applications {filter !== 'all' ? `(${filter})` : ''} yet. Send the recruit email above to get your first makers.</p></Card>
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          {rows.map((m) => (
            <button key={m.id} onClick={() => setOpen(m)} className="text-left bg-white border border-black/10 rounded-lg p-4 hover:shadow transition">
              <div className="flex items-center justify-between gap-2">
                <b className="text-ink-900">{m.maker_name}</b>
                <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${STATUS_PILL[m.status] || ''}`}>{m.status}</span>
              </div>
              <div className="text-xs text-ink-700/60 mt-1">{[m.city, m.region, m.country].filter(Boolean).join(', ')}</div>
              <div className="flex flex-wrap gap-1 mt-2">
                {(m.machine_types || []).map((t: string) => <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-cream text-bronze-700 font-mono">{t}</span>)}
              </div>
              <div className="flex gap-1.5 mt-2">
                {(m.portfolio_urls || []).slice(0, 4).map((u: string, i: number) => <img key={i} src={u} className="w-11 h-11 rounded object-cover border border-black/10" />)}
              </div>
            </button>
          ))}
        </div>
      )}

      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? open.maker_name : ''} wide>
        {open && (
          <div className="space-y-4 text-sm">
            <div className="flex items-center gap-2">
              <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${STATUS_PILL[open.status] || ''}`}>{open.status}</span>
              <span className="text-ink-700/50 text-xs">applied {new Date(open.created_at).toLocaleString()}</span>
            </div>
            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
              <Field k="Contact" v={`${open.contact_name || '—'} · ${open.email}${open.phone ? ' · ' + open.phone : ''}`} />
              <Field k="Location" v={[open.city, open.region, open.country, open.postal].filter(Boolean).join(', ')} />
              <Field k="Delivery" v={`${open.deliver_radius_km ? open.deliver_radius_km + ' km radius' : 'local'}${open.deliver_domestic_ship ? ' · ships domestic' : ''}${open.deliver_intl ? ' · ships intl' : ''}`} />
              <Field k="Intl notes" v={open.deliver_intl_notes} />
              <Field k="Machines" v={`${labelArr(open.machine_types)} · ${open.machine_count || '?'} unit(s)`} />
              <Field k="Models" v={open.machine_models} />
              <Field k="Max size" v={open.max_size} />
              <Field k="Materials" v={labelArr(open.materials)} />
              <Field k="Finishes" v={labelArr(open.finishes)} />
              <Field k="Lead time" v={open.min_lead_days ? open.min_lead_days + ' days min' : '—'} />
              <Field k="Capacity" v={open.capacity_per_week ? open.capacity_per_week + ' jobs/wk' : '—'} />
              <Field k="Gets paid by" v={labelArr(open.payment_methods)} />
              <Field k="Deposit" v={open.deposit_policy} />
              <Field k="Experience" v={open.years_experience ? open.years_experience + ' yrs' : '—'} />
              <Field k="Links" v={[open.etsy_url, open.website_url, open.instagram_url].filter(Boolean).join('  ·  ')} />
            </div>
            {open.bio && <div><div className="text-[11px] uppercase text-ink-700/50 font-semibold">Pitch</div><p className="text-ink-800">{open.bio}</p></div>}
            {(open.portfolio_urls || []).length > 0 && (
              <div><div className="text-[11px] uppercase text-ink-700/50 font-semibold mb-1">Portfolio</div>
                <div className="flex flex-wrap gap-2">{open.portfolio_urls.map((u: string, i: number) => <a key={i} href={u} target="_blank" rel="noreferrer"><img src={u} className="w-24 h-24 rounded-lg object-cover border border-black/10" /></a>)}</div>
              </div>
            )}
            <div className="text-xs text-ink-700/60">✓ owns machines · ✓ agreed fees · ✓ agreed terms{open.ip ? ` · ${open.ip}` : ''}</div>
            <div>
              <div className="text-[11px] uppercase text-ink-700/50 font-semibold mb-1">Internal note</div>
              <textarea defaultValue={open.admin_note || ''} onBlur={(e) => saveNote(open.id, e.target.value)} rows={2} className={inputCls} placeholder="Notes for your team…" />
            </div>
            <div className="flex flex-wrap gap-2 pt-2 border-t border-black/5">
              {open.status !== 'approved' && <button className={btnPrimary} onClick={() => setStatus(open.id, 'approved')}>✓ Approve maker</button>}
              {open.status !== 'rejected' && <button className={btnGhost} onClick={() => setStatus(open.id, 'rejected')}>Reject</button>}
              {open.status === 'approved' && <button className={btnGhost} onClick={() => setStatus(open.id, 'suspended')}>Suspend</button>}
              {open.status !== 'pending' && <button className={btnGhost} onClick={() => setStatus(open.id, 'pending')}>Back to pending</button>}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Field({ k, v }: { k: string; v?: string | null }) {
  if (!v) return null;
  return <div><div className="text-[11px] uppercase text-ink-700/45 font-semibold">{k}</div><div className="text-ink-800 break-words">{v}</div></div>;
}

// ── Broadcast to approved makers — the maker mailing list ─────────────
function MakerBroadcast() {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState('');
  const [results, setResults] = useState<any[] | null>(null);
  useEffect(() => { supabase.from('makers').select('id', { count: 'exact', head: true }).eq('status', 'approved').then(({ count }) => setCount(count || 0)); }, []);

  async function call(extra: any) {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch('/api/admin/email-makers', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${session?.access_token}` }, body: JSON.stringify({ subject, message, ...extra }) });
    return res.json();
  }
  async function preview() {
    if (!subject || !message) { alert('Add a subject and message first.'); return; }
    setBusy('preview');
    try { const j = await call({ preview: true }); if (j.ok) { const u = URL.createObjectURL(new Blob([`<title>${j.subject}</title>` + j.html], { type: 'text/html' })); window.open(u, '_blank'); setTimeout(() => URL.revokeObjectURL(u), 60000); } else alert(j.error); } catch (e: any) { alert(String(e?.message || e)); }
    setBusy('');
  }
  async function sendTest() { if (!subject || !message) { alert('Add a subject and message first.'); return; } setBusy('test'); try { const j = await call({ test: true }); alert(j.ok ? 'Test sent to your inbox.' : 'Failed: ' + (j.results?.[0]?.error || '')); } catch (e: any) { alert(String(e?.message || e)); } setBusy(''); }
  async function sendAll() {
    if (!subject || !message) { alert('Add a subject and message first.'); return; }
    if (!confirm(`Send this to all ${count} approved maker(s)?`)) return;
    setBusy('send'); setResults(null);
    try { const j = await call({ audience: 'approved' }); setResults(j.results || []); if (j.ok) { setSubject(''); setMessage(''); } } catch (e: any) { alert(String(e?.message || e)); }
    setBusy('');
  }

  return (
    <Card title="✉️ Email your makers (approved list)">
      <p className="text-xs text-ink-700/60 mb-3">
        A separate audience from subscribers. Announcements, new features, tips — goes to your <b>{count ?? '…'} approved maker{count === 1 ? '' : 's'}</b>. Preview and test before sending.
      </p>
      <div className="grid gap-2 max-w-2xl">
        <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject — e.g. Cut Local is now open in your area" className={inputCls} />
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5} placeholder={"Write your message. Blank lines start new paragraphs.\n\nWe sign it 'Jolly · DigitalChiselCo' for you."} className={inputCls} />
      </div>
      <div className="flex flex-wrap gap-2 mt-3">
        <button className={btnPrimary} disabled={!!busy || !count} onClick={sendAll}>{busy === 'send' ? 'Sending…' : `✉️ Send to ${count ?? 0} makers`}</button>
        <button className={btnGhost} disabled={!!busy} onClick={preview}>{busy === 'preview' ? 'Building…' : '👁 Preview'}</button>
        <button className={btnGhost} disabled={!!busy} onClick={sendTest}>{busy === 'test' ? 'Sending…' : 'Send test to me'}</button>
      </div>
      {results && <div className="mt-3 text-xs space-y-0.5">{results.map((r) => <div key={r.email} className={r.ok ? 'text-green-700' : 'text-red-700'}>{r.ok ? '✓' : '✗'} {r.email}{r.error ? ` · ${r.error}` : ''}</div>)}</div>}
    </Card>
  );
}

// ── Recruit-email sender (mirrors the portal-guide sender) ────────────
function RecruitSender() {
  const [subs, setSubs] = useState<{ email: string }[]>([]);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [applyUrl, setApplyUrl] = useState('');
  const [busy, setBusy] = useState('');
  const [results, setResults] = useState<any[] | null>(null);

  useEffect(() => { supabase.from('subscribers').select('email').limit(5000).then(({ data }) => setSubs(data || [])); }, []);
  const suggestions = input.trim().length >= 2 ? subs.filter((s) => s.email.toLowerCase().includes(input.toLowerCase()) && !recipients.includes(s.email.toLowerCase())).slice(0, 6) : [];
  const addEmails = (list: string[]) => setRecipients((r) => [...new Set([...r, ...list.map((e) => e.toLowerCase().trim()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))])]);

  async function call(extra: any) {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch('/api/admin/send-maker-invite', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${session?.access_token}` }, body: JSON.stringify({ applyUrl: applyUrl.trim() || undefined, ...extra }) });
    return res.json();
  }
  async function preview() {
    setBusy('preview');
    try { const j = await call({ preview: true }); if (j.ok) { const u = URL.createObjectURL(new Blob([`<title>${j.subject}</title>` + j.html], { type: 'text/html' })); window.open(u, '_blank'); setTimeout(() => URL.revokeObjectURL(u), 60000); } else alert(j.error); } catch (e: any) { alert(String(e?.message || e)); }
    setBusy('');
  }
  async function sendTest() { setBusy('test'); try { const j = await call({ test: true }); alert(j.ok ? 'Test sent to your inbox.' : 'Failed: ' + (j.results?.[0]?.error || '')); } catch (e: any) { alert(String(e?.message || e)); } setBusy(''); }
  async function sendAll() {
    if (!recipients.length) { alert('Add recipients first.'); return; }
    if (!confirm(`Send the maker-recruit email to ${recipients.length} subscriber(s)?`)) return;
    setBusy('send'); setResults(null);
    try { const j = await call({ emails: recipients }); setResults(j.results || []); if (j.ok) setRecipients((r) => r.filter((e) => !(j.results || []).some((x: any) => x.email === e && x.ok))); } catch (e: any) { alert(String(e?.message || e)); }
    setBusy('');
  }

  return (
    <Card title="📣 Recruit makers (send the invite email)">
      <p className="text-xs text-ink-700/60 mb-3">
        Emails subscribers inviting them to apply as a maker. Each recipient gets a personal link that pre-fills their email on the form. Preview and test-send before any real blast. During testing you can point the button at a preview link below.
      </p>
      <label className="block mb-3 max-w-md">
        <span className="text-[11px] uppercase tracking-wide text-ink-700/50 font-medium">Apply link (optional — leave blank for the live /become-a-maker)</span>
        <input value={applyUrl} onChange={(e) => setApplyUrl(e.target.value)} className={inputCls} placeholder="https://digitalchiselco.com/become-a-maker" />
      </label>
      <div className="flex flex-wrap gap-2 items-start">
        <div className="relative">
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { addEmails(input.split(/[\s,;]+/)); setInput(''); } }} placeholder="Type an email or search subscribers…" className={inputCls + ' w-72'} />
          {suggestions.length > 0 && (
            <div className="absolute z-20 mt-1 w-72 bg-white border border-black/10 rounded-md shadow-lg">
              {suggestions.map((s) => <button key={s.email} className="block w-full text-left px-3 py-1.5 text-sm hover:bg-cream/60" onClick={() => { addEmails([s.email]); setInput(''); }}>{s.email}</button>)}
            </div>
          )}
        </div>
        <button className={btnGhost} onClick={() => { addEmails(input.split(/[\s,;]+/)); setInput(''); }}>+ Add</button>
        <button className={btnGhost} onClick={() => addEmails(subs.map((s) => s.email))}>+ All subscribers ({subs.length})</button>
        {recipients.length > 0 && <button className={btnGhost} onClick={() => setRecipients([])}>Clear</button>}
      </div>
      {recipients.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {recipients.slice(0, 40).map((e) => <span key={e} className="inline-flex items-center gap-1 text-xs bg-cream border border-bronze-600/20 rounded-full px-2.5 py-1">{e}<button className="text-ink-700/50 hover:text-red-600" onClick={() => setRecipients((r) => r.filter((x) => x !== e))}>✕</button></span>)}
          {recipients.length > 40 && <span className="text-xs text-ink-700/60 self-center">+{recipients.length - 40} more</span>}
        </div>
      )}
      <div className="flex flex-wrap gap-2 mt-3">
        <button className={btnPrimary} disabled={!!busy || !recipients.length} onClick={sendAll}>{busy === 'send' ? 'Sending…' : `📣 Send invite${recipients.length ? ` to ${recipients.length}` : ''}`}</button>
        <button className={btnGhost} disabled={!!busy} onClick={preview}>{busy === 'preview' ? 'Building…' : '👁 Preview'}</button>
        <button className={btnGhost} disabled={!!busy} onClick={sendTest}>{busy === 'test' ? 'Sending…' : 'Send test to me'}</button>
      </div>
      {results && <div className="mt-3 text-xs space-y-0.5">{results.map((r) => <div key={r.email} className={r.ok ? 'text-green-700' : 'text-red-700'}>{r.ok ? '✓' : '✗'} {r.email}{r.error ? ` · ${r.error}` : ''}</div>)}</div>}
    </Card>
  );
}
