// Marketing email templates: subscriber nurture drip (5 stages), abandoned-cart
// reminder, post-purchase followups (review / new arrivals / loyalty reward).
// Every template includes a signed one-click unsubscribe link. All sends are
// gated behind the admin "Automations" toggles — nothing fires until the owner
// has previewed and enabled each system.

import crypto from 'node:crypto';

const SITE = (process.env.PUBLIC_SITE_URL || 'https://digitalchiselco.com').replace(/\/$/, '');
const BRONZE = '#854F0B', BRONZE_DARK = '#5E380A', CREAM = '#F5EFE3', INK = '#2A1A0E';
// The carved-wood shop logo (same file as site_settings.logo_image_url).
const LOGO_URL = process.env.EMAIL_LOGO_URL
  || 'https://tutalnieozbngrsfywes.supabase.co/storage/v1/object/public/site-media/brand/1782452499676-lgzcu7.png';

function esc(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

export function unsubSig(email: string): string {
  const secret = process.env.ACCOUNT_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'unsub';
  return crypto.createHmac('sha256', secret).update(email.toLowerCase()).digest('hex').slice(0, 24);
}
export function unsubUrl(email: string): string {
  return `${SITE}/api/unsubscribe?e=${encodeURIComponent(email.toLowerCase())}&s=${unsubSig(email)}`;
}

export type MiniProduct = { title: string; slug: string; image_url?: string | null; price_usd?: number | null };

export function renderShell(subject: string, heading: string, bodyHtml: string, email: string): string {
  return shell(subject, heading, bodyHtml, email);
}

export type TemplateOverride = { kind: string; subject?: string | null; heading?: string | null; body_html?: string | null };

/** Apply an owner-saved override (Admin → Automations) on top of a built
 *  template. Subject/heading swap in-place; a body_html override re-renders
 *  the inner body inside the brand shell (logo + footer + unsubscribe kept). */
export function applyOverride(
  out: { subject: string; html: string; text: string },
  ovr: TemplateOverride | undefined | null,
  email: string,
  defaultHeading: string,
): { subject: string; html: string; text: string } {
  if (!ovr) return out;
  const subject = (ovr.subject || '').trim() || out.subject;
  const heading = (ovr.heading || '').trim() || defaultHeading;
  if ((ovr.body_html || '').trim()) {
    const html = shell(subject, heading, ovr.body_html as string, email);
    const text = (ovr.body_html as string).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1200) + `\nUnsubscribe: ${unsubUrl(email)}`;
    return { subject, html, text };
  }
  if (subject === out.subject && heading === defaultHeading) return out;
  // subject/heading-only override: patch the rendered html
  let html = out.html.replace(/<title>[^<]*<\/title>/, `<title>${esc(subject)}</title>`);
  html = html.replace(/(<h1[^>]*>)[^<]*(<\/h1>)/, `$1${esc(heading)}$2`);
  return { subject, html, text: out.text };
}

/** Default headings per template kind (used when an override sets only body/subject). */
export const TEMPLATE_HEADINGS: Record<string, string> = {
  drip1: 'How did the free pack carve?',
  drip2: 'Our most-carved designs',
  drip3: 'One bundle, a whole collection',
  drip4: 'The membership pays for itself',
  drip5: 'Here is 15% off — our treat',
  cart: 'Still thinking it over?',
  review7: 'Show us your carve 🪵',
  arrivals30: 'New designs are in',
  loyalty: 'A permanent thank-you',
  weekly: 'Fresh from the workshop 🪵',
  browse: 'Still thinking it over? 🪵',
};

