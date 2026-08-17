-- Central ledger of EVERY email the site sends (all kinds — weekly, drips,
-- alerts, order confirmations, picks…). Written by src/lib/resend.ts at the
-- moment of sending, so nothing can be sent without being recorded.
-- Complements email_events (which holds Resend's delivered/opened/clicked
-- webhooks after the fact).
create table if not exists email_send_log (
  id           bigint generated always as identity primary key,
  sent_at      timestamptz not null default now(),
  kind         text,                    -- tag 'kind' (weekly, drip1, order, picks, ownerReport…)
  week         text,                    -- weekly digest ISO week when applicable
  recipient    text not null,
  subject      text,
  provider_id  text,                    -- Resend id (null on batch or failure)
  status       text not null,           -- 'sent' | 'failed' | 'skipped'
  error        text,
  batch_key    text                     -- idempotency key of the batch/send
);
create index if not exists email_send_log_sent_idx on email_send_log (sent_at desc);
create index if not exists email_send_log_kind_idx on email_send_log (kind, sent_at desc);
create index if not exists email_send_log_recipient_idx on email_send_log (recipient, sent_at desc);
alter table email_send_log enable row level security;
drop policy if exists "admin read email_send_log" on email_send_log;
create policy "admin read email_send_log" on email_send_log for select to authenticated using (is_admin());
