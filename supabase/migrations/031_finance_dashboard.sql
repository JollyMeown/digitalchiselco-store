-- Finance dashboard — cached money aggregates across all sales channels.
-- Populated by scripts/finance_refresh.mjs (runs where the Etsy OAuth token
-- lives — locally, like the Cults3D engine). The deployed admin reads these.

-- Per-day, per-channel aggregates (roll up to week/month/year in the UI).
create table if not exists finance_daily (
  day             date not null,
  channel         text not null,          -- 'website' | 'etsy' | 'cults'
  revenue_usd     numeric not null default 0,   -- gross sales, normalised to USD
  ad_spend_usd    numeric not null default 0,   -- Etsy Ads (prolist); 0 for others
  fees_usd        numeric not null default 0,
  revenue_native  numeric not null default 0,
  currency        text not null default 'USD',
  primary key (day, channel)
);
create index if not exists finance_daily_day_idx on finance_daily(day);

-- Single status row: current balances, last/next payouts, headline totals.
create table if not exists finance_status (
  id          int primary key default 1,
  data        jsonb not null default '{}'::jsonb,
  synced_at   timestamptz
);
insert into finance_status (id, data) values (1, '{}'::jsonb) on conflict (id) do nothing;

alter table finance_daily  enable row level security;
alter table finance_status enable row level security;
drop policy if exists "admin all finance_daily" on finance_daily;
create policy "admin all finance_daily" on finance_daily for all to authenticated using (is_admin()) with check (is_admin());
drop policy if exists "admin all finance_status" on finance_status;
create policy "admin all finance_status" on finance_status for all to authenticated using (is_admin()) with check (is_admin());
