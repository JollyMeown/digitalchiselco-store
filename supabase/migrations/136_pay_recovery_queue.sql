-- Failed-payment recovery, decided at SEND time instead of at failure time.
--
-- Before: on transaction.payment_failed the webhook booked a Resend email for
-- +2 h, checking only whether THAT transaction id was later paid. Buyers retry
-- at once and the retry is often a new transaction, so all three recovery
-- emails so far (Richard 09-09, Jerry 09-15, Roy 09-17) were booked for people
-- who paid within a minute, and "your order did not go through" reached
-- customers who already had their files. The send-only Resend key cannot
-- cancel a booked email, so the owner had to cancel Roy's by hand.
--
-- Now the failure is queued here. The 10-minute poller sends only once two
-- hours have passed AND that email has no paid order since the failure.
create table if not exists public.pay_recovery_queue (
  id           uuid primary key default gen_random_uuid(),
  email        text not null,
  txn_id       text not null unique,
  items        jsonb not null default '[]'::jsonb,
  failed_at    timestamptz not null default now(),
  status       text not null default 'pending'
               check (status in ('pending', 'sent', 'skipped_paid', 'skipped_unsub', 'expired', 'failed')),
  decided_at   timestamptz,
  provider_id  text,
  note         text
);
create index if not exists pay_recovery_queue_pending_idx on public.pay_recovery_queue (status, failed_at);

alter table public.pay_recovery_queue enable row level security;
drop policy if exists "pay_recovery_queue_admin_all" on public.pay_recovery_queue;
create policy "pay_recovery_queue_admin_all" on public.pay_recovery_queue
  for all using (is_admin()) with check (is_admin());
