-- Indexes for the admin Traffic panel, after the 2026-09-21 database stall.
--
-- The panel used to re-read a month of raw rows every 30 seconds with deep
-- OFFSET paging, which makes Postgres walk and discard every row before the
-- window. It now pages by timestamp instead, so both tables need an index on
-- the column it walks. site_visits already had (day) and (day, path); neither
-- helps an ORDER BY ts.
create index if not exists site_visits_ts_idx on public.site_visits (ts desc);
create index if not exists site_events_ts_idx on public.site_events (ts desc);
