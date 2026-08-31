-- 066: admin-controlled nightly automation firing time.
--
-- Netlify bakes a scheduled function's cron into code, so the schedule itself
-- cannot be changed at runtime. Instead daily-drop.mjs now runs HOURLY and
-- fires the real run only when the current hour in `cron_tz` equals
-- `cron_local_hour`. Storing a LOCAL hour + IANA zone (rather than a UTC hour)
-- means US daylight-saving shifts are handled automatically: "10am New York"
-- stays 10am New York all year, even though that is 14:00 UTC in summer and
-- 15:00 UTC in winter.
alter table public.growth_settings
  add column if not exists cron_tz text not null default 'America/New_York',
  add column if not exists cron_local_hour integer not null default 10;
