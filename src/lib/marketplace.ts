// Cut Local marketplace helpers: match makers to a request, and the small
// notification emails that move the loop along. All server-side (service role).
import type { SupabaseClient } from '@supabase/supabase-js';
import { send as sendEmail } from './resend';
import { signMakerToken } from './marketplace-token';
import { reach, REACH_ORDER, type Reach } from './maker-reach';
import { placeLabel } from './place';

const SITE = (process.env.PUBLIC_SITE_URL || 'https://digitalchiselco.com').replace(/\/$/, '');
// Prices/fees live in marketplace-pricing.ts (no imports of its own) so email
// templates can read them without an import cycle through the mailer.
export { SUCCESS_FEE_PCT, CREDIT_PACKS, FOUNDING_CREDITS } from './marketplace-pricing';
import { SUCCESS_FEE_PCT } from './marketplace-pricing';

// Find approved makers who can take this job, best first. Whether a maker can
// reach the buyer is decided in maker-reach.ts (shared with the dashboard and
// the daily reminder). Each returned maker carries `_reach`, so the job email
// can say plainly when the buyer is across a border. Capability filter is soft
// (only excludes a maker who lists materials and none match the requested one).
export async function matchMakers(db: SupabaseClient, req: any): Promise<any[]> {
  const { data } = await db.from('makers').select('*').eq('status', 'approved').limit(2000);
  const material = (req.material || '').toLowerCase();
  const scored = (data || []).map((m: any) => {
    const r = reach(m, req);
    if (!r.show) return null;
    if (material && r.kind !== 'picked' && Array.isArray(m.materials) && m.materials.length && !m.materials.map((x: string) => x.toLowerCase()).includes(material)) return null;
    return { m: { ...m, _reach: r }, r };
  }).filter(Boolean) as { m: any; r: Reach }[];
  scored.sort((a, b) =>
    REACH_ORDER[a.r.kind] - REACH_ORDER[b.r.kind]
    || (a.r.km ?? 1e9) - (b.r.km ?? 1e9)
    || (Number(b.m.rating_avg) || 0) - (Number(a.m.rating_avg) || 0));
  return scored.map((s) => s.m);
}

/** "3 can deliver, 2 asked about shipping across the border" for the owner's alert. */
export function reachSummary(makers: any[]): { sure: number; border: number; unsure: number } {
  const k = makers.map((m) => (m._reach as Reach | undefined)?.kind);
  return {
    sure: makers.filter((m) => m._reach?.sure).length,
    border: k.filter((x) => x === 'border').length,
    unsure: k.filter((x) => x === 'unknown').length,
  };
}

export async function notifyMakersOfJob(makers: any[], req: any) {
  for (const m of makers.slice(0, 40)) await sendEmail(jobEmail(m, req));
}

