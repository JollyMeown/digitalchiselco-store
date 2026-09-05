-- Deep YouTube Analytics per Short, mirrored into the site so Admin can show WHY
-- a video stalled, not just how many views it got.
--
-- Written by BRS every 3 hours from the YouTube Analytics API (which lags two to
-- three days behind Studio's realtime numbers); read by the Admin ▶ YouTube
-- Shorts tab. One row per video, JSON for the shapes that vary.
create table if not exists public.youtube_analytics (
  video_id        text primary key references public.youtube_stats(video_id) on delete cascade,
  since           date,                  -- first day of the window pulled
  through         date,                  -- last day YouTube had finalised data for
  views           integer not null default 0,
  engaged_views   integer not null default 0,   -- Shorts "chose to watch" (vs swiped)
  minutes_watched numeric not null default 0,
  avg_view_secs   numeric not null default 0,
  avg_view_pct    numeric not null default 0,   -- average percentage viewed (can exceed 100 on loops)
  likes           integer not null default 0,
  dislikes        integer not null default 0,
  shares          integer not null default 0,
  comments        integer not null default 0,
  subs_gained     integer not null default 0,
  traffic         jsonb   not null default '[]'::jsonb,  -- [[source, views, avg_pct], ...]
  by_day          jsonb   not null default '[]'::jsonb,  -- [[day, views], ...]
  countries       jsonb   not null default '[]'::jsonb,  -- [[country, views], ...]
  retention       jsonb   not null default '[]'::jsonb,  -- [[pct_of_video, pct_watching, relative], ...]
  exit_secs       numeric,               -- where the curve first drops under half the audience
  verdict         text,                  -- the playbook reading, written by BRS
  synced_at       timestamptz not null default now()
);

alter table public.youtube_analytics enable row level security;
do $$ begin
  execute 'drop policy if exists youtube_analytics_admin on public.youtube_analytics';
  execute 'create policy youtube_analytics_admin on public.youtube_analytics for all to authenticated using (public.is_admin()) with check (public.is_admin())';
end $$;

comment on table public.youtube_analytics is
  'YouTube Analytics API per Short (retention curve, traffic sources, engaged views) + a written verdict. Written by BRS, read by Admin.';
