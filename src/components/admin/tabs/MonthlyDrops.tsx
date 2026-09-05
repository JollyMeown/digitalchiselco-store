// Monthly packs: one row per calendar month. Each pack shows who is entitled,
// who was sent it, who opened it and who downloaded it, with a cover picture
// and the designs inside (filled by the BRS pack builder or by hand). Missing
// months inside the horizon are flagged before they block a member.
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { Card, Modal, btnGhost, btnDanger, btnPrimary, inputCls, labelCls, Toast } from '../ui';
import { useLiveRefresh } from '../useLiveRefresh';

type Pack = {
  id: string; month: string; title: string | null; preview_note: string | null; standard_drive_link: string | null; bonus_drive_link: string | null;
  cover_image_url: string | null; items: { title: string; slug?: string | null; image_url?: string | null }[]; bonus_items: { title: string; slug?: string | null; image_url?: string | null }[]; file_count: number | null; built_by: string | null; notes: string | null; created_at: string;
  link_history: { standard_drive_link?: string | null; bonus_drive_link?: string | null; title?: string | null; built_by?: string | null; replaced_at?: string | null }[];
};
type Sub = { id: string; email: string; status: string; start_date: string; total_drops: number; tier: string };
type Log = { subscription_id: string; email_type: string; drop_month: string; status: string; provider_id: string | null; pack_snapshot?: { standard_drive_link?: string | null; title?: string | null } | null };
type Dl = { subscription_id: string; month: string };

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const label = (m: string) => { const [y, mo] = m.split('-').map(Number); return `${MONTHS[mo - 1]} ${y}`; };
const addYM = (ym: string, n: number) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7); };
const termMonths = (s: Sub) => Array.from({ length: s.total_drops }, (_, k) => addYM(s.start_date.slice(0, 7), k));

