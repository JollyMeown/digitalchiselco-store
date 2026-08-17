-- Self-healing weekly digest queue. Every eligible subscriber gets ONE row per
-- ISO week the moment the digest is generated; a daily "drain" step sends
-- pending rows and stops cleanly when Resend's daily quota hits. Nobody is
-- ever left unsent silently: they stay 'pending' until delivered (or the week
-- ages out) and the dashboard shows the exact counts.
create table if not exists weekly_send_queue (
  week_key    text not null,
  email       text not null,
  status      text not null default 'pending',   -- pending | sent | failed | skipped
  attempts    int  not null default 0,
  last_error  text,
  queued_at   timestamptz not null default now(),
  sent_at     timestamptz,
  primary key (week_key, email)
);
create index if not exists weekly_send_queue_status_idx on weekly_send_queue (status, week_key);
alter table weekly_send_queue enable row level security;
drop policy if exists "admin read weekly_send_queue" on weekly_send_queue;
create policy "admin read weekly_send_queue" on weekly_send_queue for select to authenticated using (is_admin());

-- The designs each week's digest features are frozen at generation time so a
-- Wednesday retry sends the SAME email Monday's recipients got.
alter table weekly_digest_log add column if not exists product_ids jsonb;
alter table weekly_digest_log add column if not exists queued_count int not null default 0;
alter table weekly_digest_log add column if not exists last_drain_at timestamptz;
alter table weekly_digest_log add column if not exists drain_note text;
