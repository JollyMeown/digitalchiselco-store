import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { img } from '../../lib/img';
import { useLiveRefresh } from './useLiveRefresh';

// "Who's on the site right now" (owner, 2026-09-26: "I need a blinking effect
// on these visitors, or at least know clearly what page they are watching").
// One row per visitor seen in the last 5 minutes: the page they are on now
// (with the design's picture and name), country, device, their local time,
// where they came from, pages seen and time on site this visit, the last few
// steps, what they searched and whether they added to cart. A row flashes
// when that visitor moves to a new page; cart and checkout blink red.
// Reads only the last 30 minutes of visits and events (a few dozen rows), so
// a 15 s refresh is cheap; useLiveRefresh stops it when the admin is away.

const LIVE_MIN = 5, SESSION_MIN = 30;
type Visit = { ts: string; path: string; referrer_host: string | null; device: string | null; country: string | null; visitor_hash: string | null; campaign: string | null; tz: string | null };
type Ev = { ts: string; type: string; path: string | null; q: string | null; visitor_hash: string | null };
type Person = {
  id: string; now: Visit; first: Visit; pages: Visit[]; events: Ev[];
  lastMs: number; startMs: number;
};

const flag = (cc?: string | null) => cc && /^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map((c) => 0x1f1a5 + c.charCodeAt(0))) : '🌐';
const countryName = (cc?: string | null) => { try { return cc ? new Intl.DisplayNames(['en'], { type: 'region' }).of(cc) || cc : 'Unknown'; } catch { return cc || 'Unknown'; } };
const localTime = (tz?: string | null) => { try { return tz ? new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: tz }) : ''; } catch { return ''; } };
const ago = (ms: number) => { const s = Math.max(0, Math.round((Date.now() - ms) / 1000)); return s < 60 ? `${s}s ago` : `${Math.floor(s / 60)} min ago`; };
const dur = (ms: number) => { const m = Math.round(ms / 60000); return m < 1 ? 'under a minute' : `${m} min`; };

