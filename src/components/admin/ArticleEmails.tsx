// Every published article as an email: edit its subject, opener and inside
// photo, see who has had it, preview, test, and send to everyone who has not.
// The drip flag hands the article to the nightly "guide emails" automation so
// every subscriber, present and future, receives it in turn.
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Card, btnPrimary, btnGhost, inputCls } from './ui';

type Post = {
  slug: string; title: string; excerpt: string | null; cover_image_url: string | null; published_at: string | null;
  email_subject: string | null; email_intro: string | null; email_image_url: string | null; email_in_drip: boolean;
  sent: number; remaining: number;
};

export default function ArticleEmails() {
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [subs, setSubs] = useState(0);
  const [open, setOpen] = useState<string>('');
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<Record<string, Partial<Post>>>({});

  async function call(payload: any) {
    const { data: { session } } = await supabase.auth.getSession();
    return fetch('/api/admin/send-article', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify(payload),
    }).then((r) => r.json()).catch(() => ({ error: 'bad response' }));
  }
  async function load() {
    const r = await call({ list: true });
    if (r?.ok) { setPosts(r.posts); setSubs(r.subscribers); }
  }
  useEffect(() => { load(); }, []);

  const say = (slug: string, msg: string) => setNote((n) => ({ ...n, [slug]: msg }));
  const field = (p: Post, k: keyof Post) => (draft[p.slug]?.[k] ?? p[k]) as any;

  async function save(p: Post) {
    setBusy('save:' + p.slug);
    const d = draft[p.slug] || {};
    const r = await call({ save: true, slug: p.slug, email_subject: field(p, 'email_subject'), email_intro: field(p, 'email_intro'),
      email_image_url: field(p, 'email_image_url'), email_in_drip: !!field(p, 'email_in_drip') });
    setBusy('');
    say(p.slug, r?.error || 'Saved.');
    if (!r?.error) { setDraft((x) => { const c = { ...x }; delete c[p.slug]; return c; }); load(); }
  }

  async function act(p: Post, kind: 'preview' | 'test' | 'all') {
    setBusy(kind + ':' + p.slug); say(p.slug, '');
    const r = await call(kind === 'preview' ? { preview: true, slug: p.slug } : kind === 'test' ? { test: true, slug: p.slug } : { audience: 'all', slug: p.slug });
    setBusy('');
    if (r?.error) { say(p.slug, r.error); return; }
    if (kind === 'preview') {
      const url = URL.createObjectURL(new Blob([`<title>${r.subject}</title>` + r.html], { type: 'text/html' }));
      window.open(url, '_blank'); setTimeout(() => URL.revokeObjectURL(url), 60000);
      say(p.slug, `Preview opened. Subject: ${r.subject}`); return;
    }
    if (kind === 'test') { say(p.slug, 'Test sent to jolly@digitalchiselco.com.'); return; }
    say(p.slug, r.message || `Sent to ${r.sent} subscriber${r.sent === 1 ? '' : 's'}${r.skipped ? `, ${r.skipped} already had it` : ''}.`
      + (r.errors?.length ? ` Problems: ${r.errors.join('; ')}` : ''));
    load();
  }

  return (
    <Card>
      <div className="p-4">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <h3 className="font-serif text-lg">Guide emails</h3>
          <span className="text-[11px] text-ink-500">{subs} subscribers on the list</span>
        </div>
        <p className="mt-1 text-[12px] text-ink-700/60 leading-relaxed">
          Every published article can go out as a plain, useful email: the cover, one inside photo, what is inside, one link.
          Tick <b>drip</b> and the nightly automation sends it to every subscriber in turn; the button sends it now to everyone who has not had it.
          Edit the subject and opener here; the rest renders from the article.
        </p>

        {posts === null && <p className="mt-3 text-sm text-ink-500">Loading…</p>}
        {posts?.length === 0 && <p className="mt-3 text-sm text-ink-500">No published articles yet.</p>}

        <div className="mt-3 space-y-2">
          {(posts || []).map((p) => {
            const isOpen = open === p.slug;
            return (
              <div key={p.slug} className="rounded-lg border border-black/10 bg-white">
                <div className="flex flex-wrap items-center gap-3 p-2.5">
                  {p.cover_image_url && <img src={p.cover_image_url} alt="" className="w-16 h-10 object-cover rounded" />}
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-ink-900 truncate">{p.title}</div>
                    <div className="text-[11px] text-ink-700/60">
                      {p.sent > 0 ? <span className="text-emerald-700 font-medium">✓ sent to {p.sent}</span> : <span className="text-ink-700/40">not sent yet</span>}
                      {p.remaining > 0 && <span className="text-bronze-700"> · {p.remaining} still to go</span>}
                      {p.email_in_drip && <span className="ml-2 rounded bg-emerald-50 text-emerald-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">in drip</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button className={btnGhost + ' text-xs px-2 py-1'} onClick={() => setOpen(isOpen ? '' : p.slug)}>{isOpen ? 'close' : '✎ edit'}</button>
                    <button className={btnGhost + ' text-xs px-2 py-1'} disabled={!!busy} onClick={() => act(p, 'preview')}>👁</button>
                    <button className={btnGhost + ' text-xs px-2 py-1'} disabled={!!busy} onClick={() => act(p, 'test')}>✉ test</button>
                    <button className={btnPrimary + ' text-xs px-2 py-1'} disabled={!!busy || p.remaining === 0}
                      title={p.remaining === 0 ? 'Everyone has already had it' : `Send to ${p.remaining} who have not had it`}
                      onClick={() => { if (confirm(`Send "${p.title}" to ${p.remaining} subscriber${p.remaining === 1 ? '' : 's'} who have not had it?`)) act(p, 'all'); }}>
                      {busy === 'all:' + p.slug ? 'sending…' : `📣 ${p.remaining}`}
                    </button>
                  </div>
                </div>

                {isOpen && (
                  <div className="border-t border-black/5 p-3 space-y-2">
                    <label className="block text-[11px] text-ink-700/60">Subject
                      <input className={inputCls + ' mt-1 w-full'} value={field(p, 'email_subject') || ''} placeholder={p.title}
                        onChange={(e) => setDraft((d) => ({ ...d, [p.slug]: { ...d[p.slug], email_subject: e.target.value } }))} />
                    </label>
                    <label className="block text-[11px] text-ink-700/60">Opener (blank line between paragraphs; falls back to the excerpt)
                      <textarea className={inputCls + ' mt-1 w-full'} rows={4} value={field(p, 'email_intro') || ''} placeholder={p.excerpt || ''}
                        onChange={(e) => setDraft((d) => ({ ...d, [p.slug]: { ...d[p.slug], email_intro: e.target.value } }))} />
                    </label>
                    <label className="block text-[11px] text-ink-700/60">Inside photo URL (blank = first photo in the article after the cover)
                      <input className={inputCls + ' mt-1 w-full'} value={field(p, 'email_image_url') || ''}
                        onChange={(e) => setDraft((d) => ({ ...d, [p.slug]: { ...d[p.slug], email_image_url: e.target.value } }))} />
                    </label>
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <label className="flex items-center gap-1.5 text-[12px] text-ink-700/80">
                        <input type="checkbox" checked={!!field(p, 'email_in_drip')}
                          onChange={(e) => setDraft((d) => ({ ...d, [p.slug]: { ...d[p.slug], email_in_drip: e.target.checked } }))} />
                        send to every subscriber in turn (drip)
                      </label>
                      <button className={btnPrimary + ' text-xs px-3 py-1'} disabled={!!busy} onClick={() => save(p)}>
                        {busy === 'save:' + p.slug ? '…' : 'Save'}
                      </button>
                    </div>
                  </div>
                )}
                {note[p.slug] && <p className="px-3 pb-2 text-[12px] text-ink-700/80">{note[p.slug]}</p>}
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
