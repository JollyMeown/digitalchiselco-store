-- Advertising intelligence for Etsy Promoted Listings (owner 2026-09-09).
--
-- What Etsy's API does and does not give us, verified that day:
--   IT DOES  give the daily Promoted Listings charge, as `prolist` rows in
--            /shops/{id}/payment-account/ledger-entries (31-day windows max).
--   IT DOES  give per-listing lifetime views and favourers.
--   IT DOES  give every receipt with a timestamp, so order times are knowable.
--   IT DOES NOT give per-listing ad spend, clicks or impressions. There is no
--            ads endpoint at all (/ads, /promoted-listings and /stats are 404).
-- So "which listing is eating the budget" cannot be answered exactly. The
-- honest proxy is VIEW GROWTH WITHOUT SALES: ads buy views, so a listing
-- gaining views and converting none of them is where the money is going. That
-- needs a view history, which is what etsy_listing_history is for.

-- When orders actually arrive, in both the shop's timezone and the owner's.
create table if not exists public.etsy_order_hours (
  hour smallint not null,
  tz text not null,                       -- 'America/Los_Angeles' | 'Asia/Karachi'
  orders integer not null default 0,
  revenue_usd numeric(12,2) not null default 0,
  sample_days integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (hour, tz)
);
alter table public.etsy_order_hours enable row level security;
drop policy if exists "etsy_order_hours_admin" on public.etsy_order_hours;
create policy "etsy_order_hours_admin" on public.etsy_order_hours for select using (is_admin());

-- A daily snapshot of every listing's views, so view GROWTH over any window
-- can be measured. Lifetime views alone cannot tell a listing that is being
-- advertised today from one that was popular a year ago.
create table if not exists public.etsy_listing_history (
  listing_id bigint not null,
  day date not null,
  views integer not null default 0,
  favorers integer not null default 0,
  primary key (listing_id, day)
);
create index if not exists etsy_listing_history_day_idx on public.etsy_listing_history (day desc);
alter table public.etsy_listing_history enable row level security;
drop policy if exists "etsy_listing_history_admin" on public.etsy_listing_history;
create policy "etsy_listing_history_admin" on public.etsy_listing_history for select using (is_admin());

-- Every budget change, so a change can be judged against what followed it
-- instead of from memory.
create table if not exists public.ad_budget_log (
  id bigserial primary key,
  changed_at timestamptz not null default now(),
  daily_budget numeric(10,2) not null,
  previous_budget numeric(10,2),
  reason text,
  set_by text
);
alter table public.ad_budget_log enable row level security;
drop policy if exists "ad_budget_log_admin" on public.ad_budget_log;
create policy "ad_budget_log_admin" on public.ad_budget_log for all using (is_admin()) with check (is_admin());

-- the two budget settings the owner has actually run, so the dashboard has
-- history from day one
insert into public.ad_budget_log (changed_at, daily_budget, previous_budget, reason, set_by)
select * from (values
  (timestamptz '2026-08-09 00:00:00+00', 45.00, 25.00, 'raised from about $25/day', 'owner'),
  (timestamptz '2026-09-09 00:00:00+00', 20.00, 65.00, 'cut from $65/day after the profit review', 'owner')
) as v(changed_at, daily_budget, previous_budget, reason, set_by)
where not exists (select 1 from public.ad_budget_log);
