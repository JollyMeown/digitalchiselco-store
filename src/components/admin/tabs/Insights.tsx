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
async function postApi(body: any) {
  const res = await fetch('/api/admin/insights', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${await token()}` },
    body: JSON.stringify(body),
  });
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

type Sub = 'people' | 'products' | 'leads' | 'referrals';

export default function Insights() {
  const [sub, setSub] = useState<Sub>('people');
  const [ov, setOv] = useState<any>(null);
  const [hot, setHot] = useState<any>(null);   // product opened from the hot-list

  useEffect(() => { api({ view: 'overview' }).then((d) => d.ok && setOv(d)); }, []);

  return (
    <div className="space-y-4">
      <div className="text-xs text-ink-700/70 bg-cream/40 border border-bronze-600/15 rounded-lg px-3 py-2">
        📈 <b>Subscriber Insights.</b> Every email's opens, clicks and bounces are logged per person (via Resend). Clicks on a product link reveal what each customer actually likes, so you can send more of the right thing. All figures are live.
      </div>

      {ov?.mostClickedWeek?.length > 0 && (
        <Card>
          <div className="flex items-center gap-2 mb-3">
            <h3 className="font-medium text-ink-900 text-sm">🔥 Most-clicked designs this week</h3>
            <span className="text-xs text-ink-700/55">unique clickers in the last 7 days · click a design to send it to them</span>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {ov.mostClickedWeek.map((p: any) => (
              <button key={p.slug} onClick={() => setHot({ product_id: p.id, slug: p.slug, title: p.title })}
                className="shrink-0 w-[130px] text-left group">
                <div className="relative">
                  {p.image_url && <img src={p.image_url} className="w-full h-[130px] object-cover rounded-lg border border-black/10 group-hover:ring-2 ring-bronze-500 transition" alt="" />}
                  <span className="absolute top-1 right-1 bg-bronze-700 text-cream text-[11px] font-medium px-1.5 py-0.5 rounded-full">🖱 {p.clicks}</span>
                </div>
                <div className="text-[11px] leading-tight mt-1 text-ink-800 line-clamp-2">{title1(p.title) || p.slug}</div>
                <div className="text-[11px] text-bronze-700 mt-0.5 opacity-0 group-hover:opacity-100 transition">Send to clickers →</div>
              </button>
            ))}
          </div>
        </Card>
      )}
      {hot && <AudienceModal product={hot} onClose={() => setHot(null)} />}

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

      {ov?.health && <HealthCard health={ov.health} onChange={() => api({ view: 'overview' }).then((d) => d.ok && setOv(d))} />}

      <div className="flex gap-2 flex-wrap">
        {([['people', '👤 People'], ['products', '🎯 Product interest'], ['leads', '🔥 Hot leads'], ['referrals', '🎁 Referrals']] as [Sub, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setSub(k)}
            className={`text-sm px-3 py-1.5 rounded-lg border ${sub === k ? 'bg-bronze-600 text-cream border-bronze-600' : 'border-black/10 text-ink-700 hover:bg-cream'}`}>
            {label}
          </button>
        ))}
      </div>

      {sub === 'people' && <People />}
      {sub === 'products' && <Products topFromOverview={ov?.topProducts} />}
      {sub === 'leads' && <Leads />}
      {sub === 'referrals' && <Referrals />}
    </div>
  );
}

// ── List health: deliverability rates + prune ────────────────────────
function HealthCard({ health: h, onChange }: { health: any; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const prune = async () => {
    setBusy(true); setMsg('Suppressing…');
    const r = await postApi({ action: 'suppress_bounced' });
    setMsg(r.ok ? `✓ ${r.suppressed} suppressed` : `✗ ${r.error || 'failed'}`); setBusy(false); onChange();
  };
  const Metric = ({ label, val, good }: { label: string; val: string; good?: boolean }) => (
    <div><div className="text-[11px] uppercase tracking-wide text-ink-700/55">{label}</div><div className={`text-lg font-medium ${good === false ? 'text-orange-600' : 'text-ink-800'}`}>{val}</div></div>
  );
  return (
    <Card>
      <div className="flex items-center gap-2 mb-3">
        <h3 className="font-medium text-ink-900 text-sm">🩺 List health</h3>
        <span className="text-xs text-ink-700/55">lifetime delivery quality</span>
        <button onClick={prune} disabled={busy} className="ml-auto text-xs px-2.5 py-1.5 rounded border border-black/10 hover:bg-cream disabled:opacity-40">Suppress bounced &amp; complainers</button>
        {msg && <span className="text-xs text-ink-800">{msg}</span>}
      </div>
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        <Metric label="Emails sent" val={h.sent.toLocaleString()} />
        <Metric label="Delivered" val={`${h.deliveryRate}%`} />
        <Metric label="Open rate" val={`${h.openRate}%`} />
        <Metric label="Click rate" val={`${h.clickRate}%`} />
        <Metric label="Bounce rate" val={`${h.bounceRate}%`} good={h.bounceRate < 2} />
        <Metric label="Suppressed" val={h.suppressed.toLocaleString()} />
      </div>
      {h.complaintRate > 0.1 && <div className="text-xs text-orange-600 mt-2">⚠ Complaint rate {h.complaintRate}% — keep an eye on this; above 0.3% risks deliverability.</div>}
    </Card>
  );
}

// ── Hot leads (RFM) ──────────────────────────────────────────────────
function Leads() {
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { api({ view: 'leads' }).then((d) => d.ok && setRows(d.rows)); }, []);
  const tier = (s: number) => s >= 400 ? { t: '🔥 Champion', c: 'bg-green-100 text-green-800' } : s >= 300 ? { t: 'Loyal', c: 'bg-amber-100 text-amber-800' } : s >= 200 ? { t: 'Promising', c: 'bg-sky-100 text-sky-800' } : { t: 'At risk', c: 'bg-ink-700/10 text-ink-700/70' };
  return (
    <Card>
      <div className="text-xs text-ink-700/60 mb-3">Subscribers ranked by likelihood to buy (recency + order count + spend). Click to see their profile.</div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-ink-700/60 border-b border-black/10"><tr>
            <th className="text-left font-medium px-2 py-2">Email</th><th className="text-left font-medium px-2 py-2">Tier</th>
            <th className="text-left font-medium px-2 py-2">Orders</th><th className="text-left font-medium px-2 py-2">Revenue</th>
            <th className="text-left font-medium px-2 py-2">Last activity</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => { const t = tier(r.score); return (
              <tr key={r.email} className="border-b border-black/5 hover:bg-cream/40 cursor-pointer" onClick={() => setOpen(r.email)}>
                <td className="px-2 py-2 text-bronze-700 max-w-[220px] truncate">{r.email}</td>
                <td className="px-2 py-2"><span className={`text-[11px] px-1.5 py-0.5 rounded ${t.c}`}>{t.t}</span></td>
                <td className="px-2 py-2">{r.orders}</td>
                <td className="px-2 py-2">${Number(r.revenue).toFixed(2)}</td>
                <td className="px-2 py-2 text-ink-700/70">{r.recencyDays}d ago</td>
              </tr>
            ); })}
            {!rows.length && <tr><td colSpan={5} className="px-2 py-6 text-center text-ink-700/50">No orders yet to score.</td></tr>}
          </tbody>
        </table>
      </div>
      {open && <PersonModal email={open} onClose={() => setOpen(null)} />}
    </Card>
  );
}

// ── Referral leaderboard ─────────────────────────────────────────────
function Referrals() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { api({ view: 'referrals' }).then((d) => d.ok && setRows(d.rows)); }, []);
  return (
    <Card>
      <div className="text-xs text-ink-700/60 mb-3">Your top referrers. The referral-nudge automation invites customers to join this list.</div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-ink-700/60 border-b border-black/10"><tr>
            <th className="text-left font-medium px-2 py-2">#</th><th className="text-left font-medium px-2 py-2">Referrer</th>
            <th className="text-left font-medium px-2 py-2">Friends referred</th><th className="text-left font-medium px-2 py-2">Rewarded</th>
            <th className="text-left font-medium px-2 py-2">Revenue driven</th>
          </tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.referrer_email} className="border-b border-black/5">
                <td className="px-2 py-2 text-ink-700/60">{i + 1}</td>
                <td className="px-2 py-2 text-bronze-700 max-w-[240px] truncate">{r.referrer_email}</td>
                <td className="px-2 py-2 font-medium">{r.referred}</td>
                <td className="px-2 py-2">{r.rewarded}</td>
                <td className="px-2 py-2">${Number(r.revenue).toFixed(2)}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={5} className="px-2 py-6 text-center text-ink-700/50">No referrals yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
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
  const [rel, setRel] = useState<any[]>([]);
  const [copied, setCopied] = useState(false);
  const [seg, setSeg] = useState({ clicked: true, browsed: true, bought: false });
  const [myEmail, setMyEmail] = useState('');
  const [preview, setPreview] = useState<{ sendable: number; sample: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => { api({ view: 'product', product_id: product.product_id }).then((r) => r.ok && setD(r)); }, [product.product_id]);
  useEffect(() => { api({ view: 'related', product_id: product.product_id }).then((r) => r.ok && setRel(r.related || [])); }, [product.product_id]);
  useEffect(() => { supabase.auth.getUser().then(({ data }) => setMyEmail(data?.user?.email || '')); }, []);
  // recompute the real sendable count whenever the targeting changes
  useEffect(() => {
    setPreview(null); setConfirming(false); setMsg('');
    if (!(seg.clicked || seg.browsed || seg.bought)) return;
    let alive = true;
    postApi({ product_id: product.product_id, segments: seg }).then((r) => { if (alive && r.ok) setPreview({ sendable: r.sendable, sample: r.sample || [] }); });
    return () => { alive = false; };
  }, [seg, product.product_id]);

  const emails = useMemo(() => (d?.audience || []).map((a: any) => a.email), [d]);
  const copy = () => { navigator.clipboard.writeText(emails.join(', ')); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  const Seg = ({ k, label }: { k: 'clicked' | 'browsed' | 'bought'; label: string }) => (
    <label className="flex items-center gap-1.5 text-sm cursor-pointer select-none">
      <input type="checkbox" checked={seg[k]} onChange={(e) => setSeg({ ...seg, [k]: e.target.checked })} /> {label}
    </label>
  );

  const sendTest = async () => {
    if (!myEmail) return; setBusy(true); setMsg('Sending test…');
    const r = await postApi({ product_id: product.product_id, test: myEmail });
    setMsg(r.ok ? `✓ Test sent to ${r.tested}` : `✗ ${r.error || 'failed'}`); setBusy(false);
  };
  const sendAll = async () => {
    setBusy(true); setMsg('Sending…');
    const r = await postApi({ product_id: product.product_id, segments: seg, confirm: true });
    setBusy(false); setConfirming(false);
    setMsg(r.ok ? `✓ Sent to ${r.sent}${r.failed ? `, ${r.failed} failed` : ''}${r.note ? ` (${r.note})` : ''}` : `✗ ${r.error || 'failed'}`);
    if (r.ok) setPreview((p) => (p ? { ...p, sendable: 0 } : p));  // they're now deduped out
  };

  const n = preview?.sendable ?? null;
  return (
    <Modal open onClose={onClose} title={`Interested in: ${title1(product.title) || product.slug}`} wide>
      {!d ? <div className="text-sm text-ink-700/60 p-4">Loading…</div> : (
        <div className="space-y-4">
          {/* ── Send-to-audience panel ── */}
          <div className="bg-cream/50 border border-bronze-600/20 rounded-lg p-3">
            <div className="text-sm font-medium text-ink-800 mb-2">📣 Send this design to its interested audience</div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-2">
              <span className="text-xs text-ink-700/60">Target:</span>
              <Seg k="clicked" label="🖱 Clicked in an email" />
              <Seg k="browsed" label="👁 Browsed on site" />
              <Seg k="bought" label="🛒 Already bought" />
            </div>
            <p className="text-[11px] text-ink-700/55 mb-2">
              Only confirmed subscribers are emailed. Anyone unsubscribed, who reported spam, or who already got this design is skipped automatically. "Already bought" is off by default since they own it.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-ink-800">
                {n === null ? 'Calculating…' : <><b>{n}</b> eligible {n === 1 ? 'person' : 'people'}</>}
              </span>
              <button onClick={sendTest} disabled={busy || !myEmail}
                className="text-xs px-2.5 py-1.5 rounded border border-black/10 hover:bg-white disabled:opacity-40 ml-auto">
                Send test to me
              </button>
              {!confirming ? (
                <button onClick={() => setConfirming(true)} disabled={busy || !n}
                  className="text-xs px-3 py-1.5 rounded bg-bronze-600 text-cream hover:bg-bronze-700 disabled:opacity-40">
                  Send to {n ?? 0} →
                </button>
              ) : (
                <span className="flex items-center gap-1">
                  <span className="text-xs text-ink-700/70">Sure?</span>
                  <button onClick={sendAll} disabled={busy} className="text-xs px-3 py-1.5 rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-40">Yes, send {n}</button>
                  <button onClick={() => setConfirming(false)} disabled={busy} className="text-xs px-2 py-1.5 rounded border border-black/10">Cancel</button>
                </span>
              )}
            </div>
            {msg && <div className="text-xs mt-2 text-ink-800">{msg}</div>}
          </div>

          {/* ── Interested list ── */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm text-ink-700/70">{emails.length} people showed interest</span>
              {emails.length > 0 && <button onClick={copy} className="text-xs px-2 py-1 rounded border border-black/10 hover:bg-cream ml-auto">{copied ? '✓ Copied' : 'Copy all emails'}</button>}
            </div>
            <div className="max-h-[300px] overflow-y-auto">
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

          {rel.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wide text-ink-700/60 mb-2">Customers who liked this also liked</div>
              <div className="flex gap-3 overflow-x-auto pb-1">
                {rel.map((p) => (
                  <a key={p.slug} href={`/product/${p.slug}`} target="_blank" rel="noreferrer" className="shrink-0 w-[110px] group">
                    {p.image_url && <img src={p.image_url} className="w-full h-[110px] object-cover rounded-lg border border-black/10 group-hover:ring-2 ring-bronze-500 transition" alt="" />}
                    <div className="text-[11px] leading-tight mt-1 text-ink-800 line-clamp-2">{title1(p.title) || p.slug}</div>
                    <div className="text-[11px] text-ink-700/55">{p.shared} shared {p.shared === 1 ? 'fan' : 'fans'}</div>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
