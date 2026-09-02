-- Owner-granted free credits for makers (2026-09-03).
--
-- Until now the only free credits a maker ever got were the DB default of 5 at
-- application time, with no way to hand out more: no launch gift, no apology
-- credit, no "quote this job on us". This adds the setting that controls the
-- founding grant, so it can be raised for a recruitment push without a deploy.
-- Individual and bulk grants are recorded in maker_ledger (kind 'credit_grant'),
-- which already exists, so every free credit is auditable.
alter table public.growth_settings
  add column if not exists founding_credits integer not null default 5;

-- Grants are looked up per maker when showing "free credits given" in admin.
create index if not exists maker_ledger_grant_idx
  on public.maker_ledger (maker_id, kind, created_at desc);
