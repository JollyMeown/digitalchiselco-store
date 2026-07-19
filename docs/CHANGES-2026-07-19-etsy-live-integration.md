# CHANGES 2026-07-19 — Live Etsy integration (stats · reviews · creation stories)

Three homepage/admin features that pull live data from the DigitalChiselCo Etsy shop.
Built earlier as local code that was **never committed**, so it did not appear on the live
site until this deploy (commits `b52c3e3`, `7e92a11`, `9017ea6` on `main` → Netlify).

## 1. Live shop stats + "Design Favorites" tile
- `scripts/etsy_stats_sync.mjs` (`npm run etsy:stats`) resolves the shop and writes
  `sales_count`, `rating`, `reviews_count`, `products_count`, `admirers_count`,
  `etsy_synced_at` into `site_settings` (id=1).
- Admin one-click: `src/pages/api/admin/etsy-stats-refresh.ts` (admin-gated, public Etsy
  fields) + **🔄 Sync live from Etsy** button in `Settings.tsx`.
- Homepage stats row now 5 tiles (`src/pages/index.astro`, `md:grid-cols-5`).
- **Note on the "admirers" number:** it is the SUM of per-listing `num_favorers`
  (≈16.5k = total item favorites), NOT Etsy's shop-admirer metric, so the tile is
  labeled **"Design Favorites"** to stay honest. Admirers needs OAuth (pages every listing).

## 2. 5-star Etsy reviews → homepage "Loved by makers"
- `scripts/etsy_reviews_sync.mjs` (`npm run etsy:reviews`) imports 5★ reviews with real
  text into the `reviews` table (`source='Etsy'`, `name='Verified Buyer'`). Etsy does not
  expose buyer names on reviews (privacy). Etsy caps review paging at the newest 100.
- **Dedup by content:** `etsy_review_id = etsy:<buyer_user_id>:<hash(normalized text)>`,
  so the SAME buyer leaving the SAME review counts once. Each run clears the prior imported
  rows (etsy_review_id not null) then re-inserts the deduped set, so duplicates can never
  accumulate. The 3 hand-picked seed reviews (etsy_review_id NULL) are left untouched.
- First live run: 69 five-star → **57 unique** (12 duplicates collapsed).

## 3. Customer Creations AI story
- `src/pages/api/admin/creation-story.ts` — admin-gated, Claude Opus 4.8 with vision.
  From a buyer's shared photo + name it writes a short warm story in house voice
  (no em-dashes, no "Etsy"/charity words).
- **✨ AI story** button added to `Creations.tsx` (fills the description). The
  "Carved by you" gallery + admin CRUD already existed.

## Migration
`supabase/migrations/028_etsy_live_sync.sql`:
- `reviews.etsy_review_id` (**full** unique index — a partial index breaks Supabase
  `upsert onConflict`) + `reviews.etsy_created_at`
- `site_settings.etsy_synced_at`
- `customer_creations.story_source`

Applied to production via `DATABASE_URL` (pg). Env used: `ETSY_API_KEY`, `ETSY_SHARED_SECRET`,
`.etsy_token.json` (OAuth, gitignored), `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`DATABASE_URL`. Shop id `61524055`; shared Etsy client `scripts/etsy_client.mjs`.

## Live values at deploy
4,952 sold · 4.9★ / 634 reviews · 16,565 design favorites · 1,278 designs · 20 yrs;
57 deduped 5★ reviews showing.

> ⚠️ Never `git add -A` in this repo — many untracked secret/junk files (drive dumps,
> sandbox backups, `.etsy_token.json`, scripts). Add feature files by path only.
