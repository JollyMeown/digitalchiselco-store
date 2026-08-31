// HMAC tokens for the Cut Local marketplace, where buyers and makers are
// identified by email (not Supabase-auth users). Two scopes:
//   maker:<email>       — a maker signed in to their dashboard
//   req:<requestId>:<buyerEmail> — a buyer's link to their own request
// Same fail-closed secret discipline as account-token.ts.
import crypto from 'node:crypto';

function env(name: string): string | undefined {
  return process.env[name] ?? (import.meta as any).env?.[name];
}
function secret(): string {
  const s = env('ACCOUNT_TOKEN_SECRET') || env('SUPABASE_SERVICE_ROLE_KEY');
  if (s) return s;
  if (env('NODE_ENV') === 'production' || (import.meta as any).env?.PROD) {
    throw new Error('ACCOUNT_TOKEN_SECRET (or SUPABASE_SERVICE_ROLE_KEY) must be set in production');
  }
  return 'dev-only-insecure-fallback';
}
const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');
function sign(payloadObj: object, ttl: number): string {
  const payload = b64(JSON.stringify({ ...payloadObj, exp: Math.floor(Date.now() / 1000) + ttl }));
  const sig = b64(crypto.createHmac('sha256', secret()).update(payload).digest());
  return `${payload}.${sig}`;
}
function verify(token: string | null | undefined): any | null {
  if (!token || typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot), sig = token.slice(dot + 1);
  const exp = b64(crypto.createHmac('sha256', secret()).update(payload).digest());
  if (sig.length !== exp.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) return null;
  try {
    const d = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!d?.exp || Math.floor(Date.now() / 1000) > Number(d.exp)) return null;
    return d;
  } catch { return null; }
}

// Maker dashboard session (30 days).
export const signMakerToken = (email: string) => sign({ s: 'maker', email: email.toLowerCase() }, 60 * 60 * 24 * 30);
export function verifyMakerToken(token?: string | null): { email: string } | null {
  const d = verify(token);
  return d && d.s === 'maker' && d.email ? { email: String(d.email).toLowerCase() } : null;
}

// Buyer's link to one request (90 days).
export const signRequestToken = (requestId: string, email: string) => sign({ s: 'req', id: requestId, email: email.toLowerCase() }, 60 * 60 * 24 * 90);
export function verifyRequestToken(token?: string | null): { id: string; email: string } | null {
  const d = verify(token);
  return d && d.s === 'req' && d.id && d.email ? { id: String(d.id), email: String(d.email).toLowerCase() } : null;
}
