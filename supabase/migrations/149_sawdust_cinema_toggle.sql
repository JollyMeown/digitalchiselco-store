-- Homepage switch for Sawdust Cinema (owner 2026-09-27: "OFF/ON button ...
-- keep default OFF"). Admin > Media > Sawdust Cinema flips it; the films and
-- their emails keep working either way, only the homepage section hides.
alter table public.site_settings add column if not exists show_sawdust_cinema boolean not null default false;
