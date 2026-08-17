-- Heartbeat log for the daily automation. One row per run so the admin can
-- SEE the cron is alive (the scheduler had been silently dead for a week).
create table if not exists cron_runs (
  id          bigint generated always as identity primary key,
  ran_at      timestamptz not null default now(),
  ok          boolean not null,
  duration_ms int,
  summary     jsonb,          -- per-system stats returned by the run
  error       text
);
create index if not exists cron_runs_ran_idx on cron_runs (ran_at desc);
alter table cron_runs enable row level security;
drop policy if exists "admin read cron_runs" on cron_runs;
create policy "admin read cron_runs" on cron_runs for select to authenticated using (is_admin());
