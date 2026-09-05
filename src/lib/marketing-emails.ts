// Marketing email templates: subscriber nurture drip (5 stages), abandoned-cart
// reminder, post-purchase followups (review / new arrivals / loyalty reward).
// Every template includes a signed one-click unsubscribe link. All sends are
// gated behind the admin "Automations" toggles — nothing fires until the owner
// has previewed and enabled each system.

import crypto from 'node:crypto';
import { FOUNDING_CREDITS, SUCCESS_FEE_PCT, packLine } from './marketplace-pricing';

const SITE = (process.env.PUBLIC_SITE_URL || 'https://digitalchiselco.com').replace(/\/$/, '');
const BRONZE = '#854F0B', BRONZE_DARK = '#5E380A', CREAM = '#F5EFE3', INK = '#2A1A0E';
// The carved-wood shop logo (same file as site_settings.logo_image_url).
const LOGO_URL = process.env.EMAIL_LOGO_URL
  || 'https://tutalnieozbngrsfywes.supabase.co/storage/v1/object/public/site-media/brand/1782452499676-lgzcu7.png';

function esc(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

// Reads env the way the rest of the app does (process.env at runtime on
// Netlify, import.meta.env in Astro dev) — the old process.env-only read fell
// through to the literal 'unsub' in dev, and any missing secret in prod would
// have made every unsubscribe link forgeable. Fail closed instead.
function envAny(name: string): string | undefined {
  return process.env[name] ?? (import.meta as any).env?.[name];
}
export function unsubSig(email: string): string {
  const secret = envAny('ACCOUNT_TOKEN_SECRET') || envAny('SUPABASE_SERVICE_ROLE_KEY');
  if (!secret) throw new Error('unsubscribe signing secret not configured (ACCOUNT_TOKEN_SECRET / SUPABASE_SERVICE_ROLE_KEY)');
  return crypto.createHmac('sha256', secret).update(email.toLowerCase()).digest('hex').slice(0, 24);
}
// Opaque token: base64url(email).hmac — keeps the address out of the URL in
// plain text (Netlify logs, browser history). The endpoint still accepts the
// legacy ?e=&s= form for links already in people's inboxes.
export function unsubToken(email: string): string {
  const e = email.toLowerCase().trim();
  return `${Buffer.from(e, 'utf8').toString('base64url')}.${unsubSig(e)}`;
}
export function unsubUrl(email: string): string {
  return `${SITE}/api/unsubscribe?t=${unsubToken(email)}`;
}
// RFC 8058 one-click unsubscribe headers (Gmail/Yahoo bulk-sender requirement).
// Attach to every marketing send: providers show a native "Unsubscribe" link
// and POST to the URL — our /api/unsubscribe accepts that.
export function unsubHeaders(email: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<${unsubUrl(email)}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
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
  etsyWelcome: 'Welcome to the workshop 🪵',
  winback: 'Come back and carve 🪵',
  priceDrop: 'A design you liked just got cheaper',
  referralNudge: 'Give 15%, get 15% 🎁',
  payRecovery: 'Almost there 🛒',
  refundWinback: 'Fancy another try? 🪵',
  picks: 'Picked just for you 🪵',
  wishlistReminder: 'Saved, not forgotten ❤️',
  customPitch: 'A design made from your own photo 🪵',
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
        <li>Works out around <strong>$${perFile} per design</strong> (most singles are around $6)</li>
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

// ── The finishing guide ──────────────────────────────────────────────
// Written because a customer asked the question and there was no page to send
// them to. It is the shop's most useful piece of writing, so it does double
// duty: a one-off broadcast to the list, and the last stage of the new
// subscriber sequence.
//
// Deliberately not a sales email. There is one link, it goes to the article,
// and the only pitch is the sign-off. That is what makes people open the next
// one.
const GUIDE_URL = `${SITE}/blog/how-to-finish-cnc-relief-carvings`;
// Same bucket the article itself serves from, so the pictures in the email are
// the pictures on the page. Host comes from env rather than a literal.
const STORAGE = (envAny('PUBLIC_SUPABASE_URL') || 'https://tutalnieozbngrsfywes.supabase.co').replace(/\/$/, '');
const GUIDE_IMG = (k: string) => `${STORAGE}/storage/v1/object/public/site-media/blog/finishing/${k}.jpg`;

export function guideEmail(d: { email: string; name?: string | null }): Out {
  const e = d.email;
  // Say what it is. The earlier line ("The step that makes a carving look
  // carved") was intriguing but a subscriber could not tell it was a finishing
  // guide, and curiosity subjects age badly in a crowded inbox.
  const subject = 'How to finish a relief carving: the complete guide';
  const p = 'margin:0 0 14px;font-size:15px;line-height:1.65;color:#555;';
  const body = `
    <a href="${GUIDE_URL}?utm_source=email&utm_medium=newsletter&utm_campaign=finishing-guide" style="text-decoration:none;">
      <img src="${GUIDE_IMG('cover')}" width="544" alt="A finished cherry relief carving on a workbench with the oils, waxes and brushes used to finish it" style="width:100%;max-width:544px;border-radius:10px;display:block;margin:0 0 20px;">
    </a>

    <p style="${p}">Most relief carvings are lost after the machine finishes, not during the cut.</p>

    <p style="${p}">A carving is a landscape of very small hills and valleys, and the only reason anyone can see it is that light falls across it and leaves shadows. Fill those valleys with thick varnish and the whole thing goes flat. Keep them dark and the same board looks like it came out of a church.</p>

    <p style="${p}">We have just published the long version of how to do that, and there is one step that does most of the work. Flood the carving with a dark glaze, then wipe it back off the raised surfaces only. Here it is, half finished:</p>

    <img src="${GUIDE_IMG('glaze-wipe')}" width="544" alt="A relief carving half wiped back, the left side clean and warm, the right side still dark with glaze" style="width:100%;max-width:544px;border-radius:10px;display:block;margin:0 0 8px;">
    <p style="margin:0 0 20px;font-size:12.5px;line-height:1.5;color:#8a7a68;text-align:center;font-style:italic;">Left side wiped, right side not. Same panel, same light, same five minutes of work.</p>

    <p style="${p}">The guide walks through the whole job, with the products and tools that actually work:</p>

    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:0 0 18px;">
      <tr><td style="padding:5px 0;font-size:14.5px;line-height:1.5;color:#555;">Which woods hold fine detail, and which fight you</td></tr>
      <tr><td style="padding:5px 0;font-size:14.5px;line-height:1.5;color:#555;">Getting the machining fuzz off without rounding your edges</td></tr>
      <tr><td style="padding:5px 0;font-size:14.5px;line-height:1.5;color:#555;">Why sealing first is the step everyone skips, and what it costs</td></tr>
      <tr><td style="padding:5px 0;font-size:14.5px;line-height:1.5;color:#555;">The antique glaze, in detail</td></tr>
      <tr><td style="padding:5px 0;font-size:14.5px;line-height:1.5;color:#555;">Oils, waxes and the one finish to keep away from carved work</td></tr>
      <tr><td style="padding:5px 0;font-size:14.5px;line-height:1.5;color:#555;">Food safe trays, outdoor signs, and painting 3D printed reliefs</td></tr>
      <tr><td style="padding:5px 0;font-size:14.5px;line-height:1.5;color:#555;">A troubleshooting table for when it goes wrong</td></tr>
    </table>

    ${btn(`${GUIDE_URL}?utm_source=email&utm_medium=newsletter&utm_campaign=finishing-guide`, 'Read the full guide')}

    <p style="margin:18px 0 0;font-size:14px;line-height:1.6;color:#666;">It is free, there is nothing to sign up for, and it took a while to write. If it saves you one panel it has done its job.</p>

    <p style="margin:16px 0 0;font-size:14px;line-height:1.6;color:#666;">One more thing worth knowing: the guide exists because a customer emailed and asked. If something is not behaving in your shop, reply to this and ask. That is genuinely how this gets written.</p>

    <p style="margin:18px 0 0;font-size:13px;color:#777;">Jolly, DigitalChiselCo</p>`;

  const text = [
    'Most relief carvings are lost after the machine finishes, not during the cut.',
    '',
    'A carving is a landscape of very small hills and valleys, and the only reason anyone can see it',
    'is that light falls across it and leaves shadows. Fill those valleys with thick varnish and the',
    'whole thing goes flat. Keep them dark and the same board looks like it came out of a church.',
    '',
    'We have just published the long version of how to do that. It covers wood choice, removing',
    'machining fuzz, sealing, the antique glaze that makes the depth read, oils and waxes, food safe',
    'trays, outdoor signs, painting 3D printed reliefs, and a troubleshooting table.',
    '',
    `Read it: ${GUIDE_URL}`,
    '',
    'It is free and there is nothing to sign up for. If something is not behaving in your shop,',
    'reply and ask.',
    '',
    'Jolly, DigitalChiselCo',
    `Unsubscribe: ${unsubUrl(e)}`,
  ].join('\n');

  return { subject, html: shell(subject, 'How to finish a relief carving', body, e), text };
}

// ── Any published article ─────────────────────────────────────────────
// The finishing guide email, generalised. Renders from the post itself: the
// cover as the opening photograph, one chosen inside photograph, and the
// section headings as the "what is inside" list. Subject and opener come from
// the post's email_* columns (editable in Admin > Automations) with fallbacks
// to the title and excerpt, so every guide goes out the same way the finishing
// guide did without anyone writing a new template.
export type ArticlePost = {
  slug: string; title: string; excerpt?: string | null; body?: string | null;
  cover_image_url?: string | null; email_subject?: string | null; email_intro?: string | null;
  email_image_url?: string | null;
};

const stripTags = (s: string) => s.replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').trim();

export function articleEmail(d: { email: string; post: ArticlePost }): Out {
  const e = d.email, p = d.post;
  const url = `${SITE}/blog/${p.slug}?utm_source=email&utm_medium=newsletter&utm_campaign=article-${p.slug}`;
  const subject = String(p.email_subject || p.title).slice(0, 120);
  const heading = p.title.split(':')[0].trim();
  const body = String(p.body || '');
  const imgs = [...body.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]);
  // The inside photo must not be the cover, and the first figure in an
  // article is the hero, which is the cover's twin even when the URL differs
  // (owner, 2026-09-05: "two similar pictures"). So skip the first figure as
  // well and take the next one, which is a step photo, not another hero.
  // Compare by file name, not full URL: the cover is often a re-hosted copy of
  // the hero figure (different bucket path, same picture).
  const stem = (u: string) => String(u || '').split('?')[0].split('/').pop()!.replace(/-(\d{2,4}w|email|poster|thumb)\.(jpe?g|png|webp)$/i, '').replace(/\.(jpe?g|png|webp)$/i, '').toLowerCase();
  const coverStem = stem(p.cover_image_url || '');
  const candidates = imgs.filter((u, i, all) => u !== p.cover_image_url && stem(u) !== coverStem && all.indexOf(u) === i);
  // A chosen inside photo that is itself the cover (several articles were
  // published with email.image pointing at the hero) is ignored the same way.
  const chosen = p.email_image_url && stem(p.email_image_url) !== coverStem ? p.email_image_url : null;
  const inside = chosen || candidates[candidates.length > 2 ? 1 : 0] || null;
  // Section headings become the list, each linking to its section. The
  // contents heading itself and the FAQ heading are navigation, not content.
  const sections = [...body.matchAll(/<h2([^>]*)>([\s\S]*?)<\/h2>/g)].map((m) => ({
    id: (/id="([^"]+)"/.exec(m[1]) || [])[1] || '', text: stripTags(m[2]),
  })).filter((h) => h.text && !/^(what this guide covers|in this (guide|article|comparison)|contents|who are you giving to\??|questions people ask|common questions|faq)$/i.test(h.text))
    .slice(0, 7);
  const headings = sections.map((s) => s.text);
  const intro = String(p.email_intro || p.excerpt || '').split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  const P = 'margin:0 0 14px;font-size:15px;line-height:1.65;color:#555;';
  const readMin = Math.max(1, Math.round(stripTags(body).split(/\s+/).filter(Boolean).length / 220));

  const html = shell(subject, heading, `
    ${p.cover_image_url ? `<a href="${url}" style="text-decoration:none;"><img src="${esc(p.cover_image_url)}" width="544" alt="${esc(p.title)}" style="width:100%;max-width:544px;border-radius:10px;display:block;margin:0 0 20px;"></a>` : ''}
    ${intro.map((t) => `<p style="${P}">${esc(t)}</p>`).join('')}
    ${inside ? `<a href="${url}" style="text-decoration:none;"><img src="${esc(inside)}" width="544" alt="" style="width:100%;max-width:544px;border-radius:10px;display:block;margin:6px 0 22px;"></a>` : ''}
    ${headings.length ? `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:0 0 22px;background:#FAF3E6;border-left:4px solid ${BRONZE};border-radius:0 10px 10px 0;">
      <tr><td style="padding:16px 18px 6px;">
        <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:${BRONZE};font-weight:700;">What is inside</div>
        <div style="font-size:12px;color:#8a7a68;margin-top:2px;">${readMin} minute read · ${headings.length} sections</div>
      </td></tr>
      ${sections.map((s) => `<tr><td style="padding:0 18px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
          <td style="width:14px;padding:6px 0;font-size:13px;line-height:1.5;color:${BRONZE};vertical-align:top;">&#9656;</td>
          <td style="padding:6px 0;font-size:14.5px;line-height:1.5;color:${INK};"><a href="${url}${s.id ? '#' + esc(s.id) : ''}" style="color:${INK};text-decoration:none;">${esc(s.text)}</a></td>
        </tr></table>
      </td></tr>`).join('')}
      <tr><td style="padding:8px 18px 14px;"></td></tr>
    </table>` : ''}
    ${btn(url, 'Read the full guide')}
    <p style="margin:18px 0 0;font-size:14px;line-height:1.6;color:#666;">It is free and there is nothing to sign up for. If something in your shop is not behaving, reply to this and ask. Real questions are how these guides get written.</p>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:26px 0 0;border-top:1px solid #E5DDD0;">
      <tr><td style="padding:16px 0 0;">
        <div style="font-family:Georgia,'Times New Roman',serif;font-size:16px;color:${INK};">Jolly</div>
        <div style="font-size:12.5px;color:#8a7a68;margin-top:2px;">DigitalChiselCo · relief files for CNC, laser and 3D printing</div>
        <div style="font-size:12.5px;margin-top:10px;">
          <a href="${SITE}/blog?utm_source=email&utm_medium=newsletter" style="color:${BRONZE};text-decoration:none;">All guides</a>
          <span style="color:#c9bda9;">&nbsp;·&nbsp;</span>
          <a href="${SITE}/collections?utm_source=email&utm_medium=newsletter" style="color:${BRONZE};text-decoration:none;">Browse designs</a>
          <span style="color:#c9bda9;">&nbsp;·&nbsp;</span>
          <a href="${SITE}/account" style="color:${BRONZE};text-decoration:none;">Your downloads</a>
        </div>
      </td></tr>
    </table>`, e);

  const text = [
    ...intro, '', ...(headings.length ? [`What is inside (${readMin} minute read):`, ...headings.map((h) => `  - ${h}`), ''] : []),
    `Read it: ${url}`, '',
    'It is free and there is nothing to sign up for. If something in your shop is not behaving, reply and ask.',
    '', 'Jolly, DigitalChiselCo', `All guides: ${SITE}/blog`, `Unsubscribe: ${unsubUrl(e)}`,
  ].join('\n');
  return { subject, html, text };
}

