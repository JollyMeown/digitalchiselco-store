// Memberships: every term, its delivery timeline (sent / delivered / opened /
// clicked / downloaded per email), and the actions the old standalone admin
// had plus a few it did not: add member, deliver now, re-send a pack, send
// the renewal reminder, extend the term, pause / resume / cancel, notes.
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { Card, Modal, btnGhost, btnDanger, btnPrimary, inputCls, labelCls, Toast } from '../ui';

type Sub = {
  id: string; email: string; customer_name: string | null; plan_slug: string; months: number; tier: string; status: string;
  start_date: string; end_date: string; next_drop_date: string | null; drops_sent: number; total_drops: number;
  price_usd: number | null; is_renewal: boolean; created_at: string; source: string | null; notes: string | null;
  admin_notes: string | null; renewed_from: string | null; renewed_to: string | null; last_email_at: string | null; last_download_at: string | null;
};
type Log = { id: string; subscription_id: string; email_type: string; drop_month: string; status: string; provider_id: string | null; subject: string | null; sent_at: string; error_message: string | null };
type Ev = { provider_id: string; event: string; created_at: string; url: string | null };
type Dl = { subscription_id: string; month: string; kind: string; via: string | null; created_at: string };

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-800', paused: 'bg-amber-100 text-amber-800',
  cancelled: 'bg-red-100 text-red-700', expired: 'bg-gray-100 text-gray-600', upgraded: 'bg-blue-50 text-blue-800',
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ymLabel = (ym: string) => { const [y, m] = ym.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };
const addMonthsYM = (ymd: string, n: number) => { const [y, m] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7); };
const TYPE_LABEL: Record<string, string> = {
  first_pack: 'First pack', monthly_drop: 'Monthly pack', pre_expiry: 'Reminder', pre_expiry_10: 'Reminder (10 days)', pre_expiry_3: 'Reminder (3 days)',
  pre_expiry_manual: 'Reminder (sent by you)', expiry: 'Term ended', winback: 'Win-back', custom: 'Custom',
};
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

