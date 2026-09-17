// Saved carts (migration 139): what shoppers have in their carts, whether
// they are on the site right now, and whether they came back to it.
//
// Owner, 2026-09-16: the Shopper actions strip said "1 at cart RIGHT NOW"
// while every card read zero, because the cart lives in the shopper's browser.
// This shows the cart itself.
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';

type Item = { id: string; title: string; price: number; slug: string | null; image_url: string | null };
type Snap = {
  browser_id: string; items: Item[]; item_count: number; total_usd: number; email: string | null;
  status: 'open' | 'converted' | 'emptied'; first_saved_at: string; updated_at: string; last_seen_at: string;
  last_path: string | null; visits: number; device: string | null;
};

const LIVE_MS = 5 * 60e3;
function ago(iso: string): string {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} days ago`;
}

export default function SavedCarts() {
  const [rows, setRows] = useState<Snap[] | null>(null);
  const [show, setShow] = useState<'open' | 'bought'>('open');
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const since = new Date(Date.now() - 30 * 86400e3).toISOString();
      const { data } = await supabase.from('cart_snapshots').select('*')
        .gte('last_seen_at', since).order('last_seen_at', { ascending: false }).limit(200);
      if (alive) setRows((data as any) || []);
    };
    load();
    const t = setInterval(load, 20000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const view = useMemo(() => {
    const all = rows || [];
    const open = all.filter((r) => r.status === 'open');
    const live = open.filter((r) => Date.now() - new Date(r.last_seen_at).getTime() < LIVE_MS);
    // A returning shopper: the cart was started on an earlier day than today's visit.
    const returning = open.filter((r) => new Date(r.last_seen_at).getTime() - new Date(r.first_saved_at).getTime() > 12 * 3600e3);
    const bought = all.filter((r) => r.status === 'converted');
    return {
      open, live, returning, bought,
      openValue: open.reduce((n, r) => n + Number(r.total_usd || 0), 0),
      withEmail: open.filter((r) => r.email).length,
    };
  }, [rows]);

  if (!rows) return null;
  const list = show === 'open' ? view.open : view.bought;

  return (
    <div className="bg-white border border-black/10 rounded-xl p-4">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="text-sm font-bold text-ink-800">🛒 Saved carts</div>
        <span className="text-[11px] text-ink-700/60">last 30 days, refreshes every 20 s</span>
        <div className="ml-auto flex gap-1.5">
          {(['open', 'bought'] as const).map((k) => (
            <button key={k} onClick={() => setShow(k)}
              className={`text-xs px-2.5 py-1 rounded-full border ${show === k ? 'bg-[#633806] text-[#FAEEDA] border-[#633806]' : 'bg-white border-black/15'}`}>
              {k === 'open' ? `Waiting (${view.open.length})` : `Bought (${view.bought.length})`}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
        <Stat n={view.live.length} label="with a cart, on the site now" hot={view.live.length > 0} />
        <Stat n={view.returning.length} label="came back to a saved cart" />
        <Stat n={`$${view.openValue.toFixed(0)}`} label="sitting in open carts" />
        <Stat n={view.withEmail} label="open carts with an email" />
      </div>

      {list.length === 0 && (
        <p className="text-xs text-ink-700/60 py-4 text-center">
          {show === 'open' ? 'No open carts yet. They appear as shoppers add designs (recording started 17 Sep 2026).' : 'No bought carts recorded yet.'}
        </p>
      )}

      <div className="divide-y divide-black/5">
        {list.slice(0, 40).map((r) => {
          const live = r.status === 'open' && Date.now() - new Date(r.last_seen_at).getTime() < LIVE_MS;
          const returning = new Date(r.last_seen_at).getTime() - new Date(r.first_saved_at).getTime() > 12 * 3600e3;
          return (
            <div key={r.browser_id} className="py-2.5 flex flex-wrap items-center gap-3">
              <div className="flex -space-x-2 shrink-0">
                {(r.items || []).slice(0, 4).map((it) => it.image_url
                  ? <img key={it.id} src={it.image_url} alt="" title={it.title} className="w-10 h-10 rounded-md object-cover border-2 border-white" />
                  : <div key={it.id} title={it.title} className="w-10 h-10 rounded-md bg-[#FAEEDA] border-2 border-white flex items-center justify-center text-[10px]">◆</div>)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  {live && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-600 text-white">ON SITE NOW</span>}
                  {returning && r.status === 'open' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-900">came back</span>}
                  {r.status === 'converted' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-800">bought</span>}
                  <span className="text-sm font-medium text-ink-800">{r.item_count} design{r.item_count === 1 ? '' : 's'} · ${Number(r.total_usd).toFixed(2)}</span>
                  {r.email && <a href={`mailto:${r.email}`} className="text-xs text-[#854F0B] underline break-all">{r.email}</a>}
                </div>
                <div className="text-[11px] text-ink-700/60 truncate">
                  {(r.items || []).map((i) => i.title).join(' · ')}
                </div>
                <div className="text-[11px] text-ink-700/50">
                  cart started {ago(r.first_saved_at)} · last seen {ago(r.last_seen_at)}{r.last_path ? ` on ${r.last_path}` : ''} · {r.visits} page view{r.visits === 1 ? '' : 's'}{r.device ? ` · ${r.device}` : ''}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ n, label, hot }: { n: number | string; label: string; hot?: boolean }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${hot ? 'border-red-300 bg-red-50' : 'border-black/10 bg-[#FBF5EA]'}`}>
      <div className={`text-lg font-semibold tabular-nums ${hot ? 'text-red-700' : 'text-ink-800'}`}>{n}</div>
      <div className="text-[11px] text-ink-700/70 leading-tight">{label}</div>
    </div>
  );
}