// ── Abandoned cart (one reminder, ~20h later) ────────────────────────
export function cartReminderEmail(d: { email: string; items: { title: string; price: number; image_url?: string | null; slug?: string | null }[]; subtotal: number }): Out {
  const subject = 'Your cart is saved — your designs are waiting';
  const rows = d.items.slice(0, 6).map((i) => {
    const t = esc(i.title.split('|')[0].trim().slice(0, 60));
    const link = i.slug ? `${SITE}/product/${esc(i.slug)}` : `${SITE}/cart`;
    const thumb = i.image_url
      ? `<a href="${link}"><img src="${esc(i.image_url)}" width="54" height="54" style="width:54px;height:54px;border-radius:6px;object-fit:cover;display:block;border:1px solid #E5DDD0;" alt=""></a>`
      : '';
    return `<tr>
      <td style="padding:8px 10px 8px 0;width:54px;vertical-align:middle;">${thumb}</td>
      <td style="padding:8px 8px 8px 0;font-size:14px;color:${INK};vertical-align:middle;"><a href="${link}" style="color:${INK};text-decoration:none;">${t}</a></td>
      <td style="padding:8px 0;font-size:14px;color:#777;text-align:right;vertical-align:middle;white-space:nowrap;">$${Number(i.price).toFixed(2)}</td>
    </tr>`;
  }).join('');
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
    ${btn(SITE + '/catalog', 'See everything new')}
    <p style="margin:14px 0 0;font-size:13px;color:#777;text-align:center;">Buying a few? <a href="${SITE}/bundle-builder" style="color:${BRONZE};">Pick any 5 and save, bundles from $25 →</a></p>`;
  const text = `${n} new designs this week at DigitalChiselCo: ` + d.products.slice(0, 12).map((p) => `${p.title.split('|')[0].trim()} ${SITE}/product/${p.slug}`).join(' · ') + `\nUnsubscribe: ${unsubUrl(d.email)}`;
  return { subject, html: shell(subject, 'Fresh from the workshop 🪵', body, d.email), text };
}

// ── Etsy-buyer welcome (one-time, warm intro to the website) ──────────
// Sent once to imported Etsy buyers: thank-you + this week's newest designs +
// a 10% welcome code. No em dashes (owner preference).
export function etsyWelcomeEmail(d: {
  email: string; products: MiniProduct[]; totalNew?: number; code?: string;
}): Out {
  const code = d.code || 'THANKYOU10';
  const total = d.totalNew ?? d.products.length;
  const rows: string[] = [];
  for (let i = 0; i < Math.min(12, d.products.length); i += 3) rows.push(productGrid(d.products.slice(i, i + 3)));
  const grid = d.products.length ? `
    <div style="font-size:13px;letter-spacing:1px;text-transform:uppercase;color:${BRONZE};text-align:center;margin:22px 0 4px;">✨ Just added this week</div>
    ${rows.join('')}
    <p style="text-align:center;margin:6px 0 4px;"><a href="${SITE}/catalog?sort=newest" style="color:${BRONZE};font-size:13px;">See all ${total} new designs &rarr;</a></p>` : '';
  const subject = 'Thanks for your purchase, here is a little welcome gift 🎁';
  const body = `
    <p style="font-size:15px;line-height:1.65;margin:0 0 14px;color:${INK};">Hi there,</p>
    <p style="font-size:15px;line-height:1.65;margin:0 0 14px;color:${INK};">
      Thank you so much for your purchase on Etsy. It genuinely means the world to a small workshop like ours. 🙏
      I wanted to personally welcome you to our home on the web, <a href="${SITE}" style="color:${BRONZE};">digitalchiselco.com</a>.
    </p>
    <p style="font-size:15px;line-height:1.65;margin:0 0 14px;color:${INK};">
      It's where <b>every one of our bas-relief designs lives in one place</b>, with instant downloads, brand-new designs added every week,
      bundle deals, and a members' library, usually at friendlier prices than Etsy.
    </p>
    ${grid}
    <div style="background:${CREAM};border:1px dashed ${BRONZE};border-radius:10px;padding:18px;text-align:center;margin:20px 0;">
      <div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:${BRONZE};margin-bottom:6px;">Your welcome gift</div>
      <div style="font-size:15px;color:${INK};margin-bottom:8px;">10% off your first order on our site</div>
      <div style="font-size:26px;font-weight:700;letter-spacing:2px;color:${BRONZE_DARK};font-family:Georgia,serif;">${esc(code)}</div>
      <div style="font-size:12px;color:#8a7a68;margin-top:6px;">Just paste it in the promo box at checkout.</div>
    </div>
    ${btn(SITE + '/catalog', 'Browse the full collection')}
    <p style="font-size:14px;line-height:1.6;margin:18px 0 4px;color:${INK};">Happy carving,<br><b>Jolly</b> · DigitalChiselCo</p>`;
  const text = `Thank you for your Etsy purchase! Welcome to digitalchiselco.com, where every one of our bas-relief designs lives in one place, new ones weekly, instant downloads.\n\nYour welcome gift: 10% off your first order with code ${code} (paste it in the checkout promo box).\n\nBrowse the collection: ${SITE}/catalog\n\nHappy carving, Jolly, DigitalChiselCo\n\nUnsubscribe: ${unsubUrl(d.email)}`;
  return { subject, html: shell(subject, 'Welcome to the workshop 🪵', body, d.email), text };
}

// ── Custom-design pitch (people who asked us to copy another shop's design) ──
// Page 1: we do not copy, but we make originals from YOUR photo, from $30,
// quoted first, paid only on approval, with the /custom-design upload link.
// Page 2: the designs released this week (product-page links only).
// No em dashes (owner rule). Signed Jolly.
export const CUSTOM_DESIGN_URL = `${SITE}/custom-design`;
export function customDesignPitchEmail(d: {
  email: string; name?: string | null; note?: string | null; products: MiniProduct[]; totalNew?: number; fromPrice?: number;
}): Out {
  const from = d.fromPrice ?? 30;
  const first = (d.name || '').trim().split(/\s+/)[0];
  const hi = first ? `Hi ${esc(first)},` : 'Hi there,';
  const n = d.products.length;
  const total = d.totalNew ?? n;
  const rows: string[] = [];
  for (let i = 0; i < Math.min(12, n); i += 3) rows.push(productGrid(d.products.slice(i, i + 3)));
  const step = (num: string, title: string, body: string) => `
    <tr><td style="padding:10px 0;border-top:1px solid #EFE7DA;vertical-align:top;width:42px;">
      <div style="width:30px;height:30px;border-radius:15px;background:${BRONZE_DARK};color:${CREAM};font-family:Georgia,serif;font-size:15px;line-height:30px;text-align:center;">${num}</div></td>
      <td style="padding:10px 0 10px 8px;border-top:1px solid #EFE7DA;vertical-align:top;">
      <div style="font-size:14px;font-weight:600;color:${INK};">${title}</div>
      <div style="font-size:13px;line-height:1.55;color:#666;margin-top:2px;">${body}</div></td></tr>`;
  const subject = `Your custom design: share a picture, sketch or idea and we model it, from $${from}`;
  const body = `
    <p style="font-size:15px;line-height:1.65;margin:0 0 14px;color:${INK};">${hi}</p>
    <p style="font-size:15px;line-height:1.65;margin:0 0 14px;color:${INK};">
      Thank you for asking us about a custom design. We make bas-relief STL files to order, and the starting point can be anything you have: a concept, a piece of artwork, a sketch, a photo, or a picture that shows the feel you are after. Send it over and we model a relief that carves the way you imagine it.
    </p>
    ${d.note ? `<p style="font-size:15px;line-height:1.65;margin:0 0 14px;color:${INK};">${esc(d.note)}</p>` : ''}
    <div style="background:${CREAM};border:1px solid #E5DDD0;border-radius:10px;padding:18px 20px;margin:18px 0;">
      <div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:${BRONZE};margin-bottom:6px;">Original custom design</div>
      <div style="font-family:Georgia,serif;font-size:21px;line-height:1.3;color:${BRONZE_DARK};">Share your concept, we model the relief.</div>
      <div style="font-size:14px;line-height:1.6;color:#555;margin-top:8px;">A pet, a portrait, a logo, a family crest, a scene, a sketch on paper. You get a carve-ready STL made for you, with the same commercial licence as every design in the shop.</div>
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top:14px;">
        <tr><td style="font-size:13px;color:#555;padding:4px 0;">Starting price</td><td align="right" style="font-size:15px;font-weight:700;color:${BRONZE_DARK};padding:4px 0;">from $${from}</td></tr>
        <tr><td style="font-size:13px;color:#555;padding:4px 0;">Quote</td><td align="right" style="font-size:13px;color:${INK};padding:4px 0;">within 24 hours, before you pay anything</td></tr>
        <tr><td style="font-size:13px;color:#555;padding:4px 0;">Delivery</td><td align="right" style="font-size:13px;color:${INK};padding:4px 0;">usually 3 to 5 days</td></tr>
        <tr><td style="font-size:13px;color:#555;padding:4px 0;">Revisions</td><td align="right" style="font-size:13px;color:${INK};padding:4px 0;">one round included</td></tr>
        <tr><td style="font-size:13px;color:#555;padding:4px 0;">You receive</td><td align="right" style="font-size:13px;color:${INK};padding:4px 0;">a carve-ready STL file</td></tr>
      </table>
    </div>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:4px 0 6px;">
      ${step('1', 'Share your picture or idea', `Open the custom design page, upload a photo, sketch or artwork and tell us the size and material you carve.`)}
      ${step('2', 'Approve the quote', `We reply with a firm price and a delivery date. Nothing is charged until you say yes.`)}
      ${step('3', 'Carve it', `You receive the STL by email and in your account, with one revision if anything needs a tweak.`)}
    </table>
    ${btn(CUSTOM_DESIGN_URL, 'Post your picture for a quote')}
    <p style="text-align:center;font-size:12px;color:#8a7a68;margin:4px 0 0;">Reply to this email if you prefer to talk it through first.</p>
    ${n ? `
    <div style="margin:28px 0 0;padding-top:22px;border-top:2px solid ${CREAM};">
      <div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:${BRONZE};text-align:center;">Released this week</div>
      <div style="font-family:Georgia,serif;font-size:19px;color:${BRONZE_DARK};text-align:center;margin:4px 0 10px;">${total} new design${total === 1 ? '' : 's'} in the shop</div>
      ${rows.join('')}
      <p style="text-align:center;margin:10px 0 0;"><a href="${SITE}/catalog?sort=newest" style="color:${BRONZE};font-size:13px;">See everything new &rarr;</a></p>
    </div>` : ''}
    <p style="font-size:14px;line-height:1.6;margin:22px 0 4px;color:${INK};">Happy carving,<br><b>Jolly</b> · DigitalChiselCo</p>`;
  const text = `${first ? 'Hi ' + first : 'Hi there'},\n\nThank you for asking us about a custom design. We make bas-relief STL files to order from anything you have: a concept, artwork, a sketch, a photo. From $${from}.${d.note ? '\n\n' + d.note : ''}\n\nHow it works:\n1. Share your picture or idea: ${CUSTOM_DESIGN_URL}\n2. We quote within 24 hours, before you pay anything.\n3. Your STL in 3 to 5 days, one revision included.\n\n` +
    (n ? `Released this week (${total} new designs):\n` + d.products.slice(0, 12).map((p) => `${p.title.split('|')[0].trim()} ${SITE}/product/${p.slug}`).join('\n') + '\n\n' : '') +
    `Happy carving, Jolly, DigitalChiselCo\nUnsubscribe: ${unsubUrl(d.email)}`;
  return { subject, html: shell(subject, TEMPLATE_HEADINGS.customPitch, body, d.email), text };
}

// ── Custom request received (transactional confirmation to the requester) ──
export function customRequestReceivedEmail(d: { email: string; name?: string | null; photoUrl?: string | null; description?: string | null; ref: string }): Out {
  const first = (d.name || '').trim().split(/\s+/)[0];
  const subject = 'Got your picture, a quote is on its way';
  const body = `
    <p style="font-size:15px;line-height:1.65;margin:0 0 14px;color:${INK};">${first ? `Hi ${esc(first)},` : 'Hi there,'}</p>
    <p style="font-size:15px;line-height:1.65;margin:0 0 14px;color:${INK};">Your custom design request has arrived and I have it in front of me. You will get a firm quote and a delivery date within 24 hours, usually much sooner. Nothing is charged until you approve it.</p>
    ${d.photoUrl ? `<p style="text-align:center;margin:6px 0 14px;"><img src="${esc(d.photoUrl)}" alt="your picture" width="260" style="max-width:260px;width:100%;border-radius:10px;border:1px solid #E5DDD0;"></p>` : ''}
    ${d.description ? `<div style="background:${CREAM};border-radius:8px;padding:12px 14px;font-size:13px;line-height:1.55;color:#555;">${esc(d.description).slice(0, 600)}</div>` : ''}
    <p style="font-size:13px;color:#8a7a68;margin:14px 0 0;">Reference ${esc(d.ref)}. Reply to this email to add anything.</p>
    <p style="font-size:14px;line-height:1.6;margin:22px 0 4px;color:${INK};">Talk soon,<br><b>Jolly</b> · DigitalChiselCo</p>`;
  const text = `Your custom design request (${d.ref}) has arrived. You will get a firm quote and delivery date within 24 hours; nothing is charged until you approve it.\n\nReply to this email to add anything.\n\nJolly, DigitalChiselCo`;
  return { subject, html: shell(subject, 'Your picture is with me 🪵', body, d.email), text };
}

// ── Product spotlight (send one design to the people interested in it) ──
export function productSpotlightEmail(d: { email: string; product: MiniProduct; reason?: string }): Out {
  const p = d.product;
  const t = (p.title || '').split('|')[0].trim();
  const subject = `You might love this design: ${t.slice(0, 55)}`;
  const reason = d.reason || 'Based on the designs you have been looking at, we think this one belongs on your machine';
  const body = `
    <p style="font-size:15px;line-height:1.6;color:#555;margin:0 0 12px;">Hi fellow maker,</p>
    <p style="font-size:15px;line-height:1.6;color:#555;margin:0 0 16px;">${esc(reason)}:</p>
    <div style="text-align:center;">
      <a href="${SITE}/product/${esc(p.slug)}" style="text-decoration:none;color:${INK};">
        ${p.image_url ? `<img src="${esc(p.image_url)}" width="440" style="width:100%;max-width:440px;border-radius:10px;display:block;margin:0 auto;" alt="${esc(t)}">` : ''}
        <div style="font-size:17px;font-weight:600;margin:12px 0 2px;color:${INK};">${esc(t)}</div>
        ${p.price_usd != null ? `<div style="font-size:16px;color:${BRONZE};font-weight:600;">$${Number(p.price_usd).toFixed(2)}</div>` : ''}
      </a>
    </div>
    ${btn(SITE + '/product/' + esc(p.slug), 'Get this design')}
    <p style="text-align:center;font-size:13px;color:#777;margin:14px 0 0;">Not quite right? <a href="${SITE}/catalog" style="color:${BRONZE};">Browse the full collection</a></p>`;
  const text = `We thought you'd love this design: ${t}. ${SITE}/product/${p.slug}\nUnsubscribe: ${unsubUrl(d.email)}`;
  return { subject, html: shell(subject, 'A design picked for you 🪵', body, d.email), text };
}

