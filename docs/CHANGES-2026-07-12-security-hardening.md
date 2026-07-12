# Security hardening — 2026-07-12

Fixes for the findings of the 2026-07-12 audit (auth/API + XSS/secrets passes).

## CRITICAL — client-controlled checkout discount (fixed)
`src/pages/api/checkout-init.ts` read `body.discount_percent` from the browser
and applied the larger of it and the server value, so `discount_percent: 99`
let anyone check out at ~1% of catalog price. **Fix:** the endpoint now starts
`discountPercent = 0` and only ever sets it from a server-validated coupon or
the active shop sale. The browser value is ignored entirely.

## HIGH
- **Security headers** (`netlify.toml` → `[[headers]]` for `/*`): `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, `Strict-Transport-Security` (2y, preload),
  `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, and a
  CSP limited to `frame-ancestors 'none'; object-src 'none'; base-uri 'self';
  upgrade-insecure-requests`. The CSP intentionally omits `script-src` (static
  headers can't issue per-request nonces, and a nonce-less `script-src` would
  break Astro inline scripts + the Paddle overlay). It still stops clickjacking,
  plugin/object injection, and `<base>` hijacking.
- **Blog body sanitized** (`src/pages/blog/[slug].astro`): `post.body` is now run
  through the `xss` package (added as a direct dependency) before `set:html`.
  Script tags are neutralized and `on*` handlers stripped; normal formatting
  tags are preserved.
- **Rate limiting** on unauthenticated endpoints — sign-in link
  (`api/account/request-link`), `api/subscribe`, `api/membership-lead`,
  `api/checkout-init`, `api/coupons/validate`. Backed by Postgres (migration
  `027_rate_limits.sql`: `rate_limit_hits` table + `rate_limit_check` RPC) via
  `src/lib/rate-limit.ts`. Fails **open** (a DB error allows the request) so a
  limiter outage never blocks real customers. Limits are per-IP and, for email
  endpoints, additionally per target address.
- **Coupon redemption moved to the webhook**: stamping (insert into
  `coupon_redemptions` + `increment_coupon_redemption`) now happens in
  `api/paddle/webhook.ts` on `transaction.completed`, not in `checkout-init`.
  Previously an unauthenticated caller could loop checkout-init to exhaust a
  coupon's `max_redemptions` without paying. The `coupon_id` rides through in
  Paddle `custom_data`. The webhook is idempotent (order insert skipped on
  retry), so each paid order counts once.

## MEDIUM / LOW
- **JSON-LD breakout** (`src/lib/jsonld.ts`, new): all
  `<script type="application/ld+json">` blocks now use `jsonLd()` instead of raw
  `JSON.stringify`, escaping `<` `>` `&` to `\u00XX` so a DB value containing
  `</script>` can't break out of the tag. Applied in product, blog, breadcrumbs,
  index (FAQ), and Base (Org/WebSite) schema blocks.
- **Token secrets fail closed** (`src/lib/account-token.ts`,
  `src/lib/subscribe-token.ts`): in production, if neither the dedicated secret
  nor `SUPABASE_SERVICE_ROLE_KEY` is set, signing/verifying now throws instead
  of using the hardcoded `'dev-only-insecure-fallback'` (which would let tokens
  be forged). Dev/build still uses the fallback.

## Not changed (accepted / needs product decision)
- Coupon-validate still returns specific messages (expired / not-active-yet /
  minimum-spend) because they're useful to real shoppers; brute-force
  enumeration is mitigated by the new rate limit rather than by making messages
  generic.
- Order-detail-by-txn-id on `checkout/success.astro` + `api/invoice/[txnId]`
  still gates only on "txn exists". Mitigated by ~150-bit txn entropy (not
  enumerable). Binding it to the account session would be the stronger fix but
  changes the post-checkout UX, so it's left for a product decision.

## Confirmed already-correct (no change)
Paddle webhook signature verification; admin API routes validating Bearer JWT +
`is_admin`; RLS coverage; service-role key never bundled to the browser;
`.env`/`PROJECT_HANDOFF.md` git-ignored and never committed; no SSRF.