/** The "new job" email for one maker, built but not sent (scripts preview it). */
export function jobEmail(m: any, req: any) {
  const title = (req.product_title || 'a design').split('|')[0].trim();
  const where = placeLabel(req, { withCountry: true }) || req.country || 'your area';
  {
    const link = `${SITE}/maker?t=${encodeURIComponent(signMakerToken(m.email))}`;
    const r: Reach | undefined = m._reach;
    const border = r?.kind === 'border';
    const away = r?.km != null ? `about ${Math.round(r.km / 10) * 10} km from you` : 'in another country';
    // Across a border the maker is ASKED, not assumed: say where the buyer is,
    // that shipping and customs are between them, and that skipping costs nothing.
    const borderHtml = border
      ? `<p style="background:#fbf1de;border:1px solid #e7cf9c;border-radius:8px;padding:10px 12px;">This buyer is in <b>${esc(where)}</b>, ${away}, across the border. We are asking because you ship within your own country and you are one of the closest makers. Quote only if you can ship there: shipping and any customs are agreed between you and the buyer. If not, just skip it; only sending a quote uses a credit.</p>
<p style="font-size:13px;color:#6b5d4a;">You can tick the countries you ship to under "Your listing" on your dashboard, so we only ask when it fits.</p>`
      : '';
    return {
      to: m.email,
      subject: border ? `Cut Local job across the border in ${countryName(req.country)}: ${title}` : `New Cut Local job near you: ${title}`,
      html: `<div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;color:#2a241d;">
<p style="font-size:12px;letter-spacing:.15em;text-transform:uppercase;color:#854F0B;">Cut Local · new job</p>
<p>A buyer ${border ? 'in' : 'near'} <b>${esc(border ? where : (req.city || req.region || req.country || 'you'))}</b> wants <b>${esc(title)}</b> made${req.material ? ' in ' + esc(req.material) : ''}${req.size ? ', ' + esc(req.size) : ''}.</p>
<p>Budget: ${esc(req.budget || 'open')} · needed: ${esc(req.deadline || 'flexible')}${req.delivery ? ' · ' + esc(req.delivery === 'ship' ? 'buyer wants it shipped' : req.delivery === 'pickup' ? 'pickup' : 'pickup or shipping') : ''}.</p>
${borderHtml}
<p style="margin:20px 0;"><a href="${link}" style="background:#854F0B;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:bold;">View job &amp; send a quote →</a></p>
<p style="font-size:12px;color:#9a8b76;">You're an approved Cut Local maker. Quoting uses one credit.</p></div>`,
      text: border
        ? `Cut Local job across the border: a buyer in ${where} (${away}) wants ${title}${req.material ? ' in ' + req.material : ''}. Quote only if you can ship there; shipping and customs are agreed with the buyer. View & quote: ${link}`
        : `New Cut Local job near ${req.city || req.country}: ${title}${req.material ? ' in ' + req.material : ''}. View & quote: ${link}`,
      idempotencyKey: `mp-job:${req.id}:${m.id}`,
      tags: [{ name: 'kind', value: 'marketplace' }],
    };
  }
}

function countryName(c: unknown): string {
  const s = String(c || '').trim();
  return /^(ca|can|canada)$/i.test(s) ? 'Canada' : /^(us|usa|u\.?s\.?a?\.?|united states.*)$/i.test(s) ? 'the USA' : s || 'another country';
}