// ── Win-back (dormant subscriber, gentle nudge + code) ───────────────
export function winbackEmail(d: { email: string; products: MiniProduct[]; code: string }): Out {
  const subject = 'We saved your spot at the workshop 🪵';
  const rows: string[] = [];
  for (let i = 0; i < Math.min(3, d.products.length); i += 3) rows.push(productGrid(d.products.slice(i, i + 3)));
  const body = `
    <p style="font-size:15px;line-height:1.6;color:#555;margin:0 0 14px;">Hi fellow maker,</p>
    <p style="font-size:15px;line-height:1.6;color:#555;margin:0 0 16px;">It has been a while, and we have added a lot of new designs since you last stopped by. To welcome you back, here is <strong>15% off</strong> anything in the shop:</p>
    <div style="text-align:center;margin:6px 0 16px;">
      <div style="display:inline-block;background:#fff;border:1px dashed ${BRONZE};border-radius:8px;padding:12px 28px;font-family:monospace;font-size:22px;letter-spacing:3px;color:${BRONZE_DARK};font-weight:bold;">${esc(d.code)}</div>
    </div>
    ${rows.join('')}
    ${btn(SITE + '/catalog', 'See what is new')}
    <p style="text-align:center;font-size:12px;color:#999;margin:14px 0 0;">Not carving these days? No hard feelings, you can unsubscribe below.</p>`;
  const text = `We miss you at DigitalChiselCo. Here is 15% off with code ${d.code}: ${SITE}/catalog\nUnsubscribe: ${unsubUrl(d.email)}`;
  return { subject, html: shell(subject, 'Come back and carve 🪵', body, d.email), text };
}

