-- Weekly digest now sends only designs added SINCE the last send (never repeats
-- what subscribers already saw). This marker advances after each send.
alter table site_settings add column if not exists weekly_last_sent_at timestamptz;
