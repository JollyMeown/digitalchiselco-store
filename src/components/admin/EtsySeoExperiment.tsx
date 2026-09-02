// Etsy SEO rewrite experiment readout: BEFORE -> AFTER per listing.
//
// Weak listings (views < 20, zero sales in 365 days) got a subject-first title
// and 13 buyer-intent tags. Every row stores what the listing had before (title,
// tags, views, favourites, sales) and the local Finance Refresh task writes the
// "now" numbers once a day (scripts/etsy_seo/etsy_seo_progress.mjs), so the
// owner sees the change and its effect side by side without opening Etsy.
// The untouched weak listings are the control: judge on growth RATE vs them.
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Card } from './ui';

type Exp = {
  listing_id: number; batch: string; applied_at: string; status: string;
  old_title: string; new_title: string; old_tags: string[] | null; new_tags: string[] | null;
  views_at_apply: number; favorers_at_apply: number; sales_at_apply: number;
  views_now: number | null; favorers_now: number | null; sales_now: number | null; checked_at: string | null;
};
type Stat = { listing_id: number; views: number; favorers: number; updated_at: string };

const TOOLING = /\b(cnc|stl|relief|router|carv|aspire|vcarve|carveco|artcam|laser|3d print|engrav|dxf|svg)\b/i;

