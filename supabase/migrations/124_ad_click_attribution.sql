-- Which sales actually came from a Google ad click (owner 2026-09-12, on adding
-- billing and asking for a dashboard).
--
-- Google will report its own conversions, and it has every incentive to claim
-- generously: a 30-day click window means a click today can claim a sale next
-- month that email or Etsy really produced. The only way to hold it honest is
-- to carry Google's own click id through checkout and record it on the order,
-- so the shop can say "this sale, this amount, this click" from its own books.
--
-- gclid is the standard parameter. gbraid and wbraid are the iOS variants Google
-- substitutes when a click cannot be cookie-tracked; storing them in the same
-- column keeps the question simple, and ad_click_source says which arrived.
alter table public.orders add column if not exists gclid text;
alter table public.orders add column if not exists ad_click_source text;
create index if not exists orders_gclid_idx on public.orders (gclid) where gclid is not null;

-- The checkout snapshot carries it from the browser to the webhook, the same
-- path the cart and coupon already travel. Never read from Paddle's custom_data,
-- which the browser can forge.
alter table public.pending_checkouts add column if not exists gclid text;
alter table public.pending_checkouts add column if not exists ad_click_source text;

-- Every landing from an ad, whether or not it ever buys. Without this the
-- dashboard could count sales but never a click-through rate or a cost per
-- visit, and those are what say whether the bid is right.
create table if not exists public.ad_clicks (
  id bigserial primary key,
  ts timestamptz not null default now(),
  day date not null default (now() at time zone 'utc')::date,
  gclid text not null,
  source text not null default 'gclid',      -- gclid | gbraid | wbraid
  path text,
  visitor_hash text,
  country text
);
create index if not exists ad_clicks_day_idx on public.ad_clicks (day desc);
create unique index if not exists ad_clicks_gclid_idx on public.ad_clicks (gclid);
alter table public.ad_clicks enable row level security;
drop policy if exists "ad_clicks_admin" on public.ad_clicks;
create policy "ad_clicks_admin" on public.ad_clicks for select using (is_admin());

-- What Google charged. There is no Ads API on this account, so the cost side is
-- entered by hand or pasted from the Ads export. Kept separate from what we
-- measure ourselves, so the two can be compared rather than conflated.
create table if not exists public.google_ads_daily (
  day date primary key,
  cost_pkr numeric(12,2) not null default 0,
  clicks integer not null default 0,
  impressions integer not null default 0,
  conversions numeric(10,2) not null default 0,   -- as Google counts them
  note text,
  updated_at timestamptz not null default now()
);
alter table public.google_ads_daily enable row level security;
drop policy if exists "google_ads_daily_admin" on public.google_ads_daily;
create policy "google_ads_daily_admin" on public.google_ads_daily for all using (is_admin()) with check (is_admin());
