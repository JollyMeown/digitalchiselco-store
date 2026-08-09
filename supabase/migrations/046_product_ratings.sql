-- Denormalized per-product rating for fast display on catalog/collection cards
-- (avoids a join on every card render). Recomputed by scripts/recompute_ratings.mjs
-- in the daily refresh; backfilled here from approved, active, product-linked reviews.
alter table products
  add column if not exists rating_avg   numeric,
  add column if not exists rating_count int not null default 0;

update products p set rating_avg = agg.avg, rating_count = agg.cnt
from (
  select product_id, round(avg(rating)::numeric, 1) as avg, count(*)::int as cnt
  from reviews
  where product_id is not null and status = 'approved' and active = true
  group by product_id
) agg
where agg.product_id = p.id;