function shell(subject: string, heading: string, bodyHtml: string, email: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${CREAM};font-family:Helvetica,Arial,sans-serif;color:${INK};">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:${CREAM};padding:32px 12px;"><tr><td align="center">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #E5DDD0;">
<tr><td style="background:${BRONZE_DARK};color:${CREAM};padding:28px 24px;text-align:center;">
  <img src="${LOGO_URL}" alt="DigitalChiselCo" width="72" height="72" style="display:block;margin:0 auto 10px;border-radius:12px;">
  <div style="font-size:11px;letter-spacing:2px;color:#FAC775;text-transform:uppercase;margin-bottom:8px;">DigitalChiselCo</div>
  <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:1.25;color:#ffffff;">${esc(heading)}</h1>
</td></tr>
<tr><td style="padding:26px 28px 22px;">${bodyHtml}</td></tr>
<tr><td style="background:${CREAM};padding:16px 28px;text-align:center;font-size:11px;color:#8a7a68;">
  DigitalChiselCo &middot; premium bas-relief STL files<br>
  <a href="${SITE}" style="color:${BRONZE};">digitalchiselco.com</a> &middot; <a href="${unsubUrl(email)}" style="color:#8a7a68;">unsubscribe from these emails</a>
</td></tr>
</table></td></tr></table></body></html>`;
}

const btn = (href: string, label: string) =>
  `<p style="text-align:center;margin:20px 0 6px;"><a href="${esc(href)}" style="display:inline-block;background:${BRONZE_DARK};color:${CREAM};text-decoration:none;padding:12px 26px;border-radius:8px;font-size:15px;font-weight:500;">${label}</a></p>`;

function productGrid(products: MiniProduct[]): string {
  if (!products.length) return '';
  const cells = products.slice(0, 3).map((p) => `
    <td width="33%" style="padding:6px;vertical-align:top;">
      <a href="${SITE}/product/${esc(p.slug)}" style="text-decoration:none;color:${INK};">
        ${p.image_url ? `<img src="${esc(p.image_url)}" width="170" style="width:100%;border-radius:8px;display:block;" alt="${esc(p.title)}">` : ''}
        <div style="font-size:12px;line-height:1.4;margin-top:6px;color:${INK};">${esc(p.title.split('|')[0].trim().slice(0, 55))}</div>
        ${p.price_usd != null ? `<div style="font-size:13px;color:${BRONZE};font-weight:500;margin-top:2px;">$${Number(p.price_usd).toFixed(2)}</div>` : ''}
      </a>
    </td>`).join('');
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"><tr>${cells}</tr></table>`;
}

type Out = { subject: string; html: string; text: string };

