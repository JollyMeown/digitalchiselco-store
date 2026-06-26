// Branded transactional email templates for DigitalChiselCo.
// All templates render inline-styled HTML (email clients ignore <style> often)
// and produce a plain-text fallback for poor renderers.

import { money } from './pricing';

const SITE = process.env.PUBLIC_SITE_URL || 'https://digitalchiselco.com';
const BRAND_NAME = 'DigitalChiselCo';
const BRAND_BRONZE = '#854F0B';
const BRAND_BRONZE_DARK = '#5E380A';
const BRAND_CREAM = '#F5EFE3';
const BRAND_INK = '#2A1A0E';

export type OrderEmailItem = {
  title: string;
  qty: number;
  price_usd: number;
  download_links?: { name?: string; url: string }[];
};

export type OrderEmailData = {
  email: string;
  customerName?: string | null;
  orderId: string;
  orderShortId: string;       // last 8 of UUID for display
  createdAt: string;          // ISO timestamp
  total: number;              // USD
  currency: string;
  items: OrderEmailItem[];
  logoUrl?: string | null;    // optional brand logo
  // Receipt fields — populated from Paddle webhook so we can suppress Paddle's
  // own email and have ours be the full record customers keep.
  invoiceNumber?: string | null;     // human-friendly invoice number (Paddle's)
  paddleInvoiceUrl?: string | null;  // hosted PDF invoice link (Paddle's)
  subtotal?: number | null;
  tax?: number | null;
  discountTotal?: number | null;
  paymentMethod?: {
    type?: string;                   // 'card' | 'paypal' | ...
    cardBrand?: string | null;       // 'visa' | 'mastercard' | ...
    last4?: string | null;
  } | null;
};

/**
 * Order confirmation email with download links. Sent immediately after the
 * Paddle webhook fires `transaction.completed`.
 */
