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

// ── Legacy-URL rescue (Google Search Console cleanup, 2026-08-28) ─────
// GSC reported 229 crawled 404s. Patterns and where they now 301 to:
//   /product/<etsy-listing-id>-<slug>  → the live /product/<slug> when a
//       matching product exists (93% do; exact then prefix match), else
//       /catalog. These are URLs from the old Etsy-divert landing site.
//   /blog.html, /catalog.html, /blog/x.html, /category/x.html → .html stripped
//   /category/<anything>               → /collections (old section scheme)
// Lookups only run on these rare legacy shapes, never on normal traffic.
async function legacyRedirect(pathname: string): Promise<string | null> {
  let p = pathname;
  if (p === '/blog.html') return '/blog';
  if (p === '/catalog.html') return '/catalog';
  const blogHtml = p.match(/^\/blog\/(.+)\.html$/);
  if (blogHtml) return `/blog/${blogHtml[1]}`;
  if (/^\/category\//.test(p)) return '/collections';
  const etsy = p.match(/^\/product\/\d{5,}-(.+?)\/?$/);
  if (etsy) {
    try {
      const slug = decodeURIComponent(etsy[1]).toLowerCase();
      const { supabaseAdmin } = await import('./lib/supabase');
      const db = supabaseAdmin();
      const { data: exact } = await db.from('products').select('slug').eq('slug', slug).maybeSingle();
      if (exact?.slug) return `/product/${exact.slug}`;
      // Old exports truncated slugs at a different length: prefix match both ways.
      const { data: pre } = await db.from('products').select('slug').ilike('slug', slug.slice(0, 60).replace(/[%_]/g, '') + '%').limit(1);
      if (pre?.[0]?.slug) return `/product/${pre[0].slug}`;
    } catch { /* fall through */ }
    return '/catalog';
  }
  return null;
}

// ── Edge caching for the storefront ───────────────────────────────────
// Every storefront page was served `Cache-Control: no-cache`, so each visitor
// waited for the SSR function to query Supabase: measured TTFB 3.8 s on the
// homepage, 1.6 s on the catalog. These pages read no cookie and render the
// same for everyone (cart, wishlist and "recently viewed" are client-side),
// so Netlify's CDN can hold them. Five minutes fresh, then served stale while a
// single background fetch renews it, so a price or catalogue change lands
// within minutes and no visitor ever waits on the origin. The browser itself
// is still told not to cache, so a back-button never shows a stale price.
const CACHEABLE = /^\/(?:$|catalog\/?$|collections(?:\/[^/]+)?\/?$|product\/[^/]+\/?$|blog(?:\/[^/]+)?\/?$|designs(?:\/[^/]+)?\/?$|free\/?$|membership\/?$|faq\/?$|our-story\/?$|gift-cards\/?$)/;
const NEVER_CACHE = /^\/(?:admin|api|account|checkout|maker|requests|cart|search|free\/(?:confirm|files))/;

export const onRequest = defineMiddleware(async (context, next) => {
  if (csrfBlocked(context.request, context.url.pathname)) {
    return new Response('Cross-site POST form submissions are forbidden', { status: 403 });
  }
  if (context.request.method === 'GET') {
    const path = context.url.pathname;
    // One URL per page. /catalog/ and /catalog both answered 200 with a
    // self-referencing canonical, so Google indexed two copies of every
    // listing page. The slash form now 301s to the bare one.
    if (path.length > 1 && path.endsWith('/') && !path.startsWith('/api/')) {
      return context.redirect(path.slice(0, -1) + context.url.search, 301);
    }
    // cheap pre-filter so the async helper only runs on legacy-looking paths
    if (/\.html$/.test(path) || path.startsWith('/category/') || /^\/product\/\d{5,}-/.test(path)) {
      const to = await legacyRedirect(path);
      if (to) return context.redirect(to, 301);
    }
  }
  const response = await next();
  try {
    const path = context.url.pathname;
    if (context.request.method === 'GET' && response.status === 200 && CACHEABLE.test(path) && !NEVER_CACHE.test(path)
        && !context.request.headers.get('cookie')?.includes('sb-')) {
      response.headers.set('Netlify-CDN-Cache-Control', 'public, s-maxage=300, stale-while-revalidate=86400, durable');
      response.headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
      response.headers.set('Cache-Tag', path.startsWith('/product/') ? 'product,storefront' : 'storefront');
    }
  } catch { /* never let a caching header break a page */ }
  try {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
      // a page may pre-set a STRICTER Referrer-Policy (token-in-URL pages use
      // no-referrer) — don't overwrite it with the site default
      if (k === 'Referrer-Policy' && response.headers.get(k) === 'no-referrer') continue;
      response.headers.set(k, v);
    }
  } catch {
    // Some responses (e.g. certain redirects) may have immutable headers — never
    // let a header-set failure break the page.
  }
  return response;
});
