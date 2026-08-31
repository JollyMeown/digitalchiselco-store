// Cut Local marketplace helpers: match makers to a request, and the small
// notification emails that move the loop along. All server-side (service role).
import type { SupabaseClient } from '@supabase/supabase-js';
import { send as sendEmail } from './resend';
import { signMakerToken } from './marketplace-token';

const SITE = (process.env.PUBLIC_SITE_URL || 'https://digitalchiselco.com').replace(/\/$/, '');
export const SUCCESS_FEE_PCT = 3;

// Find approved makers who can plausibly do this job. Lenient by design — it's
// better to notify a few extra than to miss a maker. Ranked: same city, then
// same region, then anyone who ships. Capability filter is soft (only excludes
// a maker who lists materials and none match the requested one).
export async function matchMakers(db: SupabaseClient, req: any): Promise<any[]> {
  const { data } = await db.from('makers').select('*').eq('status', 'approved').limit(2000);
  const country = (req.country || '').toLowerCase();
  const region = (req.region || '').toLowerCase();
  const city = (req.city || '').toLowerCase();
  const material = (req.material || '').toLowerCase();
  const wantsShip = req.delivery === 'ship' || req.delivery === 'either';
  const scored = (data || []).map((m: any) => {
    const mc = (m.country || '').toLowerCase();
    if (country && mc && country !== mc) {
      // different country: only match if maker ships internationally and buyer accepts shipping
      if (!(m.deliver_intl && wantsShip)) return null;
    }
    // soft capability filter
    if (material && Array.isArray(m.materials) && m.materials.length && !m.materials.map((x: string) => x.toLowerCase()).includes(material)) return null;
    let score = 0;
    if (city && (m.city || '').toLowerCase() === city) score += 3;
    if (region && (m.region || '').toLowerCase() === region) score += 2;
    if (m.deliver_domestic_ship) score += 1;
    score += Math.min(2, Number(m.rating_avg) || 0) * 0.3; // nudge higher-rated makers up
    return { m, score };
  }).filter(Boolean) as { m: any; score: number }[];
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.m);
}

export async function notifyMakersOfJob(makers: any[], req: any) {
  const title = (req.product_title || 'a design').split('|')[0].trim();
  for (const m of makers.slice(0, 40)) {
    const link = `${SITE}/maker?t=${encodeURIComponent(signMakerToken(m.email))}`;
    await sendEmail({
      to: m.email,
      subject: `New Cut Local job near you: ${title}`,
      html: `<div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;color:#2a241d;">
<p style="font-size:12px;letter-spacing:.15em;text-transform:uppercase;color:#854F0B;">Cut Local · new job</p>
<p>A buyer near <b>${esc(req.city || req.region || req.country || 'you')}</b> wants <b>${esc(title)}</b> made${req.material ? ' in ' + esc(req.material) : ''}${req.size ? ', ' + esc(req.size) : ''}.</p>
<p>Budget: ${esc(req.budget || 'open')} · needed: ${esc(req.deadline || 'flexible')}.</p>
<p style="margin:20px 0;"><a href="${link}" style="background:#854F0B;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:bold;">View job &amp; send a quote →</a></p>
<p style="font-size:12px;color:#9a8b76;">You're an approved Cut Local maker. Quoting uses one credit.</p></div>`,
      text: `New Cut Local job near ${req.city || req.country}: ${title}${req.material ? ' in ' + req.material : ''}. View & quote: ${link}`,
      idempotencyKey: `mp-job:${req.id}:${m.id}`,
      tags: [{ name: 'kind', value: 'marketplace' }],
    });
  }
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
