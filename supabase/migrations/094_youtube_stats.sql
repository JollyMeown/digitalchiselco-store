-- YouTube Shorts performance, mirrored into the site so Admin can show it.
--
-- The site cannot call the YouTube API: the OAuth refresh token lives in BRS on
-- the owner's machine, and putting a channel-management token in a Netlify env
-- var would be a much bigger key than anything else the site holds. So BRS pulls
-- the numbers and pushes them here, exactly as the finance and Cults panels work.
create table if not exists public.youtube_stats (
  video_id      text primary key,
  title         text,
  description   text,
  thumb_url     text,
  duration_s    integer,
  published_at  timestamptz,
  privacy       text,
  views         integer not null default 0,
  likes         integer not null default 0,
  comments      integer not null default 0,
  -- which design the Short sells, so Admin can tie views to a product
  product_id    uuid references public.products(id) on delete set null,
  playlist      text,
  synced_at     timestamptz not null default now()
);

-- one row per video per day, so the panel can draw a trend instead of a snapshot
create table if not exists public.youtube_stats_daily (
  video_id  text not null,
  day       date not null,
  views     integer not null default 0,
  likes     integer not null default 0,
  comments  integer not null default 0,
  primary key (video_id, day)
);

alter table public.youtube_stats       enable row level security;
alter table public.youtube_stats_daily enable row level security;
do $$ begin
  execute 'drop policy if exists youtube_stats_admin on public.youtube_stats';
  execute 'create policy youtube_stats_admin on public.youtube_stats for all to authenticated using (public.is_admin()) with check (public.is_admin())';
  execute 'drop policy if exists youtube_stats_daily_admin on public.youtube_stats_daily';
  execute 'create policy youtube_stats_daily_admin on public.youtube_stats_daily for all to authenticated using (public.is_admin()) with check (public.is_admin())';
end $$;

create index if not exists youtube_stats_published_idx on public.youtube_stats (published_at desc);
create index if not exists youtube_stats_daily_day_idx on public.youtube_stats_daily (day desc);

comment on table public.youtube_stats is
  'Latest YouTube Shorts stats. Written by BRS (which holds the OAuth token), read by Admin.';
comment on table public.youtube_stats_daily is
  'Daily snapshot per video so the Admin panel can show a trend, not just a total.';
