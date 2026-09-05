// Every Sawdust Cinema film as an email: edit its subject, opener and runtime,
// see who has had it, preview, test, and send to everyone who has not. The
// drip flag hands the film to the nightly "film emails" automation so every
// subscriber, present and future, receives it in turn. The send ledger is the
// single source of truth, so the button and the drip never double-send.
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Card, btnPrimary, btnGhost, inputCls } from './ui';

type Film = {
  id: string; title: string | null; caption: string | null; poster_url: string | null; video_url: string | null;
  email_intro: string | null; email_subject: string | null; runtime_seconds: number | null; email_in_drip: boolean;
  created_at: string; product_slug: string | null; product_title: string | null;
  sent: number; last: string | null; remaining: number;
};

export default function FilmEmails() {
  const [films, setFilms] = useState<Film[] | null>(null);
  const [subs, setSubs] = useState(0);
  const [open, setOpen] = useState<string>('');
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<Record<string, Partial<Film>>>({});

  async function call(payload: any) {
    const { data: { session } } = await supabase.auth.getSession();
    return fetch('/api/admin/send-film', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify(payload),
    }).then((r) => r.json()).catch(() => ({ error: 'bad response' }));
  }
  async function load() {
    const r = await call({ list: true });
    if (r?.ok) { setFilms(r.films); setSubs(r.subscribers); }
  }
  useEffect(() => { load(); }, []);

  const say = (id: string, msg: string) => setNote((n) => ({ ...n, [id]: msg }));
  const field = (f: Film, k: keyof Film) => (draft[f.id]?.[k] ?? f[k]) as any;

  async function save(f: Film) {
    setBusy('save:' + f.id);
    const r = await call({ save: true, filmId: f.id, email_subject: field(f, 'email_subject'), email_intro: field(f, 'email_intro'),
      runtime_seconds: field(f, 'runtime_seconds'), email_in_drip: !!field(f, 'email_in_drip') });
    setBusy('');
    say(f.id, r?.error || 'Saved.');
    if (!r?.error) { setDraft((x) => { const c = { ...x }; delete c[f.id]; return c; }); load(); }
  }

  async function act(f: Film, kind: 'preview' | 'test' | 'all') {
    setBusy(kind + ':' + f.id); say(f.id, '');
    const r = await call(kind === 'preview' ? { preview: true, filmId: f.id } : kind === 'test' ? { test: true, filmId: f.id } : { audience: 'all', filmId: f.id });
    setBusy('');
    if (r?.error) { say(f.id, r.error); return; }
    if (kind === 'preview') {
      const url = URL.createObjectURL(new Blob([`<title>${r.subject}</title>` + r.html], { type: 'text/html' }));
      window.open(url, '_blank'); setTimeout(() => URL.revokeObjectURL(url), 60000);
      say(f.id, `Preview opened. Subject: ${r.subject}`); return;
    }
    if (kind === 'test') { say(f.id, 'Test sent to jolly@digitalchiselco.com.'); return; }
    say(f.id, r.message || `Sent to ${r.sent} subscriber${r.sent === 1 ? '' : 's'}${r.skipped ? `, ${r.skipped} already had it` : ''}.`
      + (r.errors?.length ? ` Problems: ${r.errors.join('; ')}` : ''));
    load();
  }

  return (
    <Card>
      <div className="p-4">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <h3 className="font-serif text-lg">🎬 Film emails · Sawdust Cinema</h3>
          <span className="text-[11px] text-ink-500">{subs} subscribers on the list</span>
        </div>
        <p className="mt-1 text-[12px] text-ink-700/60 leading-relaxed">
          Every film can go out as an email: the poster with a play badge, your opener, the design it sells, one link.
          Tick <b>drip</b> and the nightly automation sends it to every subscriber in turn, newest joiners included; the button sends it now to everyone who has not had it.
          Nobody ever receives the same film twice, whichever route it took.
        </p>

        {films === null && <p className="mt-3 text-sm text-ink-500">Loading…</p>}
        {films?.length === 0 && <p className="mt-3 text-sm text-ink-500">No active films yet. Publish one from BRS Video Studio.</p>}

        <div className="mt-3 space-y-2">
          {(films || []).map((f) => {
            const isOpen = open === f.id;
            const unlinked = !f.product_slug;
            return (
              <div key={f.id} className="rounded-lg border border-black/10 bg-white">
                <div className="flex flex-wrap items-center gap-3 p-2.5">
                  {f.poster_url && <img src={f.poster_url} alt="" className="w-10 h-14 object-cover rounded" />}
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-ink-900 truncate">{f.title || 'Untitled film'}</div>
                    <div className="text-[11px] text-ink-700/60">
                      {f.product_title ? <span>sells {f.product_title}</span> : <span className="text-red-600">not linked to a design, cannot be sent</span>}
                      {f.runtime_seconds ? <span> · {f.runtime_seconds}s</span> : null}
                    </div>
                    <div className="text-[11px] text-ink-700/60">
                      {f.sent > 0 ? <span className="text-emerald-700 font-medium">✓ sent to {f.sent}{f.last ? ` · last ${new Date(f.last).toLocaleDateString()}` : ''}</span> : <span className="text-ink-700/40">not sent yet</span>}
                      {f.remaining > 0 && <span className="text-bronze-700"> · {f.remaining} still to go</span>}
                      {f.email_in_drip && <span className="ml-2 rounded bg-emerald-50 text-emerald-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">in drip</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button className={btnGhost + ' text-xs px-2 py-1'} onClick={() => setOpen(isOpen ? '' : f.id)}>{isOpen ? 'close' : '✎ edit'}</button>
                    <button className={btnGhost + ' text-xs px-2 py-1'} disabled={!!busy || unlinked} onClick={() => act(f, 'preview')}>👁</button>
                    <button className={btnGhost + ' text-xs px-2 py-1'} disabled={!!busy || unlinked} onClick={() => act(f, 'test')}>✉ test</button>
                    <button className={btnPrimary + ' text-xs px-2 py-1'} disabled={!!busy || unlinked || f.remaining === 0}
                      title={f.remaining === 0 ? 'Everyone has already had it' : `Send to ${f.remaining} who have not had it`}
                      onClick={() => { if (confirm(`Send "${f.title || 'this film'}" to ${f.remaining} subscriber${f.remaining === 1 ? '' : 's'} who have not had it?`)) act(f, 'all'); }}>
                      {busy === 'all:' + f.id ? 'sending…' : `📣 ${f.remaining}`}
                    </button>
                  </div>
                </div>

                {isOpen && (
                  <div className="border-t border-black/5 p-3 space-y-2">
                    <label className="block text-[11px] text-ink-700/60">Subject (blank = generated from the title and runtime)
                      <input className={inputCls + ' mt-1 w-full'} value={field(f, 'email_subject') || ''} placeholder={f.title || ''}
                        onChange={(e) => setDraft((d) => ({ ...d, [f.id]: { ...d[f.id], email_subject: e.target.value } }))} />
                    </label>
                    <label className="block text-[11px] text-ink-700/60">Opener, one or two sentences in your voice (blank = a neutral line)
                      <textarea className={inputCls + ' mt-1 w-full'} rows={3} value={field(f, 'email_intro') || ''} placeholder={f.caption || ''}
                        onChange={(e) => setDraft((d) => ({ ...d, [f.id]: { ...d[f.id], email_intro: e.target.value } }))} />
                    </label>
                    <label className="block text-[11px] text-ink-700/60">Runtime in seconds (the email never claims a runtime it does not have)
                      <input className={inputCls + ' mt-1 w-32'} type="number" min={1} value={field(f, 'runtime_seconds') || ''}
                        onChange={(e) => setDraft((d) => ({ ...d, [f.id]: { ...d[f.id], runtime_seconds: Number(e.target.value) || null } }))} />
                    </label>
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <label className="flex items-center gap-1.5 text-[12px] text-ink-700/80">
                        <input type="checkbox" checked={!!field(f, 'email_in_drip')}
                          onChange={(e) => setDraft((d) => ({ ...d, [f.id]: { ...d[f.id], email_in_drip: e.target.checked } }))} />
                        send to every subscriber in turn (drip)
                      </label>
                      <button className={btnPrimary + ' text-xs px-3 py-1'} disabled={!!busy} onClick={() => save(f)}>
                        {busy === 'save:' + f.id ? '…' : 'Save'}
                      </button>
                    </div>
                  </div>
                )}
                {note[f.id] && <p className="px-3 pb-2 text-[12px] text-ink-700/80">{note[f.id]}</p>}
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
