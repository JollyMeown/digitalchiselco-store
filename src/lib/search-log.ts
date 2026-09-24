// Every search, recorded for later analysis (owner, 2026-09-24: "the searches
// must record what is being searched for").
//
// All rows go to site_events, which the admin search-terms report and Design
// Scout already read:
//   type 'search'        q = the words, n = how many designs matched,
//                        path = '/search?' + the filters and sort in force
//                        (so "deer + under $8 + portrait" is visible), and
//                        '#page', '#filter', '#typed' for where it came from
//   type 'search_click'  q = the words, product_id = the design clicked,
//                        n = its position in the list (1 = first),
//                        path = '/search' or '/dropdown'
// A zero-result search is logged as zero even when a spelling fix or a
// synonym found something: that miss is the demand signal.
//
// No cookies, no IPs: the visitor hash is the same daily sha256 the pageview
// beacon uses, so searches can be tied to a day's visit and nothing more.
// Bots and the local dev server are never recorded.
import crypto from 'node:crypto';
import { supabaseAdmin } from './supabase';

const BOT_RE = /bot|crawl|spider|slurp|bingpreview|headless|lighthouse|pingdom|uptime|monitor|facebookexternal|preview|scrapy|python-requests|curl|wget/i;

export function visitorHash(ip: string, ua: string, day: string): string {
  const secret = process.env.ACCOUNT_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'trk';
  return crypto.createHash('sha256').update(`${ip}|${ua}|${day}|${secret}`).digest('hex').slice(0, 32);
}

export function isLoggable(request: Request, host: string): boolean {
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/i.test(host)) return false;
  return !BOT_RE.test(request.headers.get('user-agent') || '');
}

export function cleanQ(q: unknown): string {
  return String(q || '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 120);
}

/** Awaited by callers (Netlify can end a function once the response is sent,
 *  dropping an unawaited insert); it never throws, so it cannot break a search. */
export async function logSearchEvent(row: { request: Request; ip: string; host: string; type: 'search' | 'search_click'; q: string; n?: number | null; path: string; productId?: string | null }) {
  try {
    if (!isLoggable(row.request, row.host)) return;
    const q = cleanQ(row.q);
    if (row.type === 'search' && !q && !row.path.includes('?')) return;   // a bare /search visit is browsing, not a search
    const day = new Date().toISOString().slice(0, 10);
    await Promise.race([
      supabaseAdmin().from('site_events').insert({
        day, type: row.type, q: q || null, n: row.n ?? null,
        path: row.path.slice(0, 200), product_id: row.productId || null,
        visitor_hash: visitorHash(row.ip, row.request.headers.get('user-agent') || '', day),
      }).then(() => {}, () => {}),
      new Promise((r) => setTimeout(r, 1500)),   // a slow database never holds up the results
    ]);
  } catch { /* never let logging fail a search */ }
}
