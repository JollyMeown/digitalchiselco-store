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
  name: string; slug: string;
  url: string; scene: string | null; sales?: number;
};
type Stats = { pending: number; approved: number; total: number; withMockup: number; topDone: number; topTotal: number };

export default function MarketingImages() {
  const [tab, setTab] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [items, setItems] = useState<Item[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [canRegen, setCanRegen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string>('');
  const [scenes, setScenes] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');

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
        id: c.id, kind: 'category', name: c.name, slug: c.slug, url: c.mockup_url, scene: c.mockup_scene,
      }));
      const prods: Item[] = (j.products || []).map((p: any) => ({
        id: p.id, kind: 'product', name: String(p.title || '').split('|')[0].trim(), slug: p.slug,
        url: p.mockup_url, scene: p.mockup_scene, sales: p.etsy_sales_365,
      }));
      setItems([...cats, ...prods]);
      setStats(j.stats);
      setCanRegen(!!j.canRegenerate);
    }
    setLoading(false);
  }, [call, tab]);

  useEffect(() => { load(tab); }, [tab, load]);

  async function act(it: Item, action: 'approve' | 'reject' | 'regenerate') {
    setBusy(it.id + action); setNote('');
    const j = await call({
      action, id: it.id, kind: it.kind,
      ...(action === 'regenerate' ? { scene: scenes[it.id] ?? it.scene ?? '' } : {}),
    });
    setBusy('');
    if (j?.error) { setNote(`${it.name}: ${j.error}`); return; }
    if (action === 'regenerate') {
      setNote(`${it.name}: regenerated, review the new image below.`);
      setItems((list) => list.map((x) => (x.id === it.id ? { ...x, url: j.url } : x)));
    } else {
      setItems((list) => list.filter((x) => x.id !== it.id));
      load(tab);
    }
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
          </div>
          <div className="rounded-lg border border-black/10 bg-cream/40 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-ink-700/50 font-medium">Whole catalogue</div>
            <div className="text-xl font-extrabold text-bronze-800">{stats.withMockup}<span className="text-sm text-ink-700/45">/{stats.total}</span></div>
            <div className="text-[10px] text-ink-700/50">{pct}% have a mockup</div>
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

      {note && <div className="text-xs mb-3 px-3 py-2 rounded-lg bg-cream border border-bronze-600/20 text-ink-800">{note}</div>}

      {loading ? <div className="text-sm text-ink-700/60">Loading…</div>
        : items.length === 0 ? (
          <p className="text-sm text-ink-700/60">
            Nothing {tab}. {tab === 'pending' && 'Generate a batch locally with scripts/gen_product_mockups.mjs, then come back here to approve.'}
          </p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map((it) => (
              <div key={it.id} className="rounded-xl border border-black/10 bg-white overflow-hidden flex flex-col">
                <a href={it.url} target="_blank" rel="noreferrer" className="block bg-cream/50">
                  <img src={it.url} alt={it.name} loading="lazy" className="w-full h-56 object-contain" />
                </a>
                <div className="p-3 flex flex-col gap-2 flex-1">
                  <div>
                    <div className="text-[10px] uppercase tracking-wide font-semibold text-bronze-700">
                      {it.kind === 'category' ? 'Collection' : 'Product'}{typeof it.sales === 'number' && it.sales > 0 ? ` · ${it.sales} sales` : ''}
                    </div>
                    <div className="text-[13px] font-semibold text-ink-900 leading-snug line-clamp-2">{it.name}</div>
                  </div>
                  <textarea
                    className={inputCls + ' text-[11px] leading-snug'}
                    rows={3}
                    placeholder="Scene: describe the room you want. Leave as-is to reuse it."
                    value={scenes[it.id] ?? it.scene ?? ''}
                    onChange={(e) => setScenes((s) => ({ ...s, [it.id]: e.target.value }))}
                  />
                  <div className="flex flex-wrap gap-1.5 mt-auto">
                    {tab !== 'approved' && (
                      <button className={btnPrimary + ' text-xs px-3 py-1.5'} disabled={!!busy} onClick={() => act(it, 'approve')}>
                        {busy === it.id + 'approve' ? '…' : '✓ Approve'}
                      </button>
                    )}
                    <button className={btnGhost + ' text-xs px-3 py-1.5'} disabled={!!busy || !canRegen} onClick={() => act(it, 'regenerate')}>
                      {busy === it.id + 'regenerate' ? 'Generating…' : '↻ Regenerate'}
                    </button>
                    {tab !== 'rejected' && (
                      <button className={btnGhost + ' text-xs px-3 py-1.5'} disabled={!!busy} onClick={() => act(it, 'reject')}>
                        {busy === it.id + 'reject' ? '…' : '✕ Reject'}
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