// ── Nurture drip (5 stages, ~4 days apart) ───────────────────────────
export function dripEmail(stage: number, d: {
  email: string; bestsellers?: MiniProduct[]; bundle?: MiniProduct | null;
  plan?: { name: string; months: number; files_per_month: number; price_usd: number } | null;
  couponCode?: string;
}): Out {
  const e = d.email;
  if (stage === 1) {
    const subject = 'Did you carve your free pack yet?';
    const body = `
      <p style="margin:0;font-size:15px;line-height:1.6;color:#555;">Hi fellow maker,</p>
      <p style="margin:10px 0 0;font-size:15px;line-height:1.6;color:#555;">A little while ago you grabbed our free STL pack — I'd genuinely love to know: <strong>did you get a chance to carve any of them?</strong></p>
      <p style="margin:10px 0 0;font-size:15px;line-height:1.6;color:#555;">Just hit reply and tell me what you're carving these days (and what designs you wish existed — we make new ones every week, and subscriber ideas regularly become real files).</p>
      ${btn(SITE + '/free', 'Re-download the free pack')}
      <p style="margin:14px 0 0;font-size:13px;color:#777;">— Jolly, DigitalChiselCo</p>`;
    return { subject, html: shell(subject, 'How did the free pack carve?', body, e), text: `Did you carve the free pack yet? Reply and tell me what you're carving. Re-download: ${SITE}/free\nUnsubscribe: ${unsubUrl(e)}` };
  }
  if (stage === 2) {
    const subject = 'The 5 designs our carvers buy most';
    const body = `
      <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#555;">Over <strong>5,000 carvers</strong> have bought from us — these are the designs they choose most. Every file is a watertight, CNC-tested 3D relief with commercial use included.</p>
      ${productGrid(d.bestsellers || [])}
      ${btn(SITE + '/catalog', 'Browse the full catalog')}`;
    return { subject, html: shell(subject, 'Our most-carved designs', body, e), text: `Our bestsellers: ${SITE}/catalog\nUnsubscribe: ${unsubUrl(e)}` };
  }
  if (stage === 3) {
    const b = d.bundle;
    const subject = b ? `${b.title.split('|')[0].trim()} — one bundle, a whole collection` : 'Bundles: a whole collection for less';
    const body = `
      <p style="margin:0;font-size:15px;line-height:1.6;color:#555;">Single files are great — but <strong>bundles are where the value is</strong>: a full themed collection for less than the price of three singles.</p>
      ${b ? productGrid([b]) : ''}
      <p style="margin:12px 0 0;font-size:14px;color:#555;line-height:1.6;">And remember: any <strong>2+ designs get 10% off automatically</strong> in the cart (code SET10).</p>
      ${btn(SITE + '/collections/premium-bundle-offer', 'See all bundles')}`;
    return { subject, html: shell(subject, 'One bundle, a whole collection', body, e), text: `Bundles: ${SITE}/collections/premium-bundle-offer\nUnsubscribe: ${unsubUrl(e)}` };
  }
  if (stage === 4) {
    const p = d.plan;
    const perFile = p ? (Number(p.price_usd) / (p.months * p.files_per_month)).toFixed(2) : '2.50';
    const subject = 'Fresh designs every month — from $' + perFile + ' per file';
    const body = `
      <p style="margin:0;font-size:15px;line-height:1.6;color:#555;">If you carve regularly, the membership is the best deal we offer: <strong>${p ? p.files_per_month : 8} brand-new bas-relief designs every month</strong>, delivered to your inbox and your account.</p>
      <ul style="margin:12px 0 0;padding-left:18px;font-size:14px;color:#555;line-height:1.7;">
        <li>Works out around <strong>$${perFile} per design</strong> (singles are $5–13)</li>
        <li>Commercial use included — sell what you carve</li>
        <li>Every pack stays yours forever</li>
      </ul>
      ${btn(SITE + '/#membership', 'See membership plans')}`;
    return { subject, html: shell(subject, 'The membership pays for itself', body, e), text: `Membership: ${SITE}/#membership\nUnsubscribe: ${unsubUrl(e)}` };
  }
  const code = d.couponCode || 'CARVE15';
  const subject = `A 15% thank-you, just for you (code ${code})`;
  const body = `
    <p style="margin:0;font-size:15px;line-height:1.6;color:#555;">You've been with us a couple of weeks now, so here's a proper thank-you: <strong>15% off anything in the store</strong> — singles, bundles, anything.</p>
    <p style="text-align:center;margin:18px 0 0;"><span style="display:inline-block;background:${CREAM};border:1px dashed ${BRONZE};border-radius:8px;padding:12px 28px;font-family:monospace;font-size:20px;letter-spacing:2px;color:${BRONZE_DARK};font-weight:bold;">${esc(code)}</span></p>
    <p style="margin:10px 0 0;font-size:12px;color:#999;text-align:center;">Paste it in the cart's promo box. Don't wait too long — it won't last forever.</p>
    ${btn(SITE + '/catalog', 'Pick your designs')}`;
  return { subject, html: shell(subject, 'Here is 15% off — our treat', body, e), text: `15% off with code ${code}: ${SITE}/catalog\nUnsubscribe: ${unsubUrl(e)}` };
}