export function orderConfirmation(d: OrderEmailData): { subject: string; html: string; text: string } {
  const dateStr = new Date(d.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const subject = `Your DigitalChiselCo download${d.items.length > 1 ? 's are' : ' is'} ready — Order #${d.orderShortId}`;

  // --- HTML ---
  const itemRowsHtml = d.items.map((it) => {
    const links = (it.download_links || []).map((l) => `
      <a href="${esc(l.url)}" style="display:inline-block;background:${BRAND_BRONZE};color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-size:14px;font-weight:500;margin-top:8px;margin-right:6px;font-family:Helvetica,Arial,sans-serif;">
        ⬇ Download${l.name ? ' &middot; ' + esc(l.name) : ''}
      </a>`).join('');
    const noLinkNote = (!it.download_links || it.download_links.length === 0)
      ? `<div style="font-size:13px;color:#777;margin-top:6px;">Download link will be emailed within a few minutes if not already attached.</div>`
      : '';
    return `
      <tr>
        <td style="padding:14px 0;border-bottom:1px solid #E5DDD0;font-family:Helvetica,Arial,sans-serif;">
          <div style="font-size:15px;color:${BRAND_INK};font-weight:500;">${esc(it.title)}</div>
          <div style="font-size:13px;color:#777;margin-top:2px;">${it.qty}× &middot; ${money(it.price_usd)}</div>
          ${links}
          ${noLinkNote}
        </td>
      </tr>`;
  }).join('');

  const logoHtml = d.logoUrl
    ? `<img src="${esc(d.logoUrl)}" alt="${BRAND_NAME}" width="48" height="48" style="display:block;margin:0 auto 12px;border-radius:8px;">`
    : '';

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND_CREAM};font-family:Helvetica,Arial,sans-serif;color:${BRAND_INK};">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:${BRAND_CREAM};padding:32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #E5DDD0;">

          <!-- Header -->
          <tr>
            <td style="background:${BRAND_BRONZE_DARK};color:${BRAND_CREAM};padding:32px 24px;text-align:center;">
              ${logoHtml}
              <div style="font-size:11px;letter-spacing:2px;color:#FAC775;text-transform:uppercase;margin-bottom:8px;">${BRAND_NAME}</div>
              <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:28px;line-height:1.2;color:#ffffff;">Thank you for your order!</h1>
              <p style="margin:8px 0 0;font-size:14px;color:#E5DDD0;">Your downloads are ready below.</p>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding:28px 28px 8px;">
              <p style="margin:0;font-size:16px;line-height:1.5;color:${BRAND_INK};">
                ${d.customerName ? `Hi ${esc(d.customerName)},` : 'Hi there,'}
              </p>
              <p style="margin:10px 0 0;font-size:15px;line-height:1.6;color:#555;">
                Your CNC-ready bas-relief STL${d.items.length > 1 ? ' files are' : ' file is'} prepared and ready to download. Tap any button below to grab the file. Links don't expire — bookmark this email if you want to come back later.
              </p>
            </td>
          </tr>

          <!-- Order meta -->
          <tr>
            <td style="padding:18px 28px 4px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:${BRAND_CREAM};border-radius:8px;padding:14px 16px;">
                <tr>
                  <td style="font-size:13px;color:#666;font-family:Helvetica,Arial,sans-serif;line-height:1.6;">
                    <strong style="color:${BRAND_INK};">Order #${esc(d.orderShortId)}</strong>${d.invoiceNumber ? ` &middot; Invoice <strong style="color:${BRAND_INK};">${esc(d.invoiceNumber)}</strong>` : ''}<br>
                    ${esc(dateStr)}${d.paymentMethod && d.paymentMethod.last4 ? ` &middot; Paid via ${esc((d.paymentMethod.cardBrand || 'card').toUpperCase())} ending in ${esc(d.paymentMethod.last4)}` : ''}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Items -->
          <tr>
            <td style="padding:8px 28px 12px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                ${itemRowsHtml}
              </table>
            </td>
          </tr>

          <!-- Totals breakdown -->
          <tr>
            <td style="padding:0 28px 4px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:${BRAND_INK};">
                ${(d.subtotal != null) ? `
                <tr>
                  <td style="padding:4px 0;color:#666;">Subtotal</td>
                  <td style="padding:4px 0;text-align:right;color:#666;">${money(d.subtotal)} ${esc(d.currency)}</td>
                </tr>` : ''}
                ${(d.discountTotal && d.discountTotal > 0) ? `
                <tr>
                  <td style="padding:4px 0;color:#188038;">Discount</td>
                  <td style="padding:4px 0;text-align:right;color:#188038;">&minus;${money(d.discountTotal)} ${esc(d.currency)}</td>
                </tr>` : ''}
                ${(d.tax != null && d.tax > 0) ? `
                <tr>
                  <td style="padding:4px 0;color:#666;">Tax</td>
                  <td style="padding:4px 0;text-align:right;color:#666;">${money(d.tax)} ${esc(d.currency)}</td>
                </tr>` : ''}
                <tr>
                  <td style="padding:8px 0;border-top:1px solid #E5DDD0;font-weight:600;font-size:15px;">Total paid</td>
                  <td style="padding:8px 0;text-align:right;border-top:1px solid #E5DDD0;font-weight:600;font-size:15px;">${money(d.total)} ${esc(d.currency)}</td>
                </tr>
              </table>
            </td>
          </tr>

          ${d.paddleInvoiceUrl ? `
          <!-- Invoice download link -->
          <tr>
            <td style="padding:12px 28px 4px;text-align:center;">
              <a href="${esc(d.paddleInvoiceUrl)}" style="font-size:13px;color:${BRAND_BRONZE};text-decoration:underline;">📄 Download PDF invoice</a>
            </td>
          </tr>` : ''}

          <!-- Helpful tips -->
          <tr>
            <td style="padding:8px 28px 24px;">
              <div style="background:#FFFBF4;border-left:3px solid ${BRAND_BRONZE};padding:14px 16px;border-radius:0 6px 6px 0;">
                <div style="font-size:13px;font-weight:500;color:${BRAND_BRONZE_DARK};margin-bottom:6px;">📌 A few quick tips</div>
                <ul style="margin:0;padding-left:18px;font-size:13px;color:#555;line-height:1.6;">
                  <li>Files open in Aspire, VCarve, Carveco, ArtCAM, Fusion 360 — any STL-compatible CAM.</li>
                  <li>Scale freely to your router bed or 3D printer; the geometry stays clean.</li>
                  <li>Commercial use is included — sell the pieces you carve.</li>
                </ul>
              </div>
            </td>
          </tr>

          <!-- Support / footer -->
          <tr>
            <td style="padding:0 28px 28px;">
              <p style="margin:0;font-size:13px;color:#777;line-height:1.6;">
                Trouble downloading or carving? Reply to this email — a real person reads every message and gets back within 24 hours.
              </p>
              <p style="margin:14px 0 0;font-size:13px;color:#777;">
                Want to see your full order history? <a href="${SITE}/account" style="color:${BRAND_BRONZE};text-decoration:underline;">Sign into your account</a>.
              </p>
            </td>
          </tr>

          <!-- Brand footer -->
          <tr>
            <td style="background:${BRAND_CREAM};padding:18px 28px;text-align:center;font-size:12px;color:#888;border-top:1px solid #E5DDD0;">
              ${BRAND_NAME} &middot; Premium STL files for CNC, laser &amp; 3D printing<br>
              <a href="${SITE}" style="color:${BRAND_BRONZE};text-decoration:none;">digitalchiselco.com</a>
            </td>
          </tr>

        </table>
        <p style="font-size:11px;color:#999;margin:16px 0 0;text-align:center;">
          You're receiving this because you bought from ${BRAND_NAME}. Order ID ${esc(d.orderId)}.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;

  // --- Plain text fallback ---
  const itemsTxt = d.items.map((it) => {
    const linksTxt = (it.download_links || []).map((l) => `  - ${l.name ? l.name + ': ' : ''}${l.url}`).join('\n');
    return `* ${it.title} (${it.qty}× ${money(it.price_usd)})\n${linksTxt || '  (link will be sent separately)'}`;
  }).join('\n\n');
  const payLine = d.paymentMethod?.last4
    ? ` - Paid via ${(d.paymentMethod.cardBrand || 'card').toUpperCase()} ending in ${d.paymentMethod.last4}`
    : '';
  const invoiceLine = d.invoiceNumber ? ` - Invoice ${d.invoiceNumber}` : '';
  const totalsTxt = [
    d.subtotal != null ? `Subtotal: ${money(d.subtotal)} ${d.currency}` : null,
    d.discountTotal && d.discountTotal > 0 ? `Discount: -${money(d.discountTotal)} ${d.currency}` : null,
    d.tax != null && d.tax > 0 ? `Tax: ${money(d.tax)} ${d.currency}` : null,
    `Total paid: ${money(d.total)} ${d.currency}`,
  ].filter(Boolean).join('\n');
  const invoiceLink = d.paddleInvoiceUrl ? `\nPDF invoice: ${d.paddleInvoiceUrl}\n` : '';
  const text = `${d.customerName ? `Hi ${d.customerName},` : 'Hi there,'}

Thank you for your order from ${BRAND_NAME}!

Order #${d.orderShortId}${invoiceLine}
${dateStr}${payLine}

Your downloads:
${itemsTxt}

${totalsTxt}
${invoiceLink}
These links don't expire — keep this email for future re-downloads, or sign into your account at ${SITE}/account anytime.

Need help? Reply to this email and a real person will help within 24 hours.

— The DigitalChiselCo team
${SITE}
`;

  return { subject, html, text };
}

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ──────────────────────────────────────────────────────────────────────
// Internal ops notification: new membership purchase.
// Goes to jolly@digitalchiselco.com so the manual side of the membership
// fulfilment (first pack delivery + monthly schedule) can kick off.
// ──────────────────────────────────────────────────────────────────────