export default function LiveActivity() {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [names, setNames] = useState<Record<string, { title: string; image: string | null }>>({});
  const [cats, setCats] = useState<Record<string, string>>({});
  const [flash, setFlash] = useState<Record<string, number>>({});
  const lastPath = useRef<Record<string, string>>({});
  const [, tick] = useState(0);

  async function poll() {
    try {
      const since = new Date(Date.now() - SESSION_MIN * 60000).toISOString();
      const [{ data: v }, { data: e }] = await Promise.all([
        supabase.from('site_visits').select('ts, path, referrer_host, device, country, visitor_hash, campaign, tz').gte('ts', since).order('ts', { ascending: true }).limit(2000),
        supabase.from('site_events').select('ts, type, path, q, visitor_hash').gte('ts', since).order('ts', { ascending: true }).limit(2000),
      ]);
      const by = new Map<string, Person>();
      for (const x of (v || []) as Visit[]) {
        const id = x.visitor_hash || `anon-${x.ts}`;
        const ms = Date.parse(x.ts);
        const p = by.get(id);
        if (!p) by.set(id, { id, now: x, first: x, pages: [x], events: [], lastMs: ms, startMs: ms });
        else { p.pages.push(x); p.now = x; p.lastMs = ms; }
      }
      for (const x of (e || []) as Ev[]) { const p = x.visitor_hash && by.get(x.visitor_hash); if (p) { p.events.push(x); p.lastMs = Math.max(p.lastMs, Date.parse(x.ts)); } }
      const live = [...by.values()].filter((p) => Date.now() - p.lastMs < LIVE_MIN * 60000).sort((a, b) => b.lastMs - a.lastMs);

      // a visitor who moved to a new page flashes for a few seconds
      const fl: Record<string, number> = {};
      for (const p of live) {
        const prev = lastPath.current[p.id];
        if (prev && prev !== p.now.path) fl[p.id] = Date.now();
        lastPath.current[p.id] = p.now.path;
      }
      if (Object.keys(fl).length) setFlash((f) => ({ ...f, ...fl }));
      setPeople(live);

      // names for the pages they are on: designs and collections
      const slugs = [...new Set(live.flatMap((p) => p.pages.map((x) => x.path)).filter((x) => x.startsWith('/product/')).map((x) => x.split('/')[2]))].filter((s) => s && !(s in names));
      if (slugs.length) {
        const { data } = await supabase.from('products').select('slug, title, image_url').in('slug', slugs.slice(0, 100));
        setNames((n) => ({ ...n, ...Object.fromEntries((data || []).map((r: any) => [r.slug, { title: String(r.title).split('|')[0].trim(), image: r.image_url }])) }));
      }
      const cs = [...new Set(live.flatMap((p) => p.pages.map((x) => x.path)).filter((x) => x.startsWith('/collections/')).map((x) => x.split('/')[2]))].filter((s) => s && !(s in cats));
      if (cs.length) {
        const { data } = await supabase.from('categories').select('slug, name').in('slug', cs);
        setCats((c) => ({ ...c, ...Object.fromEntries((data || []).map((r: any) => [r.slug, r.name])) }));
      }
    } catch { /* keep the last view */ }
  }
  useEffect(() => { poll(); }, []);
  useLiveRefresh(poll, 15000, []);
  // "12s ago" labels keep moving between polls
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 5000); return () => clearInterval(t); }, []);

  const pageName = (path: string) => {
    const [, a, b] = path.split('/');
    if (a === 'product') return names[b]?.title || 'A design page';
    if (a === 'collections') return b ? `Collection: ${cats[b] || b.replace(/-/g, ' ')}` : 'All collections';
    const fixed: Record<string, string> = { '': 'Homepage', catalog: 'Catalog', search: 'Search', cart: 'Cart', checkout: 'Checkout', membership: 'Membership', free: 'Free files', 'bundle-builder': 'Pick 5 bundle builder', blog: b ? 'Blog article' : 'Blog', faq: 'FAQ', account: 'Their account', 'laser-studio': 'Laser Studio', 'lamp-studio': 'Lamp Studio', 'gift-cards': 'Gift cards', 'custom-design': 'Custom design', tools: 'Free tools', pl: 'Polish page', de: 'German page', favorites: 'Favourites', quiz: 'Design finder', designs: 'Theme page', seasonal: 'Seasonal page', about: 'Our story', pricing: 'Pricing' };
    return fixed[a] ?? path;
  };
  const source = (p: Person) => p.first.campaign ? p.first.campaign.replace(/^article-/, 'article: ') : p.first.referrer_host || 'direct / bookmark';

  if (!people) return null;
  return (
    <div className="bg-white border border-black/10 rounded-lg p-4">
      <style>{`@keyframes dccLiveBlink{0%,49%{opacity:1}50%,100%{opacity:.2}} .dcc-live-blink{animation:dccLiveBlink 1s step-start infinite}
        @keyframes dccLiveFlash{0%{background:#FDF3C4}100%{background:transparent}} .dcc-live-flash{animation:dccLiveFlash 3s ease-out}
        @media (prefers-reduced-motion:reduce){.dcc-live-blink,.dcc-live-flash{animation:none}}`}</style>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className={`inline-block w-3 h-3 rounded-full ${people.length ? 'bg-green-500 dcc-live-blink' : 'bg-ink-700/20'}`} />
        <span className="text-sm font-semibold text-ink-900">Who is on the site right now</span>
        <span className="text-xs text-ink-700/60">{people.length ? `${people.length} visitor${people.length === 1 ? '' : 's'} active in the last ${LIVE_MIN} minutes · updates every 15 seconds` : `nobody in the last ${LIVE_MIN} minutes`}</span>
      </div>
      {people.length > 0 && (
        <ul className="divide-y divide-black/5">
          {people.map((p) => {
            const path = p.now.path;
            const onCart = path === '/cart' || path.startsWith('/checkout');
            const fresh = Date.now() - p.lastMs < 60000;
            const slug = path.startsWith('/product/') ? path.split('/')[2] : '';
            const pic = slug ? names[slug]?.image : null;
            const searches = p.events.filter((e) => e.type === 'search' && e.q).map((e) => e.q as string);
            const added = p.events.some((e) => e.type === 'add_to_cart');
            const trail = p.pages.slice(-6, -1).reverse();
            return (
              <li key={p.id + (flash[p.id] || '')} className={`py-3 flex gap-3 items-start ${flash[p.id] && Date.now() - flash[p.id] < 4000 ? 'dcc-live-flash' : ''} ${onCart ? 'bg-red-50/60 -mx-2 px-2 rounded' : ''}`}>
                <span className={`mt-1.5 inline-block w-2.5 h-2.5 rounded-full shrink-0 ${onCart ? 'bg-red-500 dcc-live-blink' : fresh ? 'bg-green-500 dcc-live-blink' : 'bg-green-400/60'}`} title={fresh ? 'active this minute' : 'reading'} />
                {pic ? <img src={img(pic, { w: 96, square: true, q: 60 })} alt="" width={48} height={48} className="w-12 h-12 rounded object-cover shrink-0" /> : <span className="w-12 h-12 rounded bg-cream shrink-0 flex items-center justify-center text-lg">{onCart ? '🛒' : '👀'}</span>}
                <div className="min-w-0 flex-1 text-sm">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    {onCart && <span className="text-[11px] font-bold text-red-600 dcc-live-blink">AT {path.startsWith('/checkout') ? 'CHECKOUT' : 'CART'}</span>}
                    <a href={path} target="_blank" rel="noopener" className="font-medium text-ink-900 hover:underline truncate max-w-full">{pageName(path)}</a>
                    <span className="text-xs text-ink-700/50">{ago(p.lastMs)}</span>
                  </div>
                  <div className="text-xs text-ink-700/70 mt-0.5">
                    {flag(p.now.country)} {countryName(p.now.country)}{localTime(p.now.tz) ? ` · their time ${localTime(p.now.tz)}` : ''} · {p.now.device || 'device ?'} · from {source(p)} · {p.pages.length} page{p.pages.length === 1 ? '' : 's'} in {dur(p.lastMs - p.startMs)}
                  </div>
                  {(searches.length > 0 || added) && (
                    <div className="text-xs mt-1 flex flex-wrap gap-2">
                      {searches.slice(-3).map((q, i) => <span key={i} className="bg-cream rounded px-1.5 py-0.5">🔎 searched "{q}"</span>)}
                      {added && <span className="bg-green-50 text-green-700 rounded px-1.5 py-0.5">🛒 added to cart</span>}
                    </div>
                  )}
                  {trail.length > 0 && <div className="text-[11px] text-ink-700/50 mt-1 truncate">before: {trail.map((t) => pageName(t.path)).join(' ← ')}</div>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
