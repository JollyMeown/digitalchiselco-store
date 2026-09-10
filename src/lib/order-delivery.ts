// Did the buyer actually RECEIVE their download email?
//
// "Sent" is not "delivered". An address that has hard-bounced once goes onto
// the mail provider's suppression list, after which every send to it is
// accepted by the API and then silently dropped. That is exactly how one buyer
// paid on 2026-09-08, was marked fulfilled, and received nothing: we only found
// out because he wrote in. Waiting for a customer to complain is not a system.
//
// So delivery is judged on the webhook events Resend sends back, not on our own
// record of having asked it to send. The match is by address and time, because
// order emails are not written to email_send_log, so there is no message id to
// join on. That makes it a best-effort read, and the labels say so: an order is
// only ever called "not delivered" once enough time has passed for the event to
// have arrived.
import type { SupabaseClient } from '@supabase/supabase-js';

export type DeliveryState = 'delivered' | 'opened' | 'sent' | 'bounced' | 'missing' | 'pending' | 'unknown';

export type Delivery = {
  state: DeliveryState;
  /** true when this needs the owner's attention now */
  warn: boolean;
  label: string;
  detail: string;
  /** the address has hard-bounced at some point, so ANY future send may vanish */
  addressBounced: boolean;
};

// How long to wait before a silent order counts as a problem. Resend's webhook
// normally lands within seconds; half an hour is generous enough that a slow
// event never raises a false alarm.
const GRACE_MS = 30 * 60 * 1000;

type OrderLike = { id: string; email: string | null; created_at: string; confirmation_sent_at?: string | null; status?: string | null };

export async function deliveryForOrders(
  db: SupabaseClient,
  orders: OrderLike[],
): Promise<Map<string, Delivery>> {
  const out = new Map<string, Delivery>();
  const emails = [...new Set(orders.map((o) => (o.email || '').toLowerCase()).filter(Boolean))];
  if (!emails.length) return out;

  // Every order-email event for these buyers, plus any bounce they have ever
  // had on any kind of mail: one bounce is enough to poison every later send.
  const [{ data: orderEvents }, { data: bounces }] = await Promise.all([
    db.from('email_events').select('email, event, created_at').eq('kind', 'order').in('email', emails),
    db.from('email_events').select('email, created_at, kind').in('event', ['bounced', 'complained']).in('email', emails),
  ]);

  const bouncedAddresses = new Set((bounces || []).map((b: any) => String(b.email).toLowerCase()));
  const byEmail = new Map<string, { event: string; created_at: string }[]>();
  for (const e of orderEvents || []) {
    const k = String((e as any).email).toLowerCase();
    if (!byEmail.has(k)) byEmail.set(k, []);
    byEmail.get(k)!.push({ event: String((e as any).event), created_at: String((e as any).created_at) });
  }

  for (const o of orders) {
    const key = (o.email || '').toLowerCase();
    const addressBounced = bouncedAddresses.has(key);
    if (!key || key === 'unknown@digitalchiselco.com') {
      out.set(o.id, { state: 'unknown', warn: false, label: 'no address', detail: 'This order carries no buyer email.', addressBounced });
      continue;
    }
    // Events from just before the order onwards; a few minutes of slack absorbs
    // clock differences between Paddle, us and Resend.
    const from = Date.parse(o.created_at) - 5 * 60 * 1000;
    const mine = (byEmail.get(key) || []).filter((e) => Date.parse(e.created_at) >= from);
    const has = (n: string) => mine.some((e) => e.event === n);
    const age = Date.now() - Date.parse(o.created_at);

    if (has('bounced') || has('complained')) {
      out.set(o.id, { state: 'bounced', warn: true, label: 'BOUNCED', detail: 'Their mail server rejected the download email. Send the files to another address.', addressBounced });
    } else if (has('opened') || has('clicked')) {
      out.set(o.id, { state: 'opened', warn: false, label: 'opened', detail: 'The buyer opened their download email.', addressBounced });
    } else if (has('delivered')) {
      out.set(o.id, { state: 'delivered', warn: false, label: 'delivered', detail: 'The download email reached their mailbox.', addressBounced });
    } else if (has('sent')) {
      out.set(o.id, {
        state: age > GRACE_MS ? 'sent' : 'pending', warn: false,
        label: age > GRACE_MS ? 'sent, no receipt' : 'in flight',
        detail: 'Accepted by the mail provider. No delivery confirmation has come back yet.', addressBounced,
      });
    } else if (age < GRACE_MS) {
      out.set(o.id, { state: 'pending', warn: false, label: 'in flight', detail: 'Just placed; give the mail provider a few minutes.', addressBounced });
    } else {
      // Nothing at all, well after the fact. This is the silent-suppression
      // case, and it is the one that costs a customer.
      out.set(o.id, {
        state: 'missing', warn: true, label: 'NOT DELIVERED',
        detail: addressBounced
          ? 'No delivery event at all, and this address has bounced before, so the provider is almost certainly dropping our mail. Send the files to another address.'
          : 'No delivery event ever arrived for this order. The buyer may have received nothing.',
        addressBounced,
      });
    }
  }
  return out;
}