export default function EtsySeoExperiment() {
  const [d, setD] = useState<any>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    (async () => {
      const { data: exp } = await supabase.from('etsy_seo_experiment').select('*').eq('status', 'applied').order('applied_at');
      if (!exp?.length) return setD({ none: true });
      const ids = new Set(exp.map((e: any) => Number(e.listing_id)));
      const { data: stats } = await supabase.from('etsy_listing_stats').select('listing_id, views, favorers, updated_at').limit(5000);
      const byId = new Map<number, Stat>((stats || []).map((s: any) => [Number(s.listing_id), s]));
      const started = exp[0].applied_at;
      let gainV = 0, gainF = 0, sales = 0, n = 0, beforeV = 0, beforeF = 0;
      const rows = (exp as Exp[]).map((e) => {
        const s = byId.get(Number(e.listing_id));
        // "now" = the daily snapshot when present, else the live stats table
        const viewsNow = e.views_now ?? s?.views ?? e.views_at_apply;
        const favNow = e.favorers_now ?? s?.favorers ?? e.favorers_at_apply;
        const salesNow = e.sales_now ?? 0;
        const gv = Math.max(0, viewsNow - e.views_at_apply), gf = Math.max(0, favNow - e.favorers_at_apply);
        gainV += gv; gainF += gf; sales += salesNow; n++; beforeV += e.views_at_apply; beforeF += e.favorers_at_apply;
        return { ...e, viewsNow, favNow, salesNow, gv, gf };
      }).sort((a, b) => (b.salesNow - a.salesNow) || (b.gv - a.gv) || (b.gf - a.gf));
      // control = weak listings not in the experiment (views < 25 today)
      const ctrl = (stats || []).filter((s: any) => !ids.has(Number(s.listing_id)) && s.views < 25);
      const lastSync = (stats || []).map((s: any) => s.updated_at).sort().pop();
      const checked = exp.map((e: any) => e.checked_at).filter(Boolean).sort().pop();
      setD({ started, rows, n, gainV, gainF, sales, beforeV, beforeF, ctrlN: ctrl.length, lastSync, checked, batches: [...new Set(exp.map((e: any) => e.batch))] });
    })();
  }, []);
  if (!d || d.none) return null;
  const days = Math.max(0, Math.round((Date.now() - Date.parse(d.started)) / 86400000));
  const perDay = days > 0 ? (d.gainV / d.n / days).toFixed(2) : '—';
  const list = showAll ? d.rows : d.rows.slice(0, 10);
  const tile = (label: string, before: any, after: any, note?: string, strong?: boolean) => (
    <div className="rounded-lg border border-black/10 bg-cream/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-ink-700/50 font-medium">{label}</div>
      <div className="flex items-baseline gap-2 tabular-nums">
        <span className="text-sm text-ink-700/50 line-through decoration-ink-700/30">{before}</span>
        <span className="text-ink-700/40">→</span>
        <span className={`text-xl font-extrabold ${strong ? 'text-green-700' : 'text-bronze-800'}`}>{after}</span>
      </div>
      {note && <div className="text-[10px] text-ink-700/50">{note}</div>}
    </div>
  );
  return (
    <Card>
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-1">
        <div className="text-sm font-bold text-ink-900">🛍️ Etsy SEO rewrite · before → after · {d.n} listings · day {days} of 14</div>
        <span className="text-[11px] text-ink-700/50">batches {d.batches.join(', ')} · snapshot {d.checked ? new Date(d.checked).toLocaleDateString() : 'pending (runs with Finance Refresh)'}</span>
      </div>
      <p className="text-[11px] text-ink-700/55 mb-3">
        Weak listings (under 20 views, no sales in a year) were given a subject-first title and 13 buyer-intent tags, mirroring what the shop's best sellers do.
        BEFORE is the moment of the change; AFTER refreshes daily. Etsy takes several days to re-index, so read this at day 7 and decide at day 14.
        Decision rule: rewritten group clearly out-grows the {d.ctrlN} untouched weak listings → spread the method; flat → titles/tags were not the bottleneck for these.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
        {tile('Views (all rewritten)', d.beforeV, d.beforeV + d.gainV, `+${d.gainV} · ${perDay} per listing per day`)}
        {tile('Favourites', d.beforeF, d.beforeF + d.gainF, `+${d.gainF}`)}
        {tile('Sales since rewrite', 0, d.sales, 'these had zero sales in 365 days', d.sales > 0)}
        <div className="rounded-lg border border-black/10 bg-cream/40 px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-ink-700/50 font-medium">Untouched weak (control)</div><div className="text-xl font-extrabold text-ink-700/60">{d.ctrlN}</div><div className="text-[10px] text-ink-700/50">same cohort, no change</div></div>
      </div>
      <div className="flex items-baseline justify-between mb-1">
        <div className="text-xs font-bold text-ink-900">Per listing (click a row to see old vs new title and tags)</div>
        <button className="text-[11px] text-bronze-700 hover:underline" onClick={() => setShowAll(!showAll)}>{showAll ? 'show top 10' : `show all ${d.n}`}</button>
      </div>
      <div className="hidden md:grid grid-cols-[1fr_90px_90px_80px] gap-2 text-[10px] uppercase tracking-wide text-ink-700/45 font-medium border-b border-black/10 pb-1">
        <span>Listing</span><span className="text-right">Views</span><span className="text-right">Favourites</span><span className="text-right">Sales</span>
      </div>
      {list.map((r: any) => {
        const isOpen = open === r.listing_id;
        const oldTags = r.old_tags || [], newTags = r.new_tags || [];
        const tooling = (t: string[]) => t.filter((x) => TOOLING.test(x)).length;
        return (
          <div key={r.listing_id} className="border-b border-black/5">
            <button className="w-full text-left grid grid-cols-[1fr_auto] md:grid-cols-[1fr_90px_90px_80px] gap-2 items-baseline py-1.5 hover:bg-cream/40" onClick={() => setOpen(isOpen ? null : r.listing_id)}>
              <span className="text-[13px] text-ink-800 truncate">{r.new_title}</span>
              <span className="hidden md:block text-right text-[12px] tabular-nums"><span className="text-ink-700/45">{r.views_at_apply}</span> → <b className={r.gv > 0 ? 'text-green-700' : 'text-ink-800'}>{r.viewsNow}</b></span>
              <span className="hidden md:block text-right text-[12px] tabular-nums"><span className="text-ink-700/45">{r.favorers_at_apply}</span> → <b className={r.gf > 0 ? 'text-bronze-700' : 'text-ink-800'}>{r.favNow}</b></span>
              <span className="text-right text-[12px] tabular-nums"><span className="text-ink-700/45">0</span> → <b className={r.salesNow > 0 ? 'text-green-700' : 'text-ink-800'}>{r.salesNow}</b></span>
            </button>
            {isOpen && (
              <div className="grid md:grid-cols-2 gap-3 px-2 pb-3 pt-1 text-[12px]">
                <div className="rounded-lg border border-black/10 bg-white/50 p-2">
                  <div className="text-[10px] uppercase tracking-wide text-ink-700/45 font-medium mb-1">Before · {r.views_at_apply} views · {r.favorers_at_apply} ♥ · 0 sales</div>
                  <div className="text-ink-700/70 mb-1">{r.old_title}</div>
                  <div className="flex flex-wrap gap-1">{oldTags.map((t: string) => <span key={t} className={`px-1.5 py-0.5 rounded text-[10px] ${TOOLING.test(t) ? 'bg-black/5 text-ink-700/50' : 'bg-cream text-ink-800'}`}>{t}</span>)}</div>
                  <div className="text-[10px] text-ink-700/45 mt-1">{tooling(oldTags)} tooling tags · {oldTags.length - tooling(oldTags)} subject tags</div>
                </div>
                <div className="rounded-lg border border-green-700/20 bg-green-50/40 p-2">
                  <div className="text-[10px] uppercase tracking-wide text-green-800/70 font-medium mb-1">After · {r.viewsNow} views · {r.favNow} ♥ · {r.salesNow} sales · changed {new Date(r.applied_at).toLocaleDateString()}</div>
                  <div className="text-ink-900 mb-1">{r.new_title}</div>
                  <div className="flex flex-wrap gap-1">{newTags.map((t: string) => <span key={t} className={`px-1.5 py-0.5 rounded text-[10px] ${TOOLING.test(t) ? 'bg-black/5 text-ink-700/50' : 'bg-green-100 text-green-900'}`}>{t}</span>)}</div>
                  <div className="text-[10px] text-ink-700/45 mt-1">{tooling(newTags)} tooling tags · {newTags.length - tooling(newTags)} subject tags · <a href={`https://www.etsy.com/listing/${r.listing_id}`} target="_blank" rel="noreferrer" className="text-bronze-700 hover:underline">open on Etsy ↗</a></div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </Card>
  );
}
