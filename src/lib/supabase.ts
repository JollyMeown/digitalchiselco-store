import { createClient } from '@supabase/supabase-js';
import { AsyncLocalStorage } from 'node:async_hooks';

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
//
// 2026-09-26: the failure used to be ONE timestamp shared by the whole
// function instance ("a query failed in the last 4 s"), so a failed query in
// any request, a background beacon or an optional widget, turned every
// product and catalogue page rendered by anyone in the next 4 seconds into
// the 503 maintenance page. Google Shopping's landing-page checks saw those
// 503s and stopped showing the catalogue on 2026-09-22 (1,690 impressions
// and 30 clicks a day down to ~380 and 0). The mark is now kept per request
// (AsyncLocalStorage): a page is only replaced when ITS OWN queries failed.
const QUERY_DEADLINE_MS = 6000;
type RequestHealth = { failures: number };
const requestHealth = new AsyncLocalStorage<RequestHealth>();

/** Run one request with its own failure counter (middleware wraps next()). */
export function withRequestHealth<T>(fn: () => Promise<T>): Promise<T> {
  return requestHealth.run({ failures: 0 }, fn);
}
/** True if a query made by THIS request failed outright (network or deadline). */
export function databaseUnreachable(): boolean {
  return (requestHealth.getStore()?.failures || 0) > 0;
}

const timedFetch: typeof fetch = async (input, init) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), QUERY_DEADLINE_MS);
  try {
    return await fetch(input as any, { ...(init || {}), signal: ctrl.signal });
  } catch (err) {
    // A 4xx/5xx still resolves, so anything thrown here is the connection
    // itself failing: DNS, refused, reset, or our own deadline.
    const h = requestHealth.getStore();
    if (h) h.failures++;
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
