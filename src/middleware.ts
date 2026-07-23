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

export const onRequest = defineMiddleware(async (_context, next) => {
  const response = await next();
  try {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) response.headers.set(k, v);
  } catch {
    // Some responses (e.g. certain redirects) may have immutable headers — never
    // let a header-set failure break the page.
  }
  return response;
});