export async function notifyBuyerNewQuote(req: any, maker: any, quote: any, buyerLink: string) {
  await sendEmail({
    to: req.buyer_email,
    subject: `You've got a quote on "${(req.product_title || 'your request').split('|')[0].trim()}"`,
    html: `<div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;color:#2a241d;">
<p><b>${esc(maker.maker_name)}</b> quoted <b>$${Number(quote.price).toFixed(2)}</b>${quote.lead_days ? ' · ready in ' + quote.lead_days + ' days' : ''} on your Cut Local request.</p>
${maker.rating_count ? `<p>They're rated ${'★'.repeat(Math.round(maker.rating_avg))} ${Number(maker.rating_avg).toFixed(1)} from ${maker.rating_count} job(s).</p>` : ''}
<p style="margin:20px 0;"><a href="${buyerLink}" style="background:#854F0B;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:bold;">See all your quotes →</a></p></div>`,
    text: `${maker.maker_name} quoted $${Number(quote.price).toFixed(2)} on your Cut Local request. See quotes: ${buyerLink}`,
    idempotencyKey: `mp-quote:${quote.id}`,
    tags: [{ name: 'kind', value: 'marketplace' }],
  });
}

export async function notifyMakerWon(req: any, maker: any) {
  const link = `${SITE}/maker?t=${encodeURIComponent(signMakerToken(maker.email))}`;
  await sendEmail({
    to: maker.email,
    subject: `🎉 You won a Cut Local job: ${(req.product_title || '').split('|')[0].trim()}`,
    html: `<div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;color:#2a241d;">
<p><b>Congratulations!</b> The buyer chose your quote. Open the job to arrange payment and details in chat.</p>
<p style="margin:20px 0;"><a href="${link}" style="background:#854F0B;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:bold;">Open the job →</a></p>
<p style="font-size:12px;color:#9a8b76;">Buyer pays you directly. A ${SUCCESS_FEE_PCT}% success fee applies when the job completes.</p></div>`,
    text: `You won a Cut Local job. Open it: ${link}`,
    idempotencyKey: `mp-won:${req.id}:${maker.id}`,
    tags: [{ name: 'kind', value: 'marketplace' }],
  });
}

export function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// "We added free credits to your account" — sent when the owner gifts credits
// from Admin → Makers. A gift is only worth giving if the maker knows about it,
// so the email says what it is for and links straight to the jobs board.
export async function sendMakerCreditsGranted(o: { email: string; maker_name?: string | null; credits: number; balance: number; reason?: string }) {
  const link = `${SITE}/maker?t=${encodeURIComponent(signMakerToken(o.email))}`;
  const quotes = o.credits === 1 ? 'one more quote' : `${o.credits} more quotes`;
  await sendEmail({
    to: o.email,
    subject: `🎁 ${o.credits} free quote credit${o.credits === 1 ? '' : 's'} added to your Cut Local account`,
    html: `<div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;color:#2a241d;">
<p style="font-size:12px;letter-spacing:.15em;text-transform:uppercase;color:#854F0B;">Cut Local · free credits</p>
<p>Hi ${esc(o.maker_name || '')}, we have just added <b>${o.credits} free quote credit${o.credits === 1 ? '' : 's'}</b> to your account. That is ${quotes} on us.</p>
${o.reason ? `<p style="color:#6b5d4a;">${esc(o.reason)}</p>` : ''}
<p>Your balance is now <b>${o.balance} credit${o.balance === 1 ? '' : 's'}</b>. One credit sends one quote, and credits never expire.</p>
<p style="margin:20px 0;"><a href="${link}" style="background:#854F0B;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;">See jobs and quote →</a></p>
<p style="font-size:13px;color:#6b5d4a;">Buyers pay you directly, and we only take ${SUCCESS_FEE_PCT}% when a job completes. Questions: <a href="${SITE}/faq?for=makers" style="color:#854F0B;">${SITE.replace('https://', '')}/faq</a></p>
<p>Happy making,<br/>Jolly · DigitalChiselCo</p></div>`,
    text: `We added ${o.credits} free quote credits to your Cut Local account. Balance: ${o.balance}. ${o.reason || ''} See jobs and quote: ${link}`,
    idempotencyKey: `maker-credits:${o.email}:${Date.now()}`,
    tags: [{ name: 'kind', value: 'makerNews' }],
  });
}

// Welcome email when a maker is approved (dashboard link + founding credits).
export async function sendMakerWelcome(maker: { email: string; maker_name?: string | null; credits?: number }) {
  const link = `${SITE}/maker?t=${encodeURIComponent(signMakerToken(maker.email))}`;
  await sendEmail({
    to: maker.email,
    subject: '🎉 You’re in — welcome to Cut Local',
    html: `<div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;color:#2a241d;">
<p style="font-size:12px;letter-spacing:.15em;text-transform:uppercase;color:#854F0B;">Cut Local · approved</p>
<p>Hi ${esc(maker.maker_name || '')}, your application is approved — welcome aboard!</p>
<p>You’re listed as a Cut Local maker and can start quoting jobs now. We’ve added <b>${maker.credits ?? 5} founding credits</b> to get you going (one credit per quote).</p>
<p style="margin:20px 0;"><a href="${link}" style="background:#854F0B;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;">Open my maker dashboard →</a></p>
<p style="font-size:13px;color:#6b5d4a;">Reminder: buyers pay you directly, and we take just a ${SUCCESS_FEE_PCT}% success fee on completed jobs. Keep your profile photos fresh — they win work.</p>
<p style="font-size:13px;color:#6b5d4a;">Every question about credits, fees and payments is answered here: <a href="${SITE}/faq?for=makers" style="color:#854F0B;">${SITE.replace('https://', '')}/faq</a></p>
<p>Happy making,<br/>Jolly · DigitalChiselCo</p></div>`,
    text: `You're approved as a Cut Local maker! ${maker.credits ?? 5} founding credits added. Open your dashboard: ${link}`,
    idempotencyKey: `maker-welcome:${maker.email}`,
    tags: [{ name: 'kind', value: 'makerNews' }],
  });
}