// ── Product Picks: hand-selected designs sent by the owner to one person ──
// Used by the Automations "Send hand-picked designs" tool. The shop owner
// searches the catalog, picks a few designs and adds a personal note; this
// wraps them in the branded shell (logo included) like every other email.
export function productPicksEmail(d: { email: string; products: MiniProduct[]; note?: string | null; name?: string | null }): Out {
  const subject = 'A few designs I picked out for you 🪵';
  const rows: string[] = [];
  for (let i = 0; i < d.products.length; i += 3) rows.push(productGrid(d.products.slice(i, i + 3)));
  const body = `
    <p style="font-size:15px;line-height:1.6;color:#555;margin:0 0 14px;">Hi${d.name ? ' ' + esc(d.name) : ' fellow maker'},</p>
    ${d.note ? `<div style="background:#FFFBF4;border-left:3px solid ${BRONZE};border-radius:0 8px 8px 0;padding:12px 16px;margin:0 0 16px;">
      <p style="font-size:15px;line-height:1.6;color:#4a3a28;margin:0;font-style:italic;">${esc(d.note)}</p>
      <p style="font-size:12px;color:#999;margin:6px 0 0;">Jolly, DigitalChiselCo</p>
    </div>` : `<p style="font-size:15px;line-height:1.6;color:#555;margin:0 0 16px;">You asked, and I went digging through the workshop. Here is what I think you will like:</p>`}
    ${rows.join('')}
    ${btn(SITE + '/catalog', 'Browse the full catalog')}
    <p style="text-align:center;font-size:12px;color:#999;margin:14px 0 0;">Questions about any of these? Just reply, it lands straight in my inbox.</p>`;
  const text = `Hi${d.name ? ' ' + d.name : ''},\n\n${d.note ? d.note + '\n\n' : 'Here are a few designs I picked out for you:\n\n'}` +
    d.products.map((p) => `${(p.title || '').split('|')[0].trim()} ($${Number(p.price_usd).toFixed(2)}): ${SITE}/product/${p.slug}`).join('\n') +
    `\n\nBrowse everything: ${SITE}/catalog\nUnsubscribe: ${unsubUrl(d.email)}`;
  return { subject, html: shell(subject, 'Picked just for you 🪵', body, d.email), text };
}

