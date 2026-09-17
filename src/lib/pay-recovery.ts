// Failed-payment recovery: queue at failure, decide at send time.
// See migration 136 for why the old "book it for +2 h" approach misfired.
import { send as sendEmail } from './resend';
import { paymentRecoveryEmail } from './marketing-emails';

const WAIT_MS = 2 * 3600e3;          // give the buyer two hours to finish on their own
const GIVE_UP_MS = 48 * 3600e3;      // a failure older than this is no longer worth mentioning
const RETRY_SLACK_MS = 10 * 60e3;    // a paid order just before the failure event still counts

type DB = any;

export async function queuePaymentRecovery(db: DB, q: { email: string; txnId: string; items: { title: string; price: number }[] }) {
  const email = q.email.toLowerCase().trim();
  const { error } = await db.from('pay_recovery_queue')
    .upsert({ email, txn_id: q.txnId, items: q.items }, { onConflict: 'txn_id', ignoreDuplicates: true });
  if (error) console.error('[pay-recovery] queue failed:', error.message);
}

/** A paid order means the buyer finished; close anything still waiting for them. */
export async function closePaymentRecoveryForEmail(db: DB, email: string) {
  await db.from('pay_recovery_queue')
    .update({ status: 'skipped_paid', decided_at: new Date().toISOString(), note: 'paid before the reminder was due' })
    .eq('status', 'pending').ilike('email', email.toLowerCase().trim());
}

export async function sweepPaymentRecovery(db: DB, limit = 20) {
  const out = { checked: 0, sent: 0, skipped: 0, expired: 0, failed: 0 };
  const now = Date.now();
  const { data: rows } = await db.from('pay_recovery_queue').select('*')
    .eq('status', 'pending').lte('failed_at', new Date(now - WAIT_MS).toISOString())
    .order('failed_at').limit(limit);
  const sentToday = new Set<string>();
  for (const r of rows || []) {
    out.checked++;
    const decide = (status: string, note: string, extra: Record<string, unknown> = {}) =>
      db.from('pay_recovery_queue').update({ status, note, decided_at: new Date().toISOString(), ...extra }).eq('id', r.id);

    if (now - new Date(r.failed_at).getTime() > GIVE_UP_MS) { await decide('expired', 'too old to mention'); out.expired++; continue; }

    const since = new Date(new Date(r.failed_at).getTime() - RETRY_SLACK_MS).toISOString();
    const { data: paid } = await db.from('orders').select('id').ilike('email', r.email)
      .eq('status', 'paid').gte('created_at', since).limit(1);
    if (paid?.length) { await decide('skipped_paid', 'bought after the failed attempt'); out.skipped++; continue; }

    const { data: sub } = await db.from('subscribers').select('unsubscribed_at, suppressed_at').ilike('email', r.email).maybeSingle();
    if (sub?.unsubscribed_at || sub?.suppressed_at) { await decide('skipped_unsub', 'unsubscribed or suppressed'); out.skipped++; continue; }

    // Several failed attempts by one person: one reminder is plenty.
    if (sentToday.has(r.email)) { await decide('skipped_paid', 'another reminder already covers this buyer'); out.skipped++; continue; }
    const { data: recent } = await db.from('pay_recovery_queue').select('id').ilike('email', r.email)
      .eq('status', 'sent').gte('decided_at', new Date(now - 24 * 3600e3).toISOString()).limit(1);
    if (recent?.length) { await decide('skipped_paid', 'reminded in the last 24 h'); out.skipped++; continue; }

    const { subject, html, text } = paymentRecoveryEmail({ email: r.email, items: Array.isArray(r.items) ? r.items : [] });
    const res = await sendEmail({
      to: r.email, subject, html, text,
      idempotencyKey: `payfail:${r.txn_id}`,
      tags: [{ name: 'kind', value: 'payRecovery' }],
    });
    if (res.ok) { await decide('sent', 'no purchase two hours after the failure', { provider_id: (res as any).id || null }); out.sent++; sentToday.add(r.email); }
    else { await decide('failed', String(res.error || 'send failed').slice(0, 200)); out.failed++; }
  }
  return out;
}
