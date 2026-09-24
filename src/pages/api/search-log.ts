// Browser-side search events: a finished search typed on /search, a filter
// change, and a click on a result or a dropdown suggestion. See
// src/lib/search-log.ts for what each row means.
import type { APIRoute } from 'astro';
import { logSearchEvent } from '../../lib/search-log';
import { rateLimit, clientIp } from '../../lib/rate-limit';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const t = body.t === 'search_click' ? 'search_click' : body.t === 'search' ? 'search' : '';
    if (!t) return new Response(null, { status: 204 });
    const ip = clientIp(request);
    if (!(await rateLimit(`searchlog:${ip}`, 90, 300))) return new Response(null, { status: 204 });
    const host = (() => { try { return new URL(request.headers.get('origin') || request.headers.get('referer') || '').hostname; } catch { return ''; } })();
    let path = String(body.p || '/search').slice(0, 200);
    if (!path.startsWith('/')) path = '/' + path;
    const n = Number.isFinite(Number(body.n)) ? Math.max(0, Math.min(100000, Math.round(Number(body.n)))) : null;
    const pid = typeof body.pid === 'string' && /^[0-9a-f-]{36}$/i.test(body.pid) ? body.pid : null;
    await logSearchEvent({ request, ip, host, type: t, q: body.q, n, path, productId: pid });
  } catch { /* analytics never errors to the visitor */ }
  return new Response(null, { status: 204 });
};
