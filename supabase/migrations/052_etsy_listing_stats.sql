-- Per-listing Etsy stats, synced daily by the LOCAL finance-refresh run (the
-- Etsy OAuth token lives on the owner's PC, never in the cloud). Design Scout
-- and admin analytics read these to blend Etsy demand with website demand.
create table if not exists etsy_listing_stats (
  listing_id    bigint primary key,
  title         text,
  views         int not null default 0,
  favorers      int not null default 0,
  views_prev    int not null default 0,     -- snapshot from the PREVIOUS sync → delta = recent demand
  favorers_prev int not null default 0,
  updated_at    timestamptz not null default now()
);
alter table etsy_listing_stats enable row level security;
drop policy if exists "admin read etsy_listing_stats" on etsy_listing_stats;
create policy "admin read etsy_listing_stats" on etsy_listing_stats for select to authenticated using (is_admin());
