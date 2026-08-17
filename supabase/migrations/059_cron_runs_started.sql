-- cron_runs: record the START of every run (ok=null) and finalize at the end,
-- so a serverless timeout mid-run is visible as "started, never finished"
-- instead of looking identical to "scheduler never fired".
alter table cron_runs alter column ok drop not null;
alter table cron_runs add column if not exists finished_at timestamptz;
alter table cron_runs add column if not exists steps_done text[];
