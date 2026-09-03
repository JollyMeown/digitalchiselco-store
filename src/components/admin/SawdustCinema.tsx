// Admin: the films that appear in "Sawdust Cinema" low on the homepage.
//
// Each film points at the product it is about, so a visitor who enjoys the clip
// is one tap from the design. Upload goes straight from this browser to storage
// (the same route the image uploader uses), which avoids the function payload
// limit a 10 MB film would blow through.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Card, btnPrimary, btnGhost, inputCls } from './ui';

type Film = {
  id: string; product_id: string | null; video_url: string; poster_url: string | null;
  title: string | null; caption: string | null; sort_order: number; active: boolean;
  products?: { slug: string; title: string } | null;
};
type Hit = { id: string; title: string; slug: string };

const BUCKET = 'site-media';

export default function SawdustCinemaAdmin() {
  const [films, setFilms] = useState<Film[]>([]);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  // new film form
  const [videoUrl, setVideoUrl] = useState('');
  const [posterUrl, setPosterUrl] = useState('');
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [search, setSearch] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [picked, setPicked] = useState<Hit | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from('showcase_videos')
      .select('*, products(slug, title)').order('sort_order').order('created_at', { ascending: false });
    setFilms((data || []) as any);
  }, []);
  useEffect(() => { load(); }, [load]);

  // Product search: the film has to link somewhere, and typing a slug by hand
  // is how the wrong product ends up attached.
  useEffect(() => {
    if (search.trim().length < 3) { setHits([]); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('products').select('id, title, slug')
        .eq('active', true).ilike('title', `%${search.trim()}%`)
        .order('etsy_sales_365', { ascending: false }).limit(8);
      if (!cancelled) setHits((data || []) as any);
    })();
    return () => { cancelled = true; };
  }, [search]);

  async function uploadFile(file: File, kind: 'video' | 'poster') {
    const max = kind === 'video' ? 60 : 8;
    if (file.size > max * 1024 * 1024) {
      setNote(`That file is ${(file.size / 1048576).toFixed(1)} MB. Keep ${kind === 'video' ? 'films under 60 MB (HandBrake, H.264 720p)' : 'posters under 8 MB'}.`);
      return;
    }
    setBusy(kind); setNote('');
    const path = `videos/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type });
    setBusy('');
    if (error) { setNote(`Upload failed: ${error.message}`); return; }
    const url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    if (kind === 'video') setVideoUrl(url); else setPosterUrl(url);
    setNote(`${kind === 'video' ? 'Film' : 'Poster'} uploaded.`);
  }

  async function add() {
    if (!videoUrl.trim()) { setNote('Add a film first: upload one or paste a URL.'); return; }
    setBusy('add'); setNote('');
    const { error } = await supabase.from('showcase_videos').insert({
      video_url: videoUrl.trim(),
      poster_url: posterUrl.trim() || null,
      product_id: picked?.id || null,
      title: title.trim() || null,
      caption: caption.trim() || null,
      sort_order: films.length,
      active: true,
    });
    setBusy('');
    if (error) { setNote(error.message); return; }
    setVideoUrl(''); setPosterUrl(''); setTitle(''); setCaption(''); setPicked(null); setSearch('');
    setNote('Added. It is live on the homepage.');
    load();
  }

  async function patch(id: string, fields: Partial<Film>) {
    await supabase.from('showcase_videos').update(fields).eq('id', id);
    load();
  }
  // ── mail a film to subscribers ──────────────────────────────────────
  const [subCount, setSubCount] = useState<number | null>(null);
  const [mailSubject, setMailSubject] = useState('');
  useEffect(() => {
    supabase.from('subscribers').select('id', { count: 'exact', head: true })
      .is('unsubscribed_at', null).is('suppressed_at', null)
      .then(({ count }) => setSubCount(count ?? 0));
  }, []);

  async function mail(kind: 'preview' | 'test' | 'all', filmId: string) {
    setBusy('mail-' + kind); setNote('');
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch('/api/admin/send-film', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ filmId, subject: mailSubject.trim() || undefined, ...(kind === 'preview' ? { preview: true } : kind === 'test' ? { test: true } : { audience: 'all' }) }),
    });
    const j = await res.json().catch(() => ({ error: 'bad response' }));
    setBusy('');
    if (j?.error) { setNote(j.error); return; }
    if (kind === 'preview') {
      const url = URL.createObjectURL(new Blob([`<title>${j.subject}</title>` + j.html], { type: 'text/html' }));
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setNote(`Preview opened. Subject: ${j.subject}`);
      return;
    }
    setNote(kind === 'test' ? 'Test sent to jolly@digitalchiselco.com.' : `Sent to ${j.sent} of ${j.total} subscribers.`);
  }

  async function remove(id: string) {
    if (!confirm('Remove this film from the homepage? The file stays in storage.')) return;
    await supabase.from('showcase_videos').delete().eq('id', id);
    load();
  }

  return (
    <Card title="🎬 Sawdust Cinema · films on the homepage">
      <p className="text-xs text-ink-700/60 mb-3">
        Short films shown low on the homepage. Each one links to the design it is about, so a viewer who likes the clip can buy it in
        one tap. Nothing downloads for a visitor until they press play.
      </p>

      <div className="rounded-lg border border-bronze-600/20 bg-cream/40 p-3 mb-4">
        <div className="text-[13px] font-bold text-ink-900 mb-2">Add a film</div>
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] uppercase tracking-wide text-ink-700/55 font-medium mb-1">Film (MP4)</label>
            <input type="file" accept="video/mp4,video/webm" className="text-xs"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f, 'video'); }} />
            <input value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="…or paste a video URL" className={inputCls + ' mt-2 text-xs'} />
            {busy === 'video' && <div className="text-[11px] text-bronze-700 mt-1">Uploading…</div>}
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wide text-ink-700/55 font-medium mb-1">Poster still (optional)</label>
            <input type="file" accept="image/*" className="text-xs"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f, 'poster'); }} />
            <input value={posterUrl} onChange={(e) => setPosterUrl(e.target.value)} placeholder="…or paste an image URL (defaults to the product photo)" className={inputCls + ' mt-2 text-xs'} />
            {busy === 'poster' && <div className="text-[11px] text-bronze-700 mt-1">Uploading…</div>}
          </div>
          <div className="md:col-span-2">
            <label className="block text-[11px] uppercase tracking-wide text-ink-700/55 font-medium mb-1">Links to which design?</label>
            {picked ? (
              <div className="flex items-center gap-2 text-xs">
                <span className="px-2.5 py-1 rounded-full bg-bronze-600 text-cream font-medium">{picked.title.split('|')[0].trim()}</span>
                <button className="text-ink-700/60 hover:text-red-600" onClick={() => setPicked(null)}>change</button>
              </div>
            ) : (
              <>
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search a design or bundle, e.g. highland cow mega bundle" className={inputCls + ' text-xs'} />
                {hits.length > 0 && (
                  <div className="mt-1 border border-black/10 rounded-md bg-white max-h-40 overflow-auto">
                    {hits.map((h) => (
                      <button key={h.id} className="block w-full text-left px-3 py-1.5 text-xs hover:bg-cream/60" onClick={() => { setPicked(h); setHits([]); }}>
                        {h.title.split('|')[0].trim()}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Card title (blank uses the design name)" className={inputCls + ' text-xs'} />
          <input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="One line under the title (optional)" className={inputCls + ' text-xs'} />
        </div>
        <div className="flex items-center gap-2 mt-3">
          <button className={btnPrimary} disabled={!!busy} onClick={add}>{busy === 'add' ? 'Adding…' : '+ Add to the homepage'}</button>
          {videoUrl && <span className="text-[11px] text-green-700">film ready</span>}
        </div>
        {note && <div className="text-[11px] text-ink-800 mt-2">{note}</div>}
      </div>

      {films.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3 p-2.5 rounded-lg bg-cream/60 border border-bronze-600/15">
          <span className="text-[11px] font-medium text-ink-800">Email subject (optional)</span>
          <input value={mailSubject} onChange={(e) => setMailSubject(e.target.value)}
            placeholder="Leave blank for the generated subject line" className={inputCls + ' text-xs flex-1 min-w-[220px]'} />
          <span className="text-[11px] text-ink-700/55">
            Video cannot play inside email, so subscribers get a tall clickable poster that opens the film on the design's page.
          </span>
        </div>
      )}

      {films.length === 0 ? (
        <p className="text-sm text-ink-700/60">No films yet. The homepage section stays hidden until you add one.</p>
      ) : (
        <div className="space-y-2">
          {films.map((f, i) => (
            <div key={f.id} className="flex flex-wrap items-center gap-3 border border-black/10 rounded-lg p-2.5 bg-white">
              <video src={f.video_url} poster={f.poster_url || undefined} className="w-20 h-28 object-cover rounded bg-black" muted preload="metadata" />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold text-ink-900 truncate">{f.title || f.products?.title?.split('|')[0].trim() || 'Untitled film'}</div>
                <div className="text-[11px] text-ink-700/60 truncate">
                  {f.products?.slug ? <a href={`/product/${f.products.slug}`} target="_blank" rel="noreferrer" className="text-bronze-700 hover:underline">/product/{f.products.slug}</a> : 'no design linked'}
                </div>
                {f.caption && <div className="text-[11px] text-ink-700/50 truncate">{f.caption}</div>}
              </div>
              <label className="flex items-center gap-1.5 text-[11px] text-ink-700/70">
                <input type="checkbox" checked={f.active} onChange={() => patch(f.id, { active: !f.active })} /> live
              </label>
              <div className="flex items-center gap-1">
                <button className={btnGhost + ' text-xs px-2 py-1'} title="Preview the email" disabled={!!busy} onClick={() => mail('preview', f.id)}>👁</button>
                <button className={btnGhost + ' text-xs px-2 py-1'} title="Send a test to your inbox" disabled={!!busy} onClick={() => mail('test', f.id)}>✉ test</button>
                <button className={btnPrimary + ' text-xs px-2 py-1'} title={`Email ${subCount ?? '…'} subscribers`} disabled={!!busy}
                  onClick={() => { if (confirm(`Email this film to all ${subCount ?? 0} subscribers? Each person receives it once.`)) mail('all', f.id); }}>
                  📣 {subCount ?? '…'}
                </button>
                <button className={btnGhost + ' text-xs px-2 py-1'} disabled={i === 0} onClick={() => patch(f.id, { sort_order: f.sort_order - 1 })}>↑</button>
                <button className={btnGhost + ' text-xs px-2 py-1'} disabled={i === films.length - 1} onClick={() => patch(f.id, { sort_order: f.sort_order + 1 })}>↓</button>
                <button className={btnGhost + ' text-xs px-2 py-1'} onClick={() => remove(f.id)}>✕</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