export default function MemberSubs() {
  const [rows, setRows] = useState<Sub[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [events, setEvents] = useState<Ev[]>([]);
  const [downloads, setDownloads] = useState<Dl[]>([]);
  const [packs, setPacks] = useState<Record<string, { title: string | null; has: boolean }>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [plans, setPlans] = useState<any[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'info'; text: string }>({ kind: 'info', text: '' });

  useEffect(() => {
    load();
    supabase.from('membership_plans').select('slug, name, months, price_usd').order('sort_order').then(({ data }) => setPlans(data || []));
  }, []);
  async function load(silent = false) {
    if (!silent) setLoading(true);
    const [{ data: subs }, { data: lg }, { data: dl }, { data: pk }] = await Promise.all([
      supabase.from('member_subscriptions').select('*').order('created_at', { ascending: false }).limit(2000),
      supabase.from('subscription_email_logs').select('id, subscription_id, email_type, drop_month, status, provider_id, subject, sent_at, error_message').order('sent_at', { ascending: false }).limit(5000),
      supabase.from('pack_downloads').select('subscription_id, month, kind, via, created_at').order('created_at', { ascending: false }).limit(5000),
      supabase.from('monthly_files').select('month, title, standard_drive_link, bonus_drive_link'),
    ]);
    setRows((subs ?? []) as Sub[]);
    setLogs((lg ?? []) as Log[]);
    setDownloads((dl ?? []) as Dl[]);
    setPacks(Object.fromEntries((pk || []).map((p: any) => [p.month, { title: p.title, has: !!(p.standard_drive_link || p.bonus_drive_link) }])));
    const ids = [...new Set((lg || []).map((l: any) => l.provider_id).filter(Boolean))] as string[];
    const evs: Ev[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await supabase.from('email_events').select('provider_id, event, created_at, url').in('provider_id', ids.slice(i, i + 200)).limit(5000);
      evs.push(...((data || []) as Ev[]));
    }
    setEvents(evs);
    setLoading(false);
  }

  async function act(payload: any, label: string) {
    setBusy(label); setMsg({ kind: 'info', text: '' });
    const { data: { session } } = await supabase.auth.getSession();
    const r = await fetch('/api/admin/membership/deliver', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${session?.access_token || ''}` }, body: JSON.stringify(payload) })
      .then((x) => x.json()).catch(() => ({ error: 'bad response' }));
    setBusy('');
    setMsg(r?.error ? { kind: 'error', text: r.error } : { kind: 'success', text: r.message || 'Done.' });
    load(true);
  }

  const filtered = useMemo(() => {
    let r = rows;
    if (status === 'due') { const cut = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10); r = r.filter((x) => x.status === 'active' && x.end_date <= cut && !x.renewed_to); }
    else if (status === 'blocked') r = r.filter((x) => x.status === 'active' && x.next_drop_date && x.next_drop_date <= new Date().toISOString().slice(0, 10));
    else if (status !== 'all') r = r.filter((x) => x.status === status);
    if (search.trim()) { const q = search.toLowerCase(); r = r.filter((x) => x.email.toLowerCase().includes(q) || (x.customer_name || '').toLowerCase().includes(q)); }
    return r;
  }, [rows, search, status]);

  const today = new Date().toISOString().slice(0, 10);
  const counts = useMemo(() => {
    const c = { active: 0, paused: 0, expired: 0, cancelled: 0, due: 0, blocked: 0 };
    const cut = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
    for (const r of rows) {
      if (r.status in c) (c as any)[r.status]++;
      if (r.status === 'active' && r.end_date <= cut && !r.renewed_to) c.due++;
      if (r.status === 'active' && r.next_drop_date && r.next_drop_date <= today) c.blocked++;
    }
    return c;
  }, [rows]);

  // opens / downloads across all pack emails, for the header
  const feedback = useMemo(() => {
    const packLogs = logs.filter((l) => (l.email_type === 'first_pack' || l.email_type === 'monthly_drop') && l.status === 'sent');
    const opened = new Set(events.filter((e) => e.event === 'opened' || e.event === 'clicked').map((e) => e.provider_id));
    const openedN = packLogs.filter((l) => l.provider_id && opened.has(l.provider_id)).length;
    const dlKeys = new Set(downloads.map((d) => `${d.subscription_id}|${d.month}`));
    const dlN = packLogs.filter((l) => dlKeys.has(`${l.subscription_id}|${l.drop_month.split('#')[0]}`)).length;
    return { sent: packLogs.length, opened: openedN, downloaded: dlN };
  }, [logs, events, downloads]);

  async function setStatusFor(s: Sub, next: string) {
    const patch: any = { status: next };
    if (next === 'cancelled') { patch.cancelled_at = new Date().toISOString(); patch.next_drop_date = null; }
    if (next === 'paused') patch.paused_at = new Date().toISOString();
    if (next === 'active' && s.status === 'paused') { patch.paused_at = null; patch.next_drop_date = s.drops_sent < s.total_drops ? addMonthsYM(s.start_date, s.drops_sent) + '-' + s.start_date.slice(8, 10) : null; }
    await supabase.from('member_subscriptions').update(patch).eq('id', s.id);
    load(true);
  }

  function exportCsv() {
    const head = 'email,name,plan,tier,status,source,start,end,drops_sent,total_drops,next_drop,price,last_email,last_download\n';
    const body = filtered.map((r) => [r.email, r.customer_name || '', r.plan_slug, r.tier, r.status, r.source || '', r.start_date, r.end_date, r.drops_sent, r.total_drops, r.next_drop_date || '', r.price_usd ?? '', r.last_email_at || '', r.last_download_at || ''].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([head + body], { type: 'text/csv' }));
    a.download = `member-subscriptions-${today}.csv`; a.click();
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[['Active', counts.active, 'active'], ['Renewal due (14d)', counts.due, 'due'], ['Waiting for a pack', counts.blocked, 'blocked'], ['Paused', counts.paused, 'paused'], ['Expired', counts.expired, 'expired'], ['Pack emails opened', `${feedback.opened}/${feedback.sent}`, null]].map(([l, v, key]: any) => (
          <button key={l} onClick={() => key && setStatus(key)} className={`text-left rounded-lg border px-3 py-2 ${key && status === key ? 'border-bronze-600 bg-bronze-600/10' : 'border-black/10 bg-cream/40'} ${key ? 'cursor-pointer hover:border-bronze-600/60' : 'cursor-default'}`}>
            <div className="text-[10px] uppercase tracking-wide text-ink-700/50 font-medium">{l}</div>
            <div className={`text-xl font-extrabold ${l === 'Waiting for a pack' && v > 0 ? 'text-red-600' : 'text-ink-900'}`}>{v}</div>
            {l === 'Pack emails opened' && <div className="text-[10px] text-ink-700/50">{feedback.downloaded} downloaded</div>}
          </button>
        ))}
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search email or name…" className={inputCls + ' max-w-xs'} />
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls + ' max-w-[12rem]'}>
            <option value="all">All statuses</option><option value="active">Active</option><option value="due">Renewal due (14d)</option><option value="blocked">Waiting for a pack</option>
            <option value="paused">Paused</option><option value="expired">Expired</option><option value="cancelled">Cancelled</option>
          </select>
          <span className="text-sm text-ink-700/60">{filtered.length} shown</span>
          <div className="ml-auto flex gap-2">
            <button className={btnGhost} disabled={!!busy} onClick={() => { if (confirm('Send every pack and reminder that is due right now, to all active members?')) act({ action: 'deliver' }, 'deliver'); }}>{busy === 'deliver' ? 'Delivering…' : '⚡ Deliver everything due now'}</button>
            <button className={btnGhost} onClick={exportCsv}>Export CSV</button>
            <button className={btnGhost} onClick={() => setImportOpen(true)}>⇪ Import from old system</button>
            <button className={btnPrimary} onClick={() => setAddOpen(true)}>+ Add member</button>
          </div>
        </div>
        {msg.text && <div className="mt-2"><Toast message={msg.text} kind={msg.kind} /></div>}
      </Card>

      {loading ? <div className="text-sm text-ink-700/60">Loading…</div> : filtered.length === 0 ? (
        <Card><p className="text-sm text-ink-700/60">No memberships match the current filters.</p></Card>
      ) : (
        <div className="bg-white border border-black/10 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-ink-700/60 text-left bg-cream/40">
              <tr><th className="p-2">Member</th><th className="p-2">Plan</th><th className="p-2">Status</th><th className="p-2">Packs</th><th className="p-2">Next pack</th><th className="p-2">Ends</th><th className="p-2">Feedback</th><th className="p-2 text-right">Actions</th></tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const mine = logs.filter((l) => l.subscription_id === r.id);
                const myDl = downloads.filter((d) => d.subscription_id === r.id);
                const lastPack = mine.find((l) => (l.email_type === 'first_pack' || l.email_type === 'monthly_drop') && l.status === 'sent');
                const lastEv = lastPack?.provider_id ? events.filter((e) => e.provider_id === lastPack.provider_id) : [];
                const opened = lastEv.some((e) => e.event === 'opened' || e.event === 'clicked');
                const dlLast = lastPack ? myDl.some((d) => d.month === lastPack.drop_month.split('#')[0]) : false;
                const left = daysBetween(today, r.end_date);
                const blocked = r.status === 'active' && r.next_drop_date && r.next_drop_date <= today;
                const isOpen = open === r.id;
                return (
                  <>
                    <tr key={r.id} className={`border-t border-black/5 hover:bg-cream/30 cursor-pointer ${isOpen ? 'bg-bronze-600/5' : ''}`} onClick={() => setOpen(isOpen ? null : r.id)}>
                      <td className="p-2">
                        <div className="font-medium">{r.customer_name || r.email}</div>
                        {r.customer_name && <div className="text-xs text-ink-700/50">{r.email}</div>}
                        <div className="text-[10px] text-ink-700/45">{r.source || 'paddle'}{r.is_renewal && <span className="ml-1 bg-bronze-100 text-bronze-800 px-1 rounded">renewal</span>}{r.renewed_to && <span className="ml-1 bg-green-50 text-green-700 px-1 rounded">renewed</span>}</div>
                      </td>
                      <td className="p-2 whitespace-nowrap">{r.months}-mo{r.tier === 'premium' ? ' · Premium' : ''}</td>
                      <td className="p-2"><span className={`text-xs px-2 py-0.5 rounded ${STATUS_COLORS[r.status] || ''}`}>{r.status}</span></td>
                      <td className="p-2 whitespace-nowrap">
                        <span className="text-xs">{r.drops_sent} / {r.total_drops}</span>
                        <div className="h-1.5 bg-cream rounded mt-1 w-20 overflow-hidden"><div className="h-full bg-bronze-600" style={{ width: `${Math.round((r.drops_sent / Math.max(1, r.total_drops)) * 100)}%` }} /></div>
                      </td>
                      <td className={`p-2 text-xs whitespace-nowrap ${blocked ? 'text-red-600 font-medium' : 'text-ink-700/60'}`}>{r.next_drop_date || '—'}{blocked ? ' · waiting' : ''}</td>
                      <td className="p-2 text-xs whitespace-nowrap">{r.end_date}<div className={`text-[10px] ${left < 0 ? 'text-ink-700/40' : left <= 10 ? 'text-amber-700' : 'text-ink-700/50'}`}>{left < 0 ? `${-left}d ago` : `${left}d left`}</div></td>
                      <td className="p-2 text-[11px] whitespace-nowrap">
                        {lastPack ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-green-700">✓ sent</span>
                            <span className={opened ? 'text-green-700' : 'text-ink-700/40'}>{opened ? '✓ opened' : '· not opened'}</span>
                            <span className={dlLast ? 'text-green-700 font-medium' : 'text-ink-700/40'}>{dlLast ? '✓ downloaded' : '· no download'}</span>
                          </div>
                        ) : <span className="text-ink-700/40">no pack email yet</span>}
                      </td>
                      <td className="p-2 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        {r.status === 'active' && <button className={btnGhost} onClick={() => setStatusFor(r, 'paused')}>Pause</button>}
                        {r.status === 'paused' && <button className={btnGhost} onClick={() => setStatusFor(r, 'active')}>Resume</button>}
                        {(r.status === 'active' || r.status === 'paused') && <button className={btnDanger + ' ml-1'} onClick={() => { if (confirm(`Cancel ${r.email}'s membership? No further packs will send.`)) setStatusFor(r, 'cancelled'); }}>Cancel</button>}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr key={r.id + '-d'} className="bg-cream/30"><td colSpan={8} className="p-3">
                        <Timeline s={r} logs={mine} events={events} downloads={myDl} packs={packs} busy={busy} act={act} onSaved={() => load(true)} />
                      </td></tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add member (Etsy / manual)">
        <AddMemberForm plans={plans} onDone={() => { setAddOpen(false); load(); }} />
      </Modal>
      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Import members from the old system" wide>
        <ImportForm plans={plans} onDone={() => { setImportOpen(false); load(); }} />
      </Modal>
    </div>
  );
}

function Timeline({ s, logs, events, downloads, packs, busy, act, onSaved }: { s: Sub; logs: Log[]; events: Ev[]; downloads: Dl[]; packs: Record<string, { title: string | null; has: boolean }>; busy: string; act: (p: any, l: string) => Promise<void>; onSaved: () => void }) {
  const [end, setEnd] = useState(s.end_date);
  const [notes, setNotes] = useState(s.admin_notes || '');
  const [name, setName] = useState(s.customer_name || '');
  const months = Array.from({ length: s.total_drops }, (_, k) => addMonthsYM(s.start_date, k));
  const today = new Date().toISOString().slice(0, 7);
  const evFor = (pid: string | null) => pid ? events.filter((e) => e.provider_id === pid) : [];
  const first = (list: Ev[], ev: string) => { const x = list.filter((e) => e.event === ev).sort((a, b) => a.created_at.localeCompare(b.created_at))[0]; return x ? x.created_at : null; };
  return (
    <div className="grid lg:grid-cols-[1fr_320px] gap-4">
      <div>
        <div className="text-xs font-bold text-ink-900 mb-1">Packs in this term</div>
        <div className="space-y-1">
          {months.map((ym, i) => {
            const sent = logs.filter((l) => (l.email_type === 'first_pack' || l.email_type === 'monthly_drop') && l.drop_month.split('#')[0] === ym && l.status === 'sent');
            const dls = downloads.filter((d) => d.month === ym);
            const pack = packs[ym];
            const unlocked = ym <= today;
            const main = sent[0];
            const ev = evFor(main?.provider_id || null);
            return (
              <div key={ym} className="grid grid-cols-[110px_1fr_auto] gap-2 items-center text-[12px] bg-white rounded border border-black/5 px-2 py-1.5">
                <div><b>Pack {i + 1}</b> · {ymLabel(ym)}</div>
                <div className="text-ink-700/70 truncate">
                  {!unlocked ? <span className="text-ink-700/40">locked until {ymLabel(ym)}</span>
                    : !pack?.has ? <span className="text-red-600">pack not uploaded</span>
                    : !main ? <span className="text-amber-700">not sent yet</span>
                    : <>
                      <span className="text-green-700">sent {when(main.sent_at)}</span>
                      {first(ev, 'delivered') && <span> · delivered</span>}
                      {first(ev, 'opened') ? <span className="text-green-700"> · opened {when(first(ev, 'opened'))}</span> : <span className="text-ink-700/40"> · not opened</span>}
                      {first(ev, 'clicked') && <span className="text-green-700"> · clicked</span>}
                      {dls.length ? <span className="text-green-800 font-medium"> · downloaded ×{dls.length} (last {when(dls[0].created_at)})</span> : <span className="text-ink-700/40"> · no download yet</span>}
                      {sent.length > 1 && <span className="text-ink-700/50"> · re-sent ×{sent.length - 1}</span>}
                      {pack?.title ? <span className="text-ink-700/40"> · {pack.title}</span> : null}
                    </>}
                </div>
                <div>{unlocked && pack?.has && <button className={btnGhost + ' text-[11px] px-2 py-0.5'} disabled={!!busy} onClick={() => act({ action: 'resend', subscription: s.id, month: ym }, 'resend' + ym)}>{busy === 'resend' + ym ? '…' : '↻ re-send'}</button>}</div>
              </div>
            );
          })}
        </div>
        <div className="text-xs font-bold text-ink-900 mt-3 mb-1">Every email</div>
        {logs.length === 0 ? <div className="text-[12px] text-ink-700/50">Nothing sent yet.</div> : (
          <div className="space-y-0.5">
            {logs.map((l) => { const ev = evFor(l.provider_id); return (
              <div key={l.id} className="text-[12px] flex flex-wrap gap-x-2 text-ink-700/80">
                <span className="w-32 shrink-0 font-medium text-ink-900">{TYPE_LABEL[l.email_type] || l.email_type}</span>
                <span className="text-ink-700/50">{when(l.sent_at)}</span>
                <span className={l.status === 'sent' ? 'text-green-700' : 'text-red-600'}>{l.status}</span>
                {first(ev, 'delivered') && <span>delivered</span>}
                {first(ev, 'opened') && <span className="text-green-700">opened</span>}
                {first(ev, 'clicked') && <span className="text-green-700">clicked</span>}
                {ev.some((e) => e.event === 'bounced') && <span className="text-red-600">bounced</span>}
                {l.subject && <span className="text-ink-700/40 truncate">· {l.subject}</span>}
              </div>
            ); })}
          </div>
        )}
      </div>
      <div className="space-y-2">
        <div className="text-xs font-bold text-ink-900">Actions</div>
        <div className="flex flex-wrap gap-1">
          <button className={btnGhost + ' text-xs'} disabled={!!busy} onClick={() => act({ action: 'deliver', subscription: s.id }, 'deliver1')}>{busy === 'deliver1' ? '…' : '⚡ Deliver due now'}</button>
          <button className={btnGhost + ' text-xs'} disabled={!!busy} onClick={() => act({ action: 'reminder', subscription: s.id }, 'rem')}>{busy === 'rem' ? '…' : '✉ Send renewal reminder'}</button>
        </div>
        <label className={labelCls}>Term ends</label>
        <div className="flex gap-1"><input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={inputCls} /><button className={btnGhost + ' text-xs'} disabled={!!busy || end === s.end_date} onClick={() => act({ action: 'extend', subscription: s.id, end_date: end }, 'ext')}>Save</button></div>
        <label className={labelCls}>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="customer name" />
        <label className={labelCls}>Notes (admin only)</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} rows={3} />
        <button className={btnPrimary + ' text-xs'} disabled={!!busy} onClick={async () => { await act({ action: 'note', subscription: s.id, admin_notes: notes, customer_name: name }, 'note'); onSaved(); }}>Save details</button>
        <div className="text-[11px] text-ink-700/50 pt-1">
          {s.notes && <div>Note at add: {s.notes}</div>}
          {s.price_usd != null && <div>Paid ${Number(s.price_usd).toFixed(2)}</div>}
          {s.last_download_at && <div>Last download {when(s.last_download_at)}</div>}
          <div>Member id {s.id.slice(0, 8)}</div>
        </div>
      </div>
    </div>
  );
}

// Paste rows from the old system: email, name, plan, start date, packs already
// received. Dry run first, then import. Nothing already sent is sent again;
// months the member is owed since then go out immediately.
function ImportForm({ plans, onDone }: { plans: any[]; onDone: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<any>(null);
  const parse = () => text.split('\n').map((l) => l.trim()).filter(Boolean).filter((l) => !/^email\b/i.test(l)).map((l) => {
    const c = l.split(/[,\t;]/).map((x) => x.trim());
    return { email: c[0], name: c[1] || null, plan_slug: /^\d+$/.test(c[2] || '') ? null : c[2], months: /^\d+$/.test(c[2] || '') ? Number(c[2]) : null, start_date: c[3], packs_received: Number(c[4]) || 0, notes: c[5] || null };
  });
  async function go(dry: boolean) {
    const rows = parse();
    if (!rows.length) return;
    if (!dry && !confirm(`Import ${rows.length} member(s)? Months they are owed since their start date are emailed right away.`)) return;
    setBusy(true);
    const { data: { session } } = await supabase.auth.getSession();
    const r = await fetch('/api/admin/membership/import', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${session?.access_token || ''}` }, body: JSON.stringify({ rows, dry }) }).then((x) => x.json()).catch(() => ({ error: 'bad response' }));
    setBusy(false); setReport(r);
    if (!dry && r?.ok) setTimeout(onDone, 1500);
  }
  return (
    <div className="space-y-3">
      <p className="text-[12px] text-ink-700/70">One member per line: <code>email, name, plan, start date, packs already received</code>. Plan = a plan slug ({plans.map((p) => p.slug).join(', ')}) or just the number of months. Start date as YYYY-MM-DD. Header line optional.</p>
      <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} className={inputCls + ' font-mono text-xs w-full'} placeholder={'jane@example.com, Jane Doe, 3-month, 2026-07-15, 2\nbob@example.com, , 6, 2026-05-01, 4'} />
      <div className="flex items-center gap-2">
        <button className={btnGhost} disabled={busy || !text.trim()} onClick={() => go(true)}>{busy ? '…' : 'Dry run'}</button>
        <button className={btnPrimary} disabled={busy || !text.trim()} onClick={() => go(false)}>{busy ? '…' : 'Import'}</button>
        {report && !report.error && <span className="text-xs text-ink-700/70">{report.dry ? 'Would create' : 'Created'} {report.created} · skipped {report.skipped} · failed {report.failed}</span>}
        {report?.error && <span className="text-xs text-red-600">{report.error}</span>}
      </div>
      {report?.rows && (
        <div className="max-h-56 overflow-y-auto text-[12px] space-y-0.5">
          {report.rows.map((r: any, i: number) => <div key={i} className={/created|would create/.test(r.result) ? 'text-green-700' : /skipped|already/.test(r.result) ? 'text-ink-700/60' : 'text-red-600'}>{r.email}: {r.result}</div>)}
        </div>
      )}
    </div>
  );
}

function AddMemberForm({ plans, onDone }: { plans: any[]; onDone: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [planSlug, setPlanSlug] = useState(plans[0]?.slug || '');
  const [startDate, setStartDate] = useState(today);
  const [source, setSource] = useState('etsy');
  const [price, setPrice] = useState('');
  const [coupon, setCoupon] = useState('');
  const [notes, setNotes] = useState('');
  const [packs, setPacks] = useState('0');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'info'; text: string }>({ kind: 'info', text: '' });
  useEffect(() => { if (!planSlug && plans[0]) setPlanSlug(plans[0].slug); }, [plans]);

  async function save() {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setMsg({ kind: 'error', text: 'Enter a valid email.' }); return; }
    if (!planSlug) { setMsg({ kind: 'error', text: 'Pick a plan.' }); return; }
    setBusy(true); setMsg({ kind: 'info', text: 'Adding member and sending every pack that is already due…' });
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch('/api/admin/membership/add', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${session?.access_token || ''}` },
      body: JSON.stringify({ email, name, plan_slug: planSlug, start_date: startDate, source, price: price || null, coupon_code: coupon || null, notes: notes || null, packs_received: Number(packs) || 0 }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok || data.error) { setMsg({ kind: 'error', text: data.error || 'Failed to add member.' }); return; }
    setMsg({ kind: 'success', text: data.created ? `✓ Member added${data.chainedFrom ? ', chained after their current term' : ''}. Due packs sent.` : `Skipped (${data.reason || 'already exists'}).` });
    setTimeout(onDone, 900);
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div><label className={labelCls}>Email *</label><input value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder="buyer@email.com" /></div>
        <div><label className={labelCls}>Name</label><input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="optional" /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className={labelCls}>Plan *</label>
          <select value={planSlug} onChange={(e) => setPlanSlug(e.target.value)} className={inputCls}>{plans.map((p) => <option key={p.slug} value={p.slug}>{p.name} ({p.months} mo · ${p.price_usd})</option>)}</select></div>
        <div><label className={labelCls}>Start date * <span className="text-ink-700/40">(backdate for an Etsy sale; every past month sends now)</span></label><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className={labelCls}>Source</label>
          <select value={source} onChange={(e) => setSource(e.target.value)} className={inputCls}><option value="etsy">Etsy</option><option value="manual">Manual</option><option value="import">Import</option><option value="website">Website</option></select></div>
        <div><label className={labelCls}>Price charged <span className="text-ink-700/40">(blank = plan price)</span></label><input value={price} onChange={(e) => setPrice(e.target.value)} className={inputCls} placeholder="auto" /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className={labelCls}>Coupon <span className="text-ink-700/40">(internal note)</span></label><input value={coupon} onChange={(e) => setCoupon(e.target.value)} className={inputCls} /></div>
        <div><label className={labelCls}>Notes</label><input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} placeholder="Etsy order number, etc." /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className={labelCls}>Packs already received <span className="text-ink-700/40">(moving from the old system: those months are not sent again)</span></label><input type="number" min={0} value={packs} onChange={(e) => setPacks(e.target.value)} className={inputCls} /></div>
      </div>
      <div className="flex items-center gap-3 border-t border-black/10 pt-3">
        <button disabled={busy} onClick={save} className={btnPrimary}>{busy ? 'Working…' : 'Add & send'}</button>
        <Toast message={msg.text} kind={msg.kind} />
      </div>
    </div>
  );
}
