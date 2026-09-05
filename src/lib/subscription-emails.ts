// Branded transactional emails for the membership system.
// Self-contained (own brand constants + esc + shell) so it does not depend on
// the order-email module. Inline-styled for email-client safety. Every pack
// link is a TRACKED link (/api/member/pack) so the admin can see who actually
// downloaded, not just who opened. No em dashes anywhere (house rule).

import { SUCCESS_FEE_PCT } from './marketplace-pricing';

const SITE = (process.env.PUBLIC_SITE_URL || 'https://digitalchiselco.com').replace(/\/$/, '');
const BRAND_NAME = 'DigitalChiselCo';
const BRONZE = '#854F0B';
const BRONZE_DARK = '#5E380A';
const CREAM = '#F5EFE3';
const INK = '#2A1A0E';
const GOLD = '#FAC775';

function esc(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

// The same Cut Local block the order emails carry (green): every member owns a
// machine, so the maker network is relevant to all of them. Shown only when
// the marketplace is live (the caller decides, same gate as the order email).
export const MAKER_BLOCK_HTML = `
      <tr><td style="padding:0 28px 24px;">
        <div style="background:#1c4a48;color:#F5EFE3;padding:18px 22px;border-radius:8px;">
          <div style="font-size:11px;letter-spacing:2px;color:#9fe0d9;text-transform:uppercase;margin-bottom:5px;">Cut Local &middot; maker network</div>
          <div style="font-family:Georgia,'Times New Roman',serif;font-size:17px;margin-bottom:6px;">Your machine could be earning between projects</div>
          <p style="margin:0 0 12px;font-size:13px;line-height:1.6;color:#dce8e6;">
            Plenty of people love these designs and own no CNC, so they ask us who can build one near them. We send those jobs, design file included, to makers like you. Free to join, the buyer pays you directly, and we take ${SUCCESS_FEE_PCT}% only when a job completes.
          </p>
          <a href="${SITE}/faq?for=makers" style="display:inline-block;background:#FAC775;color:#5E380A;text-decoration:none;padding:9px 20px;border-radius:6px;font-size:13px;font-weight:600;">&#128295; See how Cut Local works</a>
        </div>
      </td></tr>`;
export const MAKER_BLOCK_TEXT = `\n\nOwn a CNC, laser or 3D printer? Cut Local sends paid local jobs to makers like you, with the design file included. Free to join, the buyer pays you directly, and we take ${SUCCESS_FEE_PCT}% only on completed jobs: ${SITE}/faq?for=makers`;

function shell(opts: { subject: string; heading: string; subheading?: string; bodyHtml: string; logoUrl?: string | null; preheader?: string; makerBlock?: boolean }): string {
  const logoHtml = opts.logoUrl
    ? `<img src="${esc(opts.logoUrl)}" alt="${BRAND_NAME}" width="48" height="48" style="display:block;margin:0 auto 12px;border-radius:8px;">`
    : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(opts.subject)}</title></head>
<body style="margin:0;padding:0;background:${CREAM};font-family:Helvetica,Arial,sans-serif;color:${INK};">
  ${opts.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${CREAM};">${esc(opts.preheader)}</div>` : ''}
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:${CREAM};padding:32px 12px;"><tr><td align="center">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #E5DDD0;">
      <tr><td style="background:${BRONZE_DARK};color:${CREAM};padding:32px 24px;text-align:center;">
        ${logoHtml}
        <div style="font-size:11px;letter-spacing:2px;color:${GOLD};text-transform:uppercase;margin-bottom:8px;">${BRAND_NAME} &middot; Membership</div>
        <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.25;color:#ffffff;">${esc(opts.heading)}</h1>
        ${opts.subheading ? `<p style="margin:8px 0 0;font-size:14px;color:#E5DDD0;">${esc(opts.subheading)}</p>` : ''}
      </td></tr>
      <tr><td style="padding:26px 28px 22px;">${opts.bodyHtml}</td></tr>
      ${opts.makerBlock ? MAKER_BLOCK_HTML : ''}
      <tr><td style="background:${CREAM};padding:18px 28px;text-align:center;font-size:12px;color:#8a7a68;line-height:1.6;">
        You are receiving this because you hold a ${BRAND_NAME} membership.<br>
        <a href="${SITE}/account" style="color:${BRONZE};text-decoration:underline;">Your packs and membership</a> &middot; <a href="${SITE}/membership" style="color:${BRONZE};text-decoration:underline;">Plans</a> &middot; reply to this email for help
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

const btn = (href: string, label: string, primary = true) =>
  `<a href="${esc(href)}" style="display:inline-block;margin:6px 6px 0;background:${primary ? BRONZE_DARK : '#ffffff'};color:${primary ? CREAM : BRONZE_DARK};border:1px solid ${BRONZE_DARK};text-decoration:none;padding:13px 24px;border-radius:8px;font-size:15px;font-weight:600;">${label}</a>`;

function packButtons(standardLink?: string | null, bonusLink?: string | null): string {
  const parts: string[] = [];
  if (standardLink) parts.push(btn(standardLink, '&#11015; Download this month\'s pack', true));
  if (bonusLink) parts.push(btn(bonusLink, '&#11088; Bonus files (Premium)', false));
  return parts.length ? `<p style="text-align:center;margin:18px 0 4px;">${parts.join('')}</p>` : '';
}

export type PackItem = { title: string; slug?: string | null; image_url?: string | null };

// OWNER RULE (2026-09-06): pack emails carry NO design pictures and no cover.
// The pictures are the shop's copyright and travel only inside the download
// PDF (and the member portal behind login). The email lists the titles as text.
function itemGrid(items?: PackItem[] | null): string {
  const list = (items || []).filter((i) => i && i.title).slice(0, 8);
  if (!list.length) return '';
  const cells = list.map((i) => `<td width="50%" style="padding:3px 6px 3px 0;vertical-align:top;font-size:13px;line-height:1.45;color:#555;">&#8226; ${esc(String(i.title).split('|')[0].trim().slice(0, 60))}</td>`);
  const rows: string[] = [];
  for (let r = 0; r < cells.length; r += 2) rows.push(`<tr>${cells.slice(r, r + 2).join('')}${cells.slice(r, r + 2).length < 2 ? '<td></td>' : ''}</tr>`);
  return `<div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:${BRONZE};font-weight:700;margin:18px 0 6px;">Inside this pack</div>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">${rows.join('')}</table>
  <p style="margin:8px 0 0;font-size:12px;color:#8a7a68;">Pictures of every design are in the download PDF and in your account.</p>`;
}

// Premium members: their bonus designs with their own button. Standard
// members: one quiet line saying what Premium adds, linking to the plans.
function bonusSection(d: DropEmailData): string {
  if (d.isPremium && d.bonusLink) {
    const list = (d.bonusItems || []).filter((i) => i && i.title).slice(0, 4);
    // titles only, no pictures (owner rule, see itemGrid)
    const cells = list.map((i) => `<td style="padding:3px 6px 3px 0;vertical-align:top;font-size:13px;line-height:1.45;color:#555;">&#8226; ${esc(String(i.title).split('|')[0].trim().slice(0, 60))}</td>`).join('');
    return `
    <div style="margin:22px 0 0;padding:16px 18px 18px;background:#FFF8E8;border:1px solid #F1D9A6;border-radius:10px;">
      <div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:${BRONZE_DARK};font-weight:700;">&#11088; Your Premium bonus</div>
      <p style="margin:6px 0 0;font-size:14px;line-height:1.6;color:#555;">Premium members receive ${list.length || 'two'} extra design${list.length === 1 ? '' : 's'} this month, on top of the pack above.</p>
      ${cells ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top:8px;"><tr>${cells}</tr></table>` : ''}
      <p style="text-align:center;margin:14px 0 0;">${btn(d.bonusLink, '&#11088; Download the bonus files', false)}</p>
    </div>`;
  }
  if (d.isPremium && !d.bonusLink) {
    // A Premium member whose pack month predates the bonus bundles (for
    // example a September 2026 first pack): say so instead of staying silent.
    return `<p style="margin:18px 0 0;font-size:12.5px;line-height:1.6;color:#8a7a68;">&#11088; Your Premium bonus designs begin with ${d.nextPackLabel ? `the <strong>${esc(d.nextPackLabel)}</strong> pack` : 'your next pack'}, two extra designs every month on top of the eight above.</p>`;
  }
  if (!d.isPremium && d.hasBonus) {
    return `<p style="margin:18px 0 0;font-size:12.5px;line-height:1.6;color:#8a7a68;">Premium members also received two bonus designs this month. <a href="${SITE}/membership" style="color:${BRONZE};">See the 12-month Premium plan</a>.</p>`;
  }
  return '';
}

const termLine = (d: DropEmailData) => {
  const bits: string[] = [];
  if (d.nextPackLabel) bits.push(`Your next pack arrives in <strong>${esc(d.nextPackLabel)}</strong>.`);
  else if (d.endDateLabel) bits.push(`This was the last pack of your term, which runs to <strong>${esc(d.endDateLabel)}</strong>.`);
  if (d.endDateLabel && d.nextPackLabel) bits.push(`Your membership runs to ${esc(d.endDateLabel)}.`);
  return bits.length ? `<p style="margin:16px 0 0;font-size:13px;color:#777;line-height:1.6;">${bits.join(' ')}</p>` : '';
};

export type DropEmailData = {
  email: string;
  customerName?: string | null;
  planName: string;
  monthLabel: string;     // e.g. 'June 2026'
  packTitle?: string | null;
  previewNote?: string | null;
  coverUrl?: string | null;
  items?: PackItem[] | null;
  standardLink?: string | null;   // TRACKED link
  bonusLink?: string | null;      // TRACKED link (Premium members only)
  bonusItems?: PackItem[] | null; // the bonus designs (Premium members only)
  hasBonus?: boolean;             // the pack HAS a bonus bundle (shown as an upsell line to standard members)
  dropNumber: number;     // 1-based
  totalDrops: number;
  isPremium: boolean;
  nextPackLabel?: string | null;  // e.g. 'October 2026'
  endDateLabel?: string | null;
  logoUrl?: string | null;
  resend?: boolean;
  makerInvite?: boolean;   // append the Cut Local block (marketplace live)       // "here it is again"
};

const greet = (name?: string | null) => `<p style="margin:0;font-size:16px;color:${INK};">${name ? `Hi ${esc(String(name).split(' ')[0])},` : 'Hi there,'}</p>`;
// Cover image deliberately NOT sent in emails (owner rule 2026-09-06: the
// pictures are copyright and only travel inside the PDF / portal). Kept as a
// no-op so the templates stay readable; coverUrl is still used by the portal.
const cover = (_d: DropEmailData) => '';
const pending = `<div style="background:#FFFBF4;border-left:3px solid ${BRONZE};padding:14px 16px;border-radius:0 6px 6px 0;margin-top:16px;font-size:14px;color:#555;line-height:1.6;">This month&#39;s pack is being finalised. You will get a follow-up email with the download the moment it is live, usually within a day, and it will also appear in your account.</div>`;

/** First pack, sent the moment a membership starts. */
export function firstPackEmail(d: DropEmailData): { subject: string; html: string; text: string } {
  const hasFiles = !!(d.standardLink || d.bonusLink);
  const subject = hasFiles
    ? `Welcome! Your first STL pack is ready: ${d.monthLabel}`
    : `Welcome to the membership. Your ${d.monthLabel} pack arrives shortly`;
  const body = `
    ${greet(d.customerName)}
    <p style="margin:10px 0 0;font-size:15px;line-height:1.6;color:#555;">Welcome to the <strong>${esc(d.planName)}</strong>. You will receive <strong>${d.totalDrops} monthly packs</strong> of fresh bas-relief STL files, and this is pack <strong>1 of ${d.totalDrops}</strong>.</p>
    ${cover(d)}
    ${d.packTitle ? `<p style="margin:14px 0 0;font-size:16px;color:${INK};font-family:Georgia,serif;"><strong>${esc(d.packTitle)}</strong></p>` : ''}
    ${d.previewNote ? `<p style="margin:6px 0 0;font-size:14px;color:#666;line-height:1.6;">${esc(d.previewNote)}</p>` : ''}
    ${hasFiles ? packButtons(d.standardLink) : pending}
    ${itemGrid(d.items)}
    ${hasFiles ? bonusSection(d) : ''}
    ${termLine(d)}
    <p style="margin:14px 0 0;font-size:13px;color:#777;line-height:1.6;">Every pack also lives in <a href="${SITE}/account" style="color:${BRONZE};">your account</a>, forever. New packs arrive by email automatically each month; nothing to do.</p>`;
  const html = shell({ subject, heading: 'Your membership is live', subheading: `Pack 1 of ${d.totalDrops}`, bodyHtml: body, logoUrl: d.logoUrl, makerBlock: d.makerInvite, preheader: d.packTitle || `Pack 1 of ${d.totalDrops} is ready to download` });
  const text = `Welcome to the ${d.planName}.\n\nThis is pack 1 of ${d.totalDrops}.\n${d.packTitle ? d.packTitle + '\n' : ''}${d.previewNote ? d.previewNote + '\n' : ''}\n${d.standardLink ? 'Download: ' + d.standardLink + '\n' : ''}${d.bonusLink ? 'Bonus: ' + d.bonusLink + '\n' : ''}\nAll packs: ${SITE}/account`;
  return { subject, html, text: text + (d.makerInvite ? MAKER_BLOCK_TEXT : '') };
}

/** Monthly drop (and re-sends). */
export function monthlyDropEmail(d: DropEmailData): { subject: string; html: string; text: string } {
  const subject = d.resend
    ? `Here is your ${d.monthLabel} STL pack again (pack ${d.dropNumber} of ${d.totalDrops})`
    : `Your ${d.monthLabel} STL pack is here: pack ${d.dropNumber} of ${d.totalDrops}`;
  const body = `
    ${greet(d.customerName)}
    <p style="margin:10px 0 0;font-size:15px;line-height:1.6;color:#555;">${d.resend ? 'As requested, here is your pack again.' : 'Your new monthly pack is ready.'} This is pack <strong>${d.dropNumber} of ${d.totalDrops}</strong>.</p>
    ${cover(d)}
    ${d.packTitle ? `<p style="margin:14px 0 0;font-size:16px;color:${INK};font-family:Georgia,serif;"><strong>${esc(d.packTitle)}</strong></p>` : ''}
    ${d.previewNote ? `<p style="margin:6px 0 0;font-size:14px;color:#666;line-height:1.6;">${esc(d.previewNote)}</p>` : ''}
    ${(d.standardLink || d.bonusLink) ? packButtons(d.standardLink) : pending}
    ${itemGrid(d.items)}
    ${(d.standardLink || d.bonusLink) ? bonusSection(d) : ''}
    ${termLine(d)}
    <p style="margin:14px 0 0;font-size:13px;color:#777;line-height:1.6;">All your packs are always available in <a href="${SITE}/account" style="color:${BRONZE};">your account</a>.</p>`;
  const html = shell({ subject, heading: `${d.monthLabel} pack is ready`, subheading: `Pack ${d.dropNumber} of ${d.totalDrops}`, bodyHtml: body, logoUrl: d.logoUrl, makerBlock: d.makerInvite, preheader: d.packTitle || `Pack ${d.dropNumber} of ${d.totalDrops}` });
  const text = `Your ${d.monthLabel} STL pack (pack ${d.dropNumber} of ${d.totalDrops}) is ready.\n${d.packTitle ? d.packTitle + '\n' : ''}${d.previewNote ? d.previewNote + '\n' : ''}\n${d.standardLink ? 'Download: ' + d.standardLink + '\n' : ''}${d.bonusLink ? 'Bonus: ' + d.bonusLink + '\n' : ''}\nAll packs: ${SITE}/account`;
  return { subject, html, text: text + (d.makerInvite ? MAKER_BLOCK_TEXT : '') };
}

export type ExpiryEmailData = {
  email: string;
  customerName?: string | null;
  planName: string;
  endDateLabel: string;    // e.g. '12 August 2026'
  daysLeft?: number;
  renewUrl: string;
  coupon?: string | null;
  packsReceived?: number;
  logoUrl?: string | null;
  makerInvite?: boolean;
};

const couponBox = (code?: string | null, note = 'Use this code at checkout.') => code
  ? `<p style="text-align:center;margin:14px 0 0;"><span style="display:inline-block;background:${CREAM};border:1px dashed ${BRONZE};border-radius:8px;padding:10px 26px;font-family:monospace;font-size:20px;letter-spacing:2px;color:${BRONZE_DARK};font-weight:bold;">${esc(code)}</span></p><p style="margin:6px 0 0;text-align:center;font-size:12px;color:#8a7a68;">${esc(note)}</p>`
  : '';

/** Reminder before the term ends (sent at each configured day, e.g. 10 and 3). */
export function preExpiryEmail(d: ExpiryEmailData): { subject: string; html: string; text: string } {
  const days = d.daysLeft ?? 7;
  const when = days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
  const subject = days <= 3
    ? `Your membership ends ${when}: renew to keep the packs coming`
    : `Your membership ends ${when} (${d.endDateLabel})`;
  const body = `
    ${greet(d.customerName)}
    <p style="margin:10px 0 0;font-size:15px;line-height:1.6;color:#555;">Your <strong>${esc(d.planName)}</strong> ends ${when}, on <strong>${esc(d.endDateLabel)}</strong>. Renew now and the monthly packs carry on without a gap; your new term starts the day the current one ends, so nothing is lost by renewing early.</p>
    <p style="text-align:center;margin:20px 0 4px;">${btn(d.renewUrl, 'Renew my membership')}</p>
    ${couponBox(d.coupon, 'Members renewing get this code at checkout.')}
    <p style="margin:16px 0 0;font-size:13px;color:#777;line-height:1.6;">Everything you have received stays in <a href="${SITE}/account" style="color:${BRONZE};">your account</a> whatever you decide.${d.packsReceived ? ` So far you have ${d.packsReceived} pack${d.packsReceived === 1 ? '' : 's'} there.` : ''}</p>`;
  const html = shell({ subject, heading: `Your membership ends ${when}`, subheading: `Last day ${d.endDateLabel}`, bodyHtml: body, logoUrl: d.logoUrl, makerBlock: d.makerInvite, preheader: 'Renew and the packs continue without a gap' });
  const text = `Your ${d.planName} ends ${when}, on ${d.endDateLabel}.\nRenew: ${d.renewUrl}${d.coupon ? `\nCode: ${d.coupon}` : ''}\nYour packs stay in your account: ${SITE}/account`;
  return { subject, html, text: text + (d.makerInvite ? MAKER_BLOCK_TEXT : '') };
}

/** Sent on the end date. */
export function expiryEmail(d: ExpiryEmailData): { subject: string; html: string; text: string } {
  const subject = 'Your membership has ended. Your packs are still yours';
  const body = `
    ${greet(d.customerName)}
    <p style="margin:10px 0 0;font-size:15px;line-height:1.6;color:#555;">Your <strong>${esc(d.planName)}</strong> has finished. Thank you for carving with us. Every pack you received is yours to keep, in <a href="${SITE}/account" style="color:${BRONZE};">your account</a>.</p>
    <p style="margin:12px 0 0;font-size:15px;line-height:1.6;color:#555;">Want to keep going? Start a new term and the monthly drops pick straight back up.</p>
    <p style="text-align:center;margin:20px 0 4px;">${btn(d.renewUrl, 'Start a new membership')}</p>
    ${couponBox(d.coupon)}`;
  const html = shell({ subject, heading: 'Thank you for your membership', subheading: 'Your files are still yours', bodyHtml: body, logoUrl: d.logoUrl, makerBlock: d.makerInvite });
  const text = `Your ${d.planName} has ended. Your packs stay in your account: ${SITE}/account\nStart again: ${d.renewUrl}${d.coupon ? `\nCode: ${d.coupon}` : ''}`;
  return { subject, html, text: text + (d.makerInvite ? MAKER_BLOCK_TEXT : '') };
}

/** Win-back, some days after expiry, with the code. */
export function winbackEmail(d: ExpiryEmailData & { newPackTitle?: string | null }): { subject: string; html: string; text: string } {
  const subject = d.coupon ? `We kept your seat: ${d.coupon} brings the packs back` : 'The packs have not stopped. Come back?';
  const body = `
    ${greet(d.customerName)}
    <p style="margin:10px 0 0;font-size:15px;line-height:1.6;color:#555;">Your membership ended on ${esc(d.endDateLabel)}, and the workshop has not slowed down since${d.newPackTitle ? `: the latest pack is <strong>${esc(d.newPackTitle)}</strong>` : ''}. If you would like the monthly drops back, here is a little nudge.</p>
    ${couponBox(d.coupon, 'Applies to any plan at checkout.')}
    <p style="text-align:center;margin:20px 0 4px;">${btn(d.renewUrl, 'Restart my membership')}</p>
    <p style="margin:16px 0 0;font-size:13px;color:#777;line-height:1.6;">Everything you received before is still in <a href="${SITE}/account" style="color:${BRONZE};">your account</a>. Nothing expires.</p>`;
  const html = shell({ subject, heading: 'The packs are still coming', subheading: 'Pick up where you left off', bodyHtml: body, logoUrl: d.logoUrl, makerBlock: d.makerInvite });
  const text = `Your membership ended on ${d.endDateLabel}.${d.coupon ? ` Code ${d.coupon} at checkout.` : ''}\nRestart: ${d.renewUrl}\nYour packs: ${SITE}/account`;
  return { subject, html, text: text + (d.makerInvite ? MAKER_BLOCK_TEXT : '') };
}
