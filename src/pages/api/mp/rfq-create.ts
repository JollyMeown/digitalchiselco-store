// Buyer posts a request to have a design made. Matches + notifies makers,
// returns a private link (token) the buyer uses to see quotes and chat.
import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabase';
import { rateLimit, clientIp, tooMany } from '../../../lib/rate-limit';
import { signRequestToken } from '../../../lib/marketplace-token';
import { matchMakers, notifyMakersOfJob } from '../../../lib/marketplace';

export const prerender = false;
const SITE = (import.meta.env.PUBLIC_SITE_URL || process.env.PUBLIC_SITE_URL || 'https://digitalchiselco.com').replace(/\/$/, '');
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const str = (v: unknown, n = 300) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

export const POST: APIRoute = async ({ request }) => {
  const ip = clientIp(request);
  if (!(await rateLimit(`rfq:ip:${ip}`, 8, 3600))) return tooMany('Too many requests. Please try again later.');
  const b = await request.json().catch(() => ({}));
  const buyer_email = str(b.buyer_email, 160).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(buyer_email)) return json({ error: 'Please enter a valid email so makers can reach you.' }, 400);
  if (!str(b.product_title, 240) && !str(b.product_slug, 240)) return json({ error: 'Missing the design.' }, 400);

  const row = {
    status: 'open', buyer_email, buyer_name: str(b.buyer_name, 120) || null,
    product_id: /^[0-9a-f-]{36}$/i.test(String(b.product_id || '')) ? b.product_id : null,
    product_slug: str(b.product_slug, 240) || null, product_title: str(b.product_title, 240) || null, product_image: str(b.product_image, 500) || null,
    material: str(b.material, 80) || null, size: str(b.size, 80) || null, finish: str(b.finish, 80) || null,
    quantity: Math.max(1, Math.min(999, parseInt(b.quantity, 10) || 1)),
    deadline: str(b.deadline, 80) || null, budget: str(b.budget, 80) || null, notes: str(b.notes, 1500) || null,
    delivery: ['pickup', 'ship', 'either'].includes(b.delivery) ? b.delivery : 'either',
    country: str(b.country, 80) || null, region: str(b.region, 80) || null, city: str(b.city, 80) || null, postal: str(b.postal, 20) || null,
  };
  const db = supabaseAdmin();
  const { data, error } = await db.from('maker_requests').insert(row).select('*').single();
  if (error) { console.error('[rfq-create]', error.message); return json({ error: 'Could not post your request. Please try again.' }, 500); }

  const token = signRequestToken(data.id, buyer_email);
  const buyerLink = `${SITE}/requests/${data.id}?t=${encodeURIComponent(token)}`;
  // Email the buyer their private link so they never lose it (buyer-critical).
  try {
    const { send: sendEmail } = await import('../../../lib/resend');
    const { esc } = await import('../../../lib/marketplace');
    // product_title arrives from the browser → escape before HTML interpolation
    const title = esc((row.product_title || 'your design').split('|')[0].trim());
    await sendEmail({
      to: buyer_email, subject: `Your Cut Local request is posted: ${title}`,
      html: `<div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;color:#2a241d;"><p style="font-size:12px;letter-spacing:.15em;text-transform:uppercase;color:#854F0B;">Cut Local · request received</p><p>Thanks! Your request to have <b>${title}</b> made is live, and makers near you have been notified. Quotes will arrive here:</p><p style="margin:20px 0;"><a href="${buyerLink}" style="background:#854F0B;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;">View my request &amp; quotes →</a></p><p style="font-size:13px;color:#6b5d4a;">Keep this email, it's your private link. Comparing quotes is completely free for you: you pick a maker by price and star rating, then pay them directly in whatever way you both agree (card, PayPal, or cash on pickup). We never hold your money; the small service fee is paid by the maker, not you.</p><p>Happy making,<br/>Jolly · DigitalChiselCo</p></div>`,
      text: `Your Cut Local request for ${title} is posted. View quotes: ${buyerLink}`,
      idempotencyKey: `rfq-buyer:${data.id}`, tags: [{ name: 'kind', value: 'order' }],
    });
  } catch (e) { console.error('[rfq-buyer-email]', (e as any)?.message); }
  // match + notify makers (best-effort, never blocks the buyer)
  let matched = 0;
  try { const makers = await matchMakers(db, data); matched = makers.length; await notifyMakersOfJob(makers, data); } catch (e) { console.error('[rfq-match]', (e as any)?.message); }
  try { const { telegramOwner } = await import('../../../lib/notify'); await telegramOwner(`🔨 <b>New Cut Local request</b>\n${row.product_title}\n${[row.city, row.country].filter(Boolean).join(', ')} · notified ${matched} maker(s)`); } catch {}

  return json({ ok: true, id: data.id, matched, link: `${SITE}/requests/${data.id}?t=${encodeURIComponent(token)}` });
};
