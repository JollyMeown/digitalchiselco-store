// Email performance, last 30 days: what went out, who opened and clicked,
// list growth by source, unsubscribes, and how often the frequency cap held
// a broadcast back. Read-only; the controls live in the cards around it.
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Card } from './ui';
import { useLiveRefresh } from './useLiveRefresh';

type KindRow = { kind: string; sent: number; opened: number; clicked: number };
const LABEL: Record<string, string> = {
  weekly: 'Weekly digest', filmCampaign: 'Film emails', guideCampaign: 'Guide emails', articleCampaign: 'Article emails', makerRecruit: 'Maker recruiting',
  drip1: 'Drip 1 free pack', drip2: 'Drip 2 bestsellers', drip3: 'Drip 3 bundle', drip4: 'Drip 4 membership', drip5: 'Drip 5 coupon',
  winback: 'Win-back', 'product-blast': 'Hand-picked designs', picks: 'Hand-picked designs', 'etsy-welcome': 'Etsy-buyer welcome', membership: 'Membership packs',
  order: 'Order emails', browse: 'Abandoned browse', 'price-drop': 'Price drop', review7: 'Review request', arrivals30: 'New arrivals', loyalty: 'Loyalty code',
  'custom-pitch': 'Custom-design pitch', 'referral-nudge': 'Referral nudge', optin: 'Opt-in confirm', auth: 'Sign-in links',
};

async function all<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) { const { data } = await build(from, from + 999); out.push(...(data || [])); if (!data || data.length < 1000) break; }
  return out;
}