// ── Wishlist reminder (they hearted it, never bought it) ──────────────
export function wishlistReminderEmail(d: { email: string; products: MiniProduct[] }): Out {
  const subject = d.products.length === 1
    ? `Still thinking about ${String(d.products[0].title || '').split('|')[0].trim().slice(0, 40)}?`
    : 'The designs on your wishlist are still waiting 🪵';
  const rows: string[] = [];
  for (let i = 0; i < Math.min(3, d.products.length); i += 3) rows.push(productGrid(d.products.slice(i, i + 3)));
  const body = `
    <p style="font-size:15px;line-height:1.6;color:#555;margin:0 0 14px;">Hi fellow maker,</p>
    <p style="font-size:15px;line-height:1.6;color:#555;margin:0 0 16px;">A little while ago you saved ${d.products.length === 1 ? 'this design' : 'these designs'} to your wishlist. ${d.products.length === 1 ? 'It is' : 'They are'} still here, instant download, ready to carve whenever you are:</p>
    ${rows.join('')}
    ${btn(SITE + '/favorites', 'Open my wishlist')}
    <p style="text-align:center;font-size:12px;color:#999;margin:14px 0 0;">Tip: two or more designs unlock a bulk discount in the cart.</p>`;
  const text = `Still on your wishlist:\n` +
    d.products.map((p) => `${(p.title || '').split('|')[0].trim()}: ${SITE}/product/${p.slug}`).join('\n') +
    `\n\nYour wishlist: ${SITE}/favorites\nUnsubscribe: ${unsubUrl(d.email)}`;
  return { subject, html: shell(subject, 'Saved, not forgotten ❤️', body, d.email), text };
}