// ── Abandoned cart (one reminder, ~20h later) ────────────────────────
export function cartReminderEmail(d: { email: string; items: { title: string; price: number }[]; subtotal: number }): Out {
  const subject = 'Your cart is saved — your designs are waiting';
  const rows = d.items.slice(0, 6).map((i) => `<tr><td style="padding:6px 0;font-size:14px;color:${INK};">${esc(i.title.split('|')[0].trim().slice(0, 60))}</td><td style="padding:6px 0;font-size:14px;color:#777;text-align:right;">$${Number(i.price).toFixed(2)}</td></tr>`).join('');
  const body = `
    <p style="margin:0;font-size:15px;line-height:1.6;color:#555;">You left ${d.items.length === 1 ? 'a design' : d.items.length + ' designs'} in your cart — no rush, it's saved on your device. Here's what's waiting:</p>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top:12px;border-top:1px solid #E5DDD0;">${rows}</table>
    ${d.items.length >= 2 ? `<p style="margin:10px 0 0;font-size:13px;color:${BRONZE_DARK};">💡 2+ designs = 10% off automatically (code SET10 in the cart).</p>` : ''}
    ${btn(SITE + '/cart', 'Finish checkout')}
    <p style="margin:12px 0 0;font-size:12px;color:#999;">Files are delivered instantly by email after payment.</p>`;
  return { subject, html: shell(subject, 'Still thinking it over?', body, d.email), text: `Your cart is waiting: ${SITE}/cart\nUnsubscribe: ${unsubUrl(d.email)}` };
}

// ── Post-purchase followups ──────────────────────────────────────────
export function reviewRequestEmail(d: { email: string; name?: string | null; itemTitles: string[] }): Out {
  const subject = 'How did it carve? (we feature customer work)';
  const first = (d.itemTitles[0] || 'your design').split('|')[0].trim();
  const body = `
    <p style="margin:0;font-size:15px;line-height:1.6;color:#555;">${d.name ? `Hi ${esc(d.name)},` : 'Hi,'}</p>
    <p style="margin:10px 0 0;font-size:15px;line-height:1.6;color:#555;">It's been about a week since you picked up <strong>${esc(first)}</strong> — did it make it onto the machine yet?</p>
    <p style="margin:10px 0 0;font-size:15px;line-height:1.6;color:#555;"><strong>Reply with a photo of your carve</strong> and we may feature it on our "Carved by you" wall (with credit). Rough first attempts welcome — makers love seeing real results.</p>
    ${btn(SITE + '/account', 'Re-download your files')}`;
  return { subject, html: shell(subject, 'Show us your carve 🪵', body, d.email), text: `How did ${first} carve? Reply with a photo! Files: ${SITE}/account\nUnsubscribe: ${unsubUrl(d.email)}` };
}

export function newArrivalsEmail(d: { email: string; name?: string | null; products: MiniProduct[] }): Out {
  const subject = 'Fresh off the chisel — new designs this month';
  const body = `
    <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#555;">${d.name ? `Hi ${esc(d.name)},` : 'Hi,'} here's what's new in the workshop since your last order:</p>
    ${productGrid(d.products)}
    ${btn(SITE + '/catalog', 'See everything new')}`;
  return { subject, html: shell(subject, 'New designs are in', body, d.email), text: `New designs: ${SITE}/catalog\nUnsubscribe: ${unsubUrl(d.email)}` };
}

export function loyaltyEmail(d: { email: string; name?: string | null; code: string }): Out {
  const subject = 'You earned a permanent 10% discount 🏆';
  const body = `
    <p style="margin:0;font-size:15px;line-height:1.6;color:#555;">${d.name ? `Hi ${esc(d.name)},` : 'Hi,'}</p>
    <p style="margin:10px 0 0;font-size:15px;line-height:1.6;color:#555;">This is your <strong>third order</strong> with us — that officially makes you one of our favourite carvers. Thank you for coming back.</p>
    <p style="margin:10px 0 0;font-size:15px;line-height:1.6;color:#555;">Here's your personal, <strong>permanent 10% code</strong> — it works on every future order, forever, on top of nothing expiring:</p>
    <p style="text-align:center;margin:18px 0 0;"><span style="display:inline-block;background:${CREAM};border:1px dashed ${BRONZE};border-radius:8px;padding:12px 28px;font-family:monospace;font-size:20px;letter-spacing:2px;color:${BRONZE_DARK};font-weight:bold;">${esc(d.code)}</span></p>
    ${btn(SITE + '/catalog', 'Browse new designs')}`;
  return { subject, html: shell(subject, 'A permanent thank-you', body, d.email), text: `Your permanent 10% code: ${d.code}\nUnsubscribe: ${unsubUrl(d.email)}` };
}

