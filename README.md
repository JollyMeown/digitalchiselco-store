# DigitalChiselCo — standalone store

Astro (storefront, SEO-first) + React islands + Supabase (DB/auth/storage) + Netlify. Sells digital STL files delivered via Google Drive links; payments via Merchant of Record (Paddle), withdrawn to Payoneer.

## Setup
1. `npm install`
2. Create a Supabase project → copy URL + anon + service-role keys into `.env` (see `.env.example`).
3. Open Supabase SQL editor → run `supabase/schema.sql`.
4. `npm run import:products` → loads `master_products.csv` (1,235 products, categories, download links).
5. `npm run dev` → http://localhost:4321

## Data files (built during migration, kept alongside repo)
- `master_products.csv` — the import source: product → price → category → image → download_link → **link_status** (color marker).
- `etsy_master.csv` — live Etsy categories. `products_with_links.csv` — Drive-link match detail.
- `drive_stls.json` / `drive_folders.json` — Drive enumeration cache.

## Link confidence (admin color marker)
`products.link_status`: `certain`(green) · `likely`(amber) · `review`/`bundle_manual`(red) · `verified`(green, after you confirm) · `broken`(red). The admin lists `review`/`bundle_manual`/unverified for re-checking.

## Roadmap
- [x] Phase 0: schema, data consolidation, scaffold
- [ ] Phase 1: storefront (catalog, collections, product pages w/ Product schema), SEO 301 map
- [ ] Phase 2: cart → Paddle checkout → webhook → entitlement → email links + customer dashboard
- [ ] Phase 3: admin (CRUD, CSV import, orders, invoices, link verification, analytics)