// ── Owner weekly report (to the ops inbox, not customers) ─────────────
export function ownerWeeklyReport(d: {
  email: string; weekLabel: string;
  pageviews: number; actions: { label: string; n: number }[];
  orders: number; revenue: number;
  topCarted: { title: string; n: number }[];
  topWished: { title: string; n: number }[];
  topSold: { title: string; n: number }[];
  zeroSearches: string[];
  extraHtml?: string;   // pre-built sections (email health, Cut Local, SEO checkpoints)
}): Out {
  const subject = `📊 Your week at DigitalChiselCo: ${d.orders} orders, $${d.revenue.toFixed(2)}`;
  const stat = (label: string, n: string | number) =>
    `<td style="padding:10px;text-align:center;background:#FFFBF4;border:1px solid #eee;border-radius:8px;">
      <div style="font-size:24px;font-weight:bold;color:${BRONZE_DARK};">${n}</div>
      <div style="font-size:11px;color:#8a7a68;font-weight:bold;">${esc(label)}</div></td>`;
  const list = (title: string, rows: { title: string; n: number }[]) => rows.length ? `
    <p style="font-size:13px;font-weight:bold;color:${BRONZE_DARK};margin:16px 0 4px;">${title}</p>
    ${rows.map((r) => `<p style="font-size:13px;color:#555;margin:2px 0;">• ${esc(r.title)} <strong>×${r.n}</strong></p>`).join('')}` : '';
  const body = `
    <table role="presentation" width="100%" cellspacing="4"><tr>
      ${stat('Pageviews', d.pageviews.toLocaleString())}${stat('Orders', d.orders)}${stat('Revenue', '$' + d.revenue.toFixed(2))}
    </tr></table>
    <table role="presentation" width="100%" cellspacing="4"><tr>
      ${d.actions.map((a) => stat(a.label, a.n.toLocaleString())).join('')}
    </tr></table>
    ${list('🛒 Most added to cart', d.topCarted)}
    ${list('❤️ Most wishlisted', d.topWished)}
    ${list('✅ Best sellers', d.topSold)}
    ${d.zeroSearches.length ? `<p style="font-size:13px;font-weight:bold;color:#b91c1c;margin:16px 0 4px;">🔍 Searched but NOT found (design ideas!)</p>
      <p style="font-size:13px;color:#555;margin:2px 0;">${d.zeroSearches.map(esc).join(' · ')}</p>` : ''}
    ${d.extraHtml || ''}
    <p style="text-align:center;margin:18px 0 0;">${btn(SITE + '/admin#traffic', 'Open the full Traffic dashboard')}</p>`;
  const text = `Week ${d.weekLabel}: ${d.pageviews} pageviews, ${d.orders} orders, $${d.revenue.toFixed(2)}.\n` +
    d.actions.map((a) => `${a.label}: ${a.n}`).join(', ');
  return { subject, html: shell(subject, `Week in review · ${d.weekLabel}`, body, d.email), text };
}

// ── Failed-payment recovery (the card was declined mid-checkout) ─────
export function paymentRecoveryEmail(d: { email: string; items: { title: string; price: number }[] }): Out {
  const subject = 'Your order did not go through, your cart is safe';
  const list = d.items.slice(0, 6).map((it) =>
    `<tr><td style="padding:6px 0;font-size:14px;color:#555;">${esc((it.title || '').split('|')[0].trim())}</td><td style="padding:6px 0;font-size:14px;color:${BRONZE_DARK};text-align:right;white-space:nowrap;">$${Number(it.price).toFixed(2)}</td></tr>`).join('');
  const body = `
    <p style="font-size:15px;line-height:1.6;color:#555;margin:0 0 14px;">Hi fellow maker,</p>
    <p style="font-size:15px;line-height:1.6;color:#555;margin:0 0 16px;">Your payment did not complete just now. It happens, cards get declined for all sorts of harmless reasons. Nothing was charged, and your cart is still saved on the device you shopped from.</p>
    ${list ? `<table role="presentation" width="100%" style="border-top:1px solid #eee;border-bottom:1px solid #eee;margin:0 0 16px;">${list}</table>` : ''}
    ${btn(SITE + '/cart', 'Finish my order')}
    <p style="font-size:13px;line-height:1.6;color:#999;margin:14px 0 0;">Tip: a different card or PayPal usually sorts it out. If it keeps failing, just reply to this email and a real person will help.</p>
    <p style="font-size:13px;line-height:1.6;color:#999;margin:8px 0 0;">Already finished your order? Then please ignore this note, you are all set.</p>`;
  const text = `Your payment did not complete and nothing was charged. Your cart is still saved. Finish your order: ${SITE}/cart\nUnsubscribe: ${unsubUrl(d.email)}`;
  return { subject, html: shell(subject, 'Almost there 🛒', body, d.email), text };
}

// ── Post-refund win-back (30 days after a refund) ─────────────────────
export function refundWinbackEmail(d: { email: string; products: MiniProduct[]; code: string }): Out {
  const subject = 'No hard feelings, here is 15% off if you fancy another try';
  const rows: string[] = [];
  for (let i = 0; i < Math.min(3, d.products.length); i += 3) rows.push(productGrid(d.products.slice(i, i + 3)));
  const body = `
    <p style="font-size:15px;line-height:1.6;color:#555;margin:0 0 14px;">Hi fellow maker,</p>
    <p style="font-size:15px;line-height:1.6;color:#555;margin:0 0 16px;">A little while back one of your orders was refunded. That is completely fine, it simply was not the right fit. We have added plenty of new designs since, and if you would like to give the workshop another try, this <strong>15% off</strong> code is yours:</p>
    <div style="text-align:center;margin:6px 0 16px;">
      <div style="display:inline-block;background:#fff;border:1px dashed ${BRONZE};border-radius:8px;padding:12px 28px;font-family:monospace;font-size:22px;letter-spacing:3px;color:${BRONZE_DARK};font-weight:bold;">${esc(d.code)}</div>
    </div>
    ${rows.join('')}
    ${btn(SITE + '/catalog', 'Browse the new designs')}
    <p style="text-align:center;font-size:12px;color:#999;margin:14px 0 0;">If a design ever gives you trouble on your machine, reply to this email, we fix files fast.</p>`;
  const text = `Here is 15% off if you would like to give DigitalChiselCo another try. Code ${d.code}: ${SITE}/catalog\nUnsubscribe: ${unsubUrl(d.email)}`;
  return { subject, html: shell(subject, 'Fancy another try? 🪵', body, d.email), text };
}

// ── Price-drop alert (a design they liked just got cheaper) ──────────
export function priceDropEmail(d: { email: string; product: MiniProduct; oldPrice: number; newPrice: number }): Out {
  const p = d.product;
  const t = (p.title || '').split('|')[0].trim();
  const subject = `Price drop on a design you liked: ${t.slice(0, 45)}`;
  const body = `
    <p style="font-size:15px;line-height:1.6;color:#555;margin:0 0 14px;">Good news,</p>
    <p style="font-size:15px;line-height:1.6;color:#555;margin:0 0 16px;">A design you were looking at just dropped in price:</p>
    <div style="text-align:center;">
      <a href="${SITE}/product/${esc(p.slug)}" style="text-decoration:none;color:${INK};">
        ${p.image_url ? `<img src="${esc(p.image_url)}" width="420" style="width:100%;max-width:420px;border-radius:10px;display:block;margin:0 auto;" alt="${esc(t)}">` : ''}
        <div style="font-size:17px;font-weight:600;margin:12px 0 4px;color:${INK};">${esc(t)}</div>
        <div style="font-size:16px;">
          <span style="color:#999;text-decoration:line-through;margin-right:8px;">$${d.oldPrice.toFixed(2)}</span>
          <span style="color:${BRONZE};font-weight:700;">$${d.newPrice.toFixed(2)}</span>
        </div>
      </a>
    </div>
    ${btn(SITE + '/product/' + esc(p.slug), 'Grab it now')}`;
  const text = `Price drop: ${t} is now $${d.newPrice.toFixed(2)} (was $${d.oldPrice.toFixed(2)}). ${SITE}/product/${p.slug}\nUnsubscribe: ${unsubUrl(d.email)}`;
  return { subject, html: shell(subject, 'A design you liked just got cheaper', body, d.email), text };
}