export default function EmailPerformance() {
  const [rows, setRows] = useState<KindRow[] | null>(null);
  const [growth, setGrowth] = useState<{ source: string; n: number }[]>([]);
  const [tot, setTot] = useState({ sent: 0, people: 0, openers: 0, unsubs: 0, holds: 0, mailable: 0 });

  async function load() {
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const [log, events, subs, holds] = await Promise.all([
      all<{ kind: string | null; recipient: string; provider_id: string | null }>((a, b) => supabase.from('email_send_log').select('kind, recipient, provider_id').eq('status', 'sent').gte('sent_at', since).range(a, b)),
      all<{ provider_id: string; event: string }>((a, b) => supabase.from('email_events').select('provider_id, event').gte('created_at', since).in('event', ['opened', 'clicked']).range(a, b)),
      all<{ source: string | null; created_at: string; unsubscribed_at: string | null; confirmed_at: string | null }>((a, b) => supabase.from('subscribers').select('source, created_at, unsubscribed_at, confirmed_at').range(a, b)),
      supabase.from('email_holds').select('id', { count: 'exact', head: true }).gte('held_at', since).then((r) => r.count || 0),
    ]);
    const opened = new Set(events.filter((e) => e.event === 'opened').map((e) => e.provider_id));
    const clicked = new Set(events.filter((e) => e.event === 'clicked').map((e) => e.provider_id));
    const agg: Record<string, KindRow> = {};
    const people = new Set<string>(), openers = new Set<string>();
    for (const l of log) {
      const k = l.kind || '(untagged)';
      agg[k] = agg[k] || { kind: k, sent: 0, opened: 0, clicked: 0 };
      agg[k].sent++; people.add(l.recipient);
      if (l.provider_id && opened.has(l.provider_id)) { agg[k].opened++; openers.add(l.recipient); }
      if (l.provider_id && clicked.has(l.provider_id)) agg[k].clicked++;
    }
    setRows(Object.values(agg).sort((a, b) => b.sent - a.sent));
    const bySrc: Record<string, number> = {};
    let unsubs = 0, mailable = 0;
    for (const s of subs) {
      if (s.created_at >= since) bySrc[s.source || '?'] = (bySrc[s.source || '?'] || 0) + 1;
      if (s.unsubscribed_at && s.unsubscribed_at >= since) unsubs++;
      if (s.confirmed_at && !s.unsubscribed_at) mailable++;
    }
    setGrowth(Object.entries(bySrc).map(([source, n]) => ({ source, n })).sort((a, b) => b.n - a.n));
    setTot({ sent: log.length, people: people.size, openers: openers.size, unsubs, holds: holds as number, mailable });
  }
  useEffect(() => { load(); }, []);
  useLiveRefresh(load, 60000);
  if (!rows) return null;

  const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);
  const tile = (label: string, value: string | number, sub?: string, tone = 'bg-cream/40 border-bronze-600/20') => (
    <div className={`rounded-lg border px-4 py-2.5 min-w-[130px] ${tone}`}>
      <div className="text-[10px] uppercase tracking-wide text-ink-700/50 font-medium">{label}</div>
      <div className="text-2xl font-extrabold text-bronze-800 leading-tight">{value}</div>
      {sub && <div className="text-[11px] text-ink-700/60">{sub}</div>}
    </div>
  );
  const best = rows.filter((r) => r.sent >= 20).sort((a, b) => pct(b.clicked, b.sent) - pct(a.clicked, a.sent))[0];
  const worst = rows.filter((r) => r.sent >= 20).sort((a, b) => pct(a.opened, a.sent) - pct(b.opened, b.sent))[0];

  return (
    <Card title="📈 Email performance, last 30 days" subtitle="What went out, who opened and clicked, how the list grew, and how often the weekly frequency cap held a broadcast back.">
      <div className="flex flex-wrap gap-3 mb-4">
        {tile('People you can email', tot.mailable)}
        {tile('Emails sent', tot.sent, `to ${tot.people} people, ${tot.people ? (tot.sent / tot.people).toFixed(1) : 0} each`)}
        {tile('Opened at least one', tot.openers, `${pct(tot.openers, tot.people)}% of recipients`)}
        {tile('Unsubscribed', tot.unsubs, undefined, tot.unsubs > 10 ? 'bg-red-50 border-red-200' : 'bg-cream/40 border-bronze-600/20')}
        {tile('Held by frequency cap', tot.holds, 'broadcasts skipped, not lost')}
      </div>
      {(best || worst) && (
        <div className="text-xs text-ink-700/70 mb-3">
          {best && <span>Best click rate: <b>{LABEL[best.kind] || best.kind}</b> ({pct(best.clicked, best.sent)}% click, {pct(best.opened, best.sent)}% open). </span>}
          {worst && <span>Weakest opens: <b>{LABEL[worst.kind] || worst.kind}</b> ({pct(worst.opened, worst.sent)}% open).</span>}
        </div>
      )}
      <div className="grid md:grid-cols-[1fr_260px] gap-4">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-ink-700/60 text-left"><tr><th className="p-1.5">Email</th><th className="p-1.5 text-right">Sent</th><th className="p-1.5 text-right">Open</th><th className="p-1.5 text-right">Click</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.kind} className="border-t border-black/5">
                  <td className="p-1.5">{LABEL[r.kind] || r.kind}</td>
                  <td className="p-1.5 text-right">{r.sent}</td>
                  <td className="p-1.5 text-right"><span className={pct(r.opened, r.sent) < 15 && r.sent >= 20 ? 'text-red-700' : ''}>{pct(r.opened, r.sent)}%</span></td>
                  <td className="p-1.5 text-right"><span className={pct(r.clicked, r.sent) >= 10 ? 'text-green-700 font-medium' : ''}>{pct(r.clicked, r.sent)}%</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <div className="text-xs font-medium text-ink-900 mb-1">List growth, 30 days</div>
          {growth.length === 0 ? <div className="text-xs text-ink-700/60">No new subscribers.</div> : (
            <table className="w-full text-xs"><tbody>
              {growth.map((g) => <tr key={g.source} className="border-t border-black/5"><td className="p-1.5">{g.source}</td><td className="p-1.5 text-right font-medium">+{g.n}</td></tr>)}
            </tbody></table>
          )}
        </div>
      </div>
    </Card>
  );
}
