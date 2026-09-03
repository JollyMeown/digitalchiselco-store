// Rebuild + (re)send the order-confirmation email for an existing order.
//
// Why this exists: on 2026-08-24 a buyer paid $55.99 while the Resend daily
// quota was exhausted — the order was fulfilled but the confirmation with the
// download links silently never went out (orders.confirmation_sent_at stayed
// null). This module makes that impossible to miss:
//   • sendOrderConfirmationForOrder(orderId)  — rebuild everything from the DB
//     (+ best-effort receipt fields from Paddle) and send as a BUYER-CRITICAL
//     email (kind 'order' bypasses the quota gate), stamping
//     confirmation_sent_at on success.
//   • sweepUnsentOrderConfirmations()         — find paid orders whose
//     confirmation was never sent (older than a grace period) and send them.
//     Runs every 10 minutes (cults-sales-poll function), at the top of the
//     nightly automation, and on demand from the admin.
import type { SupabaseClient } from '@supabase/supabase-js';
import { orderConfirmation } from './email-templates';
import { send as sendEmail } from './resend';
import { telegramOwner } from './notify';

function env(name: string): string | undefined {
  return process.env[name] ?? (import.meta as any).env?.[name];
}

// The buyer guide attached to every order confirmation. Regenerate with
// `node scripts/make_portal_guide.mjs` (same URL, upsert).
export const PORTAL_GUIDE_URL = 'https://tutalnieozbngrsfywes.supabase.co/storage/v1/object/public/downloads/portal-guide.pdf';
export const PORTAL_GUIDE_FILENAME = 'How-Your-DigitalChiselCo-Portal-Works.pdf';

// A short block appended to the confirmation HTML pointing at the attached
// guide, so buyers discover the portal (lifetime re-downloads, points, ...).
export function portalGuideBlock(): string {
  return `<div style="margin:26px 0 0;padding:16px 18px;background:#faf6ee;border:1px solid #e5d9c3;border-radius:8px;">
    <p style="margin:0 0 6px;font-weight:bold;color:#5a3a10;">📖 New here? Your portal in 3 pages</p>
    <p style="margin:0;color:#6b5d4a;font-size:14px;line-height:1.5;">We attached a short PDF showing how to sign in to your customer portal and what it gives you: lifetime re-downloads of every file you buy, loyalty points (10 per $1), and your personal give-15%-get-15% referral link. You can also <a href="${PORTAL_GUIDE_URL}" style="color:#854F0B;">view the guide online</a> or go straight to <a href="https://digitalchiselco.com/account" style="color:#854F0B;">digitalchiselco.com/account</a>.</p>
  </div>`;
}

export async function buildOrderConfirmationForOrder(
  db: SupabaseClient,
  orderId: string,
): Promise<{ ok: true; order: any; subject: string; html: string; text: string } | { ok: false; error: string }> {
  const { data: order, error: oErr } = await db.from('orders')
    .select('id, email, status, total, subtotal, currency, created_at, customer_name, paddle_transaction_id, discount_amount, confirmation_sent_at, deleted_at')
    .eq('id', orderId).maybeSingle();
  if (oErr || !order) return { ok: false, error: oErr?.message || 'order not found' };
  if (order.deleted_at) return { ok: false, error: 'order is deleted' };
  if (!order.email || order.email === 'unknown@digitalchiselco.com') return { ok: false, error: 'order has no usable email' };

  // Items + customizations + downloads + logo — same sources as the webhook.
  const [{ data: orderItems }, { data: settings }] = await Promise.all([
    db.from('order_items')
      .select('id, title, qty, price_usd, product_id, order_item_customizations(fields), products(is_customizable, image_url)')
      .eq('order_id', order.id),
    db.from('site_settings').select('logo_image_url').eq('id', 1).maybeSingle(),
  ]);
  const productIds = (orderItems || []).map((it: any) => it.product_id).filter(Boolean);
  const downloadsByProduct: Record<string, { name?: string; url: string }[]> = {};
  if (productIds.length) {
    const { data: dls } = await db.from('product_downloads')
      .select('product_id, file_name, download_link').in('product_id', productIds);
    for (const dl of dls || []) (downloadsByProduct[dl.product_id] ||= []).push({ name: dl.file_name || undefined, url: dl.download_link });
  }
  const emailItems = (orderItems || []).map((it: any) => {
    const fields = (it.order_item_customizations || []).flatMap((c: any) => (Array.isArray(c.fields) ? c.fields : []));
    const isCustomized = fields.length > 0 || !!(it.products && (it.products as any).is_customizable);
    return {
      title: it.title || 'Item',
      qty: it.qty || 1,
      price_usd: Number(it.price_usd) || 0,
      download_links: isCustomized ? undefined : (it.product_id ? downloadsByProduct[it.product_id] : undefined),
      image_url: (it.products as any)?.image_url || null,
      is_customized: isCustomized,
      customization_fields: fields,
    };
  });

  // Best-effort receipt extras from Paddle (never blocks the send).
  let tax = 0, invoiceNumber: string | null = null, paymentMethod: any = null;
  const siteUrl = (env('PUBLIC_SITE_URL') || 'https://digitalchiselco.com').replace(/\/$/, '');
  let paddleInvoiceUrl: string | null = null;
  if (order.paddle_transaction_id && env('PADDLE_API_KEY')) {
    try {
      const base = (env('PADDLE_ENV') === 'sandbox') ? 'https://sandbox-api.paddle.com' : 'https://api.paddle.com';
      const r = await fetch(`${base}/transactions/${order.paddle_transaction_id}`, { headers: { authorization: `Bearer ${env('PADDLE_API_KEY')}` } });
      if (r.ok) {
        const txn = (await r.json()).data;
        tax = Number(txn?.details?.totals?.tax ?? 0) / 100 || 0;
        invoiceNumber = txn?.invoice_number || null;
        const card = txn?.payments?.[0]?.method_details?.card;
        paymentMethod = card ? { type: txn.payments?.[0]?.method_details?.type || 'card', cardBrand: card.type || null, last4: card.last4 || null } : null;
        if (invoiceNumber) paddleInvoiceUrl = `${siteUrl}/api/invoice/${order.paddle_transaction_id}`;
      }
    } catch { /* receipt extras are optional */ }
  }

  // Cut Local invite: every buyer of a relief STL owns a machine, so this is the
  // best-qualified maker audience we have. Only when the marketplace is live,
  // and never to someone who has already applied or been approved.
  let makerInvite = false;
  try {
    const [{ data: gs }, { data: alreadyMaker }] = await Promise.all([
      db.from('growth_settings').select('marketplace_enabled').eq('id', 1).maybeSingle(),
      db.from('makers').select('id').eq('email', String(order.email || '').toLowerCase()).maybeSingle(),
    ]);
    makerInvite = !!gs?.marketplace_enabled && !alreadyMaker;
  } catch { /* the receipt matters more than the invite */ }

  const built = orderConfirmation({
    email: order.email,
    makerInvite,
    customerName: order.customer_name || null,
    gift: null,
    crossSells: [],
    orderId: order.id,
    orderShortId: String(order.id).slice(0, 8),
    createdAt: order.created_at,
    total: Number(order.total) || 0,
    currency: order.currency || 'USD',
    items: emailItems,
    logoUrl: (settings as any)?.logo_image_url || null,
    invoiceNumber,
    paddleInvoiceUrl,
    subtotal: Number(order.subtotal) || Number(order.total) || 0,
    tax,
    discountTotal: Number(order.discount_amount) || 0,
    paymentMethod,
  } as any);
  // Portal guide pointer, inserted just before the closing of the email body.
  const html = built.html.includes('</body>')
    ? built.html.replace('</body>', portalGuideBlock() + '</body>')
    : built.html + portalGuideBlock();
  return { ok: true, order, subject: built.subject, html, text: built.text };
}

