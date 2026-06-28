import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { Card, linkColor, btnGhost } from '../ui';

export default function Links() {
  const [rows, setRows] = useState<any[]>([]);
  const [filter, setFilter] = useState('needs');
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, [filter]);
  async function load() {
    setLoading(true);
    let q = supabase.from('products')
      .select('id,title,slug,link_status,link_verified,product_downloads(download_link)')
      .order('link_status').limit(300);
    if (filter === 'needs') q = q.in('link_status', ['review', 'bundle_manual', 'likely']);
    const { data } = await q;
    setRows(data ?? []); setLoading(false);
  }
  async function mark(id: string, status: string) {
    await supabase.from('products').update({ link_status: status, link_verified: status === 'verified' }).eq('id', id);
    setRows((r) => r.map((x) => x.id === id ? { ...x, link_status: status, link_verified: status === 'verified' } : x));
  }
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-700/60">Filter:</span>
          {['needs', 'all'].map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-2.5 py-1 text-xs rounded-md border ${filter === f ? 'bg-bronze-600 text-cream border-bronze-600' : 'border-black/15'}`}>
              {f === 'needs' ? 'Needs review (red/yellow)' : 'All'}
            </button>
          ))}
          <span className="ml-auto text-xs text-ink-700/60">{rows.length} shown</span>
        </div>
      </Card>
      {loading ? <div className="text-sm text-ink-700/60">Loading…</div> : (
        <div className="bg-white border border-black/10 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-ink-700/60 text-left bg-cream/40">
              <tr><th className="p-2 w-10"></th><th className="p-2">Product</th><th className="p-2">Link</th><th className="p-2">Status</th><th className="p-2 text-right">Action</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const link = r.product_downloads?.[0]?.download_link;
                return (
                  <tr key={r.id} className="border-t border-black/5">
                    <td className="p-2"><span className={`inline-block w-2.5 h-2.5 rounded-full ${linkColor[r.link_status] || 'bg-gray-400'}`} /></td>
                    <td className="p-2"><a href={`/product/${r.slug}`} target="_blank" className="text-ink-800 hover:text-bronze-600">{r.title.slice(0, 50)}</a></td>
                    <td className="p-2">{link ? <a href={link} target="_blank" className="text-bronze-600 text-xs">open ↗</a> : <span className="text-red-600 text-xs">none</span>}</td>
                    <td className="p-2 text-xs">{r.link_status}{r.link_verified ? ' ✓' : ''}</td>
                    <td className="p-2 text-right space-x-1">
                      <button className={btnGhost + ' !border-green-500 !text-green-700'} onClick={() => mark(r.id, 'verified')}>✓ Works</button>
                      <button className={btnGhost + ' !border-red-400 !text-red-600'} onClick={() => mark(r.id, 'broken')}>✕ Broken</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
