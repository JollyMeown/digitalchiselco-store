// Channel performance: what each marketing channel actually SENDS us.
//
// Platform dashboards (Pinterest, Google Merchant) report impressions and
// clicks on their side, but their APIs need access we do not have: Pinterest
// analytics requires an ad account, which is unavailable in Pakistan. So this
// panel measures the half we own and the half that pays: real visits landing
// on the site, what those visitors did, and what they bought.
//
// Attribution: utm_source on every feed link (recorded in site_visits.campaign)
// with referrer_host as the fallback for links that lose their query string.
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Card } from './ui';
import { useLiveRefresh } from './useLiveRefresh';

type Visit = { day: string; path: string; referrer_host: string | null; campaign: string | null; visitor_hash: string | null };
type Chan = { key: string; label: string; color: string; match: (v: Visit) => boolean };

const CHANNELS: Chan[] = [
  { key: 'pinterest', label: 'Pinterest', color: '#e60023', match: (v) => v.campaign === 'pinterest' || /pinterest\./i.test(v.referrer_host || '') || /pinimg/i.test(v.referrer_host || '') },
  { key: 'google', label: 'Google (search + shopping)', color: '#4285f4', match: (v) => v.campaign === 'google' || /^(www\.)?google\./i.test(v.referrer_host || '') || /googlequicksearch/i.test(v.referrer_host || '') },
  { key: 'etsy', label: 'Etsy', color: '#eb6834', match: (v) => v.campaign === 'etsy' || /etsy\./i.test(v.referrer_host || '') },
  { key: 'cults', label: 'Cults3D', color: '#1baf7a', match: (v) => v.campaign === 'cults' || /cults3d/i.test(v.referrer_host || '') },
  { key: 'email', label: 'Our emails', color: '#854F0B', match: (v) => !!v.campaign && /mail|email|digest|drip|weekly/i.test(v.campaign) },
  { key: 'social', label: 'Other social', color: '#8b5cf6', match: (v) => /facebook|instagram|reddit|youtube|tiktok|x\.com|twitter|linkedin/i.test(v.referrer_host || '') },
];

const RANGES = [7, 30, 90] as const;

export default function ChannelStats() {
  const [days, setDays] = useState<number>(30);
  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [orders, setOrders] = useState<{ created_at: string; total: number }[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});

  const load = async () => {
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const [{ data: v }, { data: o }] = await Promise.all([
      supabase.from('site_visits').select('day, path, referrer_host, campaign, visitor_hash').gte('day', since).limit(50000),
      supabase.from('orders').select('created_at, total').eq('status', 'paid').gte('created_at', since + 'T00:00:00Z').limit(5000),
    ]);
    setVisits(v || []);
    setOrders((o || []) as any);
    // resolve product slugs -> titles for the top-10 tables
    const slugs = [...new Set((v || []).map((r: any) => (r.path || '').startsWith('/product/') ? r.path.slice(9) : '').filter(Boolean))].slice(0, 300);
    if (slugs.length) {
      const { data: ps } = await supabase.from('products').select('slug, title').in('slug', slugs);
      const m: Record<string, string> = {};
      for (const p of ps || []) m[(p as any).slug] = String((p as any).title).split('|')[0].trim();
      setTitles(m);
    }
  };
  useEffect(() => { load(); }, [days]);
  useLiveRefresh(load, 60000);

  const rows = useMemo(() => {
    if (!visits) return [];
    return CHANNELS.map((c) => {
      const vs = visits.filter(c.match);
      const people = new Set(vs.map((v) => v.visitor_hash).filter(Boolean)).size;
      const products = vs.filter((v) => (v.path || '').startsWith('/product/'));
      const top: Record<string, number> = {};
      for (const v of products) { const s = v.path.slice(9); top[s] = (top[s] || 0) + 1; }
      return {
        ...c, visits: vs.length, people, productViews: products.length,
        top: Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 10),
      };
    }).sort((a, b) => b.visits - a.visits);
  }, [visits]);

  if (!visits) return null;
  const totalVisits = visits.length;
  const attributed = rows.reduce((s, r) => s + r.visits, 0);
  const rev = orders.reduce((s, o) => s + (Number(o.total) || 0), 0);

  return (
    <Card>
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-1">
        <div className="text-sm font-bold text-ink-900">📊 Channel performance — who actually sends you visitors</div>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button key={r} onClick={() => setDays(r)} className={`text-xs px-2 py-1 rounded ${days === r ? 'bg-bronze-600 text-cream' : 'bg-cream text-ink-700'}`}>{r}d</button>
          ))}
        </div>
      </div>
      <p className="text-[11px] text-ink-700/55 mb-3">
        Measured on our own site, not platform-reported impressions. {attributed} of {totalVisits} visits in the last {days} days came from a known channel; the rest are direct or untagged.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 mb-4">
        {rows.map((r) => (
          <div key={r.key} className="rounded-lg border border-black/10 bg-cream/40 px-3 py-2.5">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span style={{ background: r.color }} className="inline-block w-2 h-2 rounded-full" />
              <div className="text-[10px] uppercase tracking-wide text-ink-700/55 font-medium truncate">{r.label}</div>
            </div>
            <div className={`text-2xl font-extrabold leading-tight ${r.visits ? 'text-bronze-800' : 'text-ink-700/35'}`}>{r.visits}</div>
            <div className="text-[10px] text-ink-700/50">{r.people} people · {r.productViews} design views</div>
          </div>
        ))}
      </div>

      <div className="text-xs text-ink-700/60 mb-3">
        Site-wide in this window: <b className="text-ink-900">{totalVisits}</b> visits · <b className="text-ink-900">{orders.length}</b> paid orders · <b className="text-ink-900">${rev.toFixed(2)}</b> revenue.
      </div>

      {/* Top designs per channel */}
      <div className="grid md:grid-cols-2 gap-x-6 gap-y-4">
        {rows.filter((r) => r.top.length > 0).map((r) => (
          <div key={r.key}>
            <div className="text-xs font-bold text-ink-900 mb-1 flex items-center gap-1.5">
              <span style={{ background: r.color }} className="inline-block w-2 h-2 rounded-full" />
              Top designs from {r.label}
            </div>
            {r.top.map(([slug, n]) => (
              <div key={slug} className="flex items-baseline justify-between gap-2 border-b border-black/5 py-1">
                <a href={`/product/${slug}`} target="_blank" rel="noreferrer" className="text-[13px] text-ink-800 hover:text-bronze-700 truncate">{titles[slug] || slug}</a>
                <b className="text-[13px] text-ink-900 shrink-0">{n}</b>
              </div>
            ))}
          </div>
        ))}
      </div>

      {rows.every((r) => r.visits === 0) && (
        <p className="text-xs text-ink-700/50">No channel-attributed visits yet in this window. Feed links now carry utm_source, so Pinterest and Google traffic will start appearing here as those platforms re-crawl.</p>
      )}
    </Card>
  );
}
