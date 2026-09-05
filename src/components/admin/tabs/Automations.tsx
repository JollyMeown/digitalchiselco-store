import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { Card, btnPrimary, btnGhost, inputCls, Toast } from '../ui';
import { useLiveRefresh } from '../useLiveRefresh';
import ArticleEmails from '../ArticleEmails';
import FilmEmails from '../FilmEmails';
import CustomPitch from '../CustomPitch';

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
  { key: 'customPitch', label: 'Custom-design pitch (asked us to copy a design)', group: 'Etsy buyers' },
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
  useLiveRefresh(() => load(true), 30000);   // keep this tab live (silent, pauses while editing)
  useEffect(() => { loadPreview(kind); }, [kind]);

  async function load(_silent = false) {
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
      <CronHealth />
      <CronSchedule />
      <TodayEmailStats />
      <div className="text-xs text-ink-700/70 bg-cream/40 border border-bronze-600/15 rounded-lg px-3 py-2">
        🛡 <b>Review-first:</b> each system starts OFF — a <b>green</b> toggle means it's <b>ON</b>. Preview each email (right) and test-send it to yourself before enabling. The daily cron (08:00 UTC) does the actual sending, so the counters below stay at <b>0</b> until it next runs and there's activity to report — that's normal, not "off".
      </div>

      <ArticleEmails />

      <FilmEmails />
      <CustomPitch />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Toggle field="article_drip_enabled" label="Guide emails, one at a time"
          desc="Every published guide marked for the drip goes to every subscriber in turn, one every few days. New subscribers get them all automatically." />
        <Toggle field="film_drip_enabled" label="Film emails, one at a time"
          desc="Every Sawdust Cinema film marked for the drip goes to every subscriber in turn, one every few days. Nobody gets the same film twice, whichever route sent it." />
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
        <Toggle field="custom_pitch_enabled" label="Custom-design pitch drip"
          desc="One-time pitch to people added with 'Add to drip' in the Custom-design pitch card (source 'custom-ask'): originals from their own photo from $30, the /custom-design upload link, plus this week's designs. Never twice; 'Send now' shares the same ledger." />
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
        <Toggle field="owner_alerts_enabled" label="Instant alerts (to you)"
          desc="Emails YOU the moment things happen: 🎉 every paid order (with items), and 🛒 any cart worth $40+ the second the shopper types their email. One big-cart ping per shopper per day." />
        <Toggle field="design_scout_enabled" label="AI Design Scout (Mondays)"
          desc="Every Monday, AI reads 30 days of real demand (searches that found nothing, top searches, hot designs) and emails you 5 ranked NEW design ideas with the evidence for each. Costs well under a cent per week." />
      </div>

      <PicksPanel />

      <TelegramTest />

      <WeeklyTracker />

      <SendLog />

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

// ── Telegram alerts: setup helper + one-tap test. ────────────────────
// Pushes free instant alerts to the owner's phone. This card just verifies
// the env vars are set; the actual sends live in the webhook + cart-note.
function TelegramTest() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'info'; text: string }>({ kind: 'info', text: '' });

  async function test() {
    setBusy(true); setMsg({ kind: 'info', text: 'Sending…' });
    try {
      const { data } = await supabase.auth.getSession();
      const res = await fetch('/api/admin/test-telegram', {
        method: 'POST', headers: { authorization: `Bearer ${data.session?.access_token || ''}` },
      });
      const d = await res.json();
      setMsg({ kind: d.ok ? 'success' : 'error', text: d.ok ? d.message : (d.error || 'Failed.') });
    } catch { setMsg({ kind: 'error', text: 'Network error.' }); }
    setBusy(false);
  }

  return (
    <Card>
      <div className="text-sm font-medium text-ink-900">📱 Telegram alerts on your phone (free)</div>
      <p className="text-xs text-ink-700/60 mt-0.5 mb-2">Get a phone ping for every new order and big cart, in addition to email. One-time setup, then tap Test.</p>
      <ol className="text-xs text-ink-700/80 space-y-1 list-decimal ml-4 mb-3">
        <li>In Telegram, open <b>@BotFather</b> → send <code>/newbot</code> → pick a name → copy the <b>token</b> it gives you.</li>
        <li>Open <b>@userinfobot</b> and send it anything → it replies with your numeric <b>Id</b> (that's your chat ID).</li>
        <li>Open the bot <b>you just made</b> and send it any message (so it's allowed to message you back).</li>
        <li>In Netlify → Site settings → Environment variables, add <code>TELEGRAM_BOT_TOKEN</code>, <code>TELEGRAM_CHAT_ID</code> and <code>TELEGRAM_WEBHOOK_SECRET</code> (any long random string, 32+ characters), then redeploy.</li>
        <li>Come back here: tap <b>Send test</b> for alerts, then <b>Enable commands</b> for the two-way bot 👇</li>
      </ol>
      <div className="flex items-center gap-3 flex-wrap">
        <button disabled={busy} onClick={test} className={btnPrimary}>{busy ? 'Sending…' : 'Send test to my Telegram'}</button>
        <button disabled={busy} onClick={register} className={btnGhost}>{busy ? '…' : '⚡ Enable commands (/stats /last /cron…)'}</button>
        <Toast message={msg.text} kind={msg.kind} />
      </div>
      <p className="text-[11px] text-ink-700/50 mt-2">Two-way commands: <code>/stats</code> today's numbers · <code>/last</code> latest orders · <code>/pending</code> weekly digest delivery + open carts · <code>/cron</code> nightly automation health · <code>/scout</code> · <code>/help</code>. Only your chat ID is answered.</p>
    </Card>
  );

  async function register() {
    setBusy(true); setMsg({ kind: 'info', text: 'Registering webhook with Telegram…' });
    try {
      const { data } = await supabase.auth.getSession();
      const res = await fetch('/api/admin/telegram-register', {
        method: 'POST', headers: { authorization: `Bearer ${data.session?.access_token || ''}` },
      });
      const d = await res.json();
      setMsg({ kind: d.ok ? 'success' : 'error', text: d.ok ? d.message : (d.error || 'Failed.') });
    } catch { setMsg({ kind: 'error', text: 'Network error.' }); }
    setBusy(false);
  }
}

// ── Email send log — the ledger of EVERY email the site has sent. ─────
// Written by src/lib/resend.ts at send time (all kinds), so this is the
// authoritative "what went out, to whom, when" record. Filter by kind or
// recipient; per-kind totals for the chosen range up top.
function SendLog() {
  const [rows, setRows] = useState<any[]>([]);
  const [days, setDays] = useState(7);
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const since = new Date(Date.now() - days * 86400000).toISOString();
      let qb = supabase.from('email_send_log').select('sent_at, kind, week, recipient, subject, status, error, batch_key')
        .gte('sent_at', since).order('sent_at', { ascending: false }).limit(2000);
      if (kind) qb = qb.eq('kind', kind);
      if (q.trim()) qb = qb.ilike('recipient', `%${q.trim()}%`);
      const { data } = await qb;
      setRows(data || []); setLoading(false);
    })();
  }, [days, kind, q]);

  const byKind: Record<string, { sent: number; failed: number }> = {};
  for (const r of rows) { const k = r.kind || '(untagged)'; (byKind[k] ||= { sent: 0, failed: 0 }); if (r.status === 'sent') byKind[k].sent++; else if (r.status === 'failed') byKind[k].failed++; }
  const kinds = Object.keys(byKind).sort();
  const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="text-sm font-bold text-ink-900">📬 Email send log</div>
        <span className="text-[11px] text-ink-700/50">every email the site sends, recorded at the moment of sending</span>
        <div className="ml-auto flex flex-wrap gap-1 items-center">
          {[1, 7, 30, 90].map((d) => (
            <button key={d} onClick={() => setDays(d)} className={`text-xs px-2 py-1 rounded ${days === d ? 'bg-bronze-600 text-cream' : 'bg-cream text-ink-700'}`}>{d === 1 ? 'Today' : d + 'd'}</button>
          ))}
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="text-xs border border-black/15 rounded px-2 py-1 bg-white">
            <option value="">All kinds</option>
            {kinds.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search recipient…" className="text-xs border border-black/15 rounded px-2 py-1 w-44" />
        </div>
      </div>
      {loading ? <p className="text-xs text-ink-700/50">Loading…</p> : rows.length === 0 ? (
        <p className="text-xs text-ink-700/50">No emails logged in this range yet. (The ledger starts recording from this deploy onward; older sends live in the "Email performance" panel above via Resend's webhooks.)</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 mb-3">
            {kinds.map((k) => (
              <button key={k} onClick={() => setKind(kind === k ? '' : k)}
                className={`text-xs px-2.5 py-1 rounded-full border ${kind === k ? 'bg-bronze-600 text-cream border-bronze-600' : 'bg-cream/60 border-bronze-600/15 text-ink-800 hover:border-bronze-600/40'}`}>
                <b>{k}</b> · {byKind[k].sent} sent{byKind[k].failed ? <span className="text-red-600"> · {byKind[k].failed} failed</span> : ''}
              </button>
            ))}
          </div>
          <div className="max-h-[420px] overflow-y-auto border border-black/10 rounded-lg">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-cream/90 text-left text-ink-700/60">
                <tr><th className="p-2">When</th><th className="p-2">Kind</th><th className="p-2">Recipient</th><th className="p-2">Subject</th><th className="p-2">Status</th></tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t border-black/5 hover:bg-cream/30">
                    <td className="p-2 whitespace-nowrap text-ink-700/70">{fmt(r.sent_at)}</td>
                    <td className="p-2 whitespace-nowrap font-medium text-bronze-800">{r.kind || '—'}{r.week ? <span className="text-ink-700/40 font-normal"> · {r.week}</span> : ''}</td>
                    <td className="p-2 text-ink-800">{r.recipient}</td>
                    <td className="p-2 text-ink-700/70 max-w-[320px] truncate" title={r.subject || ''}>{r.subject || '—'}</td>
                    <td className="p-2 whitespace-nowrap">
                      {r.status === 'sent' ? <span className="text-green-700">✓ sent</span> : r.status === 'failed' ? <span className="text-red-600" title={r.error || ''}>✕ failed</span> : <span className="text-ink-700/50">skipped</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-ink-700/50 mt-2">Showing {rows.length.toLocaleString()} rows{rows.length >= 2000 ? ' (first 2,000 — narrow the filters for more)' : ''}.</p>
        </>
      )}
    </Card>
  );
}

// ── Cron heartbeat — is the nightly automation actually running? ─────
// ── Today's email sends — every type, in bold, live. ─────────────────
// Reads email_send_log for the current UTC day and breaks it down by kind so
// the owner can see at a glance exactly what went out today and whether any
// send failed. Numbers are bold per the owner's request.
const EMAIL_KIND_LABELS: Record<string, string> = {
  'order': 'Order confirmations', 'gift': 'Gift deliveries', 'auth': 'Sign-in links',
  'optin': 'Opt-in confirmations', 'resendLibrary': 'Library re-sends', 'payRecovery': 'Payment recovery',
  'portalGuide': 'Portal guide', 'weekly-digest': 'Weekly digest', 'drip1': 'Nurture drip 1',
  'drip2': 'Nurture drip 2', 'drip3': 'Nurture drip 3', 'drip4': 'Nurture drip 4', 'drip5': 'Nurture drip 5',
  'drip6': 'Finishing guide (old drip)', 'guideCampaign': 'Finishing guide broadcast', 'articleDrip': 'Guide drip', 'articleCampaign': 'Guide broadcast',
  'cartSave': 'Cart reminders', 'browse': 'Browse reminders', 'winback': 'Win-back',
  'priceDrop': 'Price-drop alerts', 'referralNudge': 'Referral nudges', 'etsyWelcome': 'Etsy welcome',
  'wishlistReminder': 'Wishlist reminders', 'refundWinback': 'Refund win-back', 'picks': 'Hand-picked designs',
  'ownerReport': 'Owner report', 'designScout': 'Design scout', '(untagged)': 'Other',
};
type Light = { state: 'green' | 'amber' | 'red'; label: string; detail: string };
function TodayEmailStats() {
  const [rows, setRows] = useState<{ kind: string; sent: number; failed: number }[] | null>(null);
  const [tot, setTot] = useState({ sent: 0, failed: 0, lastFailErr: '' });
  const [cfg, setCfg] = useState<{ cap: number; reserve: number; monthCap: number } | null>(null);
  const [edit, setEdit] = useState<{ cap: number; reserve: number; monthCap: number } | null>(null);
  const [monthSent, setMonthSent] = useState(0);
  const [saving, setSaving] = useState(false);
  const [lights, setLights] = useState<Light[]>([]);

  const load = async () => {
    const today = new Date().toISOString().slice(0, 10);
    const [{ data: sends }, { data: gs }, { data: runs }, { data: weeks }] = await Promise.all([
      supabase.from('email_send_log').select('kind, status, error, sent_at').gte('sent_at', today + 'T00:00:00Z').limit(20000),
      supabase.from('growth_settings').select('email_daily_cap, email_daily_reserve, email_monthly_cap').eq('id', 1).maybeSingle(),
      supabase.from('cron_runs').select('ran_at, ok, error').order('ran_at', { ascending: false }).limit(1),
      supabase.from('weekly_digest_log').select('week_key, queued_count, last_drain_at').order('week_key', { ascending: false }).limit(1),
    ]);
    const agg: Record<string, { sent: number; failed: number }> = {};
    let s = 0, f = 0, lastFailErr = '';
    for (const r of sends || []) {
      const k = r.kind || '(untagged)';
      agg[k] = agg[k] || { sent: 0, failed: 0 };
      if (r.status === 'sent') { agg[k].sent++; s++; }
      else if (r.status === 'failed') { agg[k].failed++; f++; if (r.error) lastFailErr = r.error; }
    }
    setRows(Object.entries(agg).map(([kind, v]) => ({ kind, ...v })).sort((a, b) => (b.sent + b.failed) - (a.sent + a.failed)));
    setTot({ sent: s, failed: f, lastFailErr });
    const cap = Number(gs?.email_daily_cap) || 180;
    const reserve = Number(gs?.email_daily_reserve) ?? 20;
    const monthCap = Number(gs?.email_monthly_cap) || 3000;
    setCfg({ cap, reserve, monthCap });
    setEdit((e) => e || { cap, reserve, monthCap });
    // month-to-date sends (for the monthly plan-quota light)
    const monthStart = today.slice(0, 7) + '-01';
    const { count: mSent } = await supabase.from('email_send_log').select('id', { count: 'exact', head: true }).eq('status', 'sent').gte('sent_at', monthStart + 'T00:00:00Z');
    setMonthSent(mSent || 0);

    // ── Status lights: catch issues + say what's happening ──
    const L: Light[] = [];
    // 1. failures today
    if (f > 0) L.push({ state: 'red', label: `${f} email${f === 1 ? '' : 's'} failed today`, detail: lastFailErr ? `Last error: ${lastFailErr.slice(0, 120)}` : 'Check the send log below.' });
    else L.push({ state: 'green', label: 'No send failures today', detail: `${s} email${s === 1 ? '' : 's'} delivered successfully so far.` });
    // 2. weekly digest progress
    const wk = weeks?.[0];
    if (wk) {
      const [{ count: pending }, { count: stuck }, { count: sentW }] = await Promise.all([
        supabase.from('weekly_send_queue').select('email', { count: 'exact', head: true }).eq('week_key', wk.week_key).eq('status', 'pending'),
        supabase.from('weekly_send_queue').select('email', { count: 'exact', head: true }).eq('week_key', wk.week_key).eq('status', 'pending').gte('attempts', 5),
        supabase.from('weekly_send_queue').select('email', { count: 'exact', head: true }).eq('week_key', wk.week_key).eq('status', 'sent'),
      ]);
      const marketingPerDay = Math.max(1, cap - reserve);
      if ((pending || 0) === 0) L.push({ state: 'green', label: `Weekly digest ${wk.week_key} fully delivered`, detail: `${sentW || 0} of ${wk.queued_count || sentW} sent.` });
      else if ((stuck || 0) > 0) L.push({ state: 'red', label: `${stuck} recipient${stuck === 1 ? '' : 's'} stuck on the weekly digest`, detail: `Failed 5+ times — needs a look (see the tracker below). ${pending} still pending overall.` });
      else {
        const days = Math.ceil((pending || 0) / marketingPerDay);
        L.push({ state: 'amber', label: `Weekly digest sending: ${sentW || 0} done, ${pending} to go`, detail: `At ${marketingPerDay}/day this finishes in ~${days} day${days === 1 ? '' : 's'}. Raise the daily cap to go faster.` });
      }
    }
    // 3. today's budget
    const left = Math.max(0, cap - reserve - s);
    if (left === 0) L.push({ state: 'amber', label: "Today's marketing budget is used up", detail: `Buyer emails still send (the ${reserve} reserve). Marketing resumes at 00:00 UTC.` });
    // 3b. monthly plan quota
    {
      const pct = Math.round(((mSent || 0) / monthCap) * 100);
      if (pct >= 100) L.push({ state: 'red', label: `Monthly email quota reached (${mSent}/${monthCap})`, detail: 'Marketing is paused until the 1st; buyer emails keep sending. Raise the monthly cap after upgrading Resend.' });
      else if (pct >= 80) L.push({ state: 'amber', label: `Monthly email quota ${pct}% used (${mSent}/${monthCap})`, detail: 'Approaching the Resend plan limit for this month.' });
    }
    // 4. nightly cron
    const last = runs?.[0];
    const ageH = last ? (Date.now() - Date.parse(last.ran_at)) / 3600000 : Infinity;
    if (!last || ageH > 26) L.push({ state: 'red', label: 'Nightly automation overdue', detail: last ? `Last ran ${Math.round(ageH)}h ago.` : 'Has never run.' });
    else if (last.ok === false) L.push({ state: 'red', label: 'Last nightly run FAILED', detail: (last.error || '').slice(0, 120) });
    setLights(L);
  };
  useEffect(() => { load(); }, []);
  useLiveRefresh(load, 30000);
  if (!rows || !cfg || !edit) return null;

  async function saveThrottle() {
    if (!edit) return;
    const cap = Math.max(20, Math.round(edit.cap));
    const reserve = Math.min(cap, Math.max(0, Math.round(edit.reserve)));
    const monthCap = Math.max(100, Math.round(edit.monthCap));
    setSaving(true);
    await supabase.from('growth_settings').update({ email_daily_cap: cap, email_daily_reserve: reserve, email_monthly_cap: monthCap }).eq('id', 1);
    setCfg({ cap, reserve, monthCap }); setEdit({ cap, reserve, monthCap }); setSaving(false);
    load();
  }

  const marketingLeft = Math.max(0, cfg.cap - cfg.reserve - tot.sent);
  const label = (k: string) => EMAIL_KIND_LABELS[k] || k;
  const dot: Record<string, string> = { green: 'bg-green-500', amber: 'bg-amber-500', red: 'bg-red-500 animate-pulse' };
  const dirty = edit.cap !== cfg.cap || edit.reserve !== cfg.reserve || edit.monthCap !== cfg.monthCap;
  const worst = lights.some((l) => l.state === 'red') ? 'red' : lights.some((l) => l.state === 'amber') ? 'amber' : 'green';

  return (
    <Card>
      <div className="flex items-baseline gap-2 mb-3 flex-wrap">
        <span className={`inline-block w-2.5 h-2.5 rounded-full ${dot[worst]}`} />
        <div className="text-sm font-bold text-ink-900">📧 Email sending — status &amp; today's activity</div>
        <span className="text-[11px] text-ink-700/50">updates live</span>
      </div>

      {/* Green/red status lights */}
      <div className="space-y-1.5 mb-4">
        {lights.map((l, i) => (
          <div key={i} className={`flex items-start gap-2 rounded-md border px-3 py-2 ${l.state === 'red' ? 'bg-red-50 border-red-200' : l.state === 'amber' ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'}`}>
            <span className={`mt-1 inline-block w-2 h-2 rounded-full flex-shrink-0 ${dot[l.state]}`} />
            <div className="min-w-0">
              <div className={`text-sm font-bold ${l.state === 'red' ? 'text-red-800' : l.state === 'amber' ? 'text-amber-800' : 'text-green-800'}`}>{l.label}</div>
              <div className="text-xs text-ink-700/70">{l.detail}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Bold stat tiles */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-2.5 min-w-[110px]">
          <div className="text-[10px] uppercase tracking-wide text-green-700/70 font-medium">Sent today</div>
          <div className="text-2xl font-extrabold text-green-800 leading-tight">{tot.sent}</div>
        </div>
        <div className={`rounded-lg border px-4 py-2.5 min-w-[110px] ${tot.failed ? 'border-red-300 bg-red-50' : 'border-black/10 bg-cream/40'}`}>
          <div className={`text-[10px] uppercase tracking-wide font-medium ${tot.failed ? 'text-red-700/70' : 'text-ink-700/50'}`}>Failed today</div>
          <div className={`text-2xl font-extrabold leading-tight ${tot.failed ? 'text-red-700' : 'text-ink-700/60'}`}>{tot.failed}</div>
        </div>
        <div className="rounded-lg border border-bronze-600/20 bg-cream/40 px-4 py-2.5 min-w-[150px]">
          <div className="text-[10px] uppercase tracking-wide text-ink-700/50 font-medium">Marketing budget left today</div>
          <div className="text-2xl font-extrabold text-bronze-800 leading-tight">{marketingLeft}<span className="text-sm font-medium text-ink-700/50"> / {cfg.cap - cfg.reserve}</span></div>
        </div>
        <div className={`rounded-lg border px-4 py-2.5 min-w-[150px] ${monthSent >= cfg.monthCap ? 'border-red-300 bg-red-50' : 'border-bronze-600/20 bg-cream/40'}`}>
          <div className="text-[10px] uppercase tracking-wide text-ink-700/50 font-medium">Sent this month (plan quota)</div>
          <div className={`text-2xl font-extrabold leading-tight ${monthSent >= cfg.monthCap ? 'text-red-700' : 'text-bronze-800'}`}>{monthSent}<span className="text-sm font-medium text-ink-700/50"> / {cfg.monthCap}</span></div>
        </div>
      </div>

      {/* Admin-editable cap + reserve */}
      <div className="rounded-lg border border-bronze-600/15 bg-cream/30 px-3 py-3 mb-4">
        <div className="text-xs font-bold text-ink-900 mb-1">⚙️ Daily email limits (you control these)</div>
        <p className="text-[11px] text-ink-700/60 mb-2.5">
          <b>Daily cap</b> = the most emails the site sends in one day (keep it under your Resend plan's real limit; about 200/day works today).
          <b> Buyer reserve</b> = how many of those to always hold back for order confirmations &amp; sign-in links, so a big newsletter can never block a paying customer.
          <b> Monthly cap</b> = your Resend plan's monthly quota (free = 3,000; Pro $20 = 50,000) — marketing stops there so you never pay surprise overage; buyer emails still send.
          Everything else (newsletters, drips) shares <b>cap − reserve = {edit.cap - edit.reserve}</b> per day.
          After upgrading to Resend Pro, set: daily cap ~1,600, monthly cap 50,000.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="text-[10px] uppercase tracking-wide text-ink-700/50 font-medium">Daily cap</span>
            <input type="number" min={20} max={5000} value={edit.cap} onChange={(e) => setEdit({ ...edit, cap: Number(e.target.value) })} className={inputCls + ' w-28'} />
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-wide text-ink-700/50 font-medium">Buyer reserve</span>
            <input type="number" min={0} max={edit.cap} value={edit.reserve} onChange={(e) => setEdit({ ...edit, reserve: Number(e.target.value) })} className={inputCls + ' w-28'} />
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-wide text-ink-700/50 font-medium">Monthly cap (plan quota)</span>
            <input type="number" min={100} max={2000000} step={100} value={edit.monthCap} onChange={(e) => setEdit({ ...edit, monthCap: Number(e.target.value) })} className={inputCls + ' w-32'} />
          </label>
          <div className="text-xs text-ink-700/60 pb-2">→ <b className="text-bronze-800">{Math.max(0, edit.cap - edit.reserve)}</b> for newsletters/day</div>
          <button className={dirty ? btnPrimary : btnGhost} disabled={saving || !dirty} onClick={saveThrottle}>{saving ? 'Saving…' : dirty ? 'Save limits' : 'Saved'}</button>
        </div>
      </div>

      {/* Per-type breakdown */}
      <div className="text-xs font-bold text-ink-900 mb-1.5">Sent today by type</div>
      {rows.length === 0 ? (
        <p className="text-xs text-ink-700/50">No emails sent yet today.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1.5">
          {rows.map((r) => (
            <div key={r.kind} className="flex items-baseline justify-between border-b border-black/5 py-1">
              <span className="text-sm text-ink-800">{label(r.kind)}</span>
              <span className="text-sm">
                <b className="text-ink-900">{r.sent}</b>
                {r.failed > 0 && <b className="text-red-600 ml-1.5">· {r.failed} failed</b>}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ── Nightly automation firing time (admin-controlled) ────────────────
// Netlify bakes a scheduled function's cron into code, so daily-drop.mjs
// ticks hourly and fires only when the hour in cron_tz equals
// cron_local_hour. Storing a LOCAL hour + zone (not a UTC hour) keeps
// "10am New York" correct across US daylight-saving changes.
const US_ZONES: [string, string][] = [
  ['America/New_York', 'US Eastern (New York)'],
  ['America/Chicago', 'US Central (Chicago)'],
  ['America/Denver', 'US Mountain (Denver)'],
  ['America/Los_Angeles', 'US Pacific (Los Angeles)'],
];
const PK_ZONE = 'Asia/Karachi';
// The UTC instant of today's <hour> in <tz>, so we can translate to any zone.
function instantFor(tz: string, hour: number): Date {
  const probe = new Date();
  probe.setUTCMinutes(0, 0, 0);
  for (let h = 0; h < 48; h++) {
    const cand = new Date(probe.getTime() + (h - 24) * 3600000);
    const there = Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hour12: false }).format(cand));
    if (there === hour) return cand;
  }
  return probe;
}
const inZone = (d: Date, tz: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
const hour12 = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? 'AM' : 'PM'}`;

// ── When Americans actually visit AND buy, by hour ───────────────────
// Ranks by BUYING INTENT (add-to-cart / buy-now / wishlist / checkout), not
// raw pageviews: a 00:00-01:00 ET spike of 228 visits produced ZERO cart adds
// (scraper-like), while 09:00-10:00 ET produced 8 from far fewer visits.
// Ranking on views alone would have scheduled the daily send for 1 AM.
// Falls back to unique visitors only while intent data is still sparse, and
// never recommends outside a sane 6 AM - 10 PM send window.
type PeakRow = { hour: number; visitors: number; visits: number; actions: number };
const RANGES: [string, number][] = [['7 days', 7], ['30 days', 30], ['90 days', 90], ['1 year', 365]];
const SEND_WINDOW = [6, 22] as const;   // never suggest the middle of the night

function UsPeakHours({ tz, scheduledHour, onApply }: { tz: string; scheduledHour: number; onApply: (h: number) => void }) {
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState<PeakRow[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let dead = false;
    setRows(null); setErr('');
    supabase.rpc('us_visit_hours', { p_days: days, p_tz: tz }).then(({ data, error }) => {
      if (dead) return;
      if (error) { setErr(error.message); setRows([]); return; }
      const byHour = new Map<number, PeakRow>((data || []).map((d: any) => [Number(d.hour), {
        hour: Number(d.hour), visitors: Number(d.visitors) || 0, visits: Number(d.visits) || 0, actions: Number(d.actions) || 0,
      }]));
      setRows(Array.from({ length: 24 }, (_, h) => byHour.get(h) || { hour: h, visitors: 0, visits: 0, actions: 0 }));
    });
    return () => { dead = true; };
  }, [days, tz]);

  if (!rows) return <div className="mt-3 text-xs text-ink-700/50">Loading US activity…</div>;

  const totalActions = rows.reduce((s, r) => s + r.actions, 0);
  const usingIntent = totalActions >= 8;             // enough signal to trust
  const score = (r: PeakRow) => (usingIntent ? r.actions : r.visitors);
  // 3-hour smoothing: people open mail over a window, and it stops one freak
  // hour from winning.
  const smooth = rows.map((_, i) =>
    score(rows[(i + 23) % 24]) * 0.5 + score(rows[i]) + score(rows[(i + 1) % 24]) * 0.5);
  let best = -1, bestScore = -1;
  for (let h = SEND_WINDOW[0]; h <= SEND_WINDOW[1]; h++) {
    if (smooth[h] > bestScore) { bestScore = smooth[h]; best = h; }
  }
  const maxV = Math.max(1, ...rows.map((r) => r.visitors));
  const maxA = Math.max(1, ...rows.map((r) => r.actions));
  const bestAt = best >= 0 ? instantFor(tz, best) : null;
  const hasData = rows.some((r) => r.visitors > 0);

  return (
    <div className="mt-4 rounded-lg border border-bronze-600/15 bg-white/60 px-3 py-3">
      <div className="flex items-baseline gap-2 flex-wrap mb-2">
        <div className="text-xs font-bold text-ink-900">📊 When Americans visit and buy</div>
        <span className="text-[11px] text-ink-700/50">hours shown in {US_ZONES.find(([z]) => z === tz)?.[1] || tz}</span>
        <div className="ml-auto flex gap-1">
          {RANGES.map(([label, d]) => (
            <button key={d} onClick={() => setDays(d)}
              className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${days === d ? 'bg-bronze-600 text-cream' : 'bg-cream text-ink-700 hover:bg-bronze-600/10'}`}>{label}</button>
          ))}
        </div>
      </div>

      {err && <div className="text-[11px] text-red-700 mb-2">Could not load activity: {err}</div>}
      {!hasData && !err && <div className="text-[11px] text-ink-700/50 mb-2">No US visits recorded in this range yet.</div>}

      {/* 24-hour chart: pale bar = visitors, solid bar = buying actions */}
      <div className="flex items-end gap-[3px] h-24">
        {rows.map((r) => {
          const isBest = r.hour === best;
          const isNow = r.hour === scheduledHour;
          return (
            <div key={r.hour} className="flex-1 flex flex-col justify-end items-center h-full group relative"
              title={`${hour12(r.hour)} · ${r.visitors} visitors · ${r.actions} cart/wishlist actions`}>
              <div className="w-full flex flex-col justify-end items-center h-full">
                <div className="w-full rounded-t-sm bg-bronze-600/20" style={{ height: `${(r.visitors / maxV) * 70}%` }} />
                <div className={`w-full ${isBest ? 'bg-green-600' : 'bg-bronze-700'}`} style={{ height: `${(r.actions / maxA) * 30}%` }} />
              </div>
              <div className={`text-[8px] mt-0.5 leading-none ${isBest ? 'text-green-700 font-bold' : isNow ? 'text-bronze-700 font-bold' : 'text-ink-700/40'}`}>
                {r.hour % 3 === 0 ? r.hour : ''}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-ink-700/55 mt-1.5">
        <span><span className="inline-block w-2 h-2 rounded-sm bg-bronze-600/20 align-middle" /> visitors</span>
        <span><span className="inline-block w-2 h-2 rounded-sm bg-bronze-700 align-middle" /> cart / wishlist actions</span>
        <span><span className="inline-block w-2 h-2 rounded-sm bg-green-600 align-middle" /> suggested hour</span>
        <span className="text-ink-700/40">hour labels are 24-hour, every 3rd shown</span>
      </div>

      {best >= 0 && bestAt && hasData && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs border-t border-black/5 pt-2.5">
          <span>
            Best in this range: <b className="text-green-700">{hour12(best)}</b>
            <span className="text-ink-700/50"> ({inZone(bestAt, PK_ZONE)} Pakistan)</span>
            <span className="text-ink-700/45"> · ranked by {usingIntent ? `buying actions (${totalActions} in range)` : 'unique visitors (too few cart actions yet)'}</span>
          </span>
          {best !== scheduledHour
            ? <button className={btnGhost + ' ml-auto'} onClick={() => onApply(best)}>Use {hour12(best)} →</button>
            : <span className="ml-auto text-green-700 font-medium">✓ already scheduled</span>}
        </div>
      )}
    </div>
  );
}

function CronSchedule() {
  const [tz, setTz] = useState('America/New_York');
  const [hour, setHour] = useState(10);
  const [saved, setSaved] = useState<{ tz: string; hour: number } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    supabase.from('growth_settings').select('cron_tz, cron_local_hour').eq('id', 1).maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        const z = data.cron_tz || 'America/New_York';
        const h = Number.isFinite(Number(data.cron_local_hour)) ? Number(data.cron_local_hour) : 10;
        setTz(z); setHour(h); setSaved({ tz: z, hour: h });
      });
  }, []);
  if (!saved) return null;
  const at = instantFor(tz, hour);
  const dirty = tz !== saved.tz || hour !== saved.hour;
  async function save() {
    setBusy(true);
    await supabase.from('growth_settings').update({ cron_tz: tz, cron_local_hour: hour }).eq('id', 1);
    setSaved({ tz, hour }); setBusy(false);
  }
  return (
    <Card>
      <div className="flex items-baseline gap-2 mb-2 flex-wrap">
        <div className="text-sm font-bold text-ink-900">⏰ When automations run each day</div>
        <span className="text-[11px] text-ink-700/50">emails go out at this time · change takes effect the same day</span>
      </div>
      <p className="text-[11px] text-ink-700/60 mb-3">
        Pick the time in <b>US time</b> (most of your visitors and buyers are American). The matching
        <b> Pakistan time</b> is shown so you know when to expect it. Daylight-saving is handled
        automatically, so your US send time never drifts.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-[10px] uppercase tracking-wide text-ink-700/50 font-medium">US time zone</span>
          <select value={tz} onChange={(e) => setTz(e.target.value)} className={inputCls + ' w-56'}>
            {US_ZONES.map(([z, label]) => <option key={z} value={z}>{label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-wide text-ink-700/50 font-medium">Hour</span>
          <select value={hour} onChange={(e) => setHour(Number(e.target.value))} className={inputCls + ' w-32'}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hour12(h)}</option>)}
          </select>
        </label>
        <button className={dirty ? btnPrimary : btnGhost} disabled={busy || !dirty} onClick={save}>
          {busy ? 'Saving…' : dirty ? 'Save time' : 'Saved'}
        </button>
      </div>
      <UsPeakHours tz={tz} scheduledHour={hour} onApply={(h) => setHour(h)} />
      <div className="mt-3 rounded-lg border border-bronze-600/15 bg-cream/40 px-3 py-2.5 text-sm">
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          <span>🇺🇸 <b className="text-bronze-800">{inZone(at, tz)}</b> <span className="text-[11px] text-ink-700/50">{US_ZONES.find(([z]) => z === tz)?.[1]}</span></span>
          <span>🇵🇰 <b className="text-bronze-800">{inZone(at, PK_ZONE)}</b> <span className="text-[11px] text-ink-700/50">Pakistan</span></span>
          <span className="text-ink-700/60">= {String(at.getUTCHours()).padStart(2, '0')}:00 UTC</span>
        </div>
        <div className="text-[11px] text-ink-700/50 mt-1.5">
          Other US zones then: {US_ZONES.filter(([z]) => z !== tz).map(([z, l]) => `${inZone(at, z)} ${l.replace(/^US /, '').replace(/ \(.*\)$/, '')}`).join(' · ')}
        </div>
      </div>
    </Card>
  );
}

// Shows the last run + a warning if it's overdue (>26h). Reads cron_runs,
// which /api/cron/daily writes on every invocation.
function CronHealth() {
  const [runs, setRuns] = useState<any[] | null>(null);
  useEffect(() => {
    supabase.from('cron_runs').select('ran_at, ok, duration_ms, error, summary').order('ran_at', { ascending: false }).limit(7)
      .then(({ data }) => setRuns(data || []));
  }, []);
  if (!runs) return null;
  const last = runs[0];
  const ageH = last ? (Date.now() - Date.parse(last.ran_at)) / 3600000 : Infinity;
  const overdue = !last || ageH > 26;
  const g = last?.summary?.growth || {};
  const line = last ? Object.entries(g).filter(([, v]) => v && v !== 'off').slice(0, 8).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ') : '';
  return (
    <div className={`rounded-lg border px-3 py-2 text-xs ${overdue ? 'bg-red-50 border-red-200 text-red-800' : 'bg-green-50 border-green-200 text-green-800'}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-base" aria-hidden="true">{overdue ? '🔴' : '🟢'}</span>
        <b>Nightly automation {overdue ? (last ? `OVERDUE — last ran ${Math.round(ageH)}h ago` : 'has NEVER run') : `healthy — last ran ${Math.round(ageH * 60) < 90 ? Math.round(ageH * 60) + ' min' : Math.round(ageH) + 'h'} ago`}</b>
        {last && <span className="opacity-70">({last.ok ? 'ok' : 'FAILED: ' + (last.error || '')} · {Math.round((last.duration_ms || 0) / 1000)}s · runs on record: {runs.length})</span>}
      </div>
      {last?.ok && line && <div className="mt-1 opacity-80 truncate" title={line}>{line}</div>}
      {overdue && <div className="mt-1">Scheduled 08:00 UTC daily via Netlify. If this stays red past 09:00 UTC, check Netlify → Functions → daily-drop logs.</div>}
    </div>
  );
}

// ── Weekly digest delivery tracker — every recipient, every week. ────
// Reads weekly_digest_log (per week: designs, queued, sent, drain state) +
// weekly_send_queue (per person: pending/sent/failed, attempts, last error).
// The daily cron drains pending rows automatically; this shows exactly
// where each week stands and who, if anyone, is still waiting.
function WeeklyTracker() {
  const [weeks, setWeeks] = useState<any[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [filter, setFilter] = useState<'all' | 'pending' | 'sent' | 'failed'>('all');
  const [q, setQ] = useState('');

  useEffect(() => {
    (async () => {
      const { data: logs } = await supabase.from('weekly_digest_log').select('*').order('week_key', { ascending: false }).limit(12);
      const out: any[] = [];
      for (const w of logs || []) {
        const [{ count: pending }, { count: sent }, { count: failed }] = await Promise.all([
          supabase.from('weekly_send_queue').select('email', { count: 'exact', head: true }).eq('week_key', w.week_key).eq('status', 'pending'),
          supabase.from('weekly_send_queue').select('email', { count: 'exact', head: true }).eq('week_key', w.week_key).eq('status', 'sent'),
          supabase.from('weekly_send_queue').select('email', { count: 'exact', head: true }).eq('week_key', w.week_key).gte('attempts', 5).eq('status', 'pending'),
        ]);
        out.push({ ...w, pending: pending || 0, sent: sent || 0, stuck: failed || 0 });
      }
      setWeeks(out);
      if (out.length && !open) setOpen(out[0].week_key);
    })();
  }, []);

  useEffect(() => {
    if (!open) return;
    (async () => {
      let qb = supabase.from('weekly_send_queue').select('email, status, attempts, last_error, queued_at, sent_at').eq('week_key', open).order('status').order('email').limit(2000);
      if (filter !== 'all') qb = filter === 'failed' ? qb.gte('attempts', 5) : qb.eq('status', filter);
      if (q.trim()) qb = qb.ilike('email', `%${q.trim()}%`);
      const { data } = await qb;
      setRows(data || []);
    })();
  }, [open, filter, q]);

  const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const cur = weeks.find((w) => w.week_key === open);

  return (
    <Card>
      <div className="flex items-baseline gap-2 mb-3 flex-wrap">
        <div className="text-sm font-bold text-ink-900">📅 Weekly digest delivery tracker</div>
        <span className="text-[11px] text-ink-700/50">self-healing: anyone still pending is retried automatically every day until delivered</span>
      </div>
      {weeks.length === 0 ? <p className="text-xs text-ink-700/50">No weekly digests on record yet.</p> : (
        <>
          <div className="flex flex-wrap gap-2 mb-3">
            {weeks.map((w) => {
              const total = (w.queued_count || 0) || (w.sent + w.pending);
              const pct = total ? Math.round((w.sent / total) * 100) : 0;
              const done = w.pending === 0 && total > 0;
              return (
                <button key={w.week_key} onClick={() => setOpen(w.week_key)}
                  className={`text-left rounded-lg border px-3 py-2 min-w-[150px] transition ${open === w.week_key ? 'border-bronze-600 bg-bronze-600/10 ring-2 ring-bronze-600/30' : 'border-bronze-600/15 bg-cream/50 hover:border-bronze-600/40'}`}>
                  <div className="text-xs font-bold text-ink-900">{w.week_key} {done ? '✅' : w.pending > 0 ? '⏳' : ''}</div>
                  <div className="text-lg font-extrabold text-bronze-800 leading-tight">{w.sent}<span className="text-xs font-normal text-ink-700/50">/{total || '—'}</span></div>
                  <div className="h-1.5 rounded bg-white/70 overflow-hidden mt-1"><div className="h-full bg-bronze-600" style={{ width: pct + '%' }} /></div>
                  <div className="text-[10px] text-ink-700/60 mt-0.5">{w.product_count || 0} designs{w.pending > 0 ? <span className="text-amber-700 font-bold"> · {w.pending} pending</span> : ''}{w.stuck > 0 ? <span className="text-red-600 font-bold"> · {w.stuck} stuck</span> : ''}</div>
                </button>
              );
            })}
          </div>
          {cur && (
            <div className="text-xs text-ink-700/70 mb-2 flex flex-wrap gap-x-4 gap-y-1">
              <span>Generated: <b>{fmt(cur.created_at)}</b></span>
              <span>Last drain: <b>{fmt(cur.last_drain_at)}</b></span>
              {cur.drain_note && <span>Status: <b className={cur.pending > 0 ? 'text-amber-700' : 'text-green-700'}>{cur.drain_note}</b></span>}
              {cur.pending > 0 && <span className="text-amber-800">⏳ The nightly run will send the {cur.pending} pending automatically (stops cleanly if Resend's daily quota hits, resumes next day).</span>}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 mb-2">
            {(['all', 'pending', 'sent', 'failed'] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={`text-[11px] px-2 py-0.5 rounded-full ${filter === f ? 'bg-bronze-600 text-cream' : 'bg-cream text-ink-700'}`}>{f === 'failed' ? 'stuck (5+ tries)' : f}</button>
            ))}
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search recipient…" className="text-xs border border-black/15 rounded px-2 py-1 w-44 ml-auto" />
          </div>
          <div className="max-h-[360px] overflow-y-auto border border-black/10 rounded-lg">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-cream/90 text-left text-ink-700/60"><tr><th className="p-2">Recipient</th><th className="p-2">Status</th><th className="p-2">Sent at</th><th className="p-2">Tries</th><th className="p-2">Last error</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.email} className="border-t border-black/5 hover:bg-cream/30">
                    <td className="p-2 text-ink-800">{r.email}</td>
                    <td className="p-2 whitespace-nowrap">{r.status === 'sent' ? <span className="text-green-700">✓ sent</span> : r.attempts >= 5 ? <span className="text-red-600">✕ stuck</span> : <span className="text-amber-700">⏳ pending</span>}</td>
                    <td className="p-2 whitespace-nowrap text-ink-700/70">{fmt(r.sent_at)}</td>
                    <td className="p-2 text-ink-700/70">{r.attempts || 0}</td>
                    <td className="p-2 text-ink-700/60 max-w-[260px] truncate" title={r.last_error || ''}>{r.last_error || ''}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td className="p-3 text-ink-700/50" colSpan={5}>Nothing in this filter.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
