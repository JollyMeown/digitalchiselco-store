// Paddle webhook receiver.
//
// Verifies the Paddle-Signature header (HMAC-SHA256 over `<ts>:<rawBody>`),
// stores the event for idempotency, then routes to a handler.
//
// Currently handled:
//   - transaction.completed → creates an `orders` row + `entitlements` rows.
//
// TODO (next pass): on `transaction.completed`, send the buyer an email with
// their download link(s). Pending the user's choice of email provider
// (Resend / Brevo / Klaviyo / MailerLite).

import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabase';
import { verifyWebhookSignature, paddleApi } from '../../../lib/paddle';
import { send as sendEmail } from '../../../lib/resend';
import { orderConfirmation } from '../../../lib/email-templates';

export const prerender = false;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

export const POST: APIRoute = async ({ request }) => {
  const rawBody = await request.text();
  const sig = request.headers.get('paddle-signature');
  const secret = process.env.PADDLE_WEBHOOK_SECRET || '';

  if (!secret) {
    console.error('Webhook hit but PADDLE_WEBHOOK_SECRET is not set');
    return json({ error: 'Webhook secret not configured' }, 500);
  }
  if (!verifyWebhookSignature(rawBody, sig, secret)) {
    console.warn('Webhook signature failed');
    return json({ error: 'Invalid signature' }, 401);
  }

  let event: any;
  try { event = JSON.parse(rawBody); } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const eventId: string = event?.event_id || event?.notification_id || '';
  const eventType: string = event?.event_type || '';
  if (!eventId || !eventType) return json({ error: 'Missing event_id or event_type' }, 400);

  const db = supabaseAdmin();

  // 1) Idempotency — insert with unique (provider, event_id). If conflict, this is a retry.
  const { error: insertErr } = await db.from('webhook_events').insert({
    provider: 'paddle',
    event_id: eventId,
    event_type: eventType,
    payload: event,
  });
  if (insertErr) {
    // 23505 = unique_violation in Postgres → already processed, ack with 200 so Paddle stops retrying
    if ((insertErr as any).code === '23505' || /duplicate key/i.test(insertErr.message)) {
      console.log(`Webhook ${eventId} (${eventType}) already processed — acking.`);
      return json({ ok: true, deduped: true });
    }
    console.error('Webhook insert failed:', insertErr);
    return json({ error: 'DB error' }, 500);
  }

  // 2) Route by event type
  try {
    if (eventType === 'transaction.completed') {
      await handleTransactionCompleted(db, event.data);
    }
    // Other events (transaction.created, transaction.updated, subscription.*, etc.)
    // are stored above but not processed yet — easy to add as needed.

    await db.from('webhook_events')
      .update({ processed_at: new Date().toISOString() })
      .eq('provider', 'paddle')
      .eq('event_id', eventId);

    return json({ ok: true });
  } catch (e: any) {
    console.error(`Webhook ${eventType} processing failed:`, e);
    await db.from('webhook_events')
      .update({ error: e.message || String(e) })
      .eq('provider', 'paddle')
      .eq('event_id', eventId);
    // Return 500 so Paddle retries — only ack 200 when we successfully processed
    return json({ error: e.message || 'Processing failed' }, 500);
  }
};

