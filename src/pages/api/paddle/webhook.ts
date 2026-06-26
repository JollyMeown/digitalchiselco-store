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
import { orderConfirmation, membershipPurchaseNotification } from '../../../lib/email-templates';

const OPS_INBOX = 'jolly@digitalchiselco.com';

// process.env at runtime in Netlify Functions; import.meta.env at build-time
// in Astro dev. Read both so dev and prod behave identically.
function env(name: string): string | undefined {
  return process.env[name] ?? (import.meta as any).env?.[name];
}

export const prerender = false;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

export const POST: APIRoute = async ({ request }) => {
  const rawBody = await request.text();
  const sig = request.headers.get('paddle-signature');
  const secret = env('PADDLE_WEBHOOK_SECRET') || '';

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
  // custom_data.cart_ids is the array our checkout-init pushed: the DB UUID per
  // cart item, in the same order as the Paddle items (with non-product cart
  // entries like 'membership:slug' preserved). Used as a fallback when an
  // item came through as ad-hoc (no paddle_price_id) and so title-matching is
  // the only handle we have.
  const cartIds: string[] = Array.isArray(txn.custom_data?.cart_ids) ? txn.custom_data.cart_ids : [];
  // Track membership plans in this order so we can ping ops afterwards.
  const purchasedMemberships: { name: string; slug: string; price_usd: number; qty: number }[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const priceId = it.price?.id;
    const lineTotal = Number(it.totals?.total ?? it.totals?.subtotal ?? 0) / 100;
    const lineUnit = Number(it.price?.unit_price?.amount ?? 0) / 100;
    const qty = Number(it.quantity ?? 1);

    let productId: string | null = null;
    let title: string = String(it.price?.description || it.price?.name || '').slice(0, 240);

    // Detect membership-plan items: match by paddle_price_id OR by membership:<slug> cart marker.
    let membershipPlan: { name: string; slug: string; price_usd: number } | null = null;
    if (priceId) {
      const { data: mp } = await db
        .from('membership_plans')
        .select('name, slug, price_usd')
        .eq('paddle_price_id', priceId)
        .maybeSingle();
      if (mp) membershipPlan = mp;
    }
    if (!membershipPlan && cartIds[i]?.startsWith('membership:')) {
      const slug = cartIds[i].slice('membership:'.length);
      const { data: mp } = await db
        .from('membership_plans')
        .select('name, slug, price_usd')
        .eq('slug', slug)
        .maybeSingle();
      if (mp) membershipPlan = mp;
    }
    if (membershipPlan) {
      purchasedMemberships.push({ ...membershipPlan, qty });
      // Use the canonical plan name for the order_items row so admin/email reads cleanly.
      title = membershipPlan.name;
    }

    // (1) Catalog match: synced products carry a paddle_price_id in our DB.
    if (priceId) {
      const { data: p } = await db
        .from('products')
        .select('id, title')
        .eq('paddle_price_id', priceId)
        .maybeSingle();
      if (p) { productId = p.id; title = p.title; }
    }
    // (2) cart_ids positional fallback — works for ad-hoc items added before
    //     the product was synced to Paddle's catalog.
    if (!productId && cartIds[i] && !cartIds[i].startsWith('membership:')) {
      const { data: p } = await db
        .from('products')
        .select('id, title')
        .eq('id', cartIds[i])
        .maybeSingle();
      if (p) { productId = p.id; title = p.title; }
    }
    // (3) Last resort: match the inline title against products.title.
    if (!productId && title) {
      const { data: p } = await db
        .from('products')
        .select('id, title')
        .eq('title', title)
        .maybeSingle();
      if (p) { productId = p.id; }
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

  // ── Ops notification: new membership purchase ─────────────────────
  // Sends to OPS_INBOX so Jolly can spin up the manual fulfilment side
  // (first 8-file pack + monthly schedule). Best-effort — failure here
  // never rolls back the order.
  if (purchasedMemberships.length && email && email !== 'unknown@digitalchiselco.com') {
    try {
      const opsCustomerName =
        customerName || (txn.custom_data && txn.custom_data.customer_name) || null;
      const { subject, html, text } = membershipPurchaseNotification({
        customerEmail: email,
        customerName: opsCustomerName,
        orderId: order.id,
        orderShortId: String(order.id).slice(0, 8),
        createdAt: new Date().toISOString(),
        currency,
        plans: purchasedMemberships,
        totalPaid: total,
        invoiceNumber: txn.invoice_number || null,
      });
      const r = await sendEmail({
        to: OPS_INBOX,
        subject,
        html,
        text,
        replyTo: email,            // hitting reply goes straight to the customer
        idempotencyKey: `membership-ops:${order.id}`,
      });
      if (r.ok && !r.skipped) {
        console.log(`[email] Membership ops notification sent for order ${order.id.slice(0, 8)} (id=${r.id})`);
      } else if (r.skipped) {
        console.log(`[email] Membership ops notification skipped (Resend not configured) — order ${order.id.slice(0, 8)}`);
      } else {
        console.error(`[email] Membership ops notification failed for order ${order.id.slice(0, 8)}: ${r.error}`);
      }
    } catch (e) {
      console.error(`[email] Membership ops notification threw for order ${order.id}:`, e);
    }
  }

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

      // Pull receipt-grade fields straight from Paddle's payload so our email
      // can fully replace Paddle's generic receipt.
      const tax = Number(txn.details?.totals?.tax ?? 0) / 100 || 0;
      const discountTotal = Number(txn.details?.totals?.discount ?? 0) / 100 || 0;
      const card = txn.payments?.[0]?.method_details?.card;
      const paymentMethod = card ? {
        type: txn.payments?.[0]?.method_details?.type || 'card',
        cardBrand: card.type || null,
        last4: card.last4 || null,
      } : null;
      const invoiceNumber = txn.invoice_number || null;
      // Permanent redirect endpoint on OUR domain. The endpoint fetches a
      // fresh pre-signed invoice URL from Paddle on each click — Paddle's
      // direct URLs expire after 1 hour, so emailing them directly breaks.
      const siteUrl = (env('PUBLIC_SITE_URL') || 'https://digitalchiselco.com').replace(/\/$/, '');
      const paddleInvoiceUrl = invoiceNumber ? `${siteUrl}/api/invoice/${txn.id}` : null;

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
        invoiceNumber,
        paddleInvoiceUrl,
        subtotal,
        tax,
        discountTotal,
        paymentMethod,
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
