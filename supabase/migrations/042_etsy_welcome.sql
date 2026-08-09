-- Etsy-buyer welcome automation.
-- Owner imports Etsy BUYER emails (source='etsy-buyer'); when this system is ON,
-- the daily cron sends each new buyer ONE welcome email (this week's newest
-- designs + a 10% code), exactly once, and never enrolls them in the free-pack
-- drip or weekly digest. Off by default until the owner enables it.

alter table growth_settings
  add column if not exists etsy_welcome_enabled boolean default false;

-- One row per buyer we've already welcomed. Primary key = dedup guarantee, so a
-- retrying cron (or the manual send script) can never double-send.
create table if not exists etsy_welcome_log (
  email   text primary key,
  sent_at timestamptz default now()
);
alter table etsy_welcome_log enable row level security;
-- Writes happen server-side via the service_role key (bypasses RLS). Admins may read.
drop policy if exists "admin read etsy_welcome_log" on etsy_welcome_log;
create policy "admin read etsy_welcome_log" on etsy_welcome_log
  for select to authenticated using (is_admin());
