-- Daily Google Merchant Center performance, pulled by the nightly cron so the
-- admin can graph impressions/clicks without opening Merchant Center.
create table if not exists public.merchant_stats_daily (
  day date primary key,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  ctr numeric(6,4) not null default 0,
  conversions numeric(12,2) not null default 0,
  conversion_value numeric(12,2) not null default 0,
  fetched_at timestamptz not null default now()
);
create index if not exists merchant_stats_day_idx on public.merchant_stats_daily (day desc);

alter table public.merchant_stats_daily enable row level security;
do $$ begin
  execute 'drop policy if exists merchant_stats_admin on public.merchant_stats_daily';
  execute 'create policy merchant_stats_admin on public.merchant_stats_daily for select to authenticated using (public.is_admin())';
end $$;
revoke all on public.merchant_stats_daily from anon;

-- Heartbeat/last-error so the admin panel can say why data is missing.
alter table public.growth_settings add column if not exists merchant_sync_at timestamptz;
alter table public.growth_settings add column if not exists merchant_sync_error text;
