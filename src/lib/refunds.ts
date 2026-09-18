// Refunds without opening Paddle (migration 140).
//
//   findDuplicateCharges  paid orders for designs the same buyer already owned
//                         from an EARLIER paid order (paid twice by mistake).
//   refundOrder           creates the Paddle refund (an "adjustment"). Paddle
//                         approves it, then the webhook marks the order
//                         refunded and removes THAT order's entitlements only.
import { paddleApi } from './paddle';
import { send as sendEmail } from './resend';

export type DuplicateCharge = {
  orderId: string; email: string; createdAt: string; total: number; currency: string; txnId: string;
  items: { productId: string; title: string; price: number }[];
  dupItems: { productId: string; title: string; price: number }[];
  wholeOrder: boolean; refundUsd: number; firstPaidAt: string; minutesApart: number;
};

const clean = (t: string) => String(t || '').split('|')[0].trim();

export async function findDuplicateCharges(db: any, days = 60): Promise<DuplicateCharge[]> {
  const since = new Date(Date.now() - days * 86400e3).toISOString();
  const { data: orders } = await db.from('orders')
    .select('id, email, created_at, total, currency, status, paddle_transaction_id, refunded_at, refund_requested_at, duplicate_dismissed_at, order_items(product_id, title, price_usd, qty)')
    .eq('status', 'paid').gte('created_at', since).is('refunded_at', null).is('refund_requested_at', null).is('duplicate_dismissed_at', null)
    .order('created_at', { ascending: true }).limit(1000);
  // The shop's own test purchases are not customers to refund.
  const list = (orders || []).filter((o: any) => o.email && !/@digitalchiselco\.com$/i.test(o.email) && o.paddle_transaction_id && (o.order_items || []).some((i: any) => i.product_id));
  if (!list.length) return [];

  const emails = [...new Set(list.map((o: any) => String(o.email).toLowerCase()))];
  const productIds = [...new Set(list.flatMap((o: any) => (o.order_items || []).map((i: any) => i.product_id).filter(Boolean)))];
  const [{ data: ents }, { data: prods }] = await Promise.all([
    db.from('entitlements').select('email, product_id, order_id, granted_at').in('email', emails).in('product_id', productIds),
    // Personalised designs are legitimately bought again with new text.
    db.from('products').select('id, is_customizable').in('id', productIds),
  ]);
  const customizable = new Set((prods || []).filter((p: any) => p.is_customizable).map((p: any) => p.id));
  // Only a copy from a still-paid order counts as "already owned".
  const otherOrderIds = [...new Set((ents || []).map((e: any) => e.order_id).filter(Boolean))];
  const { data: paidOthers } = otherOrderIds.length
    ? await db.from('orders').select('id').in('id', otherOrderIds).eq('status', 'paid')
    : { data: [] };
  const paidSet = new Set((paidOthers || []).map((o: any) => o.id));

  const out: DuplicateCharge[] = [];
  for (const o of list) {
    const email = String(o.email).toLowerCase();
    const items = (o.order_items || []).filter((i: any) => i.product_id)
      .map((i: any) => ({ productId: i.product_id, title: clean(i.title), price: Number(i.price_usd) || 0 }));
    let firstPaidAt = '';
    const dupItems = items.filter((it) => {
      if (customizable.has(it.productId)) return false;
      const prior = (ents || []).find((e: any) => e.email?.toLowerCase() === email && e.product_id === it.productId
        && e.order_id && e.order_id !== o.id && paidSet.has(e.order_id) && new Date(e.granted_at) < new Date(o.created_at));
      if (prior && (!firstPaidAt || prior.granted_at < firstPaidAt)) firstPaidAt = prior.granted_at;
      return !!prior;
    });
    if (!dupItems.length) continue;
    const wholeOrder = dupItems.length === (o.order_items || []).length;
    out.push({
      orderId: o.id, email, createdAt: o.created_at, total: Number(o.total) || 0, currency: o.currency || 'USD',
      txnId: o.paddle_transaction_id, items, dupItems, wholeOrder,
      refundUsd: wholeOrder ? Number(o.total) || 0 : +dupItems.reduce((n, i) => n + i.price, 0).toFixed(2),
      firstPaidAt, minutesApart: Math.round((new Date(o.created_at).getTime() - new Date(firstPaidAt).getTime()) / 60000),
    });
  }
  return out.reverse();
}