export type MembershipPurchaseData = {
  customerEmail: string;
  customerName?: string | null;
  orderId: string;
  orderShortId: string;
  createdAt: string;
  currency: string;
  plans: { name: string; slug: string; price_usd: number; qty: number }[];
  totalPaid: number;
  invoiceNumber?: string | null;
};

export function membershipPurchaseNotification(d: MembershipPurchaseData): { subject: string; html: string; text: string } {
  const planSummary = d.plans.map((p) => `${p.qty}× ${p.name}`).join(', ');
  const subject = `🟢 New membership: ${d.customerName || d.customerEmail} — ${planSummary}`;
  const dateStr = new Date(d.createdAt).toLocaleString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });

  const plansHtml = d.plans.map((p) => `
    <tr>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;">${esc(p.name)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${p.qty}× $${p.price_usd.toFixed(2)}</td>
    </tr>`).join('');

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f7f4ee;font-family:Helvetica,Arial,sans-serif;color:${BRAND_INK};">
  <div style="max-width:560px;margin:0 auto;padding:24px;background:#fff;border:1px solid #eee;border-radius:10px;">
    <div style="background:${BRAND_BRONZE};color:${BRAND_CREAM};padding:14px 18px;border-radius:6px;margin-bottom:18px;">
      <strong style="font-size:16px;">New membership purchase</strong><br>
      <span style="font-size:13px;opacity:.85;">Time to send the first pack.</span>
    </div>

    <p style="margin:0 0 14px;font-size:15px;">A customer just paid for a membership. Their details are below — kick off the manual fulfilment when you have a moment.</p>

    <table style="width:100%;border-collapse:collapse;margin:0 0 18px;font-size:14px;">
      <tr><td style="padding:6px 8px;width:120px;color:#666;">Name</td><td style="padding:6px 8px;"><strong>${esc(d.customerName || '(not provided)')}</strong></td></tr>
      <tr><td style="padding:6px 8px;color:#666;">Email</td><td style="padding:6px 8px;"><a href="mailto:${esc(d.customerEmail)}" style="color:${BRAND_BRONZE};">${esc(d.customerEmail)}</a></td></tr>
      <tr><td style="padding:6px 8px;color:#666;">Order</td><td style="padding:6px 8px;">#${esc(d.orderShortId)}${d.invoiceNumber ? ` · invoice ${esc(d.invoiceNumber)}` : ''}</td></tr>
      <tr><td style="padding:6px 8px;color:#666;">Date</td><td style="padding:6px 8px;">${esc(dateStr)}</td></tr>
    </table>

    <h3 style="font-size:14px;margin:0 0 8px;color:#444;">Plan(s) purchased</h3>
    <table style="width:100%;border-collapse:collapse;margin:0 0 12px;font-size:14px;">${plansHtml}
      <tr><td style="padding:8px;border-top:2px solid #333;"><strong>Total paid</strong></td><td style="padding:8px;border-top:2px solid #333;text-align:right;"><strong>$${d.totalPaid.toFixed(2)} ${esc(d.currency)}</strong></td></tr>
    </table>

    <p style="font-size:13px;color:#666;margin:18px 0 0;">— DigitalChiselCo notifier</p>
  </div>
</body></html>`;

  const text = `New membership purchase

Name : ${d.customerName || '(not provided)'}
Email: ${d.customerEmail}
Order: #${d.orderShortId}${d.invoiceNumber ? ` · invoice ${d.invoiceNumber}` : ''}
Date : ${dateStr}

Plan(s):
${d.plans.map((p) => `  - ${p.qty}× ${p.name} ($${p.price_usd.toFixed(2)})`).join('\n')}

Total paid: $${d.totalPaid.toFixed(2)} ${d.currency}

— DigitalChiselCo notifier`;

  return { subject, html, text };
}
