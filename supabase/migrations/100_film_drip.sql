-- Sawdust Cinema films as an email automation (owner request 2026-09-05):
-- a film marked for the drip goes to every subscriber in turn, present and
-- future, with the ledger guaranteeing nobody gets the same film twice.
alter table public.showcase_videos add column if not exists email_in_drip boolean not null default false;
comment on column public.showcase_videos.email_in_drip is 'When true the nightly film drip sends this film to every confirmed subscriber who has not had it, one film per gap.';

alter table public.growth_settings add column if not exists film_drip_enabled boolean not null default false;
alter table public.growth_settings add column if not exists film_drip_gap_days integer not null default 4;
