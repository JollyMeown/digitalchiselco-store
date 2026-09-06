// Did each automation actually fire? Two proofs side by side for every
// automation: what the last nightly run reported for that step (from
// cron_runs.summary), and the last time an email of that kind really left
// (from the send ledger). Plus one button that sends every template to the
// admin's own inbox so the content can be checked in one sitting.
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Card, btnPrimary, btnGhost } from './ui';
import { useLiveRefresh } from './useLiveRefresh';

type Step = { key: string; label: string; kinds: string[]; toggle?: string; note?: string };
const STEPS: Step[] = [
  { key: 'etsyWelcome', label: 'Etsy-buyer welcome (one-time)', kinds: ['etsy-welcome'], toggle: 'etsy_welcome_enabled' },
  { key: 'drip', label: 'Nurture drip (5 stages)', kinds: ['drip1', 'drip2', 'drip3', 'drip4', 'drip5'], toggle: 'drip_enabled' },
  { key: 'weekly', label: 'Weekly fresh-designs digest', kinds: ['weekly'], toggle: 'weekly_digest_enabled' },
  { key: 'articleDrip', label: 'Guide emails, one at a time', kinds: ['guideCampaign', 'articleCampaign', 'articleDrip'], toggle: 'article_drip_enabled' },
  { key: 'filmDrip', label: 'Film emails, one at a time', kinds: ['filmCampaign'], toggle: 'film_drip_enabled' },
  { key: 'customPitch', label: 'Custom-design pitch drip', kinds: ['custom-pitch'], toggle: 'custom_pitch_enabled' },
  { key: 'carts', label: 'Abandoned-cart reminders', kinds: ['cartSave', 'cart'], toggle: 'cart_reminders_enabled' },
  { key: 'browse', label: 'Abandoned-browse reminder', kinds: ['browse'], toggle: 'abandoned_browse_enabled' },
  { key: 'followups', label: 'Post-purchase follow-ups', kinds: ['review7', 'arrivals30', 'loyalty'], toggle: 'followups_enabled' },
  { key: 'winback', label: 'Win-back dormant subscribers', kinds: ['winback'], toggle: 'winback_enabled' },
  { key: 'priceDrop', label: 'Price-drop alerts', kinds: ['price-drop', 'priceDrop'], toggle: 'price_drop_enabled' },
  { key: 'referralNudge', label: 'Referral nudge', kinds: ['referral-nudge', 'referralNudge'], toggle: 'referral_nudge_enabled' },
  { key: 'wishlistReminder', label: 'Wishlist reminders', kinds: ['wishlist-reminder', 'wishlistReminder'], toggle: 'wishlist_reminder_enabled' },
  { key: 'refundWinback', label: 'Refund win-back', kinds: ['refund-winback', 'refundWinback'], toggle: 'refund_winback_enabled' },
  { key: 'makerRecruitDrip', label: 'Maker recruiting drip', kinds: ['makerRecruit'], toggle: 'maker_recruit_drip_enabled' },
  { key: 'ownerReport', label: 'Owner weekly report', kinds: ['ownerReport'], toggle: 'owner_report_enabled' },
  { key: 'designScout', label: 'Design scout', kinds: ['designScout'], toggle: 'design_scout_enabled' },
  { key: 'membership', label: 'Membership packs and reminders', kinds: ['membership'], note: 'from the membership engine, not a toggle' },
  { key: 'orderEmails', label: 'Order confirmations', kinds: ['order'], note: 'sent by the payment webhook' },
];

function describe(v: any): { text: string; state: 'ok' | 'idle' | 'off' | 'bad' } {
  if (v === undefined || v === null) return { text: 'not in the last run', state: 'idle' };
  if (v === 'off') return { text: 'switched off', state: 'off' };
  if (typeof v === 'string') return /^failed/i.test(v) ? { text: v.slice(0, 90), state: 'bad' } : { text: v.slice(0, 90), state: 'ok' };
  if (typeof v === 'object') {
    const sent = Number(v.sent ?? v.drops ?? 0), failed = Number(v.failed ?? v.failures ?? 0);
    const cand = v.candidates ?? v.queued ?? v.enrolled ?? v.pending;
    const bits = [`sent ${sent}`]; if (cand !== undefined) bits.push(`eligible ${cand}`); if (failed) bits.push(`failed ${failed}`); if (v.note) bits.push(String(v.note).slice(0, 60));
    return { text: bits.join(' · '), state: failed ? 'bad' : sent > 0 ? 'ok' : 'idle' };
  }
  return { text: String(v), state: 'ok' };
}

