-- First-party traffic analytics (privacy-light: no cookies, no raw IPs).
-- One row per pageview; visitor_hash = sha256(ip+UA+day+secret) so uniques can
-- be counted per day without storing anything personally identifiable.
create table if not exists site_visits (
  id            bigint generated always as identity primary key,
  ts            timestamptz not null default now(),
  day           date not null default current_date,
  path          text not null,
  referrer_host text,
  device        text,          -- 'mobile' | 'desktop' | 'tablet' | 'bot'
  country       text,
  visitor_hash  text
);
create index if not exists site_visits_day_idx on site_visits(day);
create index if not exists site_visits_day_path_idx on site_visits(day, path);

alter table site_visits enable row level security;
drop policy if exists "admin read site_visits" on site_visits;
create policy "admin read site_visits" on site_visits
  for select to authenticated using (is_admin());
-- inserts happen only via the service-role endpoint (RLS bypass); no public policy.
