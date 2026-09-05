-- YouTube dashboard, the full picture (owner request 2026-09-05): channel-level
-- history, per-video daily history, and the per-video breakdowns the Analytics
-- API can give (devices, subscribed split, demographics, the search terms that
-- found the video). Written by BRS hourly, read by Admin > YouTube Shorts.

-- channel snapshot (one row) + channel-level daily history
create table if not exists public.youtube_channel (
  id              integer primary key default 1 check (id = 1),
  channel_id      text,
  title           text,
  subscribers     integer not null default 0,     -- Data API, realtime
  total_views     bigint  not null default 0,
  video_count     integer not null default 0,
  traffic         jsonb   not null default '[]'::jsonb,   -- [[source, views, avg_pct]] last 28d
  countries       jsonb   not null default '[]'::jsonb,   -- [[country, views]] last 28d
  devices         jsonb   not null default '[]'::jsonb,   -- [[device, views]] last 28d
  demographics    jsonb   not null default '[]'::jsonb,   -- [[ageGroup, gender, viewerPercentage]] last 28d
  subscribed      jsonb   not null default '[]'::jsonb,   -- [[SUBSCRIBED|UNSUBSCRIBED, views, avg_pct]] last 28d
  through         date,
  note            text,                            -- BRS writes a plain sentence when the token lacks analytics permission
  synced_at       timestamptz not null default now()
);
alter table public.youtube_channel add column if not exists note text;

create table if not exists public.youtube_channel_daily (
  day             date primary key,
  views           integer not null default 0,
  engaged_views   integer not null default 0,
  minutes_watched numeric not null default 0,
  avg_view_pct    numeric not null default 0,
  likes           integer not null default 0,
  shares          integer not null default 0,
  comments        integer not null default 0,
  subs_gained     integer not null default 0,
  subs_lost       integer not null default 0
);

-- per-video daily history from the Analytics API (finalised, lags ~2 days);
-- youtube_stats_daily stays as the realtime Data API snapshot
create table if not exists public.youtube_video_daily (
  video_id        text not null references public.youtube_stats(video_id) on delete cascade,
  day             date not null,
  views           integer not null default 0,
  engaged_views   integer not null default 0,
  minutes_watched numeric not null default 0,
  likes           integer not null default 0,
  shares          integer not null default 0,
  comments        integer not null default 0,
  subs_gained     integer not null default 0,
  primary key (video_id, day)
);

alter table public.youtube_analytics add column if not exists subs_lost     integer not null default 0;
alter table public.youtube_analytics add column if not exists devices       jsonb not null default '[]'::jsonb;
alter table public.youtube_analytics add column if not exists subscribed    jsonb not null default '[]'::jsonb;
alter table public.youtube_analytics add column if not exists demographics  jsonb not null default '[]'::jsonb;
alter table public.youtube_analytics add column if not exists search_terms  jsonb not null default '[]'::jsonb;
alter table public.youtube_analytics add column if not exists playlist_adds integer not null default 0;

alter table public.youtube_channel        enable row level security;
alter table public.youtube_channel_daily  enable row level security;
alter table public.youtube_video_daily    enable row level security;
do $$ begin
  execute 'drop policy if exists youtube_channel_admin on public.youtube_channel';
  execute 'create policy youtube_channel_admin on public.youtube_channel for all to authenticated using (public.is_admin()) with check (public.is_admin())';
  execute 'drop policy if exists youtube_channel_daily_admin on public.youtube_channel_daily';
  execute 'create policy youtube_channel_daily_admin on public.youtube_channel_daily for all to authenticated using (public.is_admin()) with check (public.is_admin())';
  execute 'drop policy if exists youtube_video_daily_admin on public.youtube_video_daily';
  execute 'create policy youtube_video_daily_admin on public.youtube_video_daily for all to authenticated using (public.is_admin()) with check (public.is_admin())';
end $$;
create index if not exists youtube_video_daily_day_idx on public.youtube_video_daily (day desc);

comment on table public.youtube_channel is 'Channel snapshot + 28-day breakdowns from the YouTube Analytics API. Written by BRS.';
comment on table public.youtube_channel_daily is 'Channel-level finalised daily metrics (90 days rolling). Written by BRS.';
comment on table public.youtube_video_daily is 'Per-video finalised daily metrics. Written by BRS.';
