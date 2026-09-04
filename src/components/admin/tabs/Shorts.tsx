// YouTube Shorts performance.
//
// The site never calls the YouTube API. The OAuth refresh token lives in BRS on
// the owner's machine, and a channel-management token is a far bigger key than
// anything else this site holds, so it stays out of Netlify. BRS pulls the
// numbers and writes youtube_stats / youtube_stats_daily; this panel only reads.
// Same shape as Finance and Cults.
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { Card } from '../ui';

type Row = {
  video_id: string; title: string | null; thumb_url: string | null;
  duration_s: number | null; published_at: string | null; privacy: string | null;
  views: number; likes: number; comments: number;
  product_id: string | null; synced_at: string | null;
};
type Day = { video_id: string; day: string; views: number };

const fmt = (n: number) => n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n);
const ago = (iso: string | null) => {
  if (!iso) return '';
  const h = (Date.now() - new Date(iso).getTime()) / 36e5;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min ago`;
  if (h < 48) return `${Math.round(h)} h ago`;
  return `${Math.round(h / 24)} days ago`;
};

export default function Shorts() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [days, setDays] = useState<Day[]>([]);
  const [err, setErr] = useState('');

  async function load() {
    const { data, error } = await supabase.from('youtube_stats')
      .select('*').order('published_at', { ascending: false });
    if (error) { setErr(error.message); setRows([]); return; }
    setRows((data || []) as Row[]);
    const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const { data: d } = await supabase.from('youtube_stats_daily')
      .select('video_id, day, views').gte('day', since).order('day');
    setDays((d || []) as Day[]);
  }
  useEffect(() => { load(); }, []);

  const totals = useMemo(() => {
    const live = (rows || []).filter((r) => r.privacy === 'public');
    return {
      live: live.length,
      drafts: (rows || []).length - live.length,
      views: live.reduce((a, r) => a + (r.views || 0), 0),
      likes: live.reduce((a, r) => a + (r.likes || 0), 0),
      comments: live.reduce((a, r) => a + (r.comments || 0), 0),
    };
  }, [rows]);

  // views gained per video since the first snapshot we hold
  const gained = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rows || []) {
      const mine = days.filter((d) => d.video_id === r.video_id);
      if (mine.length > 1) m[r.video_id] = r.views - mine[0].views;
    }
    return m;
  }, [rows, days]);

  if (rows === null) return <Card><div className="p-4 text-sm text-ink-500">Loading Shorts…</div></Card>;

  return (
    <div className="space-y-4">
      <Card>
        <div className="p-4">
          <div className="flex items-baseline justify-between flex-wrap gap-2">
            <h3 className="font-serif text-lg">YouTube Shorts</h3>
            <span className="text-[11px] text-ink-500">
              {rows[0]?.synced_at ? `synced ${ago(rows[0].synced_at)} from BRS` : 'never synced'}
            </span>
          </div>
          {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
          {!rows.length && (
            <p className="mt-2 text-sm text-ink-500">
              No Shorts yet. In BRS: 🎬 Video Studio → ▶️ YouTube pack → ⬆ Upload, then press
              📊 Sync stats. This panel only reads what BRS writes.
            </p>
          )}
          {!!rows.length && (
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-3">
              {[['Live', totals.live], ['Drafts', totals.drafts], ['Views', fmt(totals.views)],
                ['Likes', fmt(totals.likes)], ['Comments', fmt(totals.comments)]].map(([k, v]) => (
                <div key={String(k)} className="rounded-lg bg-cream/60 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-ink-500">{k}</div>
                  <div className="text-xl font-semibold text-ink-800">{v}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {rows.map((r) => (
        <Card key={r.video_id}>
          <div className="p-3 flex gap-3">
            {r.thumb_url && (
              <a href={`https://youtube.com/shorts/${r.video_id}`} target="_blank" rel="noopener"
                 className="shrink-0">
                <img src={r.thumb_url} alt="" className="w-20 h-28 object-cover rounded-md bg-ink-100" />
              </a>
            )}
            <div className="min-w-0 flex-1">
              <a href={`https://youtube.com/shorts/${r.video_id}`} target="_blank" rel="noopener"
                 className="font-medium text-sm text-ink-800 hover:underline line-clamp-2">
                {r.title || r.video_id}
              </a>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-500">
                <span className={r.privacy === 'public' ? 'text-emerald-700' : 'text-amber-700'}>
                  {r.privacy === 'public' ? '● live' : `● ${r.privacy}`}
                </span>
                {r.duration_s ? <span>{r.duration_s}s</span> : null}
                {r.published_at ? <span>{new Date(r.published_at).toLocaleDateString()}</span> : null}
                <a className="underline" target="_blank" rel="noopener"
                   href={`https://studio.youtube.com/video/${r.video_id}/analytics`}>analytics ↗</a>
              </div>
              <div className="mt-2 flex gap-4 text-sm">
                <span><b>{fmt(r.views)}</b> <span className="text-ink-500">views</span>
                  {gained[r.video_id] > 0 && (
                    <span className="ml-1 text-emerald-700 text-[11px]">+{fmt(gained[r.video_id])}</span>
                  )}
                </span>
                <span><b>{fmt(r.likes)}</b> <span className="text-ink-500">likes</span></span>
                <span><b>{fmt(r.comments)}</b> <span className="text-ink-500">comments</span></span>
              </div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
