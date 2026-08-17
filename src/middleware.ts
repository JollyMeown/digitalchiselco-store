// Security response headers for SSR pages.
//
// Netlify's `[[headers]]` in netlify.toml only decorate STATIC/CDN-served files;
// they do NOT reach responses produced by the Astro SSR function (the homepage,
// product/blog pages, the admin panel — exactly the pages that matter most for
// clickjacking and XSS). This middleware sets them on every SSR response so the
// whole site is covered. (netlify.toml still covers the static assets.)
import { defineMiddleware } from 'astro:middleware';

const SECURITY_HEADERS: Record<string, string> = {
  // NOTE: no X-Frame-Options. The Laser Studio desktop app's "My Shop" tab embeds
  // this site from http://localhost:<port>, and XFO can't express an allow-list —
  // frame-ancestors below allows exactly 'self' + localhost, which every current
  // browser prefers over XFO anyway. Web attackers can't serve from a visitor's
  // localhost, so clickjacking protection is effectively unchanged.
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  // No script-src: static headers can't issue per-request nonces, and a
  // nonce-less script-src would break Astro's inline scripts + the Paddle
  // overlay + GA. This still stops framing, plugin/object injection, and
  // <base> hijacking, and upgrades any stray http subresource to https.
  'Content-Security-Policy':
    "frame-ancestors 'self' http://localhost:* http://127.0.0.1:*; object-src 'none'; base-uri 'self'; upgrade-insecure-requests",
};

// ── CSRF origin guard (replaces Astro's built-in checkOrigin) ─────────
// Same rule as Astro's: reject cross-origin state-changing requests whose
// body is form-encoded (the only kind a plain HTML form/scanner can send).
// JSON requests are already unforgeable cross-site without CORS. ONE exemption:
// POST /api/unsubscribe, which must accept Gmail/Yahoo one-click unsubscribe
// (a form POST from the mail provider's servers). That endpoint is protected
// by its own HMAC token instead, so the exemption is safe.
const CSRF_EXEMPT = new Set(['/api/unsubscribe']);
function csrfBlocked(request: Request, pathname: string): boolean {
  const m = request.method.toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return false;
  if (CSRF_EXEMPT.has(pathname)) return false;
  const ct = (request.headers.get('content-type') || '').toLowerCase();
  const formLike = ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data') || ct.includes('text/plain');
  if (!formLike) return false;
  const origin = request.headers.get('origin');
  if (!origin) return false;                    // no Origin = not a browser form post
  try { return new URL(origin).host !== new URL(request.url).host; } catch { return true; }
}

export const onRequest = defineMiddleware(async (context, next) => {
  if (csrfBlocked(context.request, context.url.pathname)) {
    return new Response('Cross-site POST form submissions are forbidden', { status: 403 });
  }
  const response = await next();
  try {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) response.headers.set(k, v);
  } catch {
    // Some responses (e.g. certain redirects) may have immutable headers — never
    // let a header-set failure break the page.
  }
  return response;
});
