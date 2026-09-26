import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { Card, btnGhost, btnPrimary } from '../ui';
import { img } from '../../../lib/img';

// Admin > Copycat Watch: Etsy listings that reuse our pictures or copy a
// title word for word, found by lib/copycat.ts (nightly, 15 of the top 75
// designs a night). Our picture and theirs side by side, a link to the
// listing and to Etsy's IP report form, and a status to keep track.

const ETSY_IP_FORM = 'https://www.etsy.com/legal/ip/report';
const STATUS: Record<string, { label: string; cls: string }> = {
  new: { label: 'New', cls: 'bg-red-100 text-red-700' },
  reported: { label: 'Reported to Etsy', cls: 'bg-amber-100 text-amber-800' },
  removed: { label: 'Taken down', cls: 'bg-green-100 text-green-700' },
  ignored: { label: 'Not a copy', cls: 'bg-black/5 text-ink-700/70' },
};

async function call(method: 'GET' | 'POST', body?: unknown) {
  const { data: { session } } = await supabase.auth.getSession();
  const r = await fetch('/api/admin/copycat', { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${session?.access_token || ''}` }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

export default function CopycatWatch() {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [show, setShow] = useState<'open' | 'all'>('open');
  async function load() { try { setErr(''); setD(await call('GET')); } catch (e: any) { setErr(e.message); } }
  useEffect(() => { load(); }, []);

  async function runNow() {
    setBusy('Checking 2 designs on Etsy…');
    try { const j = await call('POST', { run: true }); setBusy(`Checked ${j.run.checked} design(s), ${j.run.listingsSeen} Etsy listings looked at, ${j.run.newMatches} new match(es)${j.run.errors?.length ? `. Problems: ${j.run.errors.join('; ')}` : ''}`); await load(); }
    catch (e: any) { setBusy(`Could not run: ${e.message}`); }
  }
  async function mark(id: number, status: string) { try { await call('POST', { id, status }); await load(); } catch (e: any) { setErr(e.message); } }

  if (err) return <Card><p className="text-sm text-red-700">{err}</p></Card>;
  if (!d) return <Card><p className="text-sm text-ink-700/70">Loading Copycat Watch…</p></Card>;
  const all = d.matches as any[];
  const list = show === 'open' ? all.filter((m) => m.status === 'new' || m.status === 'reported') : all;
  const c = d.coverage;
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="text-sm text-ink-700/80 max-w-3xl">
            Each night 6 of your 75 best sellers are searched on Etsy the way a buyer would, and every other shop's pictures are compared with yours.
            A <b>picture match</b> means they uploaded your render or mockup (resized or recompressed still counts). A <b>title match</b> means they copied your title almost word for word, the weaker sign.
            Your own shops are never listed. New picture matches also send you a Telegram message.
          </p>
          <button className={btnPrimary} onClick={runNow} disabled={!!busy && busy.startsWith('Checking')}>Check 2 designs now</button>
        </div>
        {busy && <p className="text-xs text-ink-700/70 mt-2">{busy}</p>}
        <p className="text-xs text-ink-700/60 mt-2">
          {c.designsChecked ? `${c.designsChecked} designs checked so far, ${c.listingsSeen} Etsy listings compared. Last check ${new Date(c.lastCheck).toLocaleString()}.` : 'No checks yet: the first run happens tonight, or press "Check 2 designs now".'}
        </p>
      </Card>

      <div className="flex items-center gap-2">
        <button className={show === 'open' ? btnPrimary : btnGhost} onClick={() => setShow('open')}>Needs action ({all.filter((m) => m.status === 'new' || m.status === 'reported').length})</button>
        <button className={show === 'all' ? btnPrimary : btnGhost} onClick={() => setShow('all')}>All ({all.length})</button>
      </div>

      {list.length === 0 ? (
        <Card><p className="text-sm text-ink-700/70">{all.length ? 'Nothing waiting for action.' : 'No copies found yet.'}</p></Card>
      ) : list.map((m) => (
        <Card key={m.id}>
          <div className="flex flex-wrap gap-4 items-start">
            <div className="flex gap-2 shrink-0">
              <figure className="text-center">
                {m.ours?.image ? <img src={img(m.ours.image, { w: 240, square: true, q: 70 })} width={120} height={120} className="w-28 h-28 rounded object-cover border border-black/10" alt="" /> : <span className="block w-28 h-28 bg-cream rounded" />}
                <figcaption className="text-[11px] text-ink-700/60 mt-1">Yours</figcaption>
              </figure>
              <figure className="text-center">
                {m.image_url ? <img src={m.image_url} width={120} height={120} className="w-28 h-28 rounded object-cover border-2 border-red-300" alt="" referrerPolicy="no-referrer" /> : <span className="block w-28 h-28 bg-cream rounded" />}
                <figcaption className="text-[11px] text-ink-700/60 mt-1">Theirs</figcaption>
              </figure>
            </div>
            <div className="flex-1 min-w-[240px] text-sm space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS[m.status]?.cls}`}>{STATUS[m.status]?.label}</span>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#EAF0F8] text-[#213B63]">
                  {m.kind === 'image' ? `Picture match (${Math.round(100 - (m.image_distance / 64) * 100)}% alike)` : `Title copied (${Math.round(m.title_overlap * 100)}% same words)`}
                </span>
              </div>
              <div><b>{m.shop_name || `Shop ${m.shop_id}`}</b> · <a href={m.url} target="_blank" rel="noopener" className="underline">{m.title}</a>{m.price ? ` · ${m.price}` : ''}</div>
              <div className="text-xs text-ink-700/70">Your design: {m.ours ? <a href={`/product/${m.ours.slug}`} target="_blank" rel="noopener" className="underline">{m.ours.title}</a> : 'removed'} · first seen {String(m.first_seen).slice(0, 10)}, last seen {String(m.last_seen).slice(0, 10)}</div>
              <div className="flex flex-wrap gap-2 pt-1">
                <a href={ETSY_IP_FORM} target="_blank" rel="noopener" className={btnGhost}>Report to Etsy</a>
                {m.status !== 'reported' && <button className={btnGhost} onClick={() => mark(m.id, 'reported')}>I reported it</button>}
                {m.status !== 'removed' && <button className={btnGhost} onClick={() => mark(m.id, 'removed')}>Taken down</button>}
                {m.status !== 'ignored' && <button className={btnGhost} onClick={() => mark(m.id, 'ignored')}>Not a copy</button>}
                {m.status !== 'new' && <button className={btnGhost} onClick={() => mark(m.id, 'new')}>Reopen</button>}
              </div>
            </div>
          </div>
        </Card>
      ))}
      <p className="text-xs text-ink-700/60">To report: open Etsy's form, choose "copyright", paste the copier's listing link, and give your own listing or website page as the original. Mark it "I reported it" here to keep track.</p>
    </div>
  );
}