export default function AutomationHealth() {
  const [run, setRun] = useState<any>(null);
  const [last, setLast] = useState<Record<string, { at: string; week: number }>>({});
  const [toggles, setToggles] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [results, setResults] = useState<{ kind: string; ok: boolean; error?: string }[]>([]);

  async function load() {
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const [{ data: runs }, { data: log }, { data: gs }] = await Promise.all([
      supabase.from('cron_runs').select('ran_at, ok, error, summary').order('ran_at', { ascending: false }).limit(1),
      supabase.from('email_send_log').select('kind, sent_at').eq('status', 'sent').order('sent_at', { ascending: false }).limit(5000),
      supabase.from('growth_settings').select('*').eq('id', 1).maybeSingle(),
    ]);
    setRun(runs?.[0] || null);
    const m: Record<string, { at: string; week: number }> = {};
    for (const l of log || []) { const k = l.kind || ''; if (!m[k]) m[k] = { at: l.sent_at, week: 0 }; if (l.sent_at >= weekAgo) m[k].week++; }
    setLast(m);
    setToggles(Object.fromEntries(Object.entries(gs || {}).filter(([, v]) => typeof v === 'boolean')) as Record<string, boolean>);
  }
  useEffect(() => { load(); }, []);
  useLiveRefresh(load, 60000);

  async function sendAll() {
    const { data: { session } } = await supabase.auth.getSession();
    const to = session?.user?.email || '';
    if (!to) { setMsg('No admin email on the session.'); return; }
    if (!confirm(`Send one copy of every marketing template (16 emails) to ${to}? Subjects are numbered [TEST 1/16 …].`)) return;
    setBusy(true); setMsg('Sending, this takes about a minute…'); setResults([]);
    const r = await fetch('/api/admin/growth/preview', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${session?.access_token || ''}` }, body: JSON.stringify({ kind: 'all', to }) }).then((x) => x.json()).catch(() => ({ error: 'bad response' }));
    setBusy(false);
    if (r?.error) { setMsg(r.error); return; }
    setResults(r.results || []); setMsg(`${r.sent} of ${(r.results || []).length} test emails sent to ${to}. Check the inbox, subjects are numbered.`);
  }

  const growth = run?.summary?.growth || {};
  const mem = run?.summary?.stats || null;
  const ago = (d?: string | null) => { if (!d) return 'never'; const h = Math.round((Date.now() - new Date(d).getTime()) / 3600000); return h < 1 ? 'just now' : h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`; };
  const dot: Record<string, string> = { ok: 'bg-green-500', idle: 'bg-amber-400', off: 'bg-gray-300', bad: 'bg-red-500' };

  return (
    <Card title="🩺 Did every automation fire?" subtitle="Left: what the last nightly run reported for each automation. Right: the last time an email of that kind actually left, and how many in the last 7 days. Amber = ran but nobody was due, which is normal on most nights.">
      <div className="text-xs text-ink-700/70 mb-3">
        Last nightly run: {run ? <><b>{new Date(run.ran_at).toLocaleString()}</b> · {run.ok ? <span className="text-green-700">completed</span> : <span className="text-red-700">failed: {run.error}</span>}</> : 'none recorded yet'}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-ink-700/60 text-left"><tr><th className="p-1.5">Automation</th><th className="p-1.5">Switch</th><th className="p-1.5">Last run said</th><th className="p-1.5">Last real send</th><th className="p-1.5 text-right">Sent, 7 days</th></tr></thead>
          <tbody>
            {STEPS.map((s) => {
              const v = s.key === 'membership' ? (mem ? { sent: (mem.drops || 0) + (mem.preExpiry || 0) + (mem.expired || 0) + (mem.winback || 0), failed: mem.failures || 0, note: mem.missingPacks?.length ? `missing pack ${mem.missingPacks.join(', ')}` : undefined } : undefined) : growth[s.key];
              const d = describe(s.toggle && toggles[s.toggle] === false ? 'off' : v);
              const lastAt = s.kinds.map((k) => last[k]?.at).filter(Boolean).sort().pop();
              const week = s.kinds.reduce((n, k) => n + (last[k]?.week || 0), 0);
              return (
                <tr key={s.key} className="border-t border-black/5">
                  <td className="p-1.5"><span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${dot[d.state]}`} />{s.label}</td>
                  <td className="p-1.5 text-ink-700/60">{s.toggle ? (toggles[s.toggle] === false ? 'off' : 'on') : (s.note || '')}</td>
                  <td className="p-1.5">{d.text}</td>
                  <td className="p-1.5">{ago(lastAt)}</td>
                  <td className="p-1.5 text-right">{week}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-4 pt-3 border-t border-black/10 flex flex-wrap items-center gap-2">
        <button className={btnPrimary} disabled={busy} onClick={sendAll}>{busy ? 'Sending…' : '✉ Send me one of everything (16 templates)'}</button>
        <span className="text-[11px] text-ink-700/60">Membership packs, film, guide and custom-pitch emails have their own "test to me" buttons in their cards.</span>
        {msg && <span className="text-xs text-bronze-800 basis-full">{msg}</span>}
        {results.length > 0 && <ul className="text-[11px] basis-full grid md:grid-cols-4 gap-x-3">{results.map((r) => <li key={r.kind}>{r.ok ? '✓' : '✗'} {r.kind}{r.error ? ` · ${r.error}` : ''}</li>)}</ul>}
      </div>
    </Card>
  );
}
