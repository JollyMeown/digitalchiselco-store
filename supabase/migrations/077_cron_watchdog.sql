-- Dedupe field for the cron watchdog Telegram alert (one alert per UTC day).
alter table public.growth_settings add column if not exists cron_watchdog_day text;
