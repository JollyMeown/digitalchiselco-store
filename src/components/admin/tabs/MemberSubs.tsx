import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { Card, Modal, btnGhost, btnDanger, btnPrimary, inputCls, labelCls, Toast } from '../ui';

type Sub = {
  id: string;
  email: string;
  customer_name: string | null;
  plan_slug: string;
  months: number;
  tier: string;
  status: string;
  start_date: string;
  end_date: string;
  next_drop_date: string | null;
  drops_sent: number;
  total_drops: number;
  price_usd: number | null;
  is_renewal: boolean;
  created_at: string;
};

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  paused: 'bg-amber-100 text-amber-800',
  cancelled: 'bg-red-100 text-red-700',
  expired: 'bg-gray-100 text-gray-600',
};

export default function MemberSubs() {
  const [rows, setRows] = useState<Sub[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [plans, setPlans] = useState<any[]>([]);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    load();
    supabase.from('membership_plans').select('slug, name, months, price_usd').order('sort_order').then(({ data }) => setPlans(data || []));
  }, []);
  async function load() {
    setLoading(true);
    const { data } = await supabase.from('member_subscriptions').select('*').order('created_at', { ascending: false }).limit(2000);
    setRows((data ?? []) as Sub[]); setLoading(false);
  }

  const filtered = useMemo(() => {
    let r = rows;
    if (status !== 'all') r = r.filter((x) => x.status === status);
    if (search.trim()) { const q = search.toLowerCase(); r = r.filter((x) => x.email.toLowerCase().includes(q) || (x.customer_name || '').toLowerCase().includes(q)); }
    return r;
  }, [rows, search, status]);

  const counts = useMemo(() => {
    const c = { active: 0, paused: 0, expired: 0, cancelled: 0 };
    for (const r of rows) if (r.status in c) (c as any)[r.status]++;
    return c;
  }, [rows]);

  async function setStatusFor(s: Sub, next: string) {
    const patch: any = { status: next };
    if (next === 'cancelled') { patch.cancelled_at = new Date().toISOString(); patch.next_drop_date = null; }
    if (next === 'paused') { patch.paused_at = new Date().toISOString(); }
    if (next === 'active' && s.status === 'paused') { patch.paused_at = null; }
    await supabase.from('member_subscriptions').update(patch).eq('id', s.id);
    load();
  }

  function exportCsv() {
    const head = 'email,name,plan,tier,status,start,end,drops_sent,total_drops,next_drop,price\n';
    const body = filtered.map((r) => [r.email, r.customer_name || '', r.plan_slug, r.tier, r.status, r.start_date, r.end_date, r.drops_sent, r.total_drops, r.next_drop_date || '', r.price_usd ?? ''].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([head + body], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `member-subscriptions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  return (
    <div className="space-y-4">
      <div className="text-xs text-ink-700/60 bg-cream/40 border border-bronze-600/15 rounded-lg px-3 py-2">
        💡 <b>+ Add member</b> is for Etsy buyers (website/Paddle purchases add themselves automatically + email pack&nbsp;1). Your original standalone admin still lives at <a className="underline text-bronze-700" href="https://digitalchiselco-admin.netlify.app" target="_blank" rel="noreferrer">digitalchiselco-admin.netlify.app</a> (sign in as jolly@digitalchiselco.com) — note it uses a <b>separate database</b>; this new admin is now the primary system.
      </div>
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search email or name…" className={inputCls + ' max-w-xs'} />
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls + ' max-w-[10rem]'}>
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="expired">Expired</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <span className="text-sm text-ink-700/60">{filtered.length} shown · {counts.active} active · {counts.paused} paused · {counts.expired} expired</span>
          <div className="ml-auto flex gap-2">
            <button className={btnGhost} onClick={exportCsv}>Export CSV</button>
            <button className={btnPrimary} onClick={() => setAddOpen(true)}>+ Add member</button>
          </div>
        </div>
      </Card>

      {loading ? <div className="text-sm text-ink-700/60">Loading…</div> : filtered.length === 0 ? (
        <Card><p className="text-sm text-ink-700/60">No subscriptions match the current filters.</p></Card>
      ) : (
        <div className="bg-white border border-black/10 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-ink-700/60 text-left bg-cream/40">
              <tr>
                <th className="p-2">Member</th><th className="p-2">Plan</th><th className="p-2">Status</th>
                <th className="p-2">Progress</th><th className="p-2">Next drop</th><th className="p-2">Ends</th><th className="p-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-t border-black/5 hover:bg-cream/30">
                  <td className="p-2">
                    <div className="font-medium">{r.customer_name || r.email}</div>
                    {r.customer_name && <div className="text-xs text-ink-700/50">{r.email}</div>}
                    {r.is_renewal && <span className="text-[10px] bg-bronze-100 text-bronze-800 px-1.5 py-0.5 rounded">renewal</span>}
                  </td>
                  <td className="p-2 whitespace-nowrap">{r.months}-mo{r.tier === 'premium' ? ' · Premium' : ''}</td>
                  <td className="p-2"><span className={`text-xs px-2 py-0.5 rounded ${STATUS_COLORS[r.status] || ''}`}>{r.status}</span></td>
                  <td className="p-2 whitespace-nowrap">
                    <span className="text-xs">{r.drops_sent} / {r.total_drops} packs</span>
                    <div className="h-1.5 bg-cream rounded mt-1 w-24 overflow-hidden"><div className="h-full bg-bronze-600" style={{ width: `${Math.round((r.drops_sent / Math.max(1, r.total_drops)) * 100)}%` }} /></div>
                  </td>
                  <td className="p-2 text-xs text-ink-700/60 whitespace-nowrap">{r.next_drop_date || '—'}</td>
                  <td className="p-2 text-xs text-ink-700/60 whitespace-nowrap">{r.end_date}</td>
                  <td className="p-2 text-right whitespace-nowrap">
                    {r.status === 'active' && <button className={btnGhost} onClick={() => setStatusFor(r, 'paused')}>Pause</button>}
                    {r.status === 'paused' && <button className={btnGhost} onClick={() => setStatusFor(r, 'active')}>Resume</button>}
                    {(r.status === 'active' || r.status === 'paused') && <button className={btnDanger + ' ml-1'} onClick={() => { if (confirm(`Cancel ${r.email}'s membership? No further drops will send.`)) setStatusFor(r, 'cancelled'); }}>Cancel</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add member (Etsy / manual)">
        <AddMemberForm plans={plans} onDone={() => { setAddOpen(false); load(); }} />
      </Modal>
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
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'info'; text: string }>({ kind: 'info', text: '' });

  useEffect(() => { if (!planSlug && plans[0]) setPlanSlug(plans[0].slug); }, [plans]);

  async function save() {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setMsg({ kind: 'error', text: 'Enter a valid email.' }); return; }
    if (!planSlug) { setMsg({ kind: 'error', text: 'Pick a plan.' }); return; }
    setBusy(true); setMsg({ kind: 'info', text: 'Adding member & sending first pack…' });
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch('/api/admin/membership/add', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${session?.access_token || ''}` },
      body: JSON.stringify({ email, name, plan_slug: planSlug, start_date: startDate, source, price: price || null, coupon_code: coupon || null, notes: notes || null }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok || data.error) { setMsg({ kind: 'error', text: data.error || 'Failed to add member.' }); return; }
    setMsg({ kind: 'success', text: data.created ? '✓ Member added — first pack email sent.' : `Skipped (${data.reason || 'already exists'}).` });
    setTimeout(onDone, 900);
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div><label className={labelCls}>Email *</label><input value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder="buyer@email.com" /></div>
        <div><label className={labelCls}>Name</label><input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="optional" /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Plan *</label>
          <select value={planSlug} onChange={(e) => setPlanSlug(e.target.value)} className={inputCls}>
            {plans.map((p) => <option key={p.slug} value={p.slug}>{p.name} ({p.months} mo · ${p.price_usd})</option>)}
          </select>
        </div>
        <div><label className={labelCls}>Start date *</label><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Source</label>
          <select value={source} onChange={(e) => setSource(e.target.value)} className={inputCls}>
            <option value="etsy">Etsy</option>
            <option value="manual">Manual</option>
            <option value="import">Import</option>
            <option value="website">Website</option>
          </select>
        </div>
        <div><label className={labelCls}>Price charged <span className="text-ink-700/40">(blank = plan price)</span></label><input value={price} onChange={(e) => setPrice(e.target.value)} className={inputCls} placeholder="auto" /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className={labelCls}>Coupon <span className="text-ink-700/40">(internal note)</span></label><input value={coupon} onChange={(e) => setCoupon(e.target.value)} className={inputCls} placeholder="WELCOME10" /></div>
        <div><label className={labelCls}>Notes</label><input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} placeholder="optional" /></div>
      </div>
      <div className="flex items-center gap-3 border-t border-black/10 pt-3">
        <button disabled={busy} onClick={save} className={btnPrimary}>{busy ? 'Working…' : 'Add & send first email'}</button>
        <Toast message={msg.text} kind={msg.kind} />
      </div>
    </div>
  );
}
