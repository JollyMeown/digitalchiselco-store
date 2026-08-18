import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { Card, Modal, btnGhost, btnDanger, btnPrimary, inputCls, labelCls, Toast } from '../ui';
import { useLiveRefresh } from '../useLiveRefresh';

type Pack = {
  id: string;
  month: string;               // 'YYYY-MM'
  title: string | null;
  preview_note: string | null;
  standard_drive_link: string | null;
  bonus_drive_link: string | null;
  created_at: string;
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const label = (m: string) => { const [y, mo] = m.split('-').map(Number); return `${MONTHS[mo - 1]} ${y}`; };

export default function MonthlyDrops() {
  const [rows, setRows] = useState<Pack[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Pack | 'new' | null>(null);

  useEffect(() => { load(); }, []);
  useLiveRefresh(() => load(true), 30000);   // keep this tab live (silent, pauses while editing)
  async function load(silent = false) {
    if (!silent) setLoading(true);
    const { data } = await supabase.from('monthly_files').select('*').order('month', { ascending: false });
    setRows((data ?? []) as Pack[]); setLoading(false);
  }

  async function del(p: Pack) {
    if (!confirm(`Delete the ${label(p.month)} pack? Members already dropped this month keep their email link, but the portal entry disappears.`)) return;
    await supabase.from('monthly_files').delete().eq('id', p.id);
    load();
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h2 className="font-medium text-ink-900">Monthly file packs</h2>
            <p className="text-sm text-ink-700/60">One row per calendar month. Members receive the Standard link; 12-month (Premium) members also get the Bonus link.</p>
          </div>
          <button className={btnPrimary + ' ml-auto'} onClick={() => setOpen('new')}>+ Add month</button>
        </div>
      </Card>

      {loading ? <div className="text-sm text-ink-700/60">Loading…</div> : rows.length === 0 ? (
        <Card><p className="text-sm text-ink-700/60">No monthly packs yet. Add one for the current month so new members get their first drop.</p></Card>
      ) : (
        <div className="bg-white border border-black/10 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-ink-700/60 text-left bg-cream/40">
              <tr><th className="p-2">Month</th><th className="p-2">Title</th><th className="p-2">Standard</th><th className="p-2">Bonus</th><th className="p-2 text-right">Actions</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-black/5 hover:bg-cream/30">
                  <td className="p-2 whitespace-nowrap font-medium">{label(r.month)}</td>
                  <td className="p-2">{r.title || <span className="text-ink-700/40">—</span>}</td>
                  <td className="p-2">{r.standard_drive_link ? <a href={r.standard_drive_link} target="_blank" rel="noreferrer" className="text-bronze-700 underline">link ✓</a> : <span className="text-red-600 text-xs">missing</span>}</td>
                  <td className="p-2">{r.bonus_drive_link ? <a href={r.bonus_drive_link} target="_blank" rel="noreferrer" className="text-bronze-700 underline">link ✓</a> : <span className="text-ink-700/40 text-xs">—</span>}</td>
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

      <Modal open={!!open} onClose={() => setOpen(null)} title={open === 'new' ? 'Add monthly pack' : 'Edit monthly pack'}>
        {open && <PackForm p={open === 'new' ? null : (open as Pack)} onDone={() => { setOpen(null); load(); }} />}
      </Modal>
    </div>
  );
}

function PackForm({ p, onDone }: { p: Pack | null; onDone: () => void }) {
  const thisMonth = new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState(p?.month || thisMonth);
  const [title, setTitle] = useState(p?.title || '');
  const [note, setNote] = useState(p?.preview_note || '');
  const [std, setStd] = useState(p?.standard_drive_link || '');
  const [bonus, setBonus] = useState(p?.bonus_drive_link || '');
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'info'; text: string }>({ kind: 'info', text: '' });
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!/^\d{4}-\d{2}$/.test(month)) { setMsg({ kind: 'error', text: 'Month must be YYYY-MM.' }); return; }
    setBusy(true);
    const payload = {
      month, title: title.trim() || null, preview_note: note.trim() || null,
      standard_drive_link: std.trim() || null, bonus_drive_link: bonus.trim() || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = p
      ? await supabase.from('monthly_files').update(payload).eq('id', p.id)
      : await supabase.from('monthly_files').upsert(payload, { onConflict: 'month' });
    setBusy(false);
    if (error) { setMsg({ kind: 'error', text: error.message }); return; }
    setMsg({ kind: 'success', text: '✓ Saved' });
    setTimeout(onDone, 500);
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Month</label>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={inputCls} disabled={!!p} />
        </div>
        <div>
          <label className={labelCls}>Title <span className="text-ink-700/40">(shown in email)</span></label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} placeholder="e.g. June 2026 — Floral" />
        </div>
      </div>
      <div>
        <label className={labelCls}>Preview note <span className="text-ink-700/40">(short caption in the drop email)</span></label>
        <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} placeholder="8 fresh floral bas-relief designs this month." />
      </div>
      <div>
        <label className={labelCls}>Standard Drive link <span className="text-ink-700/40">(all members)</span></label>
        <input value={std} onChange={(e) => setStd(e.target.value)} className={inputCls} placeholder="https://drive.google.com/…" />
      </div>
      <div>
        <label className={labelCls}>Bonus Drive link <span className="text-ink-700/40">(Premium / 12-month only)</span></label>
        <input value={bonus} onChange={(e) => setBonus(e.target.value)} className={inputCls} placeholder="https://drive.google.com/…" />
      </div>
      <div className="flex items-center gap-3 border-t border-black/10 pt-3">
        <button disabled={busy} onClick={save} className={btnPrimary}>{busy ? 'Saving…' : (p ? 'Save changes' : 'Add pack')}</button>
        <Toast message={msg.text} kind={msg.kind} />
      </div>
    </div>
  );
}
