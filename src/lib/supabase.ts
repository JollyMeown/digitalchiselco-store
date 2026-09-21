import { createClient } from '@supabase/supabase-js';

// Read from runtime env (process.env, available in the Netlify SSR function) first,
// then build-time (import.meta.env, inlined for the browser). This makes SSR work even
// if PUBLIC_ vars weren't present at build time.
function env(key: string): string | undefined {
  if (typeof process !== 'undefined' && process.env && process.env[key]) return process.env[key];
  return (import.meta.env as Record<string, string | undefined>)[key];
}

const url = env('PUBLIC_SUPABASE_URL') || 'https://placeholder.supabase.co';
const anon = env('PUBLIC_SUPABASE_ANON_KEY') || 'placeholder-anon-key';
export const isSupabaseConfigured = Boolean(env('PUBLIC_SUPABASE_URL'));

// ── Fail fast, and remember that we failed ───────────────────────────────
// 2026-09-21: the database ran out of CPU and queries took 2 to 100 seconds.
// Netlify kills an SSR function at 10 s, so visitors got the platform's raw
// 502 and the middleware never got a chance to show our own page. Two fixes:
//   1. Every query gets its own deadline, comfortably inside that 10 s, so a
//      stalled database produces a quick error instead of a dead function.
//   2. A hard failure (network error or deadline) is recorded, and the
//      middleware reads it after rendering. Pages catch their own query
//      errors and render empty, which looks fine and is not: an empty shop is
//      worse than an honest "back in a few minutes".
const QUERY_DEADLINE_MS = 6000;
let lastHardFailure = 0;

/** True if a query failed outright in the last few seconds. */
export function databaseUnreachable(withinMs = 4000): boolean {
  return lastHardFailure > 0 && Date.now() - lastHardFailure < withinMs;
}

const timedFetch: typeof fetch = async (input, init) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), QUERY_DEADLINE_MS);
  try {
    return await fetch(input as any, { ...(init || {}), signal: ctrl.signal });
  } catch (err) {
    // A 4xx/5xx still resolves, so anything thrown here is the connection
    // itself failing: DNS, refused, reset, or our own deadline.
    lastHardFailure = Date.now();
    throw err;
  } finally {
    clearTimeout(timer);
  }
};

// Browser/SSR-safe client (respects Row-Level Security).
export const supabase = createClient(url, anon, { global: { fetch: timedFetch } });

// Server-only client with elevated rights — use ONLY in API routes / server code.
export function supabaseAdmin() {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  return createClient(url, key, { auth: { persistSession: false }, global: { fetch: timedFetch } });
}

export type LinkStatus = 'certain' | 'likely' | 'review' | 'bundle_manual' | 'verified' | 'broken';

// admin color marker for download-link confidence
export const linkColor: Record<LinkStatus, string> = {
  certain: '#1d9e75',      // green
  verified: '#1d9e75',
  likely: '#ba7517',       // amber
  review: '#e24b4a',       // red
  bundle_manual: '#e24b4a',
  broken: '#e24b4a',
};
