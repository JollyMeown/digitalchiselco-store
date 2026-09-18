// A buyer paid for a design they already owned. Shown on every admin page
// until refunded or marked "not a mistake". Owner, 2026-09-18: "i never see
// Paddle.. make a button on the Admin dashboard for such event so that i
// refund timely". Jerry had waited 3 days for a refund nobody saw was owed.
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

type Dup = {
  orderId: string; email: string; createdAt: string; total: number; currency: string;
  dupItems: { title: string; price: number }[]; wholeOrder: boolean; refundUsd: number; minutesApart: number;
};

async function call(method: 'GET' | 'POST', body?: unknown) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch('/api/admin/refunds', {
    method, headers: { 'content-type': 'application/json', authorization: `Bearer ${session?.access_token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
  return d;
}

function apart(min: number) {
  if (min < 60) return `${min} min apart`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h apart`;
  return `${Math.round(min / 1440)} days apart`;
}

export default function DoubleChargeBanner() {
  const [rows, setRows] = useState<Dup[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});
  const [err, setErr] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    const load = async () => { try { const d = await call('GET'); if (alive) setRows(d.duplicates || []); } catch {} };
    load();
    const t = setInterval(load, 5 * 60000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (!rows.length) return null;

  async function refund(r: Dup) {
    const what = r.dupItems.map((i) => i.title).join(', ');
    if (!confirm(`Refund $${r.refundUsd.toFixed(2)} to ${r.email}?\n\nThey paid twice for: ${what}\nThey keep the design from their first order.\n\nPaddle sends the money back to their card (5 to 10 business days) and we email them a short note.`)) return;
    setBusy(r.orderId); setErr((e) => ({ ...e, [r.orderId]: '' }));
    try {
      const d = await call('POST', { action: 'refund', orderId: r.orderId, mode: 'duplicate' });
      setDone((m) => ({ ...m, [r.orderId]: `Refund of ${d.amount} ${d.currency} sent to Paddle (${d.status === 'approved' ? 'approved' : 'waiting for Paddle to approve, usually minutes'}). The order turns Refunded by itself.` }));
    } catch (e: any) {
      setErr((m) => ({ ...m, [r.orderId]: e.message }));
    }
    setBusy(null);
  }

  async function dismiss(r: Dup) {
    if (!confirm(`Keep this payment? Only do this if ${r.email} meant to buy it again.`)) return;
    try { await call('POST', { action: 'dismiss', orderId: r.orderId }); setRows((x) => x.filter((y) => y.orderId !== r.orderId)); }
    catch (e: any) { setErr((m) => ({ ...m, [r.orderId]: e.message })); }
  }

  return (
    <div className="mb-4 rounded-lg border border-red-400 bg-red-50 px-4 py-3 text-sm text-red-900 shadow-sm">
      <div className="font-semibold mb-2">💳 {rows.length} buyer{rows.length === 1 ? '' : 's'} paid twice for the same design: refund {rows.length === 1 ? 'it' : 'them'} before they ask</div>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.orderId} className="flex flex-wrap items-center gap-2 rounded-md bg-white/70 border border-red-200 px-3 py-2">
            <div className="flex-1 min-w-[240px]">
              <b className="break-all">{r.email}</b> paid again for <b>{r.dupItems.map((i) => i.title).join(', ')}</b>
              <span className="text-red-900/70"> · {new Date(r.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · {apart(r.minutesApart)}{r.wholeOrder ? '' : ' · part of a bigger order, only the repeat is refunded'}</span>
              {done[r.orderId] && <div className="text-green-800 text-xs mt-1">✓ {done[r.orderId]}</div>}
              {err[r.orderId] && <div className="text-red-700 text-xs mt-1">Could not refund: {err[r.orderId]}</div>}
            </div>
            {!done[r.orderId] && (
              <>
                <button disabled={busy === r.orderId} onClick={() => refund(r)}
                  className="rounded px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50">
                  {busy === r.orderId ? 'Refunding...' : `Refund $${r.refundUsd.toFixed(2)}`}
                </button>
                <button onClick={() => dismiss(r)} className="rounded px-2 py-1.5 text-xs text-red-900/70 hover:underline">Not a mistake</button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
