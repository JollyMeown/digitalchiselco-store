import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { Card, btnGhost } from '../ui';

export default function Subscribers() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);
  async function load() {
    setLoading(true);
    const { data } = await supabase.from('subscribers').select('*').order('created_at', { ascending: false }).limit(1000);
    setRows(data ?? []); setLoading(false);
  }

  function exportCsv() {
    const head = 'email,source,created_at\n';
    const body = rows.map((r) => `${r.email},${r.source || ''},${r.created_at}`).join('\n');
    const blob = new Blob([head + body], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `subscribers-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex justify-between items-center">
          <span className="text-sm text-ink-700/60">{rows.length} subscribers</span>
          <button className={btnGhost} onClick={exportCsv}>Export CSV</button>
        </div>
      </Card>
      {loading ? <div className="text-sm text-ink-700/60">Loading…</div> : rows.length === 0 ? (
        <Card><p className="text-sm text-ink-700/60">No subscribers yet.</p></Card>
      ) : (
        <div className="bg-white border border-black/10 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-xs text-ink-700/60 text-left bg-cream/40">
              <tr><th className="p-2">Email</th><th className="p-2">Source</th><th className="p-2">Signed up</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-black/5">
                  <td className="p-2">{r.email}</td><td className="p-2 text-xs text-ink-700/60">{r.source || '—'}</td>
                  <td className="p-2 text-xs text-ink-700/60">{new Date(r.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
