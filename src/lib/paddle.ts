// Server-side Paddle helper. Reads PADDLE_ENV / PADDLE_API_KEY / PADDLE_WEBHOOK_SECRET
// from env. Switch to production simply by changing PADDLE_ENV=production + swapping keys.
import crypto from 'node:crypto';

type Env = 'sandbox' | 'production';

function env(name: string): string | undefined {
  return process.env[name] ?? (import.meta as any).env?.[name];
}

export function paddleEnv(): Env {
  return (env('PADDLE_ENV') === 'production' ? 'production' : 'sandbox') as Env;
}

export function paddleApiBase(): string {
  return paddleEnv() === 'production'
    ? 'https://api.paddle.com'
    : 'https://sandbox-api.paddle.com';
}

export function paddleClientToken(): string | undefined {
  return env('PUBLIC_PADDLE_CLIENT_TOKEN');
}

/**
 * Call Paddle's REST API server-side. Returns parsed JSON, throws on non-2xx.
 */
export async function paddleApi<T = any>(
  path: string,
  init: { method?: string; body?: any; query?: Record<string, string | number | undefined> } = {},
): Promise<T> {
  const key = env('PADDLE_API_KEY');
  if (!key) throw new Error('PADDLE_API_KEY not set');
  const url = new URL(path.startsWith('/') ? path.slice(1) : path, paddleApiBase() + '/');
  for (const [k, v] of Object.entries(init.query || {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), {
    method: init.method || 'GET',
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      'paddle-version': '1',
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  if (!res.ok) {
    const msg = data?.error?.detail || data?.error?.message || `Paddle ${res.status}: ${text.slice(0, 300)}`;
    throw new Error(msg);
  }
  return data as T;
}

/**
 * Verify the Paddle-Signature header on an incoming webhook request.
 * Header format: `ts=<unix>;h1=<hmac-sha256>`
 * HMAC payload: `<ts>:<rawBody>`
 * Returns true if valid AND timestamp is within 5 minutes.
 */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null, secret: string): boolean {
  if (!signatureHeader || !secret) return false;
  const parts = Object.fromEntries(
    signatureHeader.split(';').map((p) => {
      const i = p.indexOf('=');
      return i > -1 ? [p.slice(0, i).trim(), p.slice(i + 1).trim()] : [p.trim(), ''];
    }),
  );
  const ts = parts['ts'];
  const h1 = parts['h1'];
  if (!ts || !h1) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(ts)) > 5 * 60) return false; // replay protection: 5 minute window
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${ts}:${rawBody}`)
    .digest('hex');
  // constant-time compare
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(h1, 'hex'));
  } catch {
    return false;
  }
}
