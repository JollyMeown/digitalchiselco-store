import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { Card, Modal, StatBox, inputCls } from '../ui';

// Subscriber Insights: email engagement per person + product affinity.
// Reads the admin insights API (which sits on v_subscriber_engagement /
// v_product_interest). All read-only.

const token = async () => (await supabase.auth.getSession()).data?.session?.access_token || '';
async function api(params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`/api/admin/insights?${qs}`, { headers: { authorization: `Bearer ${await token()}` } });
  return res.json();
}

const DAY = 86400000;
const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const ago = (d?: string | null) => {
  if (!d) return '—';
  const days = Math.floor((Date.now() - new Date(d).getTime()) / DAY);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days}d ago`;
};
const title1 = (t?: string) => (t || '').split('|')[0].trim();

function tierOf(r: any): { label: string; cls: string } {
  if (r.unsubscribed_at) return { label: 'Unsub', cls: 'bg-ink-700/10 text-ink-700/70' };
  if (r.complained) return { label: 'Spam', cls: 'bg-red-100 text-red-700' };
  if (r.bounced) return { label: 'Bounced', cls: 'bg-orange-100 text-orange-700' };
  const lo = r.last_opened_at ? new Date(r.last_opened_at).getTime() : 0;
  const lc = r.last_clicked_at ? new Date(r.last_clicked_at).getTime() : 0;
  if (lc && Date.now() - lc <= 30 * DAY) return { label: '🔥 Hot', cls: 'bg-green-100 text-green-800' };
  if (lo && Date.now() - lo <= 30 * DAY) return { label: 'Warm', cls: 'bg-amber-100 text-amber-800' };
  if (lo) return { label: 'Cold', cls: 'bg-sky-100 text-sky-800' };
  return { label: 'New', cls: 'bg-ink-700/10 text-ink-700/60' };
}

export default function Insights() {
  const [sub, setSub] = useState<'people' | 'products'>('people');
  const [ov, setOv] = useState<any>(null);

  useEffect(() => { api({ view: 'overview' }).then((d) => d.ok && setOv(d)); }, []);

  return (
    <div className="space-y-4">
      <div className="text-xs text-ink-700/70 bg-cream/40 border border-bronze-600/15 rounded-lg px-3 py-2">
        📈 <b>Subscriber Insights.</b> Every email's opens, clicks and bounces are logged per person (via Resend). Clicks on a product link reveal what each customer actually likes, so you can send more of the right thing. All figures are live.
      </div>

      {ov && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <StatBox label="Subscribers" value={ov.total} />
          <StatBox label="Engaged (30d)" value={ov.engaged30} sub="opened recently" />
          <StatBox label="Clickers" value={ov.clickers} sub="ever clicked" />
          <StatBox label="Dormant" value={ov.dormant} sub="opened, not in 30d" />
          <StatBox label="Never opened" value={ov.neverOpened} />
          <StatBox label="Bounced" value={ov.bounced} sub="prune these" />
          <StatBox label="Complained" value={ov.complained} sub="spam reports" />
        </div>
      )}

      <div className="flex gap-2">
        {(['people', 'products'] as const).map((k) => (
          <button key={k} onClick={() => setSub(k)}
            className={`text-sm px-3 py-1.5 rounded-lg border ${sub === k ? 'bg-bronze-600 text-cream border-bronze-600' : 'border-black/10 text-ink-700 hover:bg-cream'}`}>
            {k === 'people' ? '👤 People' : '🎯 Product interest'}
          </button>
        ))}
      </div>

      {sub === 'people' ? <People /> : <Products topFromOverview={ov?.topProducts} />}
    </div>
  );
}

// ── People: engagement table + per-person drill-down ─────────────────
function People() {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('last_event_at');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ rows: any[]; total: number }>({ rows: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api({ view: 'people', q, sort, dir, page: String(page), size: '50' })
      .then((d) => d.ok && setData({ rows: d.rows, total: d.total })).finally(() => setLoading(false));
  };
  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t); }, [q, sort, dir, page]);

  const th = (label: string, col?: string) => (
    <th className={`text-left font-medium px-2 py-2 whitespace-nowrap ${col ? 'cursor-pointer select-none hover:text-bronze-700' : ''}`}
      onClick={col ? () => { setPage(0); if (sort === col) setDir(dir === 'asc' ? 'desc' : 'asc'); else { setSort(col); setDir('desc'); } } : undefined}>
      {label}{col && sort === col ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}
    </th>
  );
  const pages = Math.ceil(data.total / 50);

  return (
    <Card>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <input value={q} onChange={(e) => { setPage(0); setQ(e.target.value); }} placeholder="Search email…" className={inputCls + ' max-w-xs'} />
        <span className="text-xs text-ink-700/60">{data.total} people{loading ? ' · loading…' : ''}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-ink-700/60 border-b border-black/10">
            <tr>{th('Email')}{th('Source')}{th('Status')}{th('Sent', 'sent')}{th('Opens', 'opened')}{th('Clicks', 'clicked')}{th('Bounced', 'bounced')}{th('Last open', 'last_opened_at')}</tr>
          </thead>
          <tbody>
            {data.rows.map((r) => {
              const t = tierOf(r);
              return (
                <tr key={r.email} className="border-b border-black/5 hover:bg-cream/40 cursor-pointer" onClick={() => setOpen(r.email)}>
                  <td className="px-2 py-2 text-bronze-700 max-w-[220px] truncate">{r.email}</td>
                  <td className="px-2 py-2 text-ink-700/70">{r.source || '—'}</td>
                  <td className="px-2 py-2"><span className={`text-[11px] px-1.5 py-0.5 rounded ${t.cls}`}>{t.label}</span></td>
                  <td className="px-2 py-2">{r.sent}</td>
                  <td className="px-2 py-2 font-medium">{r.opened}</td>
                  <td className="px-2 py-2 font-medium text-bronze-700">{r.clicked}</td>
                  <td className="px-2 py-2">{r.bounced ? <span className="text-orange-600">{r.bounced}</span> : 0}</td>
                  <td className="px-2 py-2 text-ink-700/70 whitespace-nowrap">{ago(r.last_opened_at)}</td>
                </tr>
              );
            })}
            {!data.rows.length && !loading && <tr><td colSpan={8} className="px-2 py-6 text-center text-ink-700/50">No subscribers match.</td></tr>}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex items-center gap-2 mt-3 text-sm">
          <button disabled={page === 0} onClick={() => setPage(page - 1)} className="px-2 py-1 rounded border border-black/10 disabled:opacity-40">‹ Prev</button>
          <span className="text-ink-700/60">Page {page + 1} / {pages}</span>
          <button disabled={page + 1 >= pages} onClick={() => setPage(page + 1)} className="px-2 py-1 rounded border border-black/10 disabled:opacity-40">Next ›</button>
        </div>
      )}
      {open && <PersonModal email={open} onClose={() => setOpen(null)} />}
    </Card>
  );
}

function PersonModal({ email, onClose }: { email: string; onClose: () => void }) {
  const [d, setD] = useState<any>(null);
  useEffect(() => { api({ view: 'subscriber', email }).then((r) => r.ok && setD(r)); }, [email]);
  const evIcon: Record<string, string> = { sent: '📤', delivered: '✅', opened: '👁', clicked: '🖱', bounced: '⚠️', complained: '🚩', delayed: '⏳' };
  return (
    <Modal open onClose={onClose} title={email} wide>
      {!d ? <div className="text-sm text-ink-700/60 p-4">Loading…</div> : (
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-ink-700/60 mb-2">Products they like</div>
            {d.likes?.length ? d.likes.map((p: any) => (
              <div key={p.slug} className="flex items-center gap-2 py-1.5 border-b border-black/5">
                {p.image_url && <img src={p.image_url} width={34} height={34} className="rounded object-cover" alt="" />}
                <a href={`/product/${p.slug}`} target="_blank" rel="noreferrer" className="flex-1 text-sm text-ink-800 truncate hover:text-bronze-700">{title1(p.title) || p.slug}</a>
                <span className="text-[11px] text-ink-700/60 whitespace-nowrap">
                  {p.buys ? `🛒${p.buys} ` : ''}{p.clicks ? `🖱${p.clicks} ` : ''}{p.browses ? `👁${p.browses}` : ''}
                </span>
              </div>
            )) : <div className="text-sm text-ink-700/50">No product signals yet.</div>}
            {d.orders?.length > 0 && (
              <div className="mt-3 text-xs text-ink-700/70">Orders: <b>{d.orders.length}</b> · Revenue: <b>${d.revenue.toFixed(2)}</b></div>
            )}
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-ink-700/60 mb-2">Email response log</div>
            <div className="max-h-[320px] overflow-y-auto">
              {d.events?.length ? d.events.map((e: any, i: number) => (
                <div key={i} className="flex items-center gap-2 py-1 text-sm border-b border-black/5">
                  <span>{evIcon[e.event] || '•'}</span>
                  <span className="capitalize flex-1">{e.event}{e.kind ? <span className="text-ink-700/50"> · {e.kind}</span> : ''}</span>
                  <span className="text-[11px] text-ink-700/50 whitespace-nowrap">{fmtDate(e.created_at)}</span>
                </div>
              )) : <div className="text-sm text-ink-700/50">No email events yet.</div>}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ── Product interest table + audience drill-down ─────────────────────
function Products({ topFromOverview }: { topFromOverview?: any[] }) {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ rows: any[]; total: number }>({ rows: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<any>(null);

  const load = () => {
    setLoading(true);
    api({ view: 'products', q, page: String(page), size: '50' })
      .then((d) => d.ok && setData({ rows: d.rows, total: d.total })).finally(() => setLoading(false));
  };
  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t); }, [q, page]);
  const pages = Math.ceil(data.total / 50);

  return (
    <Card>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <input value={q} onChange={(e) => { setPage(0); setQ(e.target.value); }} placeholder="Search product…" className={inputCls + ' max-w-xs'} />
        <span className="text-xs text-ink-700/60">ranked by interest (buys ×5 + clicks ×2 + browses){loading ? ' · loading…' : ''}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-ink-700/60 border-b border-black/10">
            <tr>
              <th className="text-left font-medium px-2 py-2">Product</th>
              <th className="text-left font-medium px-2 py-2">🖱 Clickers</th>
              <th className="text-left font-medium px-2 py-2">👁 Browsers</th>
              <th className="text-left font-medium px-2 py-2">🛒 Buyers</th>
              <th className="text-left font-medium px-2 py-2">Score</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.product_id} className="border-b border-black/5 hover:bg-cream/40 cursor-pointer" onClick={() => setOpen(r)}>
                <td className="px-2 py-2">
                  <div className="flex items-center gap-2">
                    {r.image_url && <img src={r.image_url} width={30} height={30} className="rounded object-cover" alt="" />}
                    <span className="max-w-[300px] truncate text-ink-800">{title1(r.title) || r.slug}</span>
                  </div>
                </td>
                <td className="px-2 py-2 font-medium text-bronze-700">{r.email_clickers}</td>
                <td className="px-2 py-2">{r.browsers}</td>
                <td className="px-2 py-2 font-medium">{r.buyers}</td>
                <td className="px-2 py-2">{r.interest_score}</td>
              </tr>
            ))}
            {!data.rows.length && !loading && <tr><td colSpan={5} className="px-2 py-6 text-center text-ink-700/50">No product signals yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex items-center gap-2 mt-3 text-sm">
          <button disabled={page === 0} onClick={() => setPage(page - 1)} className="px-2 py-1 rounded border border-black/10 disabled:opacity-40">‹ Prev</button>
          <span className="text-ink-700/60">Page {page + 1} / {pages}</span>
          <button disabled={page + 1 >= pages} onClick={() => setPage(page + 1)} className="px-2 py-1 rounded border border-black/10 disabled:opacity-40">Next ›</button>
        </div>
      )}
      {open && <AudienceModal product={open} onClose={() => setOpen(null)} />}
    </Card>
  );
}

function AudienceModal({ product, onClose }: { product: any; onClose: () => void }) {
  const [d, setD] = useState<any>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { api({ view: 'product', product_id: product.product_id }).then((r) => r.ok && setD(r)); }, [product.product_id]);
  const emails = useMemo(() => (d?.audience || []).map((a: any) => a.email), [d]);
  const copy = () => { navigator.clipboard.writeText(emails.join(', ')); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  return (
    <Modal open onClose={onClose} title={`Interested in: ${title1(product.title) || product.slug}`} wide>
      {!d ? <div className="text-sm text-ink-700/60 p-4">Loading…</div> : (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm text-ink-700/70">{emails.length} people showed interest</span>
            {emails.length > 0 && <button onClick={copy} className="text-xs px-2 py-1 rounded border border-black/10 hover:bg-cream ml-auto">{copied ? '✓ Copied' : 'Copy all emails'}</button>}
          </div>
          <div className="max-h-[360px] overflow-y-auto">
            {(d.audience || []).map((a: any) => (
              <div key={a.email} className="flex items-center gap-2 py-1.5 text-sm border-b border-black/5">
                <span className="flex-1 truncate text-ink-800">{a.email}</span>
                {a.bought && <span className="text-[11px] px-1.5 py-0.5 rounded bg-green-100 text-green-800">bought</span>}
                {a.clicked && <span className="text-[11px] px-1.5 py-0.5 rounded bg-bronze-600/15 text-bronze-700">clicked</span>}
                {a.browsed && <span className="text-[11px] px-1.5 py-0.5 rounded bg-sky-100 text-sky-800">browsed</span>}
              </div>
            ))}
            {!d.audience?.length && <div className="text-sm text-ink-700/50">No interest signals yet.</div>}
          </div>
        </div>
      )}
    </Modal>
  );
}
