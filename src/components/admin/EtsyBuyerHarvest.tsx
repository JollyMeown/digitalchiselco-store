// Etsy buyers from Gmail -> subscribers, entirely from the admin:
//   1. copy the Apps Script, run it inside a Google Sheet in the Gmail account
//      that receives Etsy orders (Google asks once for read access),
//   2. download the sheet as CSV,
//   3. drop the CSV here: it is de-duplicated against the list and the new
//      buyers are added as source 'etsy-buyer' (confirmed). The nightly
//      Etsy-buyer welcome then sends each ONE thank-you with THANKYOU10
//      (400 a night while the list warms up), later the weekly digest and,
//      three days after the welcome, the bestsellers / bundle / membership /
//      coupon sequence.
import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Card, btnPrimary, btnGhost } from './ui';
import SCRIPT from '../../../scripts/gmail_etsy_buyers.gs?raw';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function EtsyBuyerHarvest() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [parsed, setParsed] = useState<{ emails: string[]; masked: number; invalid: number; fileName: string } | null>(null);
  const [check, setCheck] = useState<{ existing: number; fresh: string[] } | null>(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');

  async function copyScript() {
    try { await navigator.clipboard.writeText(SCRIPT); setCopied(true); setTimeout(() => setCopied(false), 2500); }
    catch { window.prompt('Copy the script:', SCRIPT); }
  }

  async function onFile(f: File | null) {
    if (!f) return;
    setCheck(null); setMsg('');
    const text = await f.text();
    const seen = new Set<string>(); const emails: string[] = []; let masked = 0, invalid = 0;
    for (const line of text.split(/\r?\n/)) {
      const first = (line.split(',')[0] || '').replace(/^"|"$/g, '').trim().toLowerCase();
      if (!first || first === 'email') continue;
      if (first.includes('*')) { masked++; continue; }
      if (!EMAIL_RE.test(first)) { invalid++; continue; }
      if (seen.has(first)) continue;
      seen.add(first); emails.push(first);
    }
    setParsed({ emails, masked, invalid, fileName: f.name });
    // de-duplicate against the list
    setBusy('check');
    const existing = new Set<string>();
    for (let i = 0; i < emails.length; i += 300) {
      const { data } = await supabase.from('subscribers').select('email').in('email', emails.slice(i, i + 300));
      for (const r of data || []) existing.add(String(r.email).toLowerCase());
    }
    setCheck({ existing: existing.size, fresh: emails.filter((e) => !existing.has(e)) });
    setBusy('');
  }

  async function importFresh() {
    if (!check?.fresh.length) return;
    if (!confirm(`Add ${check.fresh.length} new Etsy buyers to the list? Each gets one welcome email (THANKYOU10) on the coming nights.`)) return;
    setBusy('import');
    const now = new Date().toISOString();
    let added = 0, failed = 0;
    for (let i = 0; i < check.fresh.length; i += 200) {
      const rows = check.fresh.slice(i, i + 200).map((email) => ({ email, source: 'etsy-buyer', confirmed_at: now }));
      const { error } = await supabase.from('subscribers').upsert(rows, { onConflict: 'email', ignoreDuplicates: true });
      if (error) failed += rows.length; else added += rows.length;
    }
    setBusy('');
    setMsg(`Added ${added} buyers${failed ? `, ${failed} failed` : ''}. Welcomes go out at up to 400 a night; the weekly digest and the buyer sequence follow automatically.`);
    setCheck(null); setParsed(null);
  }

  return (
    <Card title="🛍 Etsy buyers from Gmail" subtitle="Collect the buyer emails from your Etsy order notifications with a Google Sheet script, then drop the CSV here. Duplicates are skipped; new buyers get one welcome with a 10% code, then the weekly designs.">
      <button className={btnGhost} onClick={() => setOpen(!open)}>{open ? 'Hide the procedure' : 'Show the procedure'}</button>
      {open && (
        <ol className="mt-3 text-sm text-ink-700 space-y-2 list-decimal pl-5">
          <li>In the Gmail account that receives Etsy orders, open a new <b>Google Sheet</b>.</li>
          <li><b>Extensions &gt; Apps Script</b>. Delete the sample code, paste the script (button below), save.</li>
          <li>Pick <code>scanEtsyBuyers</code> in the toolbar and press <b>Run</b>. Google asks once to allow Gmail read access and Sheets. Allow.</li>
          <li>The sheet <b>"Etsy buyers"</b> fills up. A large mailbox pauses after about 5 minutes; press Run again and it continues where it stopped, until it says <b>Finished</b>.</li>
          <li><b>File &gt; Download &gt; CSV</b> of the "Etsy buyers" sheet, then drop that file below.</li>
          <li>Repeat in every Gmail account that gets Etsy orders. Re-running later only adds buyers that are new.</li>
        </ol>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className={btnPrimary} onClick={copyScript}>{copied ? '✓ Script copied' : '📋 Copy the Google Sheet script'}</button>
        <label className={btnGhost + ' cursor-pointer'}>
          📄 Choose the downloaded CSV
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0] || null)} />
        </label>
        {busy === 'check' && <span className="text-xs text-ink-700/60">checking against the list…</span>}
      </div>
      {parsed && (
        <div className="mt-3 text-sm bg-cream/40 border border-bronze-600/20 rounded-lg p-3">
          <div><b>{parsed.fileName}</b>: {parsed.emails.length} valid addresses{parsed.masked ? `, ${parsed.masked} masked by Etsy (unusable)` : ''}{parsed.invalid ? `, ${parsed.invalid} invalid` : ''}</div>
          {check && (
            <div className="mt-1">Already on the list: {check.existing} · <b>New: {check.fresh.length}</b>
              {check.fresh.length > 0 && <button className={btnPrimary + ' ml-3'} disabled={busy === 'import'} onClick={importFresh}>{busy === 'import' ? 'Adding…' : `Add ${check.fresh.length} new buyers`}</button>}
            </div>
          )}
        </div>
      )}
      {msg && <div className="mt-2 text-sm text-green-800">{msg}</div>}
    </Card>
  );
}
