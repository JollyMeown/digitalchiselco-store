-- Nightly step that gives imported Etsy buyers the free pack, 200 a night.
--
-- Owner, 2026-09-16: "200 a day daily". The step lives in growth.ts
-- (etsyFreePack). It dedupes on email_send_log kind='etsy-freepack', so the
-- first 200 sent by hand from scripts/etsy_buyer_freepack.mjs are never sent
-- again, and it stops on its own once every Etsy buyer has had it.
--
-- Set etsy_freepack_enabled = false to pause it. Raise or lower the nightly
-- number with etsy_freepack_per_run.

alter table growth_settings
  add column if not exists etsy_freepack_enabled boolean not null default true,
  add column if not exists etsy_freepack_per_run integer not null default 200;

comment on column growth_settings.etsy_freepack_enabled is
  'Nightly: give imported Etsy buyers the free pack plus the price-gap note. Off = paused.';
comment on column growth_settings.etsy_freepack_per_run is
  'How many Etsy buyers get the free-pack email per nightly run (domain warm-up).';
