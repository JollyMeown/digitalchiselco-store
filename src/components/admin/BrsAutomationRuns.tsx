// 🤖 BRS automation runs — the batch summaries the desktop app posts when a
// pipeline / night batch finishes (owner_alerts rows with kind brs_*). They
// used to land in the Sale alerts feed; the owner wants them here, with the
// summary: how many designs completed, how long the batch took, which designs
// stopped and why. The structured part comes from the alert's meta (BRS builds
// it), the text body is the fallback for older rows.
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Card, btnGhost } from './ui';
import { useLiveRefresh } from './useLiveRefresh';

type Row = { id: number; kind: string; title: string; body: string | null; url: string | null; created_at: string; meta: any };

function fmtSecs(s: any): string {
  const x = Number(s);
  if (!isFinite(x) || x <= 0) return '';
  if (x >= 3600) return `${Math.floor(x / 3600)} h ${String(Math.floor((x % 3600) / 60)).padStart(2, '0')} min`;
  if (x >= 60) return `${Math.floor(x / 60)} min ${String(Math.round(x % 60)).padStart(2, '0')} s`;
  return `${Math.round(x)} s`;
}

export default function BrsAutomationRuns() {
  const [rows, setRows] = useState<Row[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [err, setErr] = useState('');

  async function load() {
    const { data, error } = await supabase.from('owner_alerts')
      .select('id, kind, title, body, url, created_at, meta')
      .like('kind', 'brs_%').order('id', { ascending: false }).limit(25);
    if (error) { setErr(error.message); return; }
    setRows((data as Row[]) || []);
  }
  useEffect(() => { load(); }, []);
  useLiveRefresh(() => load(), 30000);

  const kindLabel = (k: string) => k === 'brs_pipeline' ? 'Pipeline' : k === 'brs_zbrush' ? 'ZBrush night batch' : k.replace(/^brs_/, '');

  const [busy, setBusy] = useState(false);
  async function clear(id?: number) {
    if (!id && !confirm(`Delete all ${rows.length} automation messages? Sale alerts are not touched.`)) return;
    setBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/admin/brs-alerts-clear', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${session?.access_token}` }, body: JSON.stringify(id ? { id } : {}) });
      const j = await res.json();
      if (!j.ok) alert('Delete failed: ' + (j.error || res.status));
      else setRows((r) => (id ? r.filter((x) => x.id !== id) : []));
    } catch (e: any) { alert(String(e?.message || e)); }
    setBusy(false);
  }

  return (
    <Card title="🤖 BRS automation runs" action={rows.length > 0 ? (
      <button type="button" className={btnGhost + ' text-xs'} disabled={busy} onClick={() => clear()} title="Delete every automation message in one click (sale alerts stay)">🗑 Clear all ({rows.length})</button>
    ) : undefined}>
      <p className="text-xs text-ink-700/60">
        Every finished batch from Bundle Relief Studio, newest first: designs completed, total processing time, and the designs that stopped with the reason. The full report sits in the bundle folder on the computer that ran it.
      </p>
      {err && <div className="text-xs text-red-700 mt-2">{err}</div>}
      {rows.length === 0 && !err && <div className="text-xs text-ink-700/50 mt-2">no automation run reported yet</div>}
      {rows.length > 0 && (
        <ul className="mt-2 divide-y divide-ink-700/5 text-sm">
          {rows.map((a) => {
            const m = a.meta || {};
            const t = m.timing || {};
            const failed: any[] = Array.isArray(m.failed) ? m.failed : [];
            const total = Number(m.designs ?? 0), ok = Number(m.complete ?? 0);
            const isOpen = open === a.id;
            return (
              <li key={a.id} className="py-2">
                <button type="button" className="w-full text-left" onClick={() => setOpen(isOpen ? null : a.id)}>
                  <div className="flex items-start gap-2">
                    <span>{failed.length || (total && ok < total) ? '⚠️' : '✅'}</span>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-ink-900 truncate">
                        {a.title}
                        <span className="text-xs font-normal text-ink-700/60"> · {kindLabel(a.kind)}{m.computer ? ` · ${m.computer}` : ''}</span>
                      </div>
                      <div className="text-xs text-ink-700/60 truncate">
                        {m.bundle ? `${m.bundle} · ` : ''}
                        {t.total_h ? `⏱ ${t.total_h} total` : ''}{t.avg_design_h ? ` · ${t.avg_design_h} per design` : ''}
                        {!t.total_h && a.body ? a.body : ''}
                        {' · '}{new Date(a.created_at).toLocaleString()}
                      </div>
                    </div>
                  </div>
                </button>
                {isOpen && (
                  <div className="mt-2 ml-6 text-xs text-ink-700/80 space-y-1">
                    {Array.isArray(m.steps) && m.steps.length > 0 && <div><b>Steps:</b> {m.steps.join(' → ')}</div>}
                    {Array.isArray(t.per_step) && t.per_step.length > 0 && (
                      <div><b>Time per step (avg · total):</b> {t.per_step.map((x: any) => `${x.label} ${fmtSecs(x.avg)} · ${fmtSecs(x.total)}`).join(' | ')}</div>
                    )}
                    {failed.length > 0 && (
                      <div>
                        <b>Stopped:</b>
                        <ul className="list-disc ml-5">
                          {failed.map((f: any, i: number) => <li key={i}>{f.design || f.file}: <b>{f.failed_at}</b> — {f.detail}</li>)}
                        </ul>
                      </div>
                    )}
                    {Array.isArray(m.complete_list) && m.complete_list.length > 0 && (
                      <div><b>Completed:</b> {m.complete_list.join(', ')}</div>
                    )}
                    {m.report && <div><b>Report:</b> {m.report}</div>}
                    {!m.timing && a.body && <div>{a.body}</div>}
                    <div><button type="button" className={btnGhost + ' text-xs'} disabled={busy} onClick={() => clear(a.id)}>🗑 Delete this message</button></div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
