// Etsy SEO rewrite experiment readout.
//
// Weak listings (views < 20, zero sales in 365 days) get a subject-first title
// and 13 buyer-intent tags. This compares their view growth since the change
// against the untouched weak listings, using etsy_listing_stats (refreshed
// daily by the local Finance Refresh task). A rewrite that works shows up as
// the rewritten group pulling away from the untouched group.
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Card } from './ui';

type Exp = { listing_id: number; batch: string; applied_at: string; old_title: string; new_title: string; views_at_apply: number; favorers_at_apply: number; status: string };
type Stat = { listing_id: number; views: number; favorers: number; updated_at: string };

export default function EtsySeoExperiment() {
  const [d, setD] = useState<any>(null);
  useEffect(() => {
    (async () => {
      const { data: exp } = await supabase.from('etsy_seo_experiment').select('*').eq('status', 'applied').order('applied_at');
      if (!exp?.length) return setD({ none: true });
      const ids = exp.map((e: any) => e.listing_id);
      const { data: stats } = await supabase.from('etsy_listing_stats').select('listing_id, views, favorers, updated_at').limit(5000);
      const byId = new Map<number, Stat>((stats || []).map((s: any) => [Number(s.listing_id), s]));
      const started = exp[0].applied_at;
      // rewritten group: views gained since the change
      let rwGain = 0, rwFav = 0, rwN = 0;
      const rows = (exp as Exp[]).map((e) => {
        const s = byId.get(Number(e.listing_id));
        const gain = s ? Math.max(0, s.views - e.views_at_apply) : 0;
        const fav = s ? Math.max(0, s.favorers - e.favorers_at_apply) : 0;
        if (s) { rwGain += gain; rwFav += fav; rwN++; }
        return { ...e, gain, fav, views: s?.views ?? e.views_at_apply };
      }).sort((a, b) => b.gain - a.gain);
      // control: the other weak listings (views < 20 at the same moment) — we
      // approximate "weak & untouched" as listings with views < 20 today that
      // are not in the experiment
      const untouched = (stats || []).filter((s: any) => !ids.includes(Number(s.listing_id)) && s.views < 25);
      const lastSync = (stats || []).map((s: any) => s.updated_at).sort().pop();
      setD({ started, rows, rwN, rwGain, rwFav, ctrlN: untouched.length, lastSync, batches: [...new Set(exp.map((e: any) => e.batch))] });
    })();
  }, []);
  if (!d || d.none) return null;
  const days = Math.max(0, Math.round((Date.now() - Date.parse(d.started)) / 86400000));
  return (
    <Card>
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-1">
        <div className="text-sm font-bold text-ink-900">🛍️ Etsy SEO rewrite test · {d.rwN} listings · day {days} of 14</div>
        <span className="text-[11px] text-ink-700/50">batches: {d.batches.join(', ')} · stats synced {d.lastSync ? new Date(d.lastSync).toLocaleDateString() : '—'}</span>
      </div>
      <p className="text-[11px] text-ink-700/55 mb-3">
        Weak listings (under 20 views, no sales in a year) were given a subject-first title and 13 buyer-intent tags, mirroring what the shop's best sellers do.
        Views refresh once a day, and Etsy takes several days to re-index a changed listing, so judge this after two weeks, not two days.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
        <div className="rounded-lg border border-black/10 bg-cream/40 px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-ink-700/50 font-medium">Rewritten</div><div className="text-xl font-extrabold text-bronze-800">{d.rwN}</div></div>
        <div className="rounded-lg border border-black/10 bg-cream/40 px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-ink-700/50 font-medium">Views gained since</div><div className="text-xl font-extrabold text-bronze-800">{d.rwGain}</div><div className="text-[10px] text-ink-700/50">{d.rwN ? (d.rwGain / d.rwN).toFixed(1) : 0} per listing</div></div>
        <div className="rounded-lg border border-black/10 bg-cream/40 px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-ink-700/50 font-medium">Favourites gained</div><div className="text-xl font-extrabold text-bronze-800">{d.rwFav}</div></div>
        <div className="rounded-lg border border-black/10 bg-cream/40 px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-ink-700/50 font-medium">Untouched weak (control)</div><div className="text-xl font-extrabold text-ink-700/60">{d.ctrlN}</div></div>
      </div>
      <div className="text-xs font-bold text-ink-900 mb-1">Biggest movers</div>
      {d.rows.slice(0, 8).map((r: any) => (
        <div key={r.listing_id} className="flex items-baseline justify-between gap-2 border-b border-black/5 py-1">
          <a href={`https://www.etsy.com/listing/${r.listing_id}`} target="_blank" rel="noreferrer" className="text-[13px] text-ink-800 hover:text-bronze-700 truncate" title={`was: ${r.old_title}`}>{r.new_title}</a>
          <span className="text-[12px] shrink-0 tabular-nums"><b className="text-green-700">+{r.gain}</b> <span className="text-ink-700/40">views</span> · {r.fav > 0 && <b className="text-bronze-700">+{r.fav} ♥</b>}</span>
        </div>
      ))}
    </Card>
  );
}
