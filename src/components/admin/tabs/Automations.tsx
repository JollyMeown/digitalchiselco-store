import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { Card, btnPrimary, btnGhost, inputCls, Toast } from '../ui';

const KINDS: { key: string; label: string; group: string }[] = [
  { key: 'drip1', label: '1 · Did you carve the free pack?', group: 'Subscriber drip' },
  { key: 'drip2', label: '2 · Our 5 bestsellers', group: 'Subscriber drip' },
  { key: 'drip3', label: '3 · Bundle spotlight', group: 'Subscriber drip' },
  { key: 'drip4', label: '4 · Membership pitch', group: 'Subscriber drip' },
  { key: 'drip5', label: '5 · CARVE15 coupon', group: 'Subscriber drip' },
  { key: 'cart', label: 'Abandoned-cart reminder', group: 'Cart recovery' },
  { key: 'browse', label: 'Abandoned-browse reminder', group: 'Cart recovery' },
  { key: 'review7', label: 'Review request (+7 days)', group: 'Post-purchase' },
  { key: 'arrivals30', label: 'New arrivals (+30 days)', group: 'Post-purchase' },
  { key: 'loyalty', label: 'Loyalty 10% (3rd order)', group: 'Post-purchase' },
  { key: 'weekly', label: 'Weekly fresh-designs digest (Mondays)', group: 'Broadcasts' },
  { key: 'winback', label: 'Win-back (dormant subscribers)', group: 'Broadcasts' },
  { key: 'priceDrop', label: 'Price-drop alert', group: 'Broadcasts' },
  { key: 'referralNudge', label: 'Referral nudge (happy customers)', group: 'Broadcasts' },
  { key: 'etsyWelcome', label: 'Etsy-buyer welcome (one-time)', group: 'Etsy buyers' },
];

// ── Block-based template builder ─────────────────────────────────────
// Blocks are stored in email_template_overrides.blocks (jsonb) for re-editing;
// the rendered HTML goes into body_html — the ONLY field the send path reads,
// so the growth engine needs no changes.
type Block =
  | { type: 'text'; html: string }
  | { type: 'image'; url: string; alt?: string; link?: string; width?: number }
  | { type: 'button'; label: string; link: string }
  | { type: 'products'; products: { slug: string; title: string; price_usd: number; image_url: string | null }[] }
  | { type: 'divider' };

const escH = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function renderBlocksHtml(blocks: Block[]): string {
  return blocks.map((b) => {
    if (b.type === 'text') return `<div style="font-size:14px;line-height:1.65;color:#2b2013;">${(b as any).html || ''}</div>`;
    if (b.type === 'divider') return '<hr style="border:none;border-top:1px solid #ead9bd;margin:18px 0;" />';
    if (b.type === 'image') {
      if (!b.url) return '';
      const img = `<img src="${escH(b.url)}" alt="${escH(b.alt || '')}" style="max-width:100%;${b.width ? `width:${Number(b.width)}px;` : ''}border-radius:10px;display:inline-block;" />`;
      return `<div style="text-align:center;margin:14px 0;">${b.link ? `<a href="${escH(b.link)}">${img}</a>` : img}</div>`;
    }
    if (b.type === 'button') {
      if (!b.link) return '';
      return `<div style="text-align:center;margin:18px 0;"><a href="${escH(b.link)}" style="display:inline-block;background:#854F0B;color:#F5EFE3;text-decoration:none;padding:12px 26px;border-radius:8px;font-size:14px;">${escH(b.label || 'Open')}</a></div>`;
    }
    if (b.type === 'products') {
      const ps = (b.products || []).slice(0, 3);
      if (!ps.length) return '';
      const w = Math.floor(100 / ps.length);
      const cells = ps.map((p) =>
        `<td width="${w}%" style="padding:6px;vertical-align:top;"><a href="https://digitalchiselco.com/product/${escH(p.slug)}" style="text-decoration:none;color:#2b2013;">` +
        (p.image_url ? `<img src="${escH(p.image_url)}" alt="${escH(p.title)}" style="width:100%;border-radius:8px;display:block;" />` : '') +
        `<div style="font-size:12px;margin-top:6px;line-height:1.4;">${escH(p.title.split('|')[0].trim())}</div>` +
        `<div style="font-size:12px;color:#854F0B;font-weight:bold;">$${Number(p.price_usd).toFixed(2)}</div></a></td>`).join('');
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0;"><tr>${cells}</tr></table>`;
    }
    return '';
  }).filter(Boolean).join('\n');
}

