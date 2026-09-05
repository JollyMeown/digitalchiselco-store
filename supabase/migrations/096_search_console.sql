-- Google Search Console performance, mirrored into the site so Admin can show
-- which pages and queries earn organic clicks (the blog SEO scoreboard).
--
-- Auth reuses the Merchant Center service account (GOOGLE_SA_EMAIL /
-- GOOGLE_SA_PRIVATE_KEY): the org policy blocks creating new service-account
-- keys, and one robot user added to the Search Console property is enough.

create table if not exists public.gsc_daily (
  day         date primary key,
  clicks      integer not null default 0,
  impressions integer not null default 0,
  ctr         double precision not null default 0,
  position    double precision not null default 0,
  fetched_at  timestamptz not null default now()
);

create table if not exists public.gsc_page_daily (
  day         date not null,
  page        text not null,
  clicks      integer not null default 0,
  impressions integer not null default 0,
  ctr         double precision not null default 0,
  position    double precision not null default 0,
  primary key (day, page)
);

create table if not exists public.gsc_query_daily (
  day         date not null,
  query       text not null,
  clicks      integer not null default 0,
  impressions integer not null default 0,
  ctr         double precision not null default 0,
  position    double precision not null default 0,
  primary key (day, query)
);

-- which searches land on which page, rolling 28-day window (refreshed whole)
create table if not exists public.gsc_page_query (
  page        text not null,
  query       text not null,
  clicks      integer not null default 0,
  impressions integer not null default 0,
  position    double precision not null default 0,
  window_days integer not null default 28,
  fetched_at  timestamptz not null default now(),
  primary key (page, query)
);

alter table public.growth_settings add column if not exists gsc_sync_at timestamptz;
alter table public.growth_settings add column if not exists gsc_sync_error text;

alter table public.gsc_daily       enable row level security;
alter table public.gsc_page_daily  enable row level security;
alter table public.gsc_query_daily enable row level security;
alter table public.gsc_page_query  enable row level security;
do $$ begin
  execute 'drop policy if exists gsc_daily_admin on public.gsc_daily';
  execute 'create policy gsc_daily_admin on public.gsc_daily for all to authenticated using (public.is_admin()) with check (public.is_admin())';
  execute 'drop policy if exists gsc_page_daily_admin on public.gsc_page_daily';
  execute 'create policy gsc_page_daily_admin on public.gsc_page_daily for all to authenticated using (public.is_admin()) with check (public.is_admin())';
  execute 'drop policy if exists gsc_query_daily_admin on public.gsc_query_daily';
  execute 'create policy gsc_query_daily_admin on public.gsc_query_daily for all to authenticated using (public.is_admin()) with check (public.is_admin())';
  execute 'drop policy if exists gsc_page_query_admin on public.gsc_page_query';
  execute 'create policy gsc_page_query_admin on public.gsc_page_query for all to authenticated using (public.is_admin()) with check (public.is_admin())';
end $$;

create index if not exists gsc_page_daily_page_idx on public.gsc_page_daily (page, day desc);
create index if not exists gsc_query_daily_day_idx on public.gsc_query_daily (day desc);
create index if not exists gsc_page_query_page_idx on public.gsc_page_query (page);

comment on table public.gsc_daily is 'Search Console totals per day (web search). Written by the nightly sync, read by Admin > Traffic.';
comment on table public.gsc_page_daily is 'Search Console clicks/impressions/position per page per day.';
comment on table public.gsc_query_daily is 'Search Console clicks/impressions/position per query per day.';
comment on table public.gsc_page_query is 'Which queries land on which page, rolling 28 days, replaced on every sync.';
