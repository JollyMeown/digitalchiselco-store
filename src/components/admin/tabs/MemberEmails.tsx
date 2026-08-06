import { useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { Card, btnPrimary, inputCls, labelCls, Toast } from '../ui';

const SEGMENTS = [
  { key: 'single', label: 'Single customer' },
  { key: 'active', label: 'All active paid members' },
  { key: 'expired', label: 'All expired / cancelled members' },
  { key: 'free_leads', label: 'All free leads (website opt-ins)' },
  { key: 'all_members', label: 'All paid members (active + expired)' },
];

export default function MemberEmails() {
  const [segment, setSegment] = useState('single');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [html, setHtml] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'info'; text: string }>({ kind: 'info', text: '' });

  async function sendNow() {
    if (!subject.trim()) { setMsg({ kind: 'error', text: 'Add a subject.' }); return; }
    if (!html.trim()) { setMsg({ kind: 'error', text: 'Add a message.' }); return; }
    if (segment === 'single' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setMsg({ kind: 'error', text: 'Enter a valid recipient email.' }); return; }
    if (segment !== 'single' && !confirm(`Send this to the "${SEGMENTS.find((s) => s.key === segment)?.label}" segment? This emails real people.`)) return;
    setBusy(true); setMsg({ kind: 'info', text: 'Sending…' });
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch('/api/admin/membership/broadcast', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${session?.access_token || ''}` },
      body: JSON.stringify({ segment, email, subject, html }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok || data.error) { setMsg({ kind: 'error', text: data.error || 'Send failed.' }); return; }
    setMsg({ kind: 'success', text: `✓ Sent to ${data.sent} of ${data.recipients}${data.failed ? ` (${data.failed} failed)` : ''}.` });
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2">
        <Card>
          <div className="space-y-3">
            <div>
              <label className={labelCls}>Send to</label>
              <select value={segment} onChange={(e) => setSegment(e.target.value)} className={inputCls}>
                {SEGMENTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
            {segment === 'single' && (
              <div><label className={labelCls}>Recipient email</label><input value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder="customer@email.com" /></div>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" className="text-xs px-2.5 py-1.5 rounded border border-bronze-600/30 bg-cream/50 text-bronze-800 hover:bg-cream"
                onClick={() => {
                  setSegment('expired');
                  setSubject('We miss you at the workshop — here is 15% to come back');
                  setHtml('<p>Hi {{first_name}},</p>'
                    + '<p>Your membership wrapped up a while back — and the workshop has not slowed down since: <strong>8 brand-new bas-relief designs land every month</strong>, and the recent packs have been some of our best.</p>'
                    + '<p>If you would like to pick the monthly drops back up (or just grab a few singles), here is <strong>15% off anything</strong> as a welcome-back:</p>'
                    + '<p style="text-align:center;"><span style="display:inline-block;background:#F5EFE3;border:1px dashed #854F0B;border-radius:8px;padding:12px 28px;font-family:monospace;font-size:20px;letter-spacing:2px;color:#5E380A;font-weight:bold;">COMEBACK15</span></p>'
                    + '<p style="text-align:center;"><a href="https://digitalchiselco.com/#membership" style="display:inline-block;background:#5E380A;color:#F5EFE3;text-decoration:none;padding:12px 26px;border-radius:8px;">Restart my membership</a></p>'
                    + '<p>Everything you received before is still in <a href="https://digitalchiselco.com/account">your account</a> — nothing expires.</p>'
                    + '<p>— Jolly, DigitalChiselCo</p>');
                }}>↩ Load win-back template (expired members · COMEBACK15)</button>
            </div>
            <div><label className={labelCls}>Subject</label><input value={subject} onChange={(e) => setSubject(e.target.value)} className={inputCls} placeholder="A little something new from DigitalChiselCo" /></div>
            <div>
              <label className={labelCls}>Message (HTML) — use <code>{'{{first_name}}'}</code> to personalise</label>
              <textarea value={html} onChange={(e) => setHtml(e.target.value)} className={inputCls + ' font-mono text-xs'} rows={10}
                placeholder={'<p>Hi {{first_name}},</p>\n<p>Just wanted to share something new…</p>'} />
            </div>
            <div className="flex items-center gap-3 border-t border-black/10 pt-3">
              <button disabled={busy} onClick={sendNow} className={btnPrimary}>{busy ? 'Sending…' : '✈ Send email'}</button>
              <Toast message={msg.text} kind={msg.kind} />
            </div>
          </div>
        </Card>
      </div>
      <div className="space-y-3">
        <Card>
          <h3 className="font-medium text-ink-900 mb-1 text-sm">When to use this</h3>
          <ul className="text-xs text-ink-700/70 list-disc pl-4 space-y-1">
            <li>Announce a new pack theme before it drops</li>
            <li>Nurture free leads toward a paid membership</li>
            <li>Re-engage expired members with a win-back offer</li>
            <li>One-off replies that need more than a quick email client</li>
          </ul>
        </Card>
        <Card>
          <h3 className="font-medium text-ink-900 mb-1 text-sm">Good to know</h3>
          <p className="text-xs text-ink-700/70">Broadcasts send in batches of 10 with a short pause, to stay within Resend limits. Your message is wrapped in the DigitalChiselCo brand shell automatically — you only write the inner content.</p>
        </Card>
      </div>
    </div>
  );
}
