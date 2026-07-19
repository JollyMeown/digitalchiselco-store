-- Live Etsy sync (2026-07-19): dedup keys + freshness stamps so the site can
-- pull sales/rating/admirers and 5-star reviews straight from the Etsy shop.

-- ---------- reviews: dedup key + Etsy timestamp ----------
-- Etsy's reviews API has no stable review id, so we build one from
-- transaction_id (or listing_id:buyer:create_ts) and dedup on it.
alter table reviews add column if not exists etsy_review_id  text;
alter table reviews add column if not exists etsy_created_at timestamptz;
create unique index if not exists reviews_etsy_review_id_uidx
  on reviews(etsy_review_id) where etsy_review_id is not null;

-- ---------- site_settings: last-synced stamp for the live stats ----------
alter table site_settings add column if not exists etsy_synced_at timestamptz;

-- ---------- customer_creations: mark where a story came from ----------
-- (table + gallery already exist in 010; this just tags AI-written stories)
alter table customer_creations add column if not exists story_source text default 'manual';
