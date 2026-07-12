// HMAC-signed subscriber confirmation token. Used only for the double opt-in
// click loop on /free → /free/confirm. Worst case if a token leaks: the
// holder can confirm someone else's signup — they can't read or change any
// of that person's data.

import crypto from 'node:crypto';

function env(name: string): string | undefined {
  return process.env[name] ?? (import.meta as any).env?.[name];
}

function secret(): string {
  const s = env('SUBSCRIBE_TOKEN_SECRET') || env('SUPABASE_SERVICE_ROLE_KEY');
  if (s) return s;
  // Fail closed in production — never sign/verify with a public constant.
  if (env('NODE_ENV') === 'production' || (import.meta as any).env?.PROD) {
    throw new Error('SUBSCRIBE_TOKEN_SECRET (or SUPABASE_SERVICE_ROLE_KEY) must be set in production');
  }
  return 'dev-only-insecure-fallback';
}

const SCOPE = 'subscribe-confirm';

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url');
}

export function signSubscribeToken(email: string, ttlSeconds = 60 * 60 * 24 * 14): string {
  const payload = b64url(
    JSON.stringify({ s: SCOPE, email: email.toLowerCase(), exp: Math.floor(Date.now() / 1000) + ttlSeconds }),
  );
  const sig = b64url(crypto.createHmac('sha256', secret()).update(payload).digest());
  return `${payload}.${sig}`;
}

export function verifySubscribeToken(token: string | null | undefined): { email: string } | null {
  if (!token || typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = b64url(crypto.createHmac('sha256', secret()).update(payload).digest());
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (data?.s !== SCOPE) return null;             // wrong scope → reject
    if (!data?.email || !data?.exp) return null;
    if (Math.floor(Date.now() / 1000) > Number(data.exp)) return null;
    return { email: String(data.email).toLowerCase() };
  } catch {
    return null;
  }
}
