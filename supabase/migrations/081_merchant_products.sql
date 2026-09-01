-- Per-product Google Shopping performance (last 30 days), so the admin can see
-- WHICH designs Google is showing and which ones actually earn the click.
create table if not exists public.merchant_product_stats (
  offer_id text primary key,
  title text,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  window_days integer not null default 30,
  fetched_at timestamptz not null default now()
);
create index if not exists merchant_product_impr_idx on public.merchant_product_stats (impressions desc);

alter table public.merchant_product_stats enable row level security;
do $$ begin
  execute 'drop policy if exists merchant_products_admin on public.merchant_product_stats';
  execute 'create policy merchant_products_admin on public.merchant_product_stats for select to authenticated using (public.is_admin())';
end $$;
revoke all on public.merchant_product_stats from anon;