async function handleTransactionCompleted(db: any, txn: any) {
  if (!txn?.id) throw new Error('transaction.data.id missing');

  // Paddle's webhook payload only embeds customer_id (not the full customer
  // record). Fetch the customer separately so we have the email + name for
  // the order row and the transactional receipt.
  let customerEmail = '';
  let customerName: string | null = null;
  if (txn.customer_id) {
    try {
      const cust = await paddleApi<any>(`/customers/${txn.customer_id}`);
      customerEmail = (cust?.data?.email || '').toLowerCase().trim();
      customerName = cust?.data?.name || null;
    } catch (e: any) {
      console.error(`Paddle customer lookup failed for ${txn.customer_id}:`, e.message);
    }
  }
  // Fallback chain in case the customer lookup fails or customer_id is missing.
  const email: string = customerEmail || (txn.customer?.email || '').toLowerCase().trim();
  const total = Number(txn.details?.totals?.total ?? txn.details?.totals?.subtotal ?? 0) / 100; // cents → dollars
  const subtotal = Number(txn.details?.totals?.subtotal ?? 0) / 100;
  const currency = String(txn.currency_code || 'USD');

  // Upsert order keyed on paddle_transaction_id (the unique index makes this safe).
  const { data: existing } = await db
    .from('orders')
    .select('id')
    .eq('paddle_transaction_id', txn.id)
    .maybeSingle();
  if (existing?.id) {
    console.log(`Order already exists for transaction ${txn.id} → skipping create.`);
    return;
  }

  const { data: order, error: orderErr } = await db
    .from('orders')
    .insert({
      email: email || 'unknown@digitalchiselco.com',
      status: 'paid',
      subtotal,
      total,
      currency,
      provider: 'paddle',
      provider_order_id: txn.id,
      paddle_transaction_id: txn.id,
      paddle_customer_id: txn.customer_id || null,
    })
    .select('id')
    .single();
  if (orderErr || !order) throw new Error(`Insert order failed: ${orderErr?.message}`);

  // Resolve each line item → our product (by paddle_price_id) and create order_items + entitlements.
  const items = Array.isArray(txn.items) ? txn.items : [];
  for (const it of items) {
    const priceId = it.price?.id;
    const lineTotal = Number(it.totals?.total ?? it.totals?.subtotal ?? 0) / 100;
    const lineUnit = Number(it.price?.unit_price?.amount ?? 0) / 100;
    const qty = Number(it.quantity ?? 1);

    // Try to find a matching product by paddle_price_id (may be null for ad-hoc items)
    let productId: string | null = null;
    let title: string = String(it.price?.description || it.price?.name || '').slice(0, 240);

    if (priceId) {
      const { data: p } = await db
        .from('products')
        .select('id, title')
        .eq('paddle_price_id', priceId)
        .maybeSingle();
      if (p) { productId = p.id; title = p.title; }
    }

    await db.from('order_items').insert({
      order_id: order.id,
      product_id: productId,
      title,
      price_usd: lineUnit || lineTotal,
      qty,
    });

    if (productId) {
      await db.from('entitlements').insert({
        order_id: order.id,
        email: email || 'unknown@digitalchiselco.com',
        product_id: productId,
      });
    }
  }

  console.log(`Order ${order.id} created for txn ${txn.id} (${email}, $${total}).`);

  // ── Send branded confirmation email with download links ──────────────
  // Pulls download links from product_downloads for each ordered product, then
  // hands off to Resend. Failure here does NOT roll back the order (the customer
  // can still see their order on /account); we just log so we can resend later.
  if (email && email !== 'unknown@digitalchiselco.com') {
    try {
      // Fetch order items + their download links + brand logo in parallel
      const [{ data: orderItems }, { data: settings }] = await Promise.all([
        db.from('order_items')
          .select('title, qty, price_usd, product_id')
          .eq('order_id', order.id),
        db.from('site_settings').select('logo_image_url').eq('id', 1).maybeSingle(),
      ]);
      const productIds = (orderItems || []).map((it: any) => it.product_id).filter(Boolean);
      const downloadsByProduct: Record<string, { name?: string; url: string }[]> = {};
      if (productIds.length) {
        const { data: dls } = await db
          .from('product_downloads')
          .select('product_id, file_name, download_link')
          .in('product_id', productIds);
        for (const dl of dls || []) {
          (downloadsByProduct[dl.product_id] ||= []).push({ name: dl.file_name || undefined, url: dl.download_link });
        }
      }

      const emailItems = (orderItems || []).map((it: any) => ({
        title: it.title || 'Item',
        qty: it.qty || 1,
        price_usd: Number(it.price_usd) || 0,
        download_links: it.product_id ? downloadsByProduct[it.product_id] : undefined,
      }));

      // customerName already looked up at top of function via /customers/{id}
      const finalCustomerName: string | null =
        customerName || (txn.custom_data && txn.custom_data.customer_name) || null;

      const { subject, html, text } = orderConfirmation({
        email,
        customerName: finalCustomerName,
        orderId: order.id,
        orderShortId: String(order.id).slice(0, 8),
        createdAt: new Date().toISOString(),
        total,
        currency,
        items: emailItems,
        logoUrl: settings?.logo_image_url || null,
      });

      const sendResult = await sendEmail({
        to: email,
        subject,
        html,
        text,
        idempotencyKey: `order:${order.id}`,   // Resend dedupes if we accidentally retry
      });

      if (sendResult.ok && !sendResult.skipped) {
        console.log(`[email] Order ${order.id.slice(0, 8)} confirmation sent to ${email} (id=${sendResult.id})`);
      } else if (sendResult.skipped) {
        console.log(`[email] skipped (Resend not configured) — order ${order.id.slice(0, 8)}`);
      } else {
        console.error(`[email] failed for order ${order.id.slice(0, 8)}: ${sendResult.error}`);
      }
    } catch (e) {
      // Don't throw — the order is already saved, the customer can refetch via /account
      console.error(`[email] threw for order ${order.id}:`, e);
    }
  }
}
