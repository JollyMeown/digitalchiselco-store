import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Card } from './ui';

// AI visitors (2026-09-28, owner: "the traffic was coming from ChatGPT").
// Anyone whose visit arrived from an AI assistant, followed through the rest
// of their visits in the same range: weekly trend, where the assistant sent
// them, and what they did next. Built on the visits the Traffic tab already
// loaded, plus one small events query for those visitors.
//
// A purchase is a visit to /checkout/success and a free-pack signup a visit to
// /free/confirm, because orders carry an email and not a visitor hash.

const AI_HOSTS: [RegExp, string][] = [
  [/chatgpt\.com|openai\.com/, 'ChatGPT'],
  [/perplexity\.ai/, 'Perplexity'],
  [/copilot\.microsoft\.com|bing\.com\/chat/, 'Copilot'],
  [/gemini\.google\.com|bard\.google\.com/, 'Gemini'],
  [/claude\.ai/, 'Claude'],
  [/you\.com|phind\.com|deepseek\.com|meta\.ai|grok\.com/, 'Other AI'],
];
const aiName = (h?: string | null) => { if (!h) return null; for (const [re, n] of AI_HOSTS) if (re.test(h)) return n; return null; };

type Visit = { ts: string; path: string; referrer_host: string | null; visitor_hash: string | null };

export default function AiVisitors({ rows, days }: { rows: Visit[]; days: number }) {
  const ai = useMemo(() => {
    const src = new Map<string, { name: string; landing: string; ts: string }>();
    // rows arrive newest first; walk oldest first so the landing page is the first AI arrival
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      const n = aiName(r.referrer_host);
      if (n && r.visitor_hash && !src.has(r.visitor_hash)) src.set(r.visitor_hash, { name: n, landing: r.path, ts: r.ts });
    }
    const theirs = rows.filter((r) => r.visitor_hash && src.has(r.visitor_hash));
    const sites: Record<string, number> = {}, landing: Record<string, number> = {}, weeks: Record<string, number> = {};
    for (const v of src.values()) {
      sites[v.name] = (sites[v.name] || 0) + 1;
      landing[v.landing] = (landing[v.landing] || 0) + 1;
      const d = new Date(v.ts); const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10);
      weeks[monday] = (weeks[monday] || 0) + 1;
    }
    const did = (p: (path: string) => boolean) => new Set(theirs.filter((r) => p(r.path)).map((r) => r.visitor_hash)).size;
    return {
      hashes: [...src.keys()], visitors: src.size, pageviews: theirs.length,
      sites: Object.entries(sites).sort((a, b) => b[1] - a[1]),
      landing: Object.entries(landing).sort((a, b) => b[1] - a[1]).slice(0, 8),
      weeks: Object.entries(weeks).sort((a, b) => a[0].localeCompare(b[0])),
      products: did((p) => p.startsWith('/product/')),
      bought: did((p) => p.startsWith('/checkout/success')),
      signedUp: did((p) => p.startsWith('/free/confirm')),
    };
  }, [rows]);

  const [ev, setEv] = useState<{ cart: number; checkout: number } | null>(null);
  useEffect(() => {
    if (!ai.hashes.length) { setEv({ cart: 0, checkout: 0 }); return; }
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    supabase.from('site_events').select('type, visitor_hash').in('type', ['add_to_cart', 'buy_now', 'checkout_start'])
      .in('visitor_hash', ai.hashes.slice(0, 300)).gte('day', since).limit(5000)
      .then(({ data }) => {
        const u = (t: string[]) => new Set((data || []).filter((e: any) => t.includes(e.type)).map((e: any) => e.visitor_hash)).size;
        setEv({ cart: u(['add_to_cart', 'buy_now']), checkout: u(['checkout_start']) });
      });
  }, [ai.hashes.join(','), days]);

  const maxWeek = Math.max(1, ...ai.weeks.map(([, n]) => n));
  const step = (label: string, n: number | undefined) => (
    <div className="rounded-md bg-cream/60 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-ink-700/50">{label}</div>
      <div className="text-xl font-medium text-bronze-800">{n ?? '…'}</div>
    </div>
  );
  return (
    <Card>
      <div className="flex flex-wrap items-baseline gap-2 mb-3">
        <div className="text-sm font-medium text-ink-900">🤖 AI visitors ({days}d)</div>
        <span className="text-xs text-ink-700/60">people sent by ChatGPT, Perplexity, Copilot, Gemini and other assistants, followed through their visits</span>
      </div>
      {ai.visitors === 0 ? <p className="text-sm text-ink-700/60">No AI-referred visitors in this range.</p> : (
        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <div className="grid grid-cols-2 gap-2">
              {step('Visitors', ai.visitors)}
              {step('Pages each', Math.round((ai.pageviews / ai.visitors) * 10) / 10)}
              {step('Opened a design', ai.products)}
              {step('Added to cart', ev?.cart)}
              {step('Started checkout', ev?.checkout)}
              {step('Bought', ai.bought)}
              {step('Free-pack signup', ai.signedUp)}
            </div>
            <div className="text-[11px] text-ink-700/60 mt-2">{ai.sites.map(([n, c]) => `${n} ${c}`).join(' · ')}</div>
          </div>
          <div>
            <div className="text-xs font-medium text-ink-800 mb-1">New AI visitors per week</div>
            <div className="space-y-1">
              {ai.weeks.map(([w, n]) => (
                <div key={w} className="flex items-center gap-2 text-[11px]">
                  <span className="w-12 text-ink-700/60 tabular-nums">{new Date(w + 'T00:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
                  <span className="h-3 rounded-sm bg-bronze-600" style={{ width: `${(n / maxWeek) * 100}%`, minWidth: 3 }} />
                  <span className="tabular-nums text-ink-800">{n}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs font-medium text-ink-800 mb-1">Where the assistant sent them</div>
            <ul className="space-y-1 text-[12px]">
              {ai.landing.map(([p, n]) => (
                <li key={p} className="flex gap-2"><span className="tabular-nums w-6 text-right text-bronze-800">{n}</span><a href={p} target="_blank" rel="noreferrer" className="truncate text-ink-800 hover:underline">{p}</a></li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Card>
  );
}
