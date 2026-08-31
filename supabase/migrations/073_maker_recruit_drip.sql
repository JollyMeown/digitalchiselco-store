-- 073: automatic daily maker-recruitment drip (owner: at least 20 invites/day
-- to subscribers not yet invited; more when the email budget allows).
alter table public.growth_settings add column if not exists maker_recruit_drip_enabled boolean not null default true;
