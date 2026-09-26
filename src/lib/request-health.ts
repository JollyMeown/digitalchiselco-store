// Server-only: per-request database health for the maintenance page.
//
// 2026-09-26: the "database unreachable" mark used to be ONE timestamp shared
// by the whole function instance, so a failed query in any request (another
// visitor's, a background beacon, an optional widget) turned every product
// and catalogue page rendered by anyone in the next 4 seconds into the 503
// maintenance page. Google Shopping's landing-page checks saw those 503s and
// stopped showing the catalogue on 2026-09-22 (1,690 impressions and 30 clicks
// a day down to ~380 and 0). Failures are now counted per request.
//
// Kept out of lib/supabase.ts on purpose: that file is also bundled for the
// browser (admin islands), where node:async_hooks does not exist. supabase.ts
// reports a failure through the globalThis hook registered below.
import { AsyncLocalStorage } from 'node:async_hooks';

type RequestHealth = { failures: number };
const store = new AsyncLocalStorage<RequestHealth>();

(globalThis as any).__dccQueryFailed = () => {
  const h = store.getStore();
  if (h) h.failures++;
};

/** Run one request with its own failure counter (the middleware wraps next()). */
export function withRequestHealth<T>(fn: () => Promise<T>): Promise<T> {
  return store.run({ failures: 0 }, fn);
}
/** True if a query made by THIS request failed outright (network or deadline). */
export function databaseUnreachable(): boolean {
  return (store.getStore()?.failures || 0) > 0;
}
