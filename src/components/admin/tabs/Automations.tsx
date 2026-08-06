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
  { key: 'review7', label: 'Review request (+7 days)', group: 'Post-purchase' },
  { key: 'arrivals30', label: 'New arrivals (+30 days)', group: 'Post-purchase' },
  { key: 'loyalty', label: 'Loyalty 10% (3rd order)', group: 'Post-purchase' },
];

export default function Automations() {
  const [settings, setSettings] = useState<any>(null);
  const [drip, setDrip] = useState<{ active: number; done: number; converted: number; stopped: number }>({ active: 0, done: 0, converted: 0, stopped: 0 });
  const [carts, setCarts] = useState<{ open: number; reminded: number; recovered: number }>({ open: 0, reminded: 0, recovered: 0 });
  const [kind, setKind] = useState('drip1');
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'info'; text: string }>({ kind: 'info', text: '' });

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
        🛡 <b>Review-first:</b> every system below is OFF until you switch it on. Preview each email (right), test-send it to yourself, then enable. The daily cron (08:00 UTC) does the sending — max 80 drip emails/day, one reminder per cart, each followup once per order.
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
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={inputCls + ' max-w-xs'}>
            {['Subscriber drip', 'Cart recovery', 'Post-purchase'].map((grp) => (
              <optgroup key={grp} label={grp}>
                {KINDS.filter((k) => k.group === grp).map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
              </optgroup>
            ))}
          </select>
          <input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@email.com" className={inputCls + ' max-w-[220px]'} />
          <button className={btnPrimary} disabled={busy} onClick={sendTest}>{busy ? 'Sending…' : 'Send test to me'}</button>
          <button className={btnGhost} onClick={() => loadPreview(kind)}>Refresh preview</button>
          <Toast message={msg.text} kind={msg.kind} />
        </div>
        {preview ? (
          <>
            <div className="text-xs text-ink-700/60 mb-2">Subject: <span className="text-ink-900 font-medium">{preview.subject}</span></div>
            <iframe title="email preview" srcDoc={preview.html} className="w-full bg-white border border-black/10 rounded-lg" style={{ height: 640 }} />
          </>
        ) : <div className="text-sm text-ink-700/60 py-10 text-center">Rendering preview…</div>}
      </Card>
    </div>
  );
}