export async function sendOrderConfirmationForOrder(
  db: SupabaseClient,
  orderId: string,
  opts: { reason: string; force?: boolean },
): Promise<{ ok: boolean; sent?: boolean; error?: string; email?: string; skippedWhy?: string }> {
  const built = await buildOrderConfirmationForOrder(db, orderId);
  if (!built.ok) return { ok: false, error: built.error };
  const { order, subject, html, text } = built;
  if (order.status !== 'paid') return { ok: false, error: `order status is '${order.status}', not paid`, email: order.email };
  if (order.confirmation_sent_at && !opts.force) return { ok: true, sent: false, email: order.email, skippedWhy: 'already sent ' + order.confirmation_sent_at };

  const res = await sendEmail({
    to: order.email,
    subject,
    html,
    text,
    // Fresh key per attempt: the original webhook send used `order:<id>`, and
    // Resend's idempotency window would swallow a same-key retry as a no-op.
    idempotencyKey: `order:${order.id}:${opts.reason}:${new Date().toISOString().slice(0, 13)}`,
    tags: [{ name: 'kind', value: 'order' }],
    attachments: [{ filename: PORTAL_GUIDE_FILENAME, path: PORTAL_GUIDE_URL }],
  });
  if (res.ok && !res.skipped) {
    await db.from('orders').update({ confirmation_sent_at: new Date().toISOString() }).eq('id', order.id);
    return { ok: true, sent: true, email: order.email };
  }
  return { ok: false, sent: false, email: order.email, error: res.error || (res.skipped ? 'Resend not configured' : 'send failed') };
}

// Grace period before the sweep resends: the webhook normally delivers within
// seconds; 10 minutes avoids double emails when both race.
const GRACE_MS = 10 * 60 * 1000;

// confirmation_sent_at stamping began 2026-08-18 (migration 058). For older
// orders a null stamp does NOT mean the email never went out (it usually did,
// there was just nowhere to record it), so the automatic sweep ignores them.
// They still show as "not sent" in Admin → Orders for a human decision.
const SWEEP_FLOOR = '2026-08-18T00:00:00Z';

export async function sweepUnsentOrderConfirmations(db: SupabaseClient, limit = 5): Promise<{ checked: number; sent: number; failed: number; notes: string[] }> {
  const out = { checked: 0, sent: 0, failed: 0, notes: [] as string[] };
  const cutoff = new Date(Date.now() - GRACE_MS).toISOString();
  const { data: rows, error } = await db.from('orders')
    .select('id, email, total, currency, created_at')
    .eq('status', 'paid').is('confirmation_sent_at', null).is('deleted_at', null)
    .neq('email', 'unknown@digitalchiselco.com')
    .gte('created_at', SWEEP_FLOOR)
    .lte('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) { out.notes.push('query failed: ' + error.message); return out; }
  for (const o of rows || []) {
    out.checked++;
    const r = await sendOrderConfirmationForOrder(db, o.id, { reason: 'sweep' });
    if (r.ok && r.sent) {
      out.sent++;
      out.notes.push(`sent #${String(o.id).slice(0, 8)} → ${o.email}`);
      await telegramOwner(`📬 <b>Order email recovered</b>\nConfirmation for order #${String(o.id).slice(0, 8)} ($${Number(o.total).toFixed(2)}) was missing and has now been sent to ${o.email}.`).catch(() => {});
    } else if (r.ok && !r.sent) {
      out.notes.push(`#${String(o.id).slice(0, 8)}: ${r.skippedWhy}`);
    } else {
      out.failed++;
      out.notes.push(`#${String(o.id).slice(0, 8)} FAILED: ${r.error}`);
    }
  }
  return out;
}