export async function refundOrder(db: any, orderId: string, opts: { mode: 'full' | 'duplicate'; reason?: string; by?: string }) {
  const { data: order } = await db.from('orders')
    .select('id, email, total, currency, status, paddle_transaction_id, refund_requested_at, order_items(product_id, title)')
    .eq('id', orderId).maybeSingle();
  if (!order) throw new Error('Order not found.');
  if (order.status !== 'paid') throw new Error(`This order is ${order.status}, not paid.`);
  if (order.refund_requested_at) throw new Error('A refund was already requested for this order.');
  if (!order.paddle_transaction_id) throw new Error('This order was not paid through Paddle.');

  const txn = (await paddleApi<any>(`/transactions/${order.paddle_transaction_id}`)).data;
  if (!['completed', 'paid'].includes(txn?.status)) throw new Error(`Paddle shows this payment as ${txn?.status}; it cannot be refunded yet.`);
  const existing = (await paddleApi<any>('/adjustments', { query: { transaction_id: order.paddle_transaction_id } })).data || [];
  if (existing.some((a: any) => a.action === 'refund' && a.status !== 'rejected')) throw new Error('Paddle already has a refund for this payment.');

  const lines: any[] = txn.details?.line_items || [];
  let chosen = lines;
  if (opts.mode === 'duplicate') {
    const dups = (await findDuplicateCharges(db)).find((d) => d.orderId === orderId);
    if (!dups) throw new Error('This order no longer looks like a double charge.');
    const want = new Set(dups.dupItems.map((i) => i.title.toLowerCase()));
    chosen = lines.filter((li) => want.has(clean(li.product?.name || '').toLowerCase()));
    if (!chosen.length) throw new Error('Could not match the repeated design to the Paddle payment lines.');
  }
  if (!chosen.length) throw new Error('Paddle shows no line items on this payment.');

  const reason = (opts.reason || (opts.mode === 'duplicate' ? 'Duplicate purchase: buyer already owned this design' : 'Refund requested by the shop')).slice(0, 200);
  const adj = (await paddleApi<any>('/adjustments', {
    method: 'POST',
    body: { action: 'refund', transaction_id: order.paddle_transaction_id, reason, items: chosen.map((li) => ({ item_id: li.id, type: 'full' })) },
  })).data;

  const cents = chosen.reduce((n, li) => n + Number(li.totals?.total || 0), 0);
  const amount = +(cents / 100).toFixed(2);
  const whole = chosen.length === lines.length;
  await db.from('orders').update({
    refund_requested_at: new Date().toISOString(), refund_adjustment_id: adj?.id || null,
    refund_note: `${whole ? 'Full' : 'Partial'} refund ${amount} ${txn.currency_code} requested from admin${opts.by ? ' by ' + opts.by : ''}: ${reason}`,
  }).eq('id', orderId);

  // A buyer who paid twice deserves a word from us, not just Paddle's receipt.
  // Partial refunds already get the webhook's "rest of your order" email.
  if (opts.mode === 'duplicate' && whole && order.email) {
    const title = clean(chosen[0]?.product?.name || order.order_items?.[0]?.title || 'your design');
    const what = chosen.length > 1 ? `${chosen.length} designs you already owned` : title;
    await sendEmail({
      to: order.email,
      subject: `You were charged twice, so we refunded the second payment`,
      html: `<p>Hi,</p>
<p>We noticed you paid twice for <strong>${what}</strong>, so we have refunded the second payment of <strong>${amount.toFixed(2)} ${txn.currency_code}</strong>. Depending on your bank it lands within 5 to 10 business days.</p>
<p>You keep the design: it stays in your account with unlimited re-downloads at <a href="https://digitalchiselco.com/account">digitalchiselco.com/account</a>.</p>
<p>Happy carving,<br>Jolly · DigitalChiselCo</p>`,
      text: `We noticed you paid twice for ${what}, so we have refunded the second payment of ${amount.toFixed(2)} ${txn.currency_code}. It lands within 5 to 10 business days. You keep the design: it stays in your account at digitalchiselco.com/account.\n\nJolly, DigitalChiselCo`,
      idempotencyKey: `dup-refund:${orderId}`,
      tags: [{ name: 'kind', value: 'order' }],
    }).catch((e: any) => console.error('[refund] buyer note failed', e?.message));
  }
  return { adjustmentId: adj?.id, status: adj?.status, amount, currency: txn.currency_code, whole };
}
