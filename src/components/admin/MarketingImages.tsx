// Admin: review AI marketing images before they reach Pinterest.
//
// Nothing generated goes live unapproved. Each card shows the image, the scene
// description that produced it, and three actions: approve it, edit the scene
// and regenerate, or reject it. Coverage tiles track the batch the owner asked
// for first, the top 100 sellers, and the whole catalogue after that.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Card, btnPrimary, btnGhost, inputCls } from './ui';

type Item = {
  id: string; kind: 'product' | 'category';
  key: string;                       // id + variant, so both slots can be listed
  variant?: 'a' | 'b';
  style?: string | null;
  name: string; slug: string;
  url: string; scene: string | null; sales?: number;
};
type Stats = { pending: number; approved: number; total: number; withMockup: number; withMockupB: number; topDone: number; topDoneB: number; topTotal: number };

export default function MarketingImages() {
  const [tab, setTab] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [items, setItems] = useState<Item[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [canRegen, setCanRegen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string>('');
  const [scenes, setScenes] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const call = useCallback(async (body: any) => {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch('/api/admin/marketing-image', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify(body),
    });
    return res.json().catch(() => ({ error: 'bad response' }));
  }, []);

  const load = useCallback(async (status = tab) => {
    setLoading(true);
    const j = await call({ action: 'list', status });
    if (j?.ok) {
      const cats: Item[] = (j.categories || []).map((c: any) => ({
        id: c.id, key: c.id, kind: 'category', name: c.name, slug: c.slug, url: c.mockup_url, scene: c.mockup_scene,
      }));
      // A product can have BOTH staging variants waiting, so each is its own card.
      const prods: Item[] = [];
      for (const p of j.products || []) {
        const base = {
          id: p.id, kind: 'product' as const, name: String(p.title || '').split('|')[0].trim(),
          slug: p.slug, scene: p.mockup_scene, sales: p.etsy_sales_365,
        };
        if (p.mockup_url && p.mockup_status === status) {
          prods.push({ ...base, key: `${p.id}:a`, variant: 'a', style: p.mockup_style, url: p.mockup_url });
        }
        if (p.mockup_b_url && p.mockup_b_status === status) {
          prods.push({ ...base, key: `${p.id}:b`, variant: 'b', style: p.mockup_b_style, url: p.mockup_b_url });
        }
      }
      setItems([...cats, ...prods]);
      setPicked(new Set());
      setStats(j.stats);
      setCanRegen(!!j.canRegenerate);
    }
    setLoading(false);
  }, [call, tab]);

  useEffect(() => { load(tab); }, [tab, load]);
  // A batch keeps producing images while this screen is open, so the counts
  // refresh on their own rather than looking stuck.
  useEffect(() => {
    const t = setInterval(() => { if (!busy) load(tab); }, 30000);
    return () => clearInterval(t);
  }, [tab, load, busy]);

  async function act(it: Item, action: 'approve' | 'reject' | 'regenerate') {
    setBusy(it.key + action); setNote('');
    const j = await call({
      action, id: it.id, kind: it.kind, variant: it.variant,
      ...(action === 'regenerate' ? { scene: scenes[it.key] ?? it.scene ?? '' } : {}),
    });
    setBusy('');
    if (j?.error) { setNote(`${it.name}: ${j.error}`); return; }
    if (action === 'regenerate') {
      setNote(`${it.name}: regenerated, review the new image below.`);
      setItems((list) => list.map((x) => (x.key === it.key ? { ...x, url: j.url } : x)));
    } else {
      setItems((list) => list.filter((x) => x.key !== it.key));
      load(tab);
    }
  }

  const toggle = (id: string) => setPicked((p) => {
    const n = new Set(p);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const allPicked = items.length > 0 && picked.size === items.length;

  // Bulk review: approving hundreds of images one card at a time is not a workflow.
  async function bulk(kind: 'selected' | 'all') {
    const n = kind === 'selected' ? picked.size : (stats?.pending ?? 0);
    if (kind === 'selected' && !n) { setNote('Nothing selected.'); return; }
    if (!confirm(kind === 'selected'
      ? `Approve ${n} selected image(s)? They go live on Pinterest and the site.`
      : `Approve ALL ${n} pending image(s) without reviewing the rest? They go live on Pinterest and the site.`)) return;
    setBusy('bulk'); setNote('');
    const body = kind === 'selected'
      ? { action: 'approve_many', items: items.filter((i) => picked.has(i.key)).map((i) => ({ id: i.id, kind: i.kind, variant: i.variant })) }
      : { action: 'approve_all_pending' };
    const j = await call(body);
    setBusy('');
    if (j?.error) { setNote(j.error); return; }
    setNote(`✓ Approved ${j.done}. They are live.`);
    load(tab);
  }

  const pct = stats && stats.total ? Math.round((stats.withMockup / stats.total) * 100) : 0;

  return (
    <Card title="🖼️ Marketing images · review before they go live">
      <p className="text-xs text-ink-700/60 mb-3">
        Room mockups and collection scenes made from your own designs. Nothing here reaches Pinterest until you approve it.
        Edit the scene and regenerate if you want a different room, or reject to keep the plain product photo.
      </p>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
          <div className="rounded-lg border border-black/10 bg-cream/40 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-ink-700/50 font-medium">Top 100 sellers</div>
            <div className="text-xl font-extrabold text-bronze-800">{stats.topDone}<span className="text-sm text-ink-700/45">/{stats.topTotal}</span></div>
            <div className="mt-1 h-1.5 rounded-full bg-black/10 overflow-hidden">
              <div className="h-full bg-bronze-600" style={{ width: `${stats.topTotal ? (stats.topDone / stats.topTotal) * 100 : 0}%` }} />
            </div>
            <div className="text-[10px] text-ink-700/50 mt-1">variant A · B: {stats.topDoneB}/{stats.topTotal}</div>
          </div>
          <div className="rounded-lg border border-black/10 bg-cream/40 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-ink-700/50 font-medium">Whole catalogue</div>
            <div className="text-xl font-extrabold text-bronze-800">{stats.withMockup}<span className="text-sm text-ink-700/45">/{stats.total}</span></div>
            <div className="text-[10px] text-ink-700/50">{pct}% have a mockup · {stats.withMockup + stats.withMockupB} images total</div>
          </div>
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-amber-700/70 font-medium">Waiting for you</div>
            <div className="text-xl font-extrabold text-amber-700">{stats.pending}</div>
          </div>
          <div className="rounded-lg border border-black/10 bg-cream/40 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-ink-700/50 font-medium">Approved &amp; live</div>
            <div className="text-xl font-extrabold text-green-700">{stats.approved}</div>
          </div>
        </div>
      )}

      {!canRegen && (
        <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2 mb-3">
          Regenerating from here needs <b>GEMINI_API_KEY</b> in the Netlify environment. Approving and rejecting work regardless.
        </div>
      )}

      <div className="flex gap-2 mb-3">
        {(['pending', 'approved', 'rejected'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`text-xs px-3 py-1.5 rounded-full font-medium ${tab === t ? 'bg-bronze-600 text-cream' : 'bg-cream text-ink-700 hover:bg-bronze-600/10'}`}>{t}</button>
        ))}
        <button className="text-xs px-3 py-1.5 rounded-full font-medium bg-cream text-ink-700 hover:bg-bronze-600/10" onClick={() => load(tab)}>↻ refresh</button>
      </div>

      {tab === 'pending' && items.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3 p-2.5 rounded-lg bg-cream/60 border border-bronze-600/15">
          <label className="flex items-center gap-2 text-xs font-medium text-ink-800 cursor-pointer">
            <input type="checkbox" checked={allPicked}
              onChange={() => setPicked(allPicked ? new Set() : new Set(items.map((i) => i.key)))} />
            Select all ({items.length})
          </label>
          <span className="text-[11px] text-ink-700/50">{picked.size} selected</span>
          <span className="flex-1" />
          <button className={btnPrimary + ' text-xs px-3 py-1.5'} disabled={!!busy || !picked.size} onClick={() => bulk('selected')}>
            {busy === 'bulk' ? 'Working…' : `✓ Approve selected (${picked.size})`}
          </button>
          <button className={btnGhost + ' text-xs px-3 py-1.5'} disabled={!!busy || !stats?.pending} onClick={() => bulk('all')}>
            ✓✓ Approve all pending ({stats?.pending ?? 0})
          </button>
        </div>
      )}

      {note && <div className="text-xs mb-3 px-3 py-2 rounded-lg bg-cream border border-bronze-600/20 text-ink-800">{note}</div>}

      {loading ? <div className="text-sm text-ink-700/60">Loading…</div>
        : items.length === 0 ? (
          <p className="text-sm text-ink-700/60">
            Nothing {tab}. {tab === 'pending' && 'Generate a batch locally with scripts/gen_product_mockups.mjs, then come back here to approve.'}
          </p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map((it) => (
              <div key={it.key} className={`rounded-xl border bg-white overflow-hidden flex flex-col ${picked.has(it.key) ? 'border-bronze-600 ring-2 ring-bronze-600/30' : 'border-black/10'}`}>
                <div className="relative">
                  <a href={it.url} target="_blank" rel="noreferrer" className="block bg-cream/50">
                    <img src={it.url} alt={it.name} loading="lazy" className="w-full h-56 object-contain" />
                  </a>
                  {tab === 'pending' && (
                    <label className="absolute top-2 left-2 flex items-center gap-1.5 bg-white/95 rounded-md px-2 py-1 shadow cursor-pointer text-[11px] font-medium">
                      <input type="checkbox" checked={picked.has(it.key)} onChange={() => toggle(it.key)} />
                      select
                    </label>
                  )}
                </div>
                <div className="p-3 flex flex-col gap-2 flex-1">
                  <div>
                    <div className="text-[10px] uppercase tracking-wide font-semibold text-bronze-700">
                      {it.kind === 'category' ? 'Collection' : (it.variant === 'b' ? 'Variant B' : 'Variant A')}
                      {it.style ? ` · ${it.style.replace('_', ' ')}` : ''}
                      {typeof it.sales === 'number' && it.sales > 0 ? ` · ${it.sales} sales` : ''}
                    </div>
                    <div className="text-[13px] font-semibold text-ink-900 leading-snug line-clamp-2">{it.name}</div>
                  </div>
                  <textarea
                    className={inputCls + ' text-[11px] leading-snug'}
                    rows={3}
                    placeholder="Scene: describe the room you want. Leave as-is to reuse it."
                    value={scenes[it.key] ?? it.scene ?? ''}
                    onChange={(e) => setScenes((s) => ({ ...s, [it.key]: e.target.value }))}
                  />
                  <div className="flex flex-wrap gap-1.5 mt-auto">
                    {tab !== 'approved' && (
                      <button className={btnPrimary + ' text-xs px-3 py-1.5'} disabled={!!busy} onClick={() => act(it, 'approve')}>
                        {busy === it.key + 'approve' ? '…' : '✓ Approve'}
                      </button>
                    )}
                    <button className={btnGhost + ' text-xs px-3 py-1.5'} disabled={!!busy || !canRegen} onClick={() => act(it, 'regenerate')}>
                      {busy === it.key + 'regenerate' ? 'Generating…' : '↻ Regenerate'}
                    </button>
                    {tab !== 'rejected' && (
                      <button className={btnGhost + ' text-xs px-3 py-1.5'} disabled={!!busy} onClick={() => act(it, 'reject')}>
                        {busy === it.key + 'reject' ? '…' : '✕ Reject'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

      <p className="mt-4 text-[11px] text-ink-700/50">
        Approved collection scenes become the art on the themed Pinterest board; approved product mockups become the image on that
        product's Pin. Trays, boards and coasters are always staged lying flat, never on a wall.
      </p>
    </Card>
  );
}
