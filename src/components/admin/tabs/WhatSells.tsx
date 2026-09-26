import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { Card, btnGhost, btnPrimary } from '../ui';
import { img } from '../../../lib/img';
import type { WhatSells as Report, Verdict } from '../../../lib/what-sells';

// What Sells (owner, 2026-09-26): the sales analysis and the "what to make
// next" brief, kept live on the dashboard so it can be acted on any day. The
// report is recomputed by /api/admin/what-sells (10 minute cache, Refresh
// forces a new one). No polling: it reads every product, so it loads on open.

const VERDICT: Record<Verdict, { label: string; cls: string }> = {
  more: { label: 'Make more', cls: 'bg-[#E3EFE8] text-[#2F6B4F]' },
  keep: { label: 'Keep', cls: 'bg-[#F3E6D2] text-[#854F0B]' },
  fewer: { label: 'Make fewer', cls: 'bg-[#F6E3DE] text-[#A3402B]' },
  seasonal: { label: 'Seasonal', cls: 'bg-[#ECE8E1] text-[#6B6258]' },
};
const Pill = ({ v }: { v: Verdict }) => <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${VERDICT[v].cls}`}>{VERDICT[v].label}</span>;
const Bar = ({ value, max }: { value: number; max: number }) => (
  <div className="h-2 rounded bg-black/5 w-28"><div className="h-2 rounded bg-[#C9A57A]" style={{ width: `${Math.min(100, (value / (max || 1)) * 100)}%` }} /></div>
);
const th = 'text-left text-[11px] uppercase tracking-wide text-ink-700/60 font-semibold px-3 py-2 bg-cream/60';
const td = 'px-3 py-2 border-t border-black/5 text-sm';
const num = 'tabular-nums text-right';

function briefText(r: Report): string {
  const lines = [`WHAT TO MAKE NEXT (about 100 designs), from sales on ${r.generatedAt.slice(0, 10)}`, ''];
  lines.push('PROVEN (about 60):', ...r.brief.proven.map((b) => `- ${b.name}: ${b.count}  (${b.why})`), '');
  lines.push('CLOSE TO PROVEN (about 25):', ...r.brief.close.map((b) => `- ${b.name}: ${b.count}  (${b.why})`), '');
  lines.push('NEW BETS (about 15):', ...r.brief.newBets.map((b) => `- ${b.name}: ${b.count}  (${b.why})`), '');
  lines.push('SLOW DOWN ON:', ...r.brief.slowDown.map((b) => `- ${b.name}: ${b.why}`));
  return lines.join('\n');
}

export default function WhatSells() {
  const [r, setR] = useState<Report | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState('');
  const [showAllTop, setShowAllTop] = useState(false);

  async function load(fresh = false) {
    setBusy(true); setErr('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/admin/what-sells' + (fresh ? '?fresh=1' : ''), { headers: { authorization: `Bearer ${session?.access_token || ''}` } });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setR(j);
    } catch (e: any) { setErr(e.message || 'Could not load the report.'); }
    setBusy(false);
  }
  useEffect(() => { load(); }, []);

  async function copyBrief() {
    if (!r) return;
    try { await navigator.clipboard.writeText(briefText(r)); setCopied('Copied. Paste it to Umer.'); }
    catch { setCopied('Copy was blocked by the browser; select the brief text instead.'); }
    setTimeout(() => setCopied(''), 4000);
  }

  if (err) return <Card><p className="text-sm text-red-700">{err}</p><button className={btnGhost + ' mt-3'} onClick={() => load(true)}>Try again</button></Card>;
  if (!r) return <Card><p className="text-sm text-ink-700/70">Building the report from every design's sales… (a few seconds)</p></Card>;

  const f = r.facts;
  const more = r.collections.filter((c) => c.verdict === 'more');
  const fewer = r.collections.filter((c) => c.verdict === 'fewer');
  const maxC = Math.max(...r.collections.map((c) => c.perDesign), 1);
  const maxS = Math.max(...r.subjects.map((s) => s.perDesign), 1);
  const judgedF = r.formats.filter((x) => x.judged);
  const maxF = Math.max(...judgedF.map((x) => x.perMonth), 1);
  const pctMore = f.newLast30 ? Math.round((r.followed.inMore / f.newLast30) * 100) : 0;
  const pctFewer = f.newLast30 ? Math.round((r.followed.inFewer / f.newLast30) * 100) : 0;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-ink-700/80 max-w-3xl">
            Which collections, subjects and formats actually sell, from 12 months of Etsy sales for every design on the site, and what to make next.
            Designs are judged after {r.judgeAfterDays} days on Etsy. Updated {new Date(r.generatedAt).toLocaleString()}.
          </div>
          <div className="flex gap-2">
            <a className={btnGhost} href="https://claude.ai/artifact/6N4kpjc7jkJWjS87kTxwrX" target="_blank" rel="noopener">Full report</a>
            <button className={btnPrimary} onClick={() => load(true)} disabled={busy}>{busy ? 'Refreshing…' : 'Refresh'}</button>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          [`${f.zeroPct}%`, `of designs listed ${r.judgeAfterDays}+ days sold nothing in 12 months`],
          ['75', `best sellers make ${f.top75Share}% of all ${f.sales.toLocaleString()} sales`],
          [f.trayMultiple ? `${f.trayMultiple}×` : 'n/a', 'trays sell this many times a wall panel, per design'],
          [`${pctMore}% / ${pctFewer}%`, `of the ${f.newLast30} designs added in 30 days went to "make more" / "make fewer" collections`],
        ].map(([big, small]) => (
          <div key={small} className="bg-white border border-black/10 rounded-lg p-3">
            <div className="text-2xl font-serif text-bronze-700 tabular-nums">{big}</div>
            <div className="text-xs text-ink-700/70 mt-1">{small}</div>
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card title="Make more">
          <ul className="space-y-2 text-sm">
            {more.map((c) => (
              <li key={c.name} className="flex items-start justify-between gap-3">
                <span><b>{c.name}</b> <span className="text-ink-700/70">{c.perDesign} sales per design</span>
                  {c.supply === 'under' && <span className="block text-xs text-[#A3402B]">Under-supplied: {c.salesShare}% of sales but only {c.newShare}% of new designs ({c.newLast30})</span>}</span>
                <Pill v="more" />
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Make fewer">
          <ul className="space-y-2 text-sm">
            {fewer.map((c) => (
              <li key={c.name} className="flex items-start justify-between gap-3">
                <span><b>{c.name}</b> <span className="text-ink-700/70">{c.perDesign} per design, {c.zeroPct}% sold nothing</span>
                  {c.supply === 'over' && <span className="block text-xs text-[#A3402B]">Over-supplied: {c.newShare}% of new designs ({c.newLast30}) for {c.salesShare}% of sales</span>}</span>
                <Pill v="fewer" />
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="What to make next: about 100 designs" action={<button className={btnPrimary} onClick={copyBrief}>Copy brief for Umer</button>}>
        {copied && <p className="text-xs text-[#2F6B4F] mb-2">{copied}</p>}
        <div className="grid md:grid-cols-3 gap-4 text-sm">
          {([['Proven (about 60)', r.brief.proven, 'more'], ['Close to proven (about 25)', r.brief.close, 'keep'], ['New bets (about 15)', r.brief.newBets, 'seasonal']] as const).map(([title, list, v]) => (
            <div key={title} className="space-y-2">
              <div className="flex items-center gap-2"><Pill v={v as Verdict} /><span className="font-medium">{title}</span></div>
              <ul className="space-y-1.5">
                {list.map((b) => <li key={b.name}><b className="tabular-nums">{b.count}</b> {b.name}<span className="block text-xs text-ink-700/60">{b.why}</span></li>)}
              </ul>
            </div>
          ))}
        </div>
        {r.brief.slowDown.length > 0 && (
          <div className="mt-4 rounded-md bg-[#F6E3DE]/60 p-3 text-sm">
            <b>Slow down on:</b>
            <ul className="mt-1 space-y-1">{r.brief.slowDown.map((s) => <li key={s.name}>{s.name}: <span className="text-ink-700/70">{s.why}</span></li>)}</ul>
          </div>
        )}
      </Card>

      <Card title="Collections">
        <div className="overflow-x-auto"><table className="w-full">
          <thead><tr><th className={th}>Collection</th><th className={th + ' text-right'}>Sales per design</th><th className={th}></th><th className={th + ' text-right'}>Sold nothing</th><th className={th + ' text-right'}>Share of sales</th><th className={th + ' text-right'}>New in 30 days</th><th className={th}>Verdict</th></tr></thead>
          <tbody>{r.collections.map((c) => (
            <tr key={c.name}>
              <td className={td}>{c.name}</td><td className={td + ' ' + num}>{c.perDesign}</td><td className={td}><Bar value={c.perDesign} max={maxC} /></td>
              <td className={td + ' ' + num}>{c.zeroPct}%</td><td className={td + ' ' + num}>{c.salesShare}%</td>
              <td className={td + ' ' + num}>{c.newLast30}{c.supply !== 'ok' && <span className="text-[#A3402B]" title={c.supply === 'under' ? 'Fewer new designs than its sales deserve' : 'More new designs than its sales deserve'}> {c.supply === 'under' ? '▼' : '▲'}</span>}</td>
              <td className={td}><Pill v={c.verdict} /></td>
            </tr>
          ))}</tbody>
        </table></div>
        <p className="text-xs text-ink-700/60 mt-2">Make more: at least 1.4 times the catalogue average ({f.avgPerDesign} sales per design a year). Make fewer: 0.7 times or less. ▼ under-supplied, ▲ over-supplied, compared with the collection's share of sales.</p>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Subjects">
          <div className="overflow-x-auto"><table className="w-full">
            <thead><tr><th className={th}>Subject</th><th className={th + ' text-right'}>Designs</th><th className={th + ' text-right'}>Per design</th><th className={th}></th><th className={th + ' text-right'}>Sold nothing</th></tr></thead>
            <tbody>{r.subjects.map((s) => (
              <tr key={s.name} title={s.bestSeller ? `Best: ${s.bestSeller.title} (${s.bestSeller.sales} sold)` : ''}>
                <td className={td}>{s.name}</td><td className={td + ' ' + num}>{s.designs}</td><td className={td + ' ' + num}>{s.perDesign}</td>
                <td className={td}><Bar value={s.perDesign} max={maxS} /></td><td className={td + ' ' + num}>{s.zeroPct}%</td>
              </tr>
            ))}</tbody>
          </table></div>
        </Card>
        <Card title="Formats">
          <div className="overflow-x-auto"><table className="w-full">
            <thead><tr><th className={th}>Format</th><th className={th + ' text-right'}>Designs</th><th className={th + ' text-right'}>Sales per design per month</th><th className={th}></th><th className={th + ' text-right'}>Avg price</th></tr></thead>
            <tbody>{r.formats.map((x) => (
              <tr key={x.name}>
                <td className={td}>{x.name}</td><td className={td + ' ' + num}>{x.designs}</td>
                {x.judged
                  ? <><td className={td + ' ' + num}>{x.perMonth}</td><td className={td}><Bar value={x.perMonth} max={maxF} /></td></>
                  : <td className={td + ' text-xs text-ink-700/60'} colSpan={2}>{x.readOn ? `Too new, judge from ${x.readOn}` : 'Too few to judge'}</td>}
                <td className={td + ' ' + num}>${x.avgPrice.toFixed(2)}</td>
              </tr>
            ))}</tbody>
          </table></div>
          <p className="text-xs text-ink-700/60 mt-2">Per month since each design was listed on Etsy, so new formats are compared fairly once they have 30 days.</p>
        </Card>
      </div>

      <Card title={`The ${r.top.length} designs that make ${f.top75Share}% of sales`} action={<button className={btnGhost} onClick={() => setShowAllTop((v) => !v)}>{showAllTop ? 'Show 24' : `Show all ${r.top.length}`}</button>}>
        <p className="text-sm text-ink-700/70 mb-3">Variations of these are the safest new work.</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {(showAllTop ? r.top : r.top.slice(0, 24)).map((t) => (
            <a key={t.slug} href={`/product/${t.slug}`} target="_blank" rel="noopener" className="flex items-center gap-3 border border-black/10 rounded-md p-2 hover:border-bronze-600 bg-white">
              <span className="w-6 text-right text-xs text-ink-700/60 tabular-nums">{t.rank}</span>
              {t.image ? <img src={img(t.image, { w: 96, square: true, q: 65 })} alt="" width={48} height={48} loading="lazy" className="w-12 h-12 rounded object-cover" /> : <span className="w-12 h-12 rounded bg-cream" />}
              <span className="text-xs leading-tight min-w-0"><span className="line-clamp-2 text-ink-800">{t.title}</span>
                <span className="text-ink-700/60 tabular-nums">{t.sales} sold · ${t.price} · {t.collection}</span></span>
            </a>
          ))}
        </div>
      </Card>
    </div>
  );
}
