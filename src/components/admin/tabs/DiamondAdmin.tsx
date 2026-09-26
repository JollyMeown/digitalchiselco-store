import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { Card, btnPrimary } from '../ui';
import { img } from '../../../lib/img';

// Admin > Membership > Diamond Select: every member's credits, picks and
// downloads, the warnings, and what members choose (/api/admin/diamond-stats).
export default function DiamondAdmin() {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true); setErr('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch('/api/admin/diamond-stats', { headers: { authorization: `Bearer ${session?.access_token || ''}` } });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setD(j);
    } catch (e: any) { setErr(e.message || 'Could not load.'); }
    setBusy(false);
  }
  useEffect(() => { load(); }, []);
  if (err) return <Card><p className="text-sm text-red-700">{err}</p></Card>;
  if (!d) return <Card><p className="text-sm text-ink-700/70">Loading Diamond Select…</p></Card>;
  const t = d.totals;
  const th = 'text-left text-[11px] uppercase tracking-wide text-ink-700/60 font-semibold px-3 py-2 bg-cream/60';
  const td = 'px-3 py-2 border-t border-black/5 text-sm align-top';
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <div>
            <b>{d.plan?.name || 'Diamond Select'}</b>, ${d.plan?.price}.{' '}
            {d.plan?.launched
              ? <span className="text-[#2F6B4F] font-medium">On sale.</span>
              : <span className="text-[#A3402B] font-medium">Hidden from customers (launch date {d.plan?.availableFrom}). Test it at <a className="underline" href="/membership?preview=1" target="_blank" rel="noopener">/membership?preview=1</a>, then set the launch date under Plans &amp; purchases.</span>}
          </div>
          <button className={btnPrimary} onClick={load} disabled={busy}>{busy ? 'Refreshing…' : 'Refresh'}</button>
        </div>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        {[['Members', `${t.active} active`, `${t.members} ever`], ['Revenue', `$${t.revenue.toFixed(0)}`, 'all Diamond terms'], ['Credits used', `${t.usedPct}%`, `${t.creditsUsed} of ${t.creditsEarned} received`],
          ['Downloads', String(t.downloads), 'counted from accounts'], ['Renewals due', String(t.renewalsDue), 'in the next 30 days'], ['Warnings', String(t.flagged), 'members to look at']].map(([a, b, c]) => (
          <div key={a} className="bg-white border border-black/10 rounded-lg p-3">
            <div className="text-[11px] uppercase tracking-wide text-ink-700/60">{a}</div>
            <div className="text-2xl font-serif text-bronze-700 tabular-nums">{b}</div>
            <div className="text-xs text-ink-700/60">{c}</div>
          </div>
        ))}
      </div>

      <Card title="Members">
        {d.members.length === 0 ? <p className="text-sm text-ink-700/70">No Diamond Select members yet.</p> : (
          <div className="overflow-x-auto"><table className="w-full">
            <thead><tr><th className={th}>Member</th><th className={th}>Term</th><th className={th + ' text-right'}>Credits left</th><th className={th + ' text-right'}>Used</th><th className={th + ' text-right'}>Downloads</th><th className={th}>Countries</th><th className={th}>Last pick</th><th className={th}>Warnings</th></tr></thead>
            <tbody>{d.members.map((m: any) => (
              <tr key={m.email + m.start} className={m.flags.length ? 'bg-[#F6E3DE]/40' : ''}>
                <td className={td}><div className="font-medium">{m.name || m.email}</div><div className="text-xs text-ink-700/60">{m.email}</div></td>
                <td className={td + ' text-xs'}>{m.start} to {m.end}<div className="text-ink-700/60">{m.status}{m.renewed ? ', renewed' : ''}</div></td>
                <td className={td + ' text-right tabular-nums font-medium'}>{m.left}</td>
                <td className={td + ' text-right tabular-nums'}>{m.used} / {m.earned}<div className="text-[11px] text-ink-700/50">of {m.total}</div></td>
                <td className={td + ' text-right tabular-nums'}>{m.downloads}</td>
                <td className={td + ' text-xs'}>{m.countries.join(', ') || '-'}</td>
                <td className={td + ' text-xs'}>{m.lastPick ? m.lastPick.slice(0, 10) : 'none yet'}</td>
                <td className={td + ' text-xs text-[#A3402B]'}>{m.flags.join('; ')}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <p className="text-xs text-ink-700/60 mt-2">Warnings: one design downloaded 6+ times, downloads from 3+ countries in a week (possible sharing), or 20+ credits unused with no pick for 30 days (send a reminder).</p>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Most chosen designs">
          {d.topDesigns.length === 0 ? <p className="text-sm text-ink-700/70">Nothing picked yet.</p> : (
            <ul className="space-y-2">{d.topDesigns.map((x: any) => (
              <li key={x.id} className="flex items-center gap-3 text-sm">
                {x.image ? <img src={img(x.image, { w: 80, square: true, q: 60 })} width={40} height={40} className="w-10 h-10 rounded object-cover" alt="" /> : <span className="w-10 h-10 rounded bg-cream" />}
                <a href={`/product/${x.slug}`} target="_blank" rel="noopener" className="flex-1 min-w-0 truncate hover:underline">{x.title}</a>
                <b className="tabular-nums">{x.picks}</b>
              </li>
            ))}</ul>
          )}
        </Card>
        <Card title="What members choose, by collection">
          {d.collections.length === 0 ? <p className="text-sm text-ink-700/70">Nothing picked yet.</p> : (
            <ul className="space-y-1.5 text-sm">{d.collections.map((c: any) => (
              <li key={c.name} className="flex justify-between gap-3"><span>{c.name}</span><b className="tabular-nums">{c.picks}</b></li>
            ))}</ul>
          )}
          <p className="text-xs text-ink-700/60 mt-3">Members pick with their own money already spent, so this is honest demand: compare it with the What Sells tab.</p>
        </Card>
      </div>
    </div>
  );
}
