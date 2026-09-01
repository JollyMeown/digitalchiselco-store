-- Square-image experiment: swap a small test group of Google Shopping images
-- to 1:1 (product filling the tile) and measure CTR against the rest.
--
-- Only products listed here get the square image, so the untouched catalogue
-- acts as the control group and any site-wide change in impressions (e.g. the
-- 1,570 approvals landing) affects both sides equally.
create table if not exists public.image_experiment (
  product_id uuid primary key references public.products(id) on delete cascade,
  offer_id text not null,
  variant text not null default 'square',      -- square | control
  started_at timestamptz not null default now(),
  note text
);
create index if not exists image_experiment_offer_idx on public.image_experiment (offer_id);

-- Per-product DAILY history, so before/after can be compared honestly rather
-- than from a single rolling total.
create table if not exists public.merchant_product_daily (
  day date not null,
  offer_id text not null,
  title text,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  primary key (day, offer_id)
);
create index if not exists merchant_product_daily_offer_idx on public.merchant_product_daily (offer_id, day desc);

alter table public.image_experiment enable row level security;
alter table public.merchant_product_daily enable row level security;
do $$ begin
  execute 'drop policy if exists image_exp_admin on public.image_experiment';
  execute 'create policy image_exp_admin on public.image_experiment for select to authenticated using (public.is_admin())';
  execute 'drop policy if exists mpd_admin on public.merchant_product_daily';
  execute 'create policy mpd_admin on public.merchant_product_daily for select to authenticated using (public.is_admin())';
end $$;
revoke all on public.image_experiment, public.merchant_product_daily from anon;
