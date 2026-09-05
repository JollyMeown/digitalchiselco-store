// Membership, all in one place (owner request 2026-09-05: "it should be in one
// common section"). Overview of the whole system, then the four working
// panels as sub-tabs: Members (terms, timelines, actions), Packs (the monthly
// bundles and their delivery numbers), Plans & purchases, Emails.
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { Card } from '../ui';
import MemberSubs from './MemberSubs';
import MonthlyDrops from './MonthlyDrops';
import Membership from './Membership';
import MemberEmails from './MemberEmails';

const SUBS = [
  { key: 'overview', label: 'Overview' },
  { key: 'members', label: 'Members' },
  { key: 'packs', label: 'Monthly packs' },
  { key: 'plans', label: 'Plans & purchases' },
  { key: 'emails', label: 'Emails' },
] as const;
type SubKey = typeof SUBS[number]['key'];
// old sidebar entries deep-link straight to the right sub-tab
const ALIAS: Record<string, SubKey> = { monthly: 'packs', membersubs: 'members', memberemails: 'emails', membership: 'overview' };

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ymLabel = (ym: string) => { const [y, m] = ym.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };
const addYM = (ym: string, n: number) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7); };

function Overview({ go }: { go: (k: SubKey) => void }) {
  const [d, setD] = useState<any>(null);
  useEffect(() => {
    (async () => {
      const today = new Date().toISOString().slice(0, 10);
      const thisYM = today.slice(0, 7);
      const in14 = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
      const [{ data: subs }, { data: packs }, { data: logs }, { data: dls }, { data: cron }, { data: gs }] = await Promise.all([
        supabase.from('member_subscriptions').select('id, status, end_date, next_drop_date, drops_sent, total_drops, price_usd, start_date, renewed_to, source, created_at').limit(5000),
        supabase.from('monthly_files').select('month, title, standard_drive_link, bonus_drive_link, cover_image_url, items').order('month'),
        supabase.from('subscription_email_logs').select('subscription_id, email_type, drop_month, status, provider_id, sent_at').in('email_type', ['first_pack', 'monthly_drop']).eq('status', 'sent').limit(5000),
        supabase.from('pack_downloads').select('subscription_id, month').limit(5000),
        supabase.from('cron_runs').select('ok, finished_at, summary').order('finished_at', { ascending: false }).limit(1),
        supabase.from('growth_settings').select('membership_reminder_days, membership_winback_days, membership_winback_coupon').eq('id', 1).maybeSingle(),
      ]);
      const S = subs || [];
      const active = S.filter((s: any) => s.status === 'active');
      const ids = [...new Set((logs || []).map((l: any) => l.provider_id).filter(Boolean))] as string[];
      const opened = new Set<string>();
      for (let i = 0; i < ids.length; i += 200) {
        const { data } = await supabase.from('email_events').select('provider_id').in('provider_id', ids.slice(i, i + 200)).in('event', ['opened', 'clicked']).limit(5000);
        for (const e of data || []) opened.add(e.provider_id);
      }
      const dlSet = new Set((dls || []).map((x: any) => `${x.subscription_id}|${x.month}`));
      const packLogs = logs || [];
      const monthsAhead = [0, 1, 2, 3].map((n) => addYM(thisYM, n));
      const packByMonth = new Map((packs || []).map((p: any) => [p.month, p]));
      const revenue30 = S.filter((s: any) => s.created_at >= new Date(Date.now() - 30 * 864e5).toISOString()).reduce((a: number, s: any) => a + (Number(s.price_usd) || 0), 0);
      setD({
        active: active.length,
        total: S.length,
        due: active.filter((s: any) => s.end_date <= in14 && !s.renewed_to).length,
        waiting: active.filter((s: any) => s.next_drop_date && s.next_drop_date <= today).length,
        new30: S.filter((s: any) => s.created_at >= new Date(Date.now() - 30 * 864e5).toISOString()).length,
        revenue30,
        sent: packLogs.length,
        opened: packLogs.filter((l: any) => l.provider_id && opened.has(l.provider_id)).length,
        downloaded: packLogs.filter((l: any) => dlSet.has(`${l.subscription_id}|${l.drop_month.split('#')[0]}`)).length,
        months: monthsAhead.map((ym) => { const p: any = packByMonth.get(ym); return { ym, ready: !!(p && (p.standard_drive_link || p.bonus_drive_link)), title: p?.title || null, cover: p?.cover_image_url || null, items: Array.isArray(p?.items) ? p.items.length : 0, entitled: active.filter((s: any) => { const k = Array.from({ length: s.total_drops }, (_, i) => addYM(s.start_date.slice(0, 7), i)); return k.includes(ym); }).length }; }),
        cron: cron?.[0] || null,
        settings: gs || {},
        bySource: S.reduce((m: any, s: any) => { const k = s.source || 'paddle'; m[k] = (m[k] || 0) + 1; return m; }, {}),
      });
    })();
  }, []);
  if (!d) return <div className="text-sm text-ink-700/60">Loading…</div>;
  const st = d.cron?.summary?.stats;
  const tile = (label: string, value: any, sub?: string, tone?: 'good' | 'bad' | 'warn', onClick?: () => void) => (
    <button onClick={onClick} className={`text-left rounded-lg border px-4 py-3 bg-cream/40 border-black/10 ${onClick ? 'hover:border-bronze-600/60 cursor-pointer' : 'cursor-default'}`}>
      <div className="text-[10px] uppercase tracking-wide text-ink-700/50 font-medium">{label}</div>
      <div className={`text-2xl font-extrabold ${tone === 'bad' ? 'text-red-600' : tone === 'warn' ? 'text-amber-700' : tone === 'good' ? 'text-green-700' : 'text-ink-900'}`}>{value}</div>
      {sub && <div className="text-[11px] text-ink-700/55 mt-0.5">{sub}</div>}
    </button>
  );
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {tile('Active members', d.active, `${d.total} terms ever · ${Object.entries(d.bySource).map(([k, v]) => `${v} ${k}`).join(', ')}`, undefined, () => go('members'))}
        {tile('New in 30 days', d.new30, `$${d.revenue30.toFixed(0)} in membership sales`, undefined, () => go('plans'))}
        {tile('Renewal due (14 d)', d.due, 'reminders go out automatically', d.due ? 'warn' : undefined, () => go('members'))}
        {tile('Waiting for a pack', d.waiting, d.waiting ? 'a month has no link yet' : 'nobody is held up', d.waiting ? 'bad' : 'good', () => go('packs'))}
        {tile('Pack emails opened', `${d.opened}/${d.sent}`, `${d.downloaded} downloaded`, undefined, () => go('members'))}
        {tile('Nightly run', d.cron ? (d.cron.ok ? '✓' : '✗') : '–', d.cron ? `${new Date(d.cron.finished_at).toLocaleString()}${st ? ` · ${st.drops ?? 0} packs, ${st.preExpiry ?? 0} reminders, ${st.failures ?? 0} failed` : ''}` : 'no run yet', d.cron && !d.cron.ok ? 'bad' : undefined)}
      </div>

      <Card>
        <div className="flex items-baseline justify-between flex-wrap gap-2 mb-2">
          <div className="text-sm font-bold text-ink-900">Packs for the next months</div>
          <button className="text-xs text-bronze-700 underline" onClick={() => go('packs')}>manage packs</button>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {d.months.map((m: any) => (
            <div key={m.ym} className={`rounded-lg border p-3 ${m.ready ? 'border-green-200 bg-green-50/40' : m.entitled ? 'border-red-200 bg-red-50/40' : 'border-black/10 bg-cream/30'}`}>
              {m.cover ? <img src={m.cover} alt="" className="w-full aspect-[16/9] object-cover rounded mb-2" /> : <div className="w-full aspect-[16/9] rounded mb-2 bg-cream/60 border border-dashed border-black/10 grid place-items-center text-[10px] text-ink-700/40">no cover yet</div>}
              <div className="text-[13px] font-semibold text-ink-900">{ymLabel(m.ym)}</div>
              <div className="text-[11px] text-ink-700/60 truncate">{m.title || 'untitled'}</div>
              <div className={`text-[11px] mt-1 font-medium ${m.ready ? 'text-green-700' : m.entitled ? 'text-red-600' : 'text-ink-700/50'}`}>
                {m.ready ? `ready · ${m.items ? `${m.items} designs` : 'designs not listed'}` : 'no link yet'} · {m.entitled} member{m.entitled === 1 ? '' : 's'} expect it
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div className="text-sm font-bold text-ink-900 mb-2">How the system runs</div>
        <ol className="text-[13px] text-ink-800 space-y-1.5 list-decimal pl-5">
          <li><b>A member joins</b> from a Paddle purchase on the site (automatic) or an Etsy sale you add under <button className="underline text-bronze-700" onClick={() => go('members')}>Members</button> (backdate the start and every past month is sent at once).</li>
          <li><b>The first pack goes out immediately</b> if that month's pack exists; otherwise the member is held and you are told on Telegram.</li>
          <li><b>Every night</b> the run sends each due pack (catching up any missed months), the reminders {String(d.settings.membership_reminder_days || '10,3').split(',').join(' and ')} days before the end, the end-of-term email, and a win-back {d.settings.membership_winback_days ?? 14} days later with code {d.settings.membership_winback_coupon || 'COMEBACK15'}. Membership mail is never held behind marketing mail.</li>
          <li><b>Every pack link is tracked</b>, so each member's timeline shows sent, delivered, opened, clicked and downloaded. Click a member to see it, re-send a pack, send the reminder, or extend the term.</li>
          <li><b>Packs</b> are one row per month with the Drive links, a cover and the designs inside. Fill them by hand under <button className="underline text-bronze-700" onClick={() => go('packs')}>Monthly packs</button>, or let the BRS pack builder write them; you are warned a week before a month that is still empty.</li>
          <li><b>Renewals chain:</b> a member who renews while active starts the new term the day the old one ends, so no months overlap. Members see all of this, plus an "email me this pack" button, in their account page.</li>
        </ol>
      </Card>
    </div>
  );
}

export default function MembershipHub() {
  const [sub, setSub] = useState<SubKey>(() => {
    try {
      const wanted = sessionStorage.getItem('dcc_membership_sub');
      if (wanted && ALIAS[wanted]) { sessionStorage.removeItem('dcc_membership_sub'); return ALIAS[wanted]; }
      const last = localStorage.getItem('dcc_membership_sub_last');
      if (last && SUBS.some((s) => s.key === last)) return last as SubKey;
    } catch {}
    return 'overview';
  });
  useEffect(() => { try { localStorage.setItem('dcc_membership_sub_last', sub); } catch {} }, [sub]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1 border-b border-black/10 pb-2">
        {SUBS.map((s) => (
          <button key={s.key} onClick={() => setSub(s.key)} className={`text-sm px-3 py-1.5 rounded-md ${sub === s.key ? 'bg-bronze-600 text-cream font-medium' : 'text-ink-700 hover:bg-cream'}`}>{s.label}</button>
        ))}
        <span className="ml-auto text-[11px] text-ink-700/50">members, packs, plans, emails and settings, all here</span>
      </div>
      {sub === 'overview' && <Overview go={setSub} />}
      {sub === 'members' && <MemberSubs />}
      {sub === 'packs' && <MonthlyDrops />}
      {sub === 'plans' && <Membership />}
      {sub === 'emails' && <MemberEmails />}
    </div>
  );
}
