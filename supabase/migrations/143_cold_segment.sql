-- Slow the mail to people who have never once opened anything.
--
-- Measured 2026-09-22: the imported Etsy buyers are 2,119 of a 2,339-person
-- list and have produced 7 purchases ever, a 0.33% conversion, while the 134
-- free-pack subscribers have produced 22, a 17.16% conversion. One free-pack
-- signup is worth about fifty Etsy imports.
--
-- Email volume went from 1,380 sends in August to 14,389 in September, and
-- most of that went to the nine-cent segment. That is not just waste: every
-- send to somebody who never opens teaches the mail providers to treat us as
-- bulk, which lands on the 134 people who actually buy.
--
-- So a person who arrived from a bulk import AND has never opened or clicked
-- anything now gets at most one broadcast in this many days. Drips, welcomes
-- and anything buyer-critical are untouched; they are the relationship.
-- 0 turns it off.
alter table public.growth_settings
  add column if not exists cold_broadcast_days int not null default 30;

comment on column public.growth_settings.cold_broadcast_days is
  'Minimum days between broadcasts to a never-opened bulk-import subscriber. 0 = off.';
