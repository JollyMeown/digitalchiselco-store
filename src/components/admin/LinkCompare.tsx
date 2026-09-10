// Settle a shared download file by looking at it.
//
// Two products point at one STL, so one of them sends the buyer the wrong
// model. Nothing in the database can say which; the pictures can, in a second.
// So the products are shown side by side, full size, with the file each one
// currently carries, a link straight into the Etsy listing editor (Etsy is the
// master), and a field to paste the correct link into.
//
// Deliberately not automatic: a wrong edit here means a paying customer gets
// somebody else's design, so the machine proposes and the owner decides.
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Card, btnGhost, btnPrimary, inputCls } from './ui';

type Dl = { id: string; file_name: string | null; download_link: string };
type Prod = {
  id: string; slug: string; title: string; image_url: string | null;
  active: boolean; price_usd: number; etsy_listing_id: string | null;
  etsy_sales_365: number | null; submitted_by: string | null;
  downloads: Dl[];
  suggestion: { suggested_link: string; suggested_name: string | null; score: number | null; note: string | null } | null;
};
type Group = { download_link: string; similarity: number; kind: string; products: Prod[] };

const etsyEdit = (id: string) => `https://www.etsy.com/your/shops/me/tools/listings/${id}`;

export default function LinkCompare({ onClose }: { onClose: () => void }) {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [err, setErr] = useState('');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [done, setDone] = useState<Record<string, string>>({});
  const [names, setNames] = useState<Record<string, string | null>>({});

  async function load() {
    const { data: { session } } = await supabase.auth.getSession();
    const r = await fetch('/api/admin/link-groups', { headers: { authorization: `Bearer ${session?.access_token || ''}` } })
      .then((x) => x.json()).catch(() => ({ error: 'bad response' }));
    if (r?.error) setErr(r.error); else { setGroups(r.groups); setErr(''); }
  }
  useEffect(() => { load(); }, []);

  // The file's own name, straight from Drive. Reading it costs a header, and it
  // usually names the design outright, which settles most groups on its own.
  async function readNames(links: string[]) {
    const todo = links.filter((l) => !(l in names));
    if (!todo.length) return;
    const { data: { session } } = await supabase.auth.getSession();
    const found: Record<string, string | null> = { ...names };
    for (let i = 0; i < todo.length; i += 6) {
      const r = await fetch('/api/admin/download-filename', {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${session?.access_token || ''}` },
        body: JSON.stringify({ links: todo.slice(i, i + 6) }),
      }).then((x) => x.json()).catch(() => ({ error: 'bad response' }));
      if (r?.error) break;
      for (const n of r.names || []) found[n.url] = n.filename;
      setNames({ ...found });
    }
  }

  async function save(p: Prod, link: string) {
    if (!/^https?:\/\/\S+$/i.test(link)) { alert('Paste the full link, starting with https://'); return; }
    if (!confirm(`Point "${p.title.slice(0, 60)}" at this file?\n\n${link}\n\nEvery future buyer of this product gets this file.`)) return;
    setBusy(p.id);
    const { data: { session } } = await supabase.auth.getSession();
    const r = await fetch('/api/admin/download-link', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${session?.access_token || ''}` },
      body: JSON.stringify({ product_id: p.id, download_id: p.downloads[0]?.id, link }),
    }).then((x) => x.json()).catch(() => ({ error: 'bad response' }));
    setBusy('');
    if (r?.error) alert(`Save failed: ${r.error}`);
    else { setDone((d) => ({ ...d, [p.id]: link })); load(); }
  }

  if (err) return <Card><p className="text-sm text-red-600">Could not load: {err}</p><button className={btnGhost} onClick={onClose}>Close</button></Card>;
  if (!groups) return <Card><p className="text-sm text-ink-700/60">Reading the catalogue…</p></Card>;

  return (
    <Card>
      <div className="flex items-baseline gap-2 flex-wrap mb-1">
        <h3 className="font-medium text-ink-900 text-sm">🔍 Products sharing one file</h3>
        <span className="text-xs text-ink-700/55">{groups.length} to settle</span>
        <button className={btnGhost + ' ml-auto'} onClick={() => readNames(groups.map((g) => g.download_link))}>📄 Read the real file names</button>
        <button className={btnGhost} onClick={onClose}>Close</button>
      </div>
      <p className="text-[11px] text-ink-700/65 mb-3">
        Each pair below points at the same STL, so one of them delivers the other's model. Compare the two pictures, open the
        one that is wrong in <b>Etsy</b>, which is your master, copy the correct Drive link from that listing and paste it here.
        Nothing changes until you press Save.
      </p>

      {groups.length === 0 && (
        <div className="rounded-lg border border-green-300 bg-green-50 px-3 py-2.5 text-xs text-green-900">
          Nothing left to settle. Every remaining shared file belongs to a bundle or to the same design listed twice.
        </div>
      )}

      <div className="space-y-4">
        {groups.map((g) => {
          const fn = names[g.download_link];
          return (
            <div key={g.download_link} className="border border-red-200 rounded-lg p-3 bg-red-50/40">
              <div className="text-[11px] text-ink-700/70 mb-2">
                Shared file: {fn ? <b className="text-ink-900">📄 {fn}</b> : <span className="break-all">{g.download_link}</span>}
                <a href={g.download_link} target="_blank" rel="noreferrer" className="ml-2 underline text-bronze-700">open the file ↗</a>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                {g.products.map((p) => {
                  const cur = p.downloads[0];
                  const value = draft[p.id] ?? '';
                  const saved = done[p.id];
                  return (
                    <div key={p.id} className="bg-white border border-black/10 rounded-lg p-2.5">
                      <div className="flex gap-2.5">
                        {p.image_url
                          ? <img src={p.image_url} alt="" className="w-28 h-28 object-cover rounded border border-black/10 flex-none" />
                          : <div className="w-28 h-28 rounded bg-cream/60 border border-black/10 flex items-center justify-center text-[10px] text-ink-700/40 flex-none">no picture</div>}
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-ink-900 leading-snug">{p.title}</div>
                          <div className="text-[10px] text-ink-700/60 mt-0.5">
                            ${p.price_usd} · {p.active ? 'live' : 'draft'}
                            {p.etsy_sales_365 ? ` · ${p.etsy_sales_365} Etsy sales in 365 days` : ''}
                            {p.submitted_by ? ` · 🖥 ${p.submitted_by}` : ''}
                          </div>
                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                            {p.etsy_listing_id
                              ? <a href={etsyEdit(p.etsy_listing_id)} target="_blank" rel="noreferrer" className="text-[10px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-900 border border-orange-200 font-medium">✏️ Edit on Etsy ↗</a>
                              : <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 border border-gray-200" title="This product is not linked to an Etsy listing, so there is no master to read from.">no Etsy listing</span>}
                            <a href={`/product/${p.slug}`} target="_blank" rel="noreferrer" className="text-[10px] px-1.5 py-0.5 rounded bg-cream border border-black/10">View page ↗</a>
                          </div>
                        </div>
                      </div>

                      <div className="mt-2 text-[10px] text-ink-700/60">
                        Currently sends: {cur ? (names[cur.download_link] ? <b className="text-ink-900">{names[cur.download_link]}</b> : <span className="break-all">{String(cur.download_link).slice(0, 54)}…</span>) : <b className="text-red-700">no file at all</b>}
                      </div>

                      {p.suggestion && (
                        <div className="mt-1.5 rounded border border-sky-200 bg-sky-50 px-2 py-1.5">
                          <div className="text-[10px] text-sky-900">
                            Drive has a closer match{p.suggestion.score != null ? ` (${Math.round(p.suggestion.score * 100)}% fit)` : ''}:
                            <b className="block">{p.suggestion.suggested_name}</b>
                          </div>
                          <div className="flex gap-1.5 mt-1">
                            <a href={p.suggestion.suggested_link} target="_blank" rel="noreferrer" className="text-[10px] underline text-sky-800">open it first ↗</a>
                            <button className="text-[10px] underline text-sky-800" onClick={() => setDraft((d) => ({ ...d, [p.id]: p.suggestion!.suggested_link }))}>use this link</button>
                          </div>
                        </div>
                      )}

                      {saved ? (
                        <div className="mt-2 text-[11px] text-green-800 font-medium">✓ Saved. This product now sends its own file.</div>
                      ) : (
                        <div className="mt-2 flex gap-1.5">
                          <input
                            value={value} onChange={(e) => setDraft((d) => ({ ...d, [p.id]: e.target.value }))}
                            placeholder="paste the correct Drive link from Etsy"
                            className={inputCls + ' text-[11px] flex-1 min-w-0'}
                          />
                          <button className={btnPrimary} disabled={busy === p.id || !value} onClick={() => save(p, value.trim())}>
                            {busy === p.id ? 'Saving…' : 'Save'}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
