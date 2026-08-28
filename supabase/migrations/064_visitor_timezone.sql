-- 064: log each visitor's timezone (IANA name from the browser beacon).
-- Powers the Live-visitors screen: "seen at HH:MM" comes from ts (already
-- logged), and the visitor's own local clock comes from this column, so the
-- owner can see it is 3 am vs 8 pm for the person browsing right now.
alter table public.site_visits add column if not exists tz text;
