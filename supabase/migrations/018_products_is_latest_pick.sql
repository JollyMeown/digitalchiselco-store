-- Handpicked "Latest 3D Designs" homepage row. Mirrors the existing
-- is_bestseller pattern: admin ticks the flag, homepage prefers picked
-- products and falls back to the actual latest-by-created_at when none
-- are flagged.
alter table public.products
  add column if not exists is_latest_pick boolean not null default false;

create index if not exists idx_products_is_latest_pick
  on public.products(is_latest_pick)
  where is_latest_pick = true;