// ── Gift card delivery ───────────────────────────────────────────────
export function giftCardEmail(d: { email: string; buyerName?: string | null; cards: { code: string; amount: number }[] }): Out {
  const total = d.cards.reduce((s, c) => s + c.amount, 0);
  const subject = `Your DigitalChiselCo gift card${d.cards.length > 1 ? 's are' : ' is'} here 🎁`;
  const cardBlocks = d.cards.map((c) => `
    <div style="background:${CREAM};border:2px dashed ${BRONZE};border-radius:12px;padding:20px 24px;text-align:center;margin:0 0 12px;">
      <div style="font-size:13px;color:${BRONZE_DARK};letter-spacing:1px;text-transform:uppercase;">Gift card value</div>
      <div style="font-family:Georgia,serif;font-size:34px;color:${BRONZE_DARK};margin:2px 0 10px;">$${c.amount.toFixed(2)}</div>
      <div style="display:inline-block;background:#fff;border:1px solid ${BRONZE};border-radius:8px;padding:10px 24px;font-family:monospace;font-size:20px;letter-spacing:3px;color:${BRONZE_DARK};font-weight:bold;">${esc(c.code)}</div>
      <div style="font-size:11px;color:#8a7a68;margin-top:8px;">One-time code · works on every design, bundle & membership · never expires</div>
    </div>`).join('');
  const body = `
    <p style="margin:0;font-size:15px;line-height:1.6;color:#555;">${d.buyerName ? `Hi ${esc(d.buyerName)},` : 'Hi,'}</p>
    <p style="margin:10px 0 16px;font-size:15px;line-height:1.6;color:#555;">Thank you for your purchase! Here ${d.cards.length > 1 ? 'are your gift cards' : 'is your gift card'} — <strong>forward this email to the lucky carver</strong> (or print it and tuck it in a card). They redeem it in the promo box at checkout.</p>
    ${cardBlocks}
    ${btn(SITE + '/catalog', 'Browse the catalog')}
    <p style="margin:12px 0 0;font-size:12px;color:#999;">Redeeming: add designs to the cart at digitalchiselco.com, open "Have a promo code?", paste the code.</p>`;
  return { subject, html: shell(subject, `A $${total.toFixed(0)} gift of carving`, body, d.email), text: `Your DigitalChiselCo gift card code(s): ${d.cards.map((c) => c.code + ' ($' + c.amount + ')').join(', ')}\nRedeem in the cart promo box at ${SITE}` };
}