export default function MonthlyDrops() {
  const [rows, setRows] = useState<Pack[]>([]);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [dls, setDls] = useState<Dl[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Pack | 'new' | null>(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'info'; text: string }>({ kind: 'info', text: '' });

  useEffect(() => { load(); }, []);
  useLiveRefresh(() => load(true), 30000);
  async function load(silent = false) {
    if (!silent) setLoading(true);
    const [{ data: pk }, { data: sb }, { data: lg }, { data: dl }, { data: gs }] = await Promise.all([
      supabase.from('monthly_files').select('*').order('month', { ascending: false }),
      supabase.from('member_subscriptions').select('id, email, status, start_date, total_drops, tier').in('status', ['active', 'paused', 'expired']),
      supabase.from('subscription_email_logs').select('subscription_id, email_type, drop_month, status, provider_id, pack_snapshot').in('email_type', ['first_pack', 'monthly_drop', 'imported']).eq('status', 'sent').order('sent_at', { ascending: true }).limit(5000),
      supabase.from('pack_downloads').select('subscription_id, month').limit(5000),
      supabase.from('growth_settings').select('membership_reminder_days, membership_winback_days, membership_winback_coupon, membership_pack_alert_days').eq('id', 1).maybeSingle(),
    ]);
    setRows(((pk ?? []) as any[]).map((p) => ({ ...p, items: Array.isArray(p.items) ? p.items : [], bonus_items: Array.isArray(p.bonus_items) ? p.bonus_items : [], link_history: Array.isArray(p.link_history) ? p.link_history : [] })) as Pack[]);
    setSubs((sb ?? []) as Sub[]); setLogs((lg ?? []) as Log[]); setDls((dl ?? []) as Dl[]); setSettings(gs || {});
    const ids = [...new Set((lg || []).map((l: any) => l.provider_id).filter(Boolean))] as string[];
    const op = new Set<string>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await supabase.from('email_events').select('provider_id').in('provider_id', ids.slice(i, i + 200)).in('event', ['opened', 'clicked']).limit(5000);
      for (const e of data || []) op.add(e.provider_id);
    }
    setOpened(op); setLoading(false);
  }

  async function act(payload: any, key: string) {
    setBusy(key); setMsg({ kind: 'info', text: '' });
    const { data: { session } } = await supabase.auth.getSession();
    const r = await fetch('/api/admin/membership/deliver', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${session?.access_token || ''}` }, body: JSON.stringify(payload) }).then((x) => x.json()).catch(() => ({ error: 'bad response' }));
    setBusy(''); setMsg(r?.error ? { kind: 'error', text: r.error } : { kind: 'success', text: r.message || 'Done.' }); load(true);
  }

  // per-month numbers
  const stats = useMemo(() => {
    const m: Record<string, { entitled: number; sent: number; opened: number; downloaded: number; waiting: number }> = {};
    const today = new Date().toISOString().slice(0, 7);
    const sentBy: Record<string, Log> = {};
    for (const l of logs) sentBy[`${l.subscription_id}|${l.drop_month.split('#')[0]}`] ||= l;
    const dlSet = new Set(dls.map((d) => `${d.subscription_id}|${d.month}`));
    for (const s of subs) for (const ym of termMonths(s)) {
      const st = (m[ym] ||= { entitled: 0, sent: 0, opened: 0, downloaded: 0, waiting: 0 });
      st.entitled++;
      const l = sentBy[`${s.id}|${ym}`];
      if (l) { st.sent++; if (l.provider_id && opened.has(l.provider_id)) st.opened++; }
      else if (ym <= today && s.status === 'active') st.waiting++;
      if (dlSet.has(`${s.id}|${ym}`)) st.downloaded++;
    }
    return m;
  }, [subs, logs, dls, opened]);

  // members whose delivered snapshot of this month points at different files than the row holds now
  const heldOld = (r: Pack) => new Set(logs.filter((l) => l.drop_month.split('#')[0] === r.month && l.pack_snapshot?.standard_drive_link && l.pack_snapshot.standard_drive_link !== r.standard_drive_link).map((l) => l.subscription_id)).size;

  // months in the horizon (this month + next two) that have no pack yet
  const missing = useMemo(() => {
    const thisYM = new Date().toISOString().slice(0, 7);
    const have = new Set(rows.filter((r) => r.standard_drive_link || r.bonus_drive_link).map((r) => r.month));
    return [0, 1, 2].map((n) => addYM(thisYM, n)).filter((ym) => !have.has(ym) && (stats[ym]?.entitled || 0) > 0);
  }, [rows, stats]);

  async function del(p: Pack) {
    if (!confirm(`Delete the ${label(p.month)} pack? Members already emailed keep their tracked links, but those links will stop working.`)) return;
    await supabase.from('monthly_files').delete().eq('id', p.id); load();
  }

  return (
    <div className="space-y-4">
      {missing.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <b>Pack missing:</b> {missing.map(label).join(', ')}. {missing.map((ym) => stats[ym]?.entitled || 0).reduce((a, b) => a + b, 0)} membership month(s) expect these. Members are held, not skipped, until the link is added; the owner gets a Telegram nudge each day this stays open.
        </div>
      )}
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h2 className="font-medium text-ink-900">Monthly file packs</h2>
            <p className="text-sm text-ink-700/60">One row per calendar month. Every member gets the Standard link; 12-month (Premium) members also get Bonus. Links in emails and the portal are tracked, so downloads are counted.</p>
          </div>
          <div className="ml-auto flex gap-2">
            <button className={btnGhost} disabled={!!busy} onClick={() => act({ action: 'deliver' }, 'deliver')}>{busy === 'deliver' ? 'Delivering…' : '⚡ Deliver everything due now'}</button>
            <button className={btnPrimary} onClick={() => setOpen('new')}>+ Add month</button>
          </div>
        </div>
        {msg.text && <div className="mt-2"><Toast message={msg.text} kind={msg.kind} /></div>}
      </Card>

      {loading ? <div className="text-sm text-ink-700/60">Loading…</div> : rows.length === 0 ? (
        <Card><p className="text-sm text-ink-700/60">No monthly packs yet. Add one for the current month so new members get their first drop.</p></Card>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const st = stats[r.month] || { entitled: 0, sent: 0, opened: 0, downloaded: 0, waiting: 0 };
            const has = !!(r.standard_drive_link || r.bonus_drive_link);
            return (
              <div key={r.id} className="bg-white border border-black/10 rounded-lg p-3 flex flex-wrap gap-3 items-start">
                {r.cover_image_url ? <img src={r.cover_image_url} alt="" className="w-24 h-24 object-cover rounded-md border border-black/10" /> : <div className="w-24 h-24 rounded-md bg-cream/60 border border-dashed border-black/10 grid place-items-center text-[10px] text-ink-700/40">no cover</div>}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <div className="font-semibold text-ink-900">{label(r.month)}</div>
                    <div className="text-sm text-ink-700/70">{r.title || <span className="text-ink-700/40">untitled</span>}</div>
                    {r.built_by === 'brs' && <span className="text-[10px] bg-bronze-100 text-bronze-800 px-1.5 rounded">built by BRS</span>}
                    {!has && <span className="text-[10px] bg-red-100 text-red-700 px-1.5 rounded">no link yet</span>}
                  </div>
                  {r.preview_note && <div className="text-xs text-ink-700/60 mt-0.5">{r.preview_note}</div>}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] mt-1.5">
                    <span><b>{st.entitled}</b> entitled</span>
                    <span className="text-green-700"><b>{st.sent}</b> sent</span>
                    <span className={st.opened ? 'text-green-700' : 'text-ink-700/50'}><b>{st.opened}</b> opened</span>
                    <span className={st.downloaded ? 'text-green-800' : 'text-ink-700/50'}><b>{st.downloaded}</b> downloaded</span>
                    {st.waiting > 0 && <span className="text-red-600"><b>{st.waiting}</b> waiting</span>}
                    <span className="text-ink-700/50">{r.items.length ? `${r.items.length} designs listed` : 'designs not listed'}{r.file_count ? ` · ${r.file_count} files` : ''}</span>
                  </div>
                  {r.items.length > 0 && (
                    <div className="flex gap-1 mt-2 overflow-x-auto">
                      {r.items.slice(0, 8).map((it, i) => it.image_url ? <img key={i} src={it.image_url} alt={it.title} title={it.title} className="w-10 h-10 object-cover rounded border border-black/10 shrink-0" /> : <span key={i} className="text-[10px] bg-cream px-1.5 py-1 rounded shrink-0">{it.title}</span>)}
                    </div>
                  )}
                  {r.bonus_items.length > 0 && (
                    <div className="flex items-center gap-1 mt-2 overflow-x-auto">
                      <span className="text-[10px] uppercase tracking-wide text-bronze-700 font-semibold shrink-0 mr-1">⭐ Premium bonus</span>
                      {r.bonus_items.slice(0, 4).map((it, i) => it.image_url ? <img key={i} src={it.image_url} alt={it.title} title={it.title} className="w-10 h-10 object-cover rounded border border-[#F1D9A6] shrink-0" /> : <span key={i} className="text-[10px] bg-[#FFF8E8] px-1.5 py-1 rounded shrink-0">{it.title}</span>)}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-3 text-[11px] mt-1.5">
                    {r.standard_drive_link ? <a href={r.standard_drive_link} target="_blank" rel="noreferrer" className="text-bronze-700 underline">standard link ↗</a> : <span className="text-red-600">standard link missing</span>}
                    {r.bonus_drive_link ? <a href={r.bonus_drive_link} target="_blank" rel="noreferrer" className="text-bronze-700 underline">bonus link ↗</a> : <span className="text-ink-700/40">no bonus link</span>}
                  </div>
                  {heldOld(r) > 0 && (
                    <div className="mt-1.5 text-[11px] text-ink-700/70">🔒 {heldOld(r)} member{heldOld(r) === 1 ? '' : 's'} received an earlier version of this pack and keep it in their account; members who get this month from now on receive the current files.</div>
                  )}
                  {r.link_history.length > 0 && (
                    <details className="mt-1.5 text-[11px]">
                      <summary className="cursor-pointer text-ink-700/60 hover:text-ink-900">Previous links ({r.link_history.length}) kept for reference</summary>
                      <ul className="mt-1 space-y-0.5 pl-3 border-l border-[#F1D9A6]">
                        {[...r.link_history].reverse().map((h, i) => (
                          <li key={i} className="flex flex-wrap gap-2 items-baseline">
                            <span className="text-ink-700/50">{h.replaced_at ? new Date(h.replaced_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}</span>
                            {h.title && <span className="text-ink-700/70">{h.title}</span>}
                            {h.built_by && <span className="text-[10px] bg-cream-100 px-1 rounded">{h.built_by}</span>}
                            {h.standard_drive_link && <a href={h.standard_drive_link} target="_blank" rel="noreferrer" className="text-bronze-700 underline">old standard ↗</a>}
                            {h.bonus_drive_link && <a href={h.bonus_drive_link} target="_blank" rel="noreferrer" className="text-bronze-700 underline">old bonus ↗</a>}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
                <div className="flex flex-col gap-1 items-end">
                  <div className="flex gap-1">
                    <button className={btnGhost} onClick={() => setOpen(r)}>Edit</button>
                    <button className={btnDanger} onClick={() => del(r)}>Delete</button>
                  </div>
                  <button className={btnGhost + ' text-xs'} disabled={!!busy || !has} onClick={() => act({ action: 'test', month: r.month }, 'test' + r.month)}>{busy === 'test' + r.month ? '…' : '✉ test to me'}</button>
                  {st.waiting > 0 && has && <button className={btnPrimary + ' text-xs'} disabled={!!busy} onClick={() => act({ action: 'deliver' }, 'deliver')}>Send to {st.waiting} waiting</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {settings && <SettingsCard s={settings} onSaved={() => load(true)} />}

      <Modal open={!!open} onClose={() => setOpen(null)} title={open === 'new' ? 'Add monthly pack' : 'Edit monthly pack'} wide>
        {open && <PackForm p={open === 'new' ? null : (open as Pack)} onDone={() => { setOpen(null); load(); }} />}
      </Modal>
    </div>
  );
}

function SettingsCard({ s, onSaved }: { s: any; onSaved: () => void }) {
  const [days, setDays] = useState(String(s.membership_reminder_days ?? '10,3'));
  const [wb, setWb] = useState(String(s.membership_winback_days ?? 14));
  const [coupon, setCoupon] = useState(String(s.membership_winback_coupon ?? 'COMEBACK15'));
  const [alert, setAlert] = useState(String(s.membership_pack_alert_days ?? 7));
  const [msg, setMsg] = useState('');
  async function save() {
    const { error } = await supabase.from('growth_settings').update({
      membership_reminder_days: days.split(',').map((x) => x.trim()).filter((x) => /^\d+$/.test(x)).join(',') || '10,3',
      membership_winback_days: Math.max(0, Number(wb) || 0), membership_winback_coupon: coupon.trim().toUpperCase(), membership_pack_alert_days: Math.max(1, Number(alert) || 7),
    }).eq('id', 1);
    setMsg(error ? error.message : '✓ Saved'); onSaved();
  }
  return (
    <Card>
      <div className="text-sm font-medium text-ink-900 mb-2">Membership automation settings</div>
      <div className="grid sm:grid-cols-4 gap-3">
        <div><label className={labelCls}>Reminder days before end</label><input value={days} onChange={(e) => setDays(e.target.value)} className={inputCls} placeholder="10,3" /><div className="text-[10px] text-ink-700/50">one reminder at each, comma separated</div></div>
        <div><label className={labelCls}>Win-back after expiry (days)</label><input value={wb} onChange={(e) => setWb(e.target.value)} className={inputCls} /><div className="text-[10px] text-ink-700/50">0 = off</div></div>
        <div><label className={labelCls}>Win-back coupon code</label><input value={coupon} onChange={(e) => setCoupon(e.target.value)} className={inputCls} /><div className="text-[10px] text-ink-700/50">must exist in Discounts</div></div>
        <div><label className={labelCls}>Warn me if next pack missing (days before)</label><input value={alert} onChange={(e) => setAlert(e.target.value)} className={inputCls} /></div>
      </div>
      <div className="mt-2 flex items-center gap-3"><button className={btnPrimary + ' text-xs'} onClick={save}>Save settings</button><span className="text-xs text-ink-700/60">{msg}</span></div>
      <p className="text-[11px] text-ink-700/50 mt-2">The nightly run sends due packs (catching up any missed months in one go), the reminders, the end-of-term email and the win-back, and it tells you on Telegram when a pack is missing or a send fails. Every membership email is buyer-critical: it never waits behind marketing mail.</p>
    </Card>
  );
}

function PackForm({ p, onDone }: { p: Pack | null; onDone: () => void }) {
  const thisMonth = new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState(p?.month || thisMonth);
  const [title, setTitle] = useState(p?.title || '');
  const [note, setNote] = useState(p?.preview_note || '');
  const [std, setStd] = useState(p?.standard_drive_link || '');
  const [bonus, setBonus] = useState(p?.bonus_drive_link || '');
  const [cover, setCover] = useState(p?.cover_image_url || '');
  const toLines = (list: { title: string; slug?: string | null; image_url?: string | null }[]) => (list || []).map((i) => [i.title, i.slug || '', i.image_url || ''].join(' | ')).join('\n');
  const [items, setItems] = useState(toLines(p?.items || []));
  const [bonusItems, setBonusItems] = useState(toLines(p?.bonus_items || []));
  const [notes, setNotes] = useState(p?.notes || '');
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'info'; text: string }>({ kind: 'info', text: '' });
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!/^\d{4}-\d{2}$/.test(month)) { setMsg({ kind: 'error', text: 'Month must be YYYY-MM.' }); return; }
    setBusy(true);
    const parse = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [t, s, img] = l.split('|').map((x) => x.trim()); return { title: t, slug: s || null, image_url: img || null }; });
    const payload: any = {
      month, title: title.trim() || null, preview_note: note.trim() || null,
      standard_drive_link: std.trim() || null, bonus_drive_link: bonus.trim() || null,
      cover_image_url: cover.trim() || null, items: parse(items), bonus_items: parse(bonusItems), notes: notes.trim() || null, updated_at: new Date().toISOString(),
    };
    if (!p) payload.built_by = 'manual';
    const { error } = p ? await supabase.from('monthly_files').update(payload).eq('id', p.id) : await supabase.from('monthly_files').upsert(payload, { onConflict: 'month' });
    setBusy(false);
    if (error) { setMsg({ kind: 'error', text: error.message }); return; }
    setMsg({ kind: 'success', text: '✓ Saved. Members waiting for this month receive it on the next run, or press Deliver now.' });
    setTimeout(onDone, 900);
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div><label className={labelCls}>Month</label><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={inputCls} disabled={!!p} /></div>
        <div><label className={labelCls}>Title <span className="text-ink-700/40">(shown in the email and portal)</span></label><input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} placeholder="e.g. September 2026: Woodland Wildlife" /></div>
      </div>
      <div><label className={labelCls}>Preview note <span className="text-ink-700/40">(one sentence)</span></label><input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} placeholder="Eight fresh wildlife reliefs, from a whitetail buck to a pair of loons." /></div>
      <div><label className={labelCls}>Standard Drive link <span className="text-ink-700/40">(all members)</span></label><input value={std} onChange={(e) => setStd(e.target.value)} className={inputCls} placeholder="https://drive.google.com/…" /></div>
      <div><label className={labelCls}>Bonus Drive link <span className="text-ink-700/40">(Premium / 12-month only)</span></label><input value={bonus} onChange={(e) => setBonus(e.target.value)} className={inputCls} placeholder="https://drive.google.com/…" /></div>
      <div><label className={labelCls}>Cover image URL <span className="text-ink-700/40">(shown at the top of the pack email)</span></label><input value={cover} onChange={(e) => setCover(e.target.value)} className={inputCls} placeholder="https://…jpg" /></div>
      <div><label className={labelCls}>Designs inside, one per line: <code>Title | product-slug | image url</code> <span className="text-ink-700/40">(the BRS pack builder fills this automatically)</span></label><textarea rows={5} value={items} onChange={(e) => setItems(e.target.value)} className={inputCls + ' font-mono text-xs'} /></div>
      <div><label className={labelCls}>⭐ Premium bonus designs, same format <span className="text-ink-700/40">(shown to 12-month members in the pack email and portal, with the Bonus link above)</span></label><textarea rows={2} value={bonusItems} onChange={(e) => setBonusItems(e.target.value)} className={inputCls + ' font-mono text-xs'} placeholder={'Bald Eagle Head | bald-eagle-head-3d-relief-stl | https://…jpg\nHowling Wolf | howling-wolf-moon-3d-relief-stl | https://…jpg'} /></div>
      <div><label className={labelCls}>Notes (admin only)</label><input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} /></div>
      <div className="flex items-center gap-3 border-t border-black/10 pt-3">
        <button disabled={busy} onClick={save} className={btnPrimary}>{busy ? 'Saving…' : (p ? 'Save changes' : 'Add pack')}</button>
        <Toast message={msg.text} kind={msg.kind} />
      </div>
    </div>
  );
}
