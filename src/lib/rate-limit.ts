// DB-backed fixed-window rate limiter for unauthenticated endpoints.
// Serverless functions have no shared memory, so the window lives in Postgres
// (see migration 027). Fails OPEN: if the DB check errors we allow the request
// rather than block real customers — availability over strictness here.
import { supabaseAdmin } from './supabase';

/** Best-effort client IP from Netlify / proxy headers. */
export function clientIp(request: Request): string {
  const h = request.headers;
  return (
    h.get('x-nf-client-connection-ip') ||
    (h.get('x-forwarded-for') || '').split(',')[0].trim() ||
    h.get('x-real-ip') ||
    'unknown'
  );
}

/**
 * Returns true if this attempt is within the limit (and records it), false if
 * the caller has exceeded `max` hits for `bucket` within `windowSeconds`.
 */
export async function rateLimit(bucket: string, max: number, windowSeconds: number): Promise<boolean> {
  try {
    const db = supabaseAdmin();
    const { data, error } = await db.rpc('rate_limit_check', {
      p_bucket: bucket,
      p_max: max,
      p_window_seconds: windowSeconds,
    });
    if (error) {
      console.error('rateLimit check failed (allowing):', error.message);
      return true; // fail open
    }
    return data !== false;
  } catch (e) {
    console.error('rateLimit threw (allowing):', e);
    return true; // fail open
  }
}

/** 429 JSON response helper. */
export function tooMany(message = 'Too many requests. Please wait a moment and try again.') {
  return new Response(JSON.stringify({ error: message }), {
    status: 429,
    headers: { 'content-type': 'application/json', 'retry-after': '60' },
  });
}