// ── Weekly fresh-designs digest (Monday broadcast, toggle-gated) ─────
export function weeklyDigestEmail(d: {
  email: string; products: MiniProduct[]; pdfUrl?: string | null; weekNumber?: number;
  /** e.g. "Jul 28 – Aug 3" — shown under the heading so readers know exactly
   *  what window these designs were added in. */
  range?: string;
}): Out {
  const n = d.products.length;
  const titles = [
    (k: number) => `Fresh Off the Chisel — ${k} New Design${k === 1 ? '' : 's'} This Week`,
    (k: number) => `Hot Off the CNC: ${k} Brand-New Carving${k === 1 ? '' : 's'}`,
    (k: number) => `This Week at the Workshop: ${k} New Relief${k === 1  ? '' : 's'}`,
  ];
  const subject = titles[(d.weekNumber ?? 0) % titles.length](n);
  // EVERY design added this week (rows of 3, up to 60) — 30 new designs means
  // all 30 are shown. Links are PRODUCT PAGES only, never download links.
  const rows: string[] = [];
  for (let i = 0; i < Math.min(60, n); i += 3) rows.push(productGrid(d.products.slice(i, i + 3)));
  const body = `
    ${d.range ? `<p style="margin:0 0 4px;text-align:center;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:${BRONZE};">Added this week · ${esc(d.range)}</p>` : ''}
    <p style="margin:0;font-size:15px;line-height:1.6;color:#555;">Hi fellow maker,</p>
    <p style="margin:10px 0 16px;font-size:15px;line-height:1.6;color:#555;">The chisels have not been idle — <strong>${n} brand-new design${n === 1 ? '' : 's'}</strong> landed in the shop this week. Fresh geometry, clean toolpaths, ready to carve:</p>
    ${rows.join('')}
    ${d.pdfUrl ? `<p style="text-align:center;margin:18px 0 4px;"><a href="${esc(d.pdfUrl)}" style="display:inline-block;border:2px solid ${BRONZE_DARK};color:${BRONZE_DARK};text-decoration:none;padding:10px 22px;border-radius:8px;font-size:14px;font-weight:500;">📄 Download this week's lookbook (PDF)</a></p>` : ''}
    ${btn(SITE + '/catalog', 'See everything new')}
    <p style="margin:14px 0 0;font-size:13px;color:#777;text-align:center;">Buying a few? <a href="${SITE}/bundle-builder" style="color:${BRONZE};">Pick any 5 for a flat $25 →</a></p>`;
  const text = `${n} new designs this week at DigitalChiselCo: ` + d.products.slice(0, 12).map((p) => `${p.title.split('|')[0].trim()} ${SITE}/product/${p.slug}`).join(' · ') + `\nUnsubscribe: ${unsubUrl(d.email)}`;
  return { subject, html: shell(subject, 'Fresh from the workshop 🪵', body, d.email), text };
}

// ── Referral reward (referrer earns their 15% after a friend orders) ──
export function referralRewardEmail(d: { email: string; code: string; friendEmail?: string }): Out {
  const subject = 'Your friend just carved — here is your 15% reward 🎉';
  const body = `
    <p style="margin:0;font-size:15px;line-height:1.6;color:#555;">Great news —</p>
    <p style="margin:10px 0 16px;font-size:15px;line-height:1.6;color:#555;">Someone you shared DigitalChiselCo with just placed their first order. As a thank-you, here is <strong>15% off your next design, bundle or membership</strong>:</p>
    <div style="text-align:center;margin:6px 0 18px;">
      <div style="display:inline-block;background:#fff;border:1px dashed ${BRONZE};border-radius:8px;padding:12px 28px;font-family:monospace;font-size:22px;letter-spacing:3px;color:${BRONZE_DARK};font-weight:bold;">${esc(d.code)}</div>
    </div>
    ${btn(SITE + '/catalog', 'Spend my reward')}
    <p style="margin:14px 0 0;font-size:13px;color:#777;text-align:center;">Keep sharing your link — every friend who orders earns you another reward.</p>`;
  return { subject, html: shell(subject, 'You earned a reward 🎉', body, d.email), text: `Your referral reward code: ${d.code} — 15% off at ${SITE}\nUnsubscribe: ${unsubUrl(d.email)}` };
}

// ── Abandoned browse (viewed designs, never carted) ──────────────────
export function abandonedBrowseEmail(d: { email: string; products: MiniProduct[] }): Out {
  const subject = 'Still thinking about these designs?';
  const rows: string[] = [];
  for (let i = 0; i < Math.min(6, d.products.length); i += 3) rows.push(productGrid(d.products.slice(i, i + 3)));
  const body = `
    <p style="margin:0;font-size:15px;line-height:1.6;color:#555;">Hi fellow maker,</p>
    <p style="margin:10px 0 16px;font-size:15px;line-height:1.6;color:#555;">You were browsing a few designs at the workshop recently — here they are again in case one is calling to your machine:</p>
    ${rows.join('')}
    ${btn(SITE + '/catalog', 'Back to browsing')}
    <p style="margin:14px 0 0;font-size:13px;color:#777;text-align:center;">Buying a few? <a href="${SITE}/bundle-builder" style="color:${BRONZE};">Pick any 5 for a flat $25 →</a></p>`;
  const text = `Designs you viewed at DigitalChiselCo: ` + d.products.slice(0, 6).map((p) => `${p.title.split('|')[0].trim()} ${SITE}/product/${p.slug}`).join(' · ') + `\nUnsubscribe: ${unsubUrl(d.email)}`;
  return { subject, html: shell(subject, 'Still thinking it over? 🪵', body, d.email), text };
}
