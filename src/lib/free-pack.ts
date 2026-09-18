// Mail a subscriber the link to their free pack (/free/files?k=...).
// Shared by /api/free-resend (the "send it again" button) and /api/subscribe
// (an already-confirmed subscriber signing up again gets the files, not a
// pointless second "confirm your email").
import { randomBytes } from 'node:crypto';
import { send as sendEmail } from './resend';
import { freePackLink } from './email-templates';

const SITE = ((process.env.PUBLIC_SITE_URL ?? (import.meta as any).env?.PUBLIC_SITE_URL) || 'https://digitalchiselco.com').replace(/\/$/, '');

export async function sendFreePackLink(db: any, sub: { email: string; name?: string | null; free_pack_token?: string | null }) {
  const { data: gs } = await db.from('growth_settings').select('free_pack_url').eq('id', 1).maybeSingle();
  // A stored random token, not an HMAC over an env secret. The signed
  // version failed in production: the same deployment signed a link and
  // then refused it, because the two functions resolved the secret
  // differently. The database cannot disagree with itself.
  let tok = sub.free_pack_token;
  if (!tok) {
    tok = randomBytes(24).toString('base64url');
    await db.from('subscribers').update({ free_pack_token: tok }).eq('email', sub.email);
  }
  const url = `${SITE}/free/files?k=${encodeURIComponent(tok)}`;
  const { subject, html, text } = freePackLink({ name: sub.name ?? null, filesUrl: url, packUrl: gs?.free_pack_url || '' });
  await sendEmail({
    to: sub.email, subject, html, text,
    // Timestamped: asking twice must actually send twice.
    idempotencyKey: `free-resend:${sub.email}:${Date.now()}`,
    tags: [{ name: 'kind', value: 'optin' }],   // user-initiated: bypasses the daily-quota gate
  });
}
