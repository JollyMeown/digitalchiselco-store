// One-off broadcast of the finishing guide, and a readout of who has had it.
//
// The same email is stage 6 of the subscriber drip, so new subscribers get it
// automatically. This panel is for the people who were already on the list when
// it was written.
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Card, btnPrimary, btnGhost } from './ui';

const GUIDE_PATH = '/blog/how-to-finish-cnc-relief-carvings';

export default function GuideBroadcast() {
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [s, setS] = useState<{ subscribers: number; sent: number; remaining: number } | null>(null);

  async function call(payload: any) {
    const { data: { session } } = await supabase.auth.getSession();
    return fetch('/api/admin/send-guide', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify(payload),
    }).then((r) => r.json()).catch(() => ({ error: 'bad response' }));
  }

  async function loadStats() {
    const r = await call({ stats: true });
    if (r?.ok) setS({ subscribers: r.subscribers, sent: r.sent, remaining: r.remaining });
  }
  useEffect(() => { loadStats(); }, []);

  async function act(kind: 'preview' | 'test' | 'all') {
    setBusy(kind); setNote('');
    const r = await call(kind === 'preview' ? { preview: true } : kind === 'test' ? { test: true } : { audience: 'all' });
    setBusy('');
    if (r?.error) { setNote(r.error); return; }
    if (kind === 'preview') {
      const url = URL.createObjectURL(new Blob([`<title>${r.subject}</title>` + r.html], { type: 'text/html' }));
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setNote(`Preview opened. Subject: ${r.subject}`);
      return;
    }
    if (kind === 'test') { setNote('Test sent to jolly@digitalchiselco.com.'); return; }
    setNote(r.message || `Sent to ${r.sent} subscriber${r.sent === 1 ? '' : 's'}`
      + `${r.skipped ? `, ${r.skipped} already had it` : ''}.`
      + `${r.errors?.length ? ` Problems: ${r.errors.join('; ')}` : ''}`);
    loadStats();
  }

  return (
    <Card>
      <div className="p-4">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <h3 className="font-serif text-lg">Finishing guide broadcast</h3>
          <a href={GUIDE_PATH} target="_blank" rel="noreferrer" className="text-[11px] text-bronze-700 hover:underline">
            read the article
          </a>
        </div>

        <p className="mt-1 text-[12px] text-ink-700/60 leading-relaxed">
          The long finishing guide, sent as a plain useful email with two pictures and no sales pitch.
          It is also stage 6 of the subscriber sequence, so anyone who joins from now on receives it
          without you doing anything. This button is for the people who were already on the list.
        </p>

        {s && (
          <div className="mt-3 grid grid-cols-3 gap-3">
            {[['On the list', s.subscribers], ['Already had it', s.sent], ['Still to go', s.remaining]].map(([k, v]) => (
              <div key={String(k)} className="rounded-lg border border-black/10 bg-white px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-ink-700/50">{k}</div>
                <div className="text-lg font-semibold text-ink-900 tabular-nums">{v as number}</div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <button className={btnGhost + ' text-xs px-2.5 py-1.5'} disabled={!!busy} onClick={() => act('preview')}>
            {busy === 'preview' ? '…' : '👁 preview'}
          </button>
          <button className={btnGhost + ' text-xs px-2.5 py-1.5'} disabled={!!busy} onClick={() => act('test')}>
            {busy === 'test' ? '…' : '✉ test to me'}
          </button>
          <button
            className={btnPrimary + ' text-xs px-3 py-1.5'}
            disabled={!!busy || (s?.remaining ?? 0) === 0}
            title={(s?.remaining ?? 0) === 0 ? 'Everyone has already had it' : undefined}
            onClick={() => {
              const n = s?.remaining ?? 0;
              if (confirm(`Send the finishing guide to ${n} subscriber${n === 1 ? '' : 's'} who have not had it?`)) act('all');
            }}
          >
            {busy === 'all' ? 'sending…' : `📣 send to ${s?.remaining ?? '…'}`}
          </button>
        </div>

        {note && <p className="mt-2 text-[12px] text-ink-700/80">{note}</p>}
      </div>
    </Card>
  );
}
