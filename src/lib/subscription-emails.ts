// Branded transactional emails for the membership drip automation.
// Self-contained (own brand constants + esc + shell) so it doesn't depend on
// the order-email module. Rendered inline-styled for email-client safety.

const SITE = process.env.PUBLIC_SITE_URL || 'https://digitalchiselco.com';
const BRAND_NAME = 'DigitalChiselCo';
const BRAND_BRONZE = '#854F0B';
const BRAND_BRONZE_DARK = '#5E380A';
const BRAND_CREAM = '#F5EFE3';
const BRAND_INK = '#2A1A0E';

function esc(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function shell(opts: { subject: string; heading: string; subheading?: string; bodyHtml: string; logoUrl?: string | null }): string {
  const logoHtml = opts.logoUrl
    ? `<img src="${esc(opts.logoUrl)}" alt="${BRAND_NAME}" width="48" height="48" style="display:block;margin:0 auto 12px;border-radius:8px;">`
    : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(opts.subject)}</title></head>
<body style="margin:0;padding:0;background:${BRAND_CREAM};font-family:Helvetica,Arial,sans-serif;color:${BRAND_INK};">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:${BRAND_CREAM};padding:32px 12px;"><tr><td align="center">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #E5DDD0;">
      <tr><td style="background:${BRAND_BRONZE_DARK};color:${BRAND_CREAM};padding:32px 24px;text-align:center;">
        ${logoHtml}
        <div style="font-size:11px;letter-spacing:2px;color:#FAC775;text-transform:uppercase;margin-bottom:8px;">${BRAND_NAME} &middot; Membership</div>
        <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.25;color:#ffffff;">${esc(opts.heading)}</h1>
        ${opts.subheading ? `<p style="margin:8px 0 0;font-size:14px;color:#E5DDD0;">${esc(opts.subheading)}</p>` : ''}
      </td></tr>
      <tr><td style="padding:26px 28px 22px;">${opts.bodyHtml}</td></tr>
      <tr><td style="background:${BRAND_CREAM};padding:18px 28px;text-align:center;font-size:12px;color:#8a7a68;">
        You are receiving this because you hold a DigitalChiselCo membership.<br>
        <a href="${SITE}/account" style="color:${BRAND_BRONZE};text-decoration:underline;">Manage your membership</a> &middot; <a href="${SITE}" style="color:${BRAND_BRONZE};text-decoration:underline;">digitalchiselco.com</a>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

function packButtons(standardLink?: string | null, bonusLink?: string | null): string {
  const btn = (href: string, label: string, primary: boolean) =>
    `<a href="${esc(href)}" style="display:inline-block;margin:6px 6px 0;background:${primary ? BRAND_BRONZE_DARK : '#ffffff'};color:${primary ? BRAND_CREAM : BRAND_BRONZE_DARK};border:1px solid ${BRAND_BRONZE_DARK};text-decoration:none;padding:12px 22px;border-radius:8px;font-size:15px;font-weight:500;">${label}</a>`;
  const parts: string[] = [];
  if (standardLink) parts.push(btn(standardLink, '&#11015; Download this month&#39;s pack', true));
  if (bonusLink) parts.push(btn(bonusLink, '&#11088; Bonus files (Premium)', false));
  return parts.length ? `<p style="text-align:center;margin:18px 0 4px;">${parts.join('')}</p>` : '';
}

export type DropEmailData = {
  email: string;
  customerName?: string | null;
  planName: string;
  monthLabel: string;     // e.g. 'June 2026'
  packTitle?: string | null;
  previewNote?: string | null;
  standardLink?: string | null;
  bonusLink?: string | null;
  dropNumber: number;     // 1-based
  totalDrops: number;
  isPremium: boolean;
  logoUrl?: string | null;
};

/** First pack — sent immediately after a membership is purchased. */
export function firstPackEmail(d: DropEmailData): { subject: string; html: string; text: string } {
  const subject = `Welcome! Your first STL pack is ready — ${d.monthLabel}`;
  const hasFiles = !!(d.standardLink || d.bonusLink);
  const body = `
    <p style="margin:0;font-size:16px;color:${BRAND_INK};">${d.customerName ? `Hi ${esc(d.customerName)},` : 'Hi there,'}</p>
    <p style="margin:10px 0 0;font-size:15px;line-height:1.6;color:#555;">Welcome to the <strong>${esc(d.planName)}</strong>! You will receive <strong>${d.totalDrops} monthly packs</strong> of fresh bas-relief STL files — this is pack <strong>1 of ${d.totalDrops}</strong>.</p>
    ${d.packTitle ? `<p style="margin:16px 0 0;font-size:15px;color:${BRAND_INK};"><strong>${esc(d.packTitle)}</strong></p>` : ''}
    ${d.previewNote ? `<p style="margin:6px 0 0;font-size:14px;color:#666;line-height:1.6;">${esc(d.previewNote)}</p>` : ''}
    ${hasFiles ? packButtons(d.standardLink, d.bonusLink) : `<div style="background:#FFFBF4;border-left:3px solid ${BRAND_BRONZE};padding:14px 16px;border-radius:0 6px 6px 0;margin-top:16px;font-size:14px;color:#555;">This month&#39;s pack is being finalised — you will get a follow-up email with the download the moment it is live (usually within a day).</div>`}
    <p style="margin:18px 0 0;font-size:13px;color:#777;line-height:1.6;">Every pack also lives in <a href="${SITE}/account" style="color:${BRAND_BRONZE};">your account</a>. New packs arrive automatically each month — no action needed.</p>
    ${d.isPremium ? `<p style="margin:10px 0 0;font-size:13px;color:${BRAND_BRONZE_DARK};">&#11088; As a Premium member you also get the bonus files each month.</p>` : ''}`;
  const html = shell({ subject, heading: 'Your membership is live', subheading: `Pack 1 of ${d.totalDrops}`, bodyHtml: body, logoUrl: d.logoUrl });
  const text = `Welcome to the ${d.planName}!\n\nThis is pack 1 of ${d.totalDrops}.\n${d.packTitle ? d.packTitle + '\n' : ''}${d.previewNote ? d.previewNote + '\n' : ''}\n${d.standardLink ? 'Download: ' + d.standardLink + '\n' : ''}${d.bonusLink ? 'Bonus: ' + d.bonusLink + '\n' : ''}\nAll packs: ${SITE}/account`;
  return { subject, html, text };
}

/** Monthly drop — sent by the cron on each next_drop_date. */
export function monthlyDropEmail(d: DropEmailData): { subject: string; html: string; text: string } {
  const subject = `Your ${d.monthLabel} STL pack is here — pack ${d.dropNumber} of ${d.totalDrops}`;
  const body = `
    <p style="margin:0;font-size:16px;color:${BRAND_INK};">${d.customerName ? `Hi ${esc(d.customerName)},` : 'Hi there,'}</p>
    <p style="margin:10px 0 0;font-size:15px;line-height:1.6;color:#555;">Your new monthly pack is ready — this is pack <strong>${d.dropNumber} of ${d.totalDrops}</strong>.</p>
    ${d.packTitle ? `<p style="margin:16px 0 0;font-size:15px;color:${BRAND_INK};"><strong>${esc(d.packTitle)}</strong></p>` : ''}
    ${d.previewNote ? `<p style="margin:6px 0 0;font-size:14px;color:#666;line-height:1.6;">${esc(d.previewNote)}</p>` : ''}
    ${packButtons(d.standardLink, d.bonusLink)}
    <p style="margin:18px 0 0;font-size:13px;color:#777;line-height:1.6;">All your packs are always available in <a href="${SITE}/account" style="color:${BRAND_BRONZE};">your account</a>.</p>`;
  const html = shell({ subject, heading: `${d.monthLabel} pack is ready`, subheading: `Pack ${d.dropNumber} of ${d.totalDrops}`, bodyHtml: body, logoUrl: d.logoUrl });
  const text = `Your ${d.monthLabel} STL pack (pack ${d.dropNumber} of ${d.totalDrops}) is ready.\n${d.packTitle ? d.packTitle + '\n' : ''}${d.previewNote ? d.previewNote + '\n' : ''}\n${d.standardLink ? 'Download: ' + d.standardLink + '\n' : ''}${d.bonusLink ? 'Bonus: ' + d.bonusLink + '\n' : ''}\nAll packs: ${SITE}/account`;
  return { subject, html, text };
}

export type ExpiryEmailData = {
  email: string;
  customerName?: string | null;
  planName: string;
  endDateLabel: string;    // e.g. '12 August 2026'
  renewUrl: string;
  logoUrl?: string | null;
};

/** Pre-expiry reminder — sent ~7 days before end_date. */
export function preExpiryEmail(d: ExpiryEmailData): { subject: string; html: string; text: string } {
  const subject = 'Your membership ends soon — renew to keep the packs coming';
  const body = `
    <p style="margin:0;font-size:16px;color:${BRAND_INK};">${d.customerName ? `Hi ${esc(d.customerName)},` : 'Hi there,'}</p>
    <p style="margin:10px 0 0;font-size:15px;line-height:1.6;color:#555;">Your <strong>${esc(d.planName)}</strong> wraps up on <strong>${esc(d.endDateLabel)}</strong> — that is your last scheduled pack. Renew now to keep the fresh STL files arriving every month without a gap.</p>
    <p style="text-align:center;margin:20px 0 4px;"><a href="${esc(d.renewUrl)}" style="display:inline-block;background:${BRAND_BRONZE_DARK};color:${BRAND_CREAM};text-decoration:none;padding:13px 28px;border-radius:8px;font-size:15px;font-weight:500;">Renew my membership</a></p>
    <p style="margin:16px 0 0;font-size:13px;color:#777;line-height:1.6;">Everything you have already received stays in <a href="${SITE}/account" style="color:${BRAND_BRONZE};">your account</a> forever — renewing just continues the monthly drops.</p>`;
  const html = shell({ subject, heading: 'Your membership ends soon', subheading: `Last pack on ${d.endDateLabel}`, bodyHtml: body, logoUrl: d.logoUrl });
  const text = `Your ${d.planName} ends on ${d.endDateLabel}.\nRenew to keep the monthly packs coming: ${d.renewUrl}\nYour existing packs stay in your account: ${SITE}/account`;
  return { subject, html, text };
}

/** Expiry — sent on/after end_date. */
export function expiryEmail(d: ExpiryEmailData): { subject: string; html: string; text: string } {
  const subject = 'Your membership has ended — your packs are still yours';
  const body = `
    <p style="margin:0;font-size:16px;color:${BRAND_INK};">${d.customerName ? `Hi ${esc(d.customerName)},` : 'Hi there,'}</p>
    <p style="margin:10px 0 0;font-size:15px;line-height:1.6;color:#555;">Your <strong>${esc(d.planName)}</strong> has now finished. Thank you for carving with us! Every pack you received is still yours to keep in <a href="${SITE}/account" style="color:${BRAND_BRONZE};">your account</a>.</p>
    <p style="margin:12px 0 0;font-size:15px;line-height:1.6;color:#555;">Want to keep going? Start a new term and the monthly drops pick right back up.</p>
    <p style="text-align:center;margin:20px 0 4px;"><a href="${esc(d.renewUrl)}" style="display:inline-block;background:${BRAND_BRONZE_DARK};color:${BRAND_CREAM};text-decoration:none;padding:13px 28px;border-radius:8px;font-size:15px;font-weight:500;">Start a new membership</a></p>`;
  const html = shell({ subject, heading: 'Thank you for your membership', subheading: 'Your files are still yours', bodyHtml: body, logoUrl: d.logoUrl });
  const text = `Your ${d.planName} has ended. Your packs stay in your account: ${SITE}/account\nStart again anytime: ${d.renewUrl}`;
  return { subject, html, text };
}