// ── Referral nudge (ask a happy customer to share their link) ─────────
export function referralNudgeEmail(d: { email: string; code: string; link: string }): Out {
  const subject = 'Share your favourite designs, earn 15% 🎁';
  const body = `
    <p style="font-size:15px;line-height:1.6;color:#555;margin:0 0 14px;">Hi fellow maker,</p>
    <p style="font-size:15px;line-height:1.6;color:#555;margin:0 0 16px;">Thanks for being part of the workshop. Know someone with a CNC or laser who would love our designs? Share your personal link: <strong>they get 15% off their first order, and you get 15% off your next one</strong>.</p>
    <div style="text-align:center;margin:6px 0 14px;">
      <div style="display:inline-block;background:#fff;border:1px dashed ${BRONZE};border-radius:8px;padding:10px 20px;font-family:monospace;font-size:14px;color:${BRONZE_DARK};word-break:break-all;">${esc(d.link)}</div>
    </div>
    ${btn(d.link, 'Share my link')}
    <p style="text-align:center;font-size:13px;color:#777;margin:14px 0 0;">Your code: <strong>${esc(d.code)}</strong> · track your rewards in <a href="${SITE}/account" style="color:${BRONZE};">your account</a></p>`;
  const text = `Share DigitalChiselCo and earn 15%. Your link: ${d.link}\nUnsubscribe: ${unsubUrl(d.email)}`;
  return { subject, html: shell(subject, 'Give 15%, get 15% 🎁', body, d.email), text };
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
    <p style="margin:14px 0 0;font-size:13px;color:#777;text-align:center;">Buying a few? <a href="${SITE}/bundle-builder" style="color:${BRONZE};">Pick any 5 and save, bundles from $25 →</a></p>`;
  const text = `Designs you viewed at DigitalChiselCo: ` + d.products.slice(0, 6).map((p) => `${p.title.split('|')[0].trim()} ${SITE}/product/${p.slug}`).join(' · ') + `\nUnsubscribe: ${unsubUrl(d.email)}`;
  return { subject, html: shell(subject, 'Still thinking it over? 🪵', body, d.email), text };
}

// ── Portal guide (help email, sent from Admin → Subscribers) ──────────
// One consistent message used for the buyer catch-up blast and the admin
// "send the guide to whoever needs help" tool. The PDF itself is attached by
// the caller (see order-email.ts PORTAL_GUIDE_URL / PORTAL_GUIDE_FILENAME).
export function portalGuideEmail(): { subject: string; html: string; text: string } {
  const subject = 'Your DigitalChiselCo portal: lifetime downloads, points and more (guide attached)';
  const html = `<div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#2a241d;">
<p>Hi,</p>
<p>Thank you for being part of <strong>DigitalChiselCo</strong>. I wanted to make sure you know about something many customers miss: every purchase comes with <strong>lifetime access to your own customer portal</strong>.</p>
<p>In your portal you can:</p>
<ul style="line-height:1.7;">
<li><strong>Re-download every file you have ever bought</strong>, forever and free (lost files are never a problem)</li>
<li>See all your orders in one place, each with its own download button</li>
<li>Collect <strong>loyalty points</strong> (10 points per $1) that turn into store credit</li>
<li>Share your personal <strong>give 15%, get 15%</strong> referral link</li>
</ul>
<p>I attached a short 3 page guide with pictures showing exactly how to sign in. In short: on <a href="https://digitalchiselco.com" style="color:#854F0B;">digitalchiselco.com</a>, click <strong>Account</strong> in the top menu, enter the email this message was sent to, and click the sign in link we email you. No password needed.</p>
<p style="margin:22px 0;"><a href="https://digitalchiselco.com/account" style="background:#854F0B;color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:bold;">Open my portal</a></p>
<p>Any question at all, just reply to this email and I will help personally.</p>
<p>Happy carving!<br/>Jolly · DigitalChiselCo</p></div>`;
  const text = 'Thank you for being part of DigitalChiselCo. Every purchase includes lifetime access to your customer portal: re-download every file you have bought (free, forever), see all orders, collect loyalty points (10 per $1), and share your give 15% get 15% referral link. How to sign in: go to digitalchiselco.com, click Account in the top menu, enter the email this message was sent to, then click the sign-in link we email you. No password needed. The attached PDF shows it with pictures. Questions? Just reply. Jolly, DigitalChiselCo';
  return { subject, html, text };
}


// ── Film campaign ("Sawdust Cinema") ─────────────────────────────────
// A short film about one design, mailed to subscribers.
//
// HONEST CONSTRAINT: <video> does not play in Gmail, Outlook or Yahoo. So the
// email carries a TALL POSTER with the play badge burned into the image, and the
// whole poster is one big tap target that opens the film on the product page.
// On a phone the poster fills the screen, which is the "full format" the owner
// asked for, and every tap lands on the design.
export function filmEmail(opts: {
  email: string;
  filmTitle: string;
  posterUrl: string;
  productUrl: string;
  productTitle: string;
  price?: number | null;
  runtime?: string;          // e.g. "31 seconds"
  blurb?: string;            // one line under the title
  subject?: string;          // override the generated subject line
  intro?: string;            // the opening line, written for THIS film
}): { subject: string; html: string; text: string } {
  // No runtime claim unless we actually know it: this used to default to the
  // Highland cow's "31 seconds" and state it for every other film.
  const runtime = opts.runtime || '';
  // "a 31 seconds film" reads wrong in a subject line; the adjective form does.
  const runtimeAdj = runtime.replace(/^(\d+)\s*seconds?$/i, '$1-second').replace(/^(\d+)\s*minutes?$/i, '$1-minute');
  const link = opts.productUrl.includes('?')
    ? `${opts.productUrl}&utm_source=email&utm_medium=film&utm_campaign=sawdust-cinema`
    : `${opts.productUrl}?utm_source=email&utm_medium=film&utm_campaign=sawdust-cinema`;
  const subject = opts.subject
    || (runtimeAdj ? `🎬 ${opts.filmTitle} — our new ${runtimeAdj} film`
                   : `🎬 ${opts.filmTitle} — a new short film`);
  const priceLine = opts.price ? ` — $${Number(opts.price).toFixed(2)}` : '';
  // The opener belongs to the FILM, never to the template.
  const intro = opts.intro || `We made a new film${runtime ? `, ${runtime}` : ''}. No sales pitch, just the design and the wood it is cut from.`;
  const body = `
<p style="margin:0 0 14px;font-size:15px;line-height:1.6;">${esc(intro)}</p>
<p style="margin:0 0 18px;font-size:15px;line-height:1.6;">Tap the picture to watch it, then the design is right underneath.</p>

<!-- the poster IS the play button: one tap target, full width on a phone -->
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:0 0 6px;">
  <tr><td align="center">
    <a href="${esc(link)}" style="display:block;text-decoration:none;">
      <img src="${esc(opts.posterUrl)}" width="600" alt="Watch: ${esc(opts.filmTitle)}"
        style="display:block;width:100%;max-width:600px;height:auto;border:0;border-radius:14px;" />
    </a>
  </td></tr>
</table>
<p style="margin:6px 0 20px;text-align:center;font-size:12px;color:#8a7a68;">▶ ${runtime ? esc(runtime) + ' · ' : ''}tap the picture to watch</p>

${btn(link, `Get the ${esc(opts.productTitle)}${priceLine}`)}

<p style="margin:18px 0 0;font-size:14px;line-height:1.6;color:#555;">
  ${opts.blurb ? esc(opts.blurb) + ' ' : ''}Every design in it is a ready-to-carve bas-relief STL, instant download, commercial use included.
</p>
<p style="margin:14px 0 0;font-size:13px;color:#777;">More films are on the way. If you carve one of these, send a photo, we love seeing them.</p>
<p style="margin:16px 0 0;font-size:14px;">Happy carving,<br/>Jolly · DigitalChiselCo</p>`;

  const html = shell(subject, opts.filmTitle, body, opts.email);
  const text = `${opts.filmTitle}${runtimeAdj ? ` — our new ${runtimeAdj} film` : ' — a new short film'}.

${intro}

Watch it and see the designs: ${link}

`
    + `Every design is a ready-to-carve bas-relief STL, instant download, commercial use included.

`
    + `Happy carving, Jolly · DigitalChiselCo
Unsubscribe: ${unsubUrl(opts.email)}`;
  return { subject, html, text };
}

// ── Maker recruitment (sent from Admin → Makers to subscribers) ───────
// Invites the existing audience to apply as a fabricator. Links to the gated
// /become-a-maker form with ?email= prefill. `applyUrl` lets the admin point
// at a preview/staging link during testing.
// Recruit invites go out in WAVES: the same person is re-invited every ~10
// days with a DIFFERENT subject + opener (owner directive 2026-09-01) until
// they apply as a maker or unsubscribe. `wave` picks the variant (cycles).
// Pricing shown in the invite comes from the SAME table the app charges from,
// so the email can never quote a stale price. The first real maker (2026-09-03)
// had to email and ask what credits cost, which is a question the invite itself
// should never leave open.
const RECRUIT_FEE_PCT = SUCCESS_FEE_PCT;
const RECRUIT_FOUNDING_DEFAULT = FOUNDING_CREDITS;   // fallback when the caller has not read the setting
const FAQ_URL = `${SITE}/faq?for=makers`;
const RECRUIT_PACK_LINE = packLine();
const RECRUIT_WAVES: { subject: string; opener: string }[] = [
  { subject: 'Join Cut Local: Get CNC & 3D Printing RFQs', opener: 'Quick question: <strong>do you own a CNC router, laser, or 3D printer?</strong>' },
  { subject: 'Own a CNC or 3D printer? Buyers near you need it', opener: 'People keep asking us who can <strong>actually build</strong> our designs near them. If you own a CNC router, laser, or 3D printer, that could be you.' },
  { subject: 'Turn your workshop hours into paid orders', opener: 'Your machine sits idle some days. Our buyers are looking for someone exactly like you to make the designs they already love.' },
  { subject: 'Your machine could be earning while you sleep on it', opener: 'Still thinking it over? Fair enough. Here is the short version of why makers join <strong>Cut Local</strong>:' },
  { subject: 'We send the customers, you make the sawdust', opener: 'The hardest part of selling custom work is finding buyers. We already have them, and they keep asking for finished pieces.' },
  { subject: 'A buyer near you may be waiting for your quote', opener: 'Every week, more buyers post requests to have our designs built locally. Each one is a job that could be yours.' },
];
export function makerRecruitEmail(opts: { email: string; applyUrl?: string; wave?: number; founding?: number } = { email: '' }): { subject: string; html: string; text: string } {
  // The founding grant is an admin setting (Admin -> Makers). The caller passes
  // the live value so the invite never promises fewer credits than are given.
  const RECRUIT_FOUNDING_CREDITS = Number(opts.founding ?? RECRUIT_FOUNDING_DEFAULT);
  const base = 'https://digitalchiselco.com/become-a-maker';
  const url = (opts.applyUrl || base) + (opts.email ? (`${(opts.applyUrl || base).includes('?') ? '&' : '?'}email=${encodeURIComponent(opts.email)}`) : '');
  const v = RECRUIT_WAVES[Math.abs(Math.round(opts.wave || 0)) % RECRUIT_WAVES.length];
  const subject = v.subject;
  const html = `<div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#2a241d;">
<p>Hi,</p>
<p>${v.opener}</p>
<p>We're opening <strong>Cut Local</strong> — our new maker network at DigitalChiselCo. Every day, people fall in love with our designs but have no machine to make them. We want to send those ready-to-cut jobs to makers like you, with the design file already in hand.</p>
<ul style="line-height:1.7;">
<li><strong>Paid work near you</strong> — buyers request a piece, you quote on your terms</li>
<li><strong>You keep ${100 - RECRUIT_FEE_PCT}%</strong> — buyers pay you directly; we take just a ${RECRUIT_FEE_PCT}% success fee on completed jobs</li>
<li><strong>Free to join</strong>, and founding makers get ${RECRUIT_FOUNDING_CREDITS} free quote credits + top placement</li>
<li><strong>Build your reputation</strong> on a network that already has the designs, the buyers and the traffic</li>
</ul>
<div style="background:#f7f2e8;border:1px solid #e0d3bb;border-radius:10px;padding:14px 16px;margin:20px 0;">
<p style="margin:0 0 8px;font-weight:bold;color:#854F0B;">What it costs, in plain numbers</p>
<p style="margin:0 0 6px;font-size:14px;line-height:1.6;">Joining and being listed: <strong>free</strong>, with no monthly fee.</p>
<p style="margin:0 0 6px;font-size:14px;line-height:1.6;">Sending a quote: <strong>one credit</strong>, and credits run ${RECRUIT_PACK_LINE}. Your first ${RECRUIT_FOUNDING_CREDITS} quotes are free.</p>
<p style="margin:0;font-size:14px;line-height:1.6;">When you win: the buyer pays <strong>you</strong> directly, and we bill <strong>${RECRUIT_FEE_PCT}%</strong> of the job once it is complete. On a $300 job that is $9.</p>
</div>
<p style="margin:22px 0;"><a href="${url}" style="background:#854F0B;color:#fff;text-decoration:none;padding:13px 24px;border-radius:8px;font-weight:bold;">Apply to become a Maker →</a></p>
<p>It takes about 5 minutes. We review every maker by hand, so you'll be part of a trusted, quality network from day one.</p>
<p style="font-size:14px;">Want the full detail first? Every question makers ask is answered here: <a href="${FAQ_URL}" style="color:#854F0B;">${FAQ_URL.replace('https://', '')}</a></p>
<p>Happy making,<br/>Jolly · DigitalChiselCo</p></div>`;
  const text = `${v.subject}. Cut Local is our maker network at DigitalChiselCo. Get paid work near you: buyers request a piece, you quote on your terms, they pay you directly, and we take just a ${RECRUIT_FEE_PCT}% success fee on completed jobs. What it costs: joining is free with no monthly fee; sending a quote costs one credit (${RECRUIT_PACK_LINE}) and your first ${RECRUIT_FOUNDING_CREDITS} quotes are free; on a $300 job our fee is $9. Full answers: ${FAQ_URL}. Apply (about 5 minutes): ${url}  — Jolly, DigitalChiselCo`;
  return { subject, html, text };
}

// ── Maker broadcast (announcements to APPROVED makers, from Admin → Makers)
// A distinct audience from subscribers. Wraps the owner's message in a
// branded Cut Local shell. Operational comms to opted-in makers → no unsub
// footer (kind 'makerNews' is transactional-styled but still budget-capped).
export function makerNewsEmail(opts: { subject: string; message: string }): { subject: string; html: string; text: string } {
  const paras = String(opts.message || '').trim().split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px;">${p.replace(/\n/g, '<br/>').replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`).join('');
  const html = `<div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#2a241d;">
<p style="font-size:12px;letter-spacing:.15em;text-transform:uppercase;color:#854F0B;margin:0 0 6px;">Cut Local · Maker Network</p>
${paras}
<p style="margin:18px 0 0;">Happy making,<br/>Jolly · DigitalChiselCo</p>
<p style="margin:22px 0 0;font-size:12px;color:#9a8b76;">You're receiving this as an approved Cut Local maker.</p></div>`;
  const text = `${opts.message}\n\nHappy making,\nJolly · DigitalChiselCo\n\nYou're receiving this as an approved Cut Local maker.`;
  return { subject: opts.subject, html, text };
}