const KIND_LABELS: Record<string, string> = {
  weekly: 'Weekly digest', drip1: 'Drip 1', drip2: 'Drip 2', drip3: 'Drip 3', drip4: 'Drip 4', drip5: 'Drip 5',
  cart: 'Cart reminder', review7: 'Review request', arrivals30: 'New arrivals', loyalty: 'Loyalty code',
  order: 'Order confirmation', gift: 'Gift card', '(untagged)': 'Other emails',
};

export default function Automations() {
  const [settings, setSettings] = useState<any>(null);
  const [drip, setDrip] = useState<{ active: number; done: number; converted: number; stopped: number }>({ active: 0, done: 0, converted: 0, stopped: 0 });
  const [carts, setCarts] = useState<{ open: number; reminded: number; recovered: number }>({ open: 0, reminded: 0, recovered: 0 });
  const [emailStats, setEmailStats] = useState<{ rows: any[]; recent: any[]; total: number } | null>(null);
  const [kind, setKind] = useState('drip1');
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'info'; text: string }>({ kind: 'info', text: '' });
  // template editing (email_template_overrides — blank field = use the default)
  const [editOpen, setEditOpen] = useState(false);
  const [ovrSubject, setOvrSubject] = useState('');
  const [ovrHeading, setOvrHeading] = useState('');
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [ovrSaved, setOvrSaved] = useState(false);
  // product picker (for the "products" block)
  const [prodQ, setProdQ] = useState('');
  const [prodResults, setProdResults] = useState<any[]>([]);
  const [pickerFor, setPickerFor] = useState<number | null>(null);

  useEffect(() => { load(); }, []);
  useEffect(() => { loadPreview(kind); }, [kind]);

  async function load() {
    const [{ data: g }, { data: d }, { data: ac }, { data: sess }] = await Promise.all([
      supabase.from('growth_settings').select('*').eq('id', 1).maybeSingle(),
      supabase.from('subscriber_drip').select('status'),
      supabase.from('abandoned_carts').select('reminded_at, recovered_at'),
      supabase.auth.getSession(),
    ]);
    setSettings(g || { drip_enabled: false, cart_reminders_enabled: false, followups_enabled: false });
    const dc = { active: 0, done: 0, converted: 0, stopped: 0 };
    for (const r of d || []) if (r.status in dc) (dc as any)[r.status]++;
    setDrip(dc);
    const cc = { open: 0, reminded: 0, recovered: 0 };
    for (const r of ac || []) { if (r.recovered_at) cc.recovered++; else if (r.reminded_at) cc.reminded++; else cc.open++; }
    setCarts(cc);
    const email = sess?.session?.user?.email;
    if (email) setTestTo((t) => t || email);
    loadEmailStats();
  }

  // ── Email performance (email_events via Resend webhook) ──────────
  async function loadEmailStats() {
    const { data: evs } = await supabase.from('email_events')
      .select('provider_id, event, email, kind, created_at, url')
      .order('created_at', { ascending: false }).limit(5000);
    if (!evs) { setEmailStats({ rows: [], recent: [], total: 0 }); return; }
    // aggregate per kind; opens/clicks counted UNIQUE per email id
    const agg: Record<string, { sent: number; delivered: number; opened: Set<string>; clicked: Set<string>; bounced: number; complained: number }> = {};
    for (const e of evs) {
      const k = e.kind || '(untagged)';
      const a = (agg[k] ||= { sent: 0, delivered: 0, opened: new Set(), clicked: new Set(), bounced: 0, complained: 0 });
      const pid = e.provider_id || e.email || String(Math.random());
      if (e.event === 'sent') a.sent++;
      else if (e.event === 'delivered') a.delivered++;
      else if (e.event === 'opened') a.opened.add(pid);
      else if (e.event === 'clicked') a.clicked.add(pid);
      else if (e.event === 'bounced') a.bounced++;
      else if (e.event === 'complained') a.complained++;
    }
    const rows = Object.entries(agg).map(([kind, a]) => {
      const base = a.delivered || a.sent;
      return {
        kind, sent: a.sent, delivered: a.delivered, opened: a.opened.size, clicked: a.clicked.size,
        bounced: a.bounced, complained: a.complained,
        openRate: base ? Math.round((a.opened.size / base) * 100) : 0,
        clickRate: base ? Math.round((a.clicked.size / base) * 100) : 0,
      };
    }).sort((x, y) => y.sent + y.delivered - (x.sent + x.delivered));
    setEmailStats({ rows, recent: evs.slice(0, 25), total: evs.length });
  }

  async function token(): Promise<string> {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || '';
  }

  async function loadPreview(k: string) {
    setPreview(null);
    const res = await fetch(`/api/admin/growth/preview?kind=${k}`, { headers: { authorization: `Bearer ${await token()}` } });
    const data = await res.json();
    if (res.ok) setPreview({ subject: data.subject, html: data.html });
    else setMsg({ kind: 'error', text: data.error || 'preview failed' });
    // load any saved override for the edit panel
    const { data: ov } = await supabase.from('email_template_overrides').select('*').eq('kind', k).maybeSingle();
    setOvrSubject(ov?.subject || ''); setOvrHeading(ov?.heading || '');
    // blocks (composer state) win; a legacy body_html-only override becomes one raw-HTML text block
    if (Array.isArray(ov?.blocks) && ov.blocks.length) setBlocks(ov.blocks);
    else if (ov?.body_html) setBlocks([{ type: 'text', html: ov.body_html }]);
    else setBlocks([]);
    setOvrSaved(!!ov);
    setPickerFor(null); setProdQ(''); setProdResults([]);
  }

  async function saveOverride() {
    // drop empty blocks so a lone blank text block doesn't override the default
    const clean = blocks.filter((b) =>
      b.type === 'divider' ||
      (b.type === 'text' && (b as any).html?.trim()) ||
      (b.type === 'image' && (b as any).url?.trim()) ||
      (b.type === 'button' && (b as any).link?.trim()) ||
      (b.type === 'products' && (b as any).products?.length));
    const payload = {
      kind,
      subject: ovrSubject.trim() || null,
      heading: ovrHeading.trim() || null,
      body_html: clean.length ? renderBlocksHtml(clean) : null,
      blocks: clean.length ? clean : null,
      updated_at: new Date().toISOString(),
    };
    if (!payload.subject && !payload.heading && !payload.body_html) return resetOverride();
    const { error } = await supabase.from('email_template_overrides').upsert(payload, { onConflict: 'kind' });
    if (error) { setMsg({ kind: 'error', text: error.message }); return; }
    setMsg({ kind: 'success', text: '✓ Saved — preview updated' });
    setOvrSaved(true);
    loadPreview(kind);
  }

  async function resetOverride() {
    await supabase.from('email_template_overrides').delete().eq('kind', kind);
    setOvrSubject(''); setOvrHeading(''); setBlocks([]); setOvrSaved(false);
    setMsg({ kind: 'success', text: '✓ Reset to the default template' });
    loadPreview(kind);
  }

  // ── block helpers ────────────────────────────────────────────────
  function patchBlock(i: number, patch: any) {
    setBlocks((bs) => bs.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  }
  function moveBlock(i: number, dir: -1 | 1) {
    setBlocks((bs) => {
      const j = i + dir;
      if (j < 0 || j >= bs.length) return bs;
      const next = bs.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  function removeBlock(i: number) {
    setBlocks((bs) => bs.filter((_, j) => j !== i));
    setPickerFor(null);
  }
  function addBlock(type: Block['type']) {
    const fresh: Block =
      type === 'text' ? { type: 'text', html: '<p>Hi {{first_name}},</p>\n<p></p>' } :
      type === 'image' ? { type: 'image', url: '', alt: '', link: '' } :
      type === 'button' ? { type: 'button', label: 'Browse the catalog', link: 'https://digitalchiselco.com/catalog' } :
      type === 'products' ? { type: 'products', products: [] } :
      { type: 'divider' };
    setBlocks((bs) => [...bs, fresh]);
  }
  async function searchProducts(q: string) {
    setProdQ(q);
    if (q.trim().length < 2) { setProdResults([]); return; }
    const { data } = await supabase.from('products')
      .select('slug, title, price_usd, image_url')
      .eq('active', true).ilike('title', `%${q.trim()}%`).limit(8);
    setProdResults(data || []);
  }

  async function sendTest() {
    setBusy(true); setMsg({ kind: 'info', text: 'Sending test…' });
    const res = await fetch('/api/admin/growth/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${await token()}` },
      body: JSON.stringify({ kind, to: testTo }),
    });
    const data = await res.json();
    setBusy(false);
    setMsg(res.ok ? { kind: 'success', text: `✓ Test sent to ${data.sent}` } : { kind: 'error', text: data.error || 'send failed' });
  }

  async function toggle(field: string) {
    const next = { ...settings, [field]: !settings[field], updated_at: new Date().toISOString() };
    setSettings(next);
    await supabase.from('growth_settings').update({ [field]: next[field], updated_at: next.updated_at }).eq('id', 1);
  }

  if (!settings) return <div className="text-sm text-ink-700/60">Loading…</div>;

  const Toggle = ({ field, label, desc, stat }: { field: string; label: string; desc: string; stat?: string }) => (
    <Card>
      <div className="flex items-start gap-3">
        <button onClick={() => toggle(field)} aria-pressed={settings[field]}
          className={`mt-0.5 w-11 h-6 rounded-full transition relative flex-shrink-0 ${settings[field] ? 'bg-green-600' : 'bg-black/20'}`}>
          <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-all ${settings[field] ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
        <div>
          <div className="text-sm font-medium text-ink-900">{label} {settings[field] ? <span className="text-green-700 text-xs ml-1">ON</span> : <span className="text-ink-700/40 text-xs ml-1">off</span>}</div>
          <div className="text-xs text-ink-700/60 mt-0.5">{desc}</div>
          {stat && <div className="text-xs text-bronze-700 mt-1">{stat}</div>}
        </div>
      </div>
    </Card>
  );

  return (
    <div className="space-y-4">
      <div className="text-xs text-ink-700/70 bg-cream/40 border border-bronze-600/15 rounded-lg px-3 py-2">
        🛡 <b>Review-first:</b> each system starts OFF — a <b>green</b> toggle means it's <b>ON</b>. Preview each email (right) and test-send it to yourself before enabling. The daily cron (08:00 UTC) does the actual sending, so the counters below stay at <b>0</b> until it next runs and there's activity to report — that's normal, not "off".
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Toggle field="drip_enabled" label="Subscriber nurture drip"
          desc="5 emails, ~4 days apart, to double-opt-in free subscribers. Stops automatically when someone buys."
          stat={`${drip.active} active · ${drip.done} completed · ${drip.converted} converted · ${drip.stopped} unsubscribed`} />
        <Toggle field="cart_reminders_enabled" label="Abandoned-cart reminders"
          desc="One email ~20h after a cart is left with an email typed. Never sends if they purchased."
          stat={`${carts.open} open carts · ${carts.reminded} reminded · ${carts.recovered} recovered`} />
        <Toggle field="followups_enabled" label="Post-purchase followups"
          desc="Review request (+7d), new arrivals (+30d), permanent loyalty code on the 3rd order." />
        <Toggle field="weekly_digest_enabled" label="Weekly fresh-designs digest"
          desc="Every Monday: one email to all confirmed subscribers with the designs added that week + a branded lookbook PDF (product-page links). Skips quiet weeks automatically." />
        <Toggle field="abandoned_browse_enabled" label="Abandoned-browse reminder"
          desc="One email to a confirmed subscriber who viewed 3+ designs but never added to cart or bought. Once per person, product-page links only." />
        <Toggle field="referral_rewards_enabled" label="Referral rewards"
          desc="When a friend orders with someone's REF- share link, email the referrer a 15% reward code. The 15%-off for friends works whether this is on or off." />
        <Toggle field="etsy_welcome_enabled" label="Etsy-buyer welcome"
          desc="One-time welcome to imported Etsy buyers (source 'etsy-buyer'): this week's newest designs + a 10% code. Sent once each, never twice. They skip the free-pack drip, then join the weekly digest like everyone else." />
        <Toggle field="weekly_personalized" label="Personalized weekly digest"
          desc="Orders each subscriber's weekly designs by their own category affinity (from their clicks, browses and buys), so the designs most like what they engage with appear first." />
        <Toggle field="winback_enabled" label="Win-back dormant subscribers"
          desc="A 'we miss you' email + 15% code (WINBACK15) to people who have not opened in 60+ days. Also auto-suppresses chronic never-openers (6+ sends, 0 opens) to protect deliverability. Once per person." />
        <Toggle field="price_drop_enabled" label="Price-drop alerts"
          desc="When a design's price drops, emails the people who clicked or browsed it but never bought. Skips buyers and anyone already alerted for that design." />
        <Toggle field="referral_nudge_enabled" label="Referral nudge"
          desc="Asks customers with at least one order to share their personal referral link (give 15%, get 15%). Once per person, at least 14 days after their last order." />
        <Toggle field="sendtime_enabled" label="Send-time optimization"
          desc="Learns each subscriber's most common open hour and schedules their broadcasts to arrive then (via Resend). Improves opens over time as data builds." />
        <Toggle field="refund_winback_enabled" label="Post-refund win-back"
          desc="30 days after a refund, one friendly 'no hard feelings' email with a 15% code (COMEBACK15). One per person ever; only refunds from the last week of the window, so enabling late never blasts old refunds." />
        <Toggle field="bundle_week_enabled" label="Bundle of the Week"
          desc="Every Monday the shop auto-picks 5 designs from a rotating theme and publishes them at /bundle-of-week as a one-tap $25 bundle with a countdown. No email, just the page." />
        <Toggle field="owner_report_enabled" label="Your weekly report (to you)"
          desc="Every Monday YOU get one email: pageviews, cart adds, wishlist saves, checkout funnel, orders + revenue, best designs, and searches that found nothing. No admin login needed." />
        <Toggle field="wishlist_reminder_enabled" label="Wishlist reminder"
          desc="Subscribers who hearted a design 3-14 days ago but never bought it get one gentle 'saved, not forgotten' email with those designs. Once per person per design, ever." />
      </div>

      <PicksPanel />

      <Card>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={inputCls + ' max-w-xs'}>
            {['Subscriber drip', 'Cart recovery', 'Post-purchase', 'Broadcasts', 'Etsy buyers'].map((grp) => (
              <optgroup key={grp} label={grp}>
                {KINDS.filter((k) => k.group === grp).map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
              </optgroup>
            ))}
          </select>
          <input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@email.com" className={inputCls + ' max-w-[220px]'} />
          <button className={btnPrimary} disabled={busy} onClick={sendTest}>{busy ? 'Sending…' : 'Send test to me'}</button>
          <button className={btnGhost} onClick={() => loadPreview(kind)}>Refresh preview</button>
          <button className={btnGhost} onClick={() => setEditOpen((v) => !v)}>{editOpen ? 'Close editor' : (ovrSaved ? '✎ Edit (customised)' : '✎ Edit template')}</button>
          <Toast message={msg.text} kind={msg.kind} />
        </div>

        {editOpen && (
          <div className="mb-4 border border-bronze-600/20 bg-cream/30 rounded-lg p-3 space-y-3">
            <p className="text-xs text-ink-700/60">
              Build the email body from <b>blocks</b> — text, pictures, buttons, product grids. Leave everything empty to keep the default template.
              The logo, brand shell and unsubscribe footer always stay. Use <code>{'{{first_name}}'}</code> in text to personalise.
            </p>
            <input value={ovrSubject} onChange={(e) => setOvrSubject(e.target.value)} placeholder="Custom subject (blank = default)" className={inputCls} />
            <input value={ovrHeading} onChange={(e) => setOvrHeading(e.target.value)} placeholder="Custom header title (blank = default)" className={inputCls} />

            {blocks.map((b, i) => (
              <div key={i} className="border border-black/10 bg-white rounded-md p-2.5">
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="text-[11px] uppercase tracking-wider text-bronze-700 font-medium mr-auto">
                    {b.type === 'text' ? '📝 Text' : b.type === 'image' ? '🖼 Image' : b.type === 'button' ? '🔘 Button' : b.type === 'products' ? '🛍 Product grid' : '— Divider'}
                  </span>
                  <button className="text-xs px-1.5 py-0.5 border border-black/10 rounded hover:bg-cream disabled:opacity-30" disabled={i === 0} onClick={() => moveBlock(i, -1)} title="Move up">↑</button>
                  <button className="text-xs px-1.5 py-0.5 border border-black/10 rounded hover:bg-cream disabled:opacity-30" disabled={i === blocks.length - 1} onClick={() => moveBlock(i, 1)} title="Move down">↓</button>
                  <button className="text-xs px-1.5 py-0.5 border border-black/10 rounded text-red-600 hover:bg-red-50" onClick={() => removeBlock(i)} title="Remove">✕</button>
                </div>
                {b.type === 'text' && (
                  <textarea value={(b as any).html} onChange={(e) => patchBlock(i, { html: e.target.value })} rows={4}
                    placeholder="<p>Your text — simple HTML allowed (<strong>, <a href>, <ul>…)</p>" className={inputCls + ' font-mono text-xs'} />
                )}
                {b.type === 'image' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input value={(b as any).url} onChange={(e) => patchBlock(i, { url: e.target.value })} placeholder="Image URL (https://…)" className={inputCls} />
                    <input value={(b as any).link || ''} onChange={(e) => patchBlock(i, { link: e.target.value })} placeholder="Click-through link (optional)" className={inputCls} />
                    <input value={(b as any).alt || ''} onChange={(e) => patchBlock(i, { alt: e.target.value })} placeholder="Alt text (optional)" className={inputCls} />
                    <input type="number" value={(b as any).width || ''} onChange={(e) => patchBlock(i, { width: e.target.value ? Number(e.target.value) : undefined })} placeholder="Width px (blank = full)" className={inputCls} />
                    {(b as any).url && <img src={(b as any).url} alt="" className="sm:col-span-2 max-h-28 rounded border border-black/10 object-contain" />}
                  </div>
                )}
                {b.type === 'button' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input value={(b as any).label} onChange={(e) => patchBlock(i, { label: e.target.value })} placeholder="Button label" className={inputCls} />
                    <input value={(b as any).link} onChange={(e) => patchBlock(i, { link: e.target.value })} placeholder="Button link (https://…)" className={inputCls} />
                  </div>
                )}
                {b.type === 'products' && (
                  <div>
                    <div className="flex flex-wrap gap-2 mb-2">
                      {((b as any).products || []).map((p: any, pi: number) => (
                        <span key={p.slug} className="flex items-center gap-1.5 text-xs bg-cream border border-bronze-600/20 rounded pl-1 pr-1.5 py-1">
                          {p.image_url && <img src={p.image_url} alt="" className="w-6 h-6 rounded object-cover" />}
                          <span className="max-w-[140px] truncate">{p.title.split('|')[0].trim()}</span>
                          <button className="text-red-600" onClick={() => patchBlock(i, { products: (b as any).products.filter((_: any, j: number) => j !== pi) })}>✕</button>
                        </span>
                      ))}
                      {!((b as any).products || []).length && <span className="text-xs text-ink-700/50">No products yet — search below (max 3).</span>}
                    </div>
                    <input value={pickerFor === i ? prodQ : ''} onFocus={() => { setPickerFor(i); setProdQ(''); setProdResults([]); }}
                      onChange={(e) => searchProducts(e.target.value)} placeholder="Search products by title…" className={inputCls} />
                    {pickerFor === i && prodResults.length > 0 && (
                      <div className="mt-1 border border-black/10 rounded bg-white divide-y divide-black/5 max-h-52 overflow-y-auto">
                        {prodResults.map((p) => (
                          <button key={p.slug} className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-cream disabled:opacity-40"
                            disabled={((b as any).products || []).length >= 3 || ((b as any).products || []).some((x: any) => x.slug === p.slug)}
                            onClick={() => { patchBlock(i, { products: [...((b as any).products || []), p] }); setProdQ(''); setProdResults([]); }}>
                            {p.image_url && <img src={p.image_url} alt="" className="w-8 h-8 rounded object-cover" />}
                            <span className="flex-1 truncate">{p.title.split('|')[0].trim()}</span>
                            <span className="text-bronze-700">${Number(p.price_usd).toFixed(2)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            <div className="flex flex-wrap gap-2">
              {(['text', 'image', 'button', 'products', 'divider'] as const).map((t) => (
                <button key={t} className="text-xs px-2.5 py-1.5 rounded border border-bronze-600/30 bg-white text-bronze-800 hover:bg-cream" onClick={() => addBlock(t)}>
                  + {t === 'text' ? 'Text' : t === 'image' ? 'Image' : t === 'button' ? 'Button' : t === 'products' ? 'Product grid' : 'Divider'}
                </button>
              ))}
            </div>
            <div className="flex gap-2 border-t border-black/10 pt-2">
              <button className={btnPrimary} onClick={saveOverride}>Save changes</button>
              {ovrSaved && <button className={btnGhost} onClick={resetOverride}>Reset to default</button>}
            </div>
          </div>
        )}
        {preview ? (
          <>
            <div className="text-xs text-ink-700/60 mb-2">Subject: <span className="text-ink-900 font-medium">{preview.subject}</span></div>
            <iframe title="email preview" srcDoc={preview.html} className="w-full bg-white border border-black/10 rounded-lg" style={{ height: 640 }} />
          </>
        ) : <div className="text-sm text-ink-700/60 py-10 text-center">Rendering preview…</div>}
      </Card>

      {/* ── Email performance (Resend webhook events) ─────────────── */}
      <Card>
        <div className="flex items-center gap-2 mb-2">
          <h3 className="font-medium text-ink-900 text-sm">📊 Email performance</h3>
          <button className={btnGhost + ' ml-auto'} onClick={loadEmailStats}>↻ Refresh</button>
        </div>
        {!emailStats || emailStats.total === 0 ? (
          <div className="text-xs text-ink-700/70 bg-cream/40 border border-bronze-600/15 rounded-lg px-3 py-2.5 leading-relaxed">
            No events yet. One-time setup: in the <b>Resend dashboard → Webhooks</b>, add endpoint
            <code className="mx-1 bg-white border border-black/10 rounded px-1.5 py-0.5">https://digitalchiselco.com/api/resend/webhook</code>
            with the <i>sent / delivered / opened / clicked / bounced / complained</i> events, then put the signing
            secret (whsec_…) into the Netlify env var <code className="bg-white border border-black/10 rounded px-1.5 py-0.5">RESEND_WEBHOOK_SECRET</code> and redeploy.
            From then on every email (weekly digest, drips, cart reminders, order confirmations…) reports deliveries, opens and clicks here.
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-ink-700/60 text-left">
                  <tr><th className="py-1.5">Email</th><th className="text-right">Sent</th><th className="text-right">Delivered</th><th className="text-right">Opened</th><th className="text-right">Clicked</th><th className="text-right">Open %</th><th className="text-right">Click %</th><th className="text-right">Bounced</th></tr>
                </thead>
                <tbody>
                  {emailStats.rows.map((r) => (
                    <tr key={r.kind} className="border-t border-black/5">
                      <td className="py-1.5">{KIND_LABELS[r.kind] || r.kind}</td>
                      <td className="text-right">{r.sent}</td>
                      <td className="text-right">{r.delivered}</td>
                      <td className="text-right">{r.opened}</td>
                      <td className="text-right">{r.clicked}</td>
                      <td className="text-right text-green-700">{r.openRate}%</td>
                      <td className="text-right text-bronze-700">{r.clickRate}%</td>
                      <td className={'text-right ' + (r.bounced ? 'text-red-600' : '')}>{r.bounced}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <details className="mt-3">
              <summary className="text-xs text-bronze-700 cursor-pointer select-none">Recent activity (last 25 events)</summary>
              <table className="w-full text-xs mt-2">
                <tbody>
                  {emailStats.recent.map((e, i) => (
                    <tr key={i} className="border-t border-black/5">
                      <td className="py-1 pr-2 text-ink-700/60 whitespace-nowrap">{new Date(e.created_at).toLocaleString()}</td>
                      <td className="pr-2">{e.email || '—'}</td>
                      <td className="pr-2">{KIND_LABELS[e.kind || '(untagged)'] || e.kind}</td>
                      <td className={({ opened: 'text-green-700', clicked: 'text-bronze-700', bounced: 'text-red-600', complained: 'text-red-600' } as any)[e.event] || 'text-ink-700/70'}>{e.event}{e.url ? ` → ${String(e.url).replace(/^https?:\/\/(www\.)?/, '').slice(0, 40)}` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
            <p className="text-[11px] text-ink-700/50 mt-2">Opens/clicks are unique per email. Opens undercount slightly (image blocking); clicks are exact.</p>
          </>
        )}
      </Card>
    </div>
  );
}

// ── Send hand-picked designs ─────────────────────────────────────────
// A customer asks "do you have X?" → search the catalog, pick a few designs,
// add a personal note, hit send. One branded email (logo + house template)
// straight to their inbox. Not a broadcast — one person at a time.
function PicksPanel() {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [picked, setPicked] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'info'; text: string }>({ kind: 'info', text: '' });

  async function tok(): Promise<string> {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || '';
  }

  useEffect(() => {
    const t = setTimeout(async () => {
      const term = q.trim();
      if (term.length < 2) { setResults([]); return; }
      const { data } = await supabase.from('products')
        .select('id, title, slug, price_usd, image_url')
        .eq('active', true).ilike('title', `%${term}%`)
        .order('is_bestseller', { ascending: false }).limit(8);
      setPicked((cur) => { setResults((data || []).filter((p: any) => !cur.some((x) => x.id === p.id))); return cur; });
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  function add(p: any) {
    if (picked.length >= 12) { setMsg({ kind: 'error', text: 'Max 12 designs per email.' }); return; }
    setPicked([...picked, p]); setResults(results.filter((r) => r.id !== p.id)); setQ('');
  }

  async function send() {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setMsg({ kind: 'error', text: 'Enter a valid recipient email.' }); return; }
    if (!picked.length) { setMsg({ kind: 'error', text: 'Pick at least one design.' }); return; }
    setBusy(true); setMsg({ kind: 'info', text: 'Sending…' });
    try {
      const res = await fetch('/api/admin/product-picks', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${await tok()}` },
        body: JSON.stringify({ email, name, note, product_ids: picked.map((p) => p.id) }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) setMsg({ kind: 'error', text: d.error || 'Send failed.' });
      else {
        setMsg({ kind: 'success', text: `✓ Sent ${d.sent} design${d.sent === 1 ? '' : 's'} to ${email}` });
        setPicked([]); setNote('');
      }
    } catch { setMsg({ kind: 'error', text: 'Network error.' }); }
    setBusy(false);
  }

  return (
    <Card>
      <div className="text-sm font-medium text-ink-900">🎯 Send hand-picked designs</div>
      <p className="text-xs text-ink-700/60 mt-0.5 mb-3">A customer asked for something specific? Search the catalog, pick the designs, add a personal note. They get one branded email with your logo and product cards.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Recipient email *" className={inputCls} />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Their first name (optional, used in the greeting)" className={inputCls} />
      </div>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000}
        placeholder='Personal note (optional) — e.g. "You asked about eagle designs, these carve beautifully at 12 inches."'
        className={inputCls + ' mb-2'} />
      <div className="relative">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Search the catalog by title…" className={inputCls} />
        {results.length > 0 && (
          <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-black/10 rounded-md shadow-lg max-h-72 overflow-y-auto">
            {results.map((p) => (
              <button key={p.id} onClick={() => add(p)} className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-cream text-left">
                {p.image_url && <img src={p.image_url} className="w-9 h-9 rounded object-cover flex-shrink-0" alt="" />}
                <span className="flex-1 text-xs text-ink-800 line-clamp-2">{String(p.title).split('|')[0].trim()}</span>
                <span className="text-xs text-bronze-700 whitespace-nowrap">${Number(p.price_usd).toFixed(2)}</span>
                <span className="text-bronze-600 text-sm">＋</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {picked.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {picked.map((p) => (
            <span key={p.id} className="inline-flex items-center gap-1.5 bg-cream border border-bronze-600/25 rounded-full pl-1 pr-2 py-0.5 text-xs text-ink-800">
              {p.image_url && <img src={p.image_url} className="w-5 h-5 rounded-full object-cover" alt="" />}
              <span className="max-w-[180px] truncate">{String(p.title).split('|')[0].trim()}</span>
              <button onClick={() => setPicked(picked.filter((x) => x.id !== p.id))} className="text-ink-700/40 hover:text-red-600" aria-label="Remove">✕</button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-3 mt-3">
        <button disabled={busy} onClick={send} className={btnPrimary}>{busy ? 'Sending…' : `Send ${picked.length || ''} design${picked.length === 1 ? '' : 's'} ✈`}</button>
        <Toast message={msg.text} kind={msg.kind} />
      </div>
    </Card>
  );
}
