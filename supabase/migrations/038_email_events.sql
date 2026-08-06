-- Email delivery/engagement events pushed by Resend's webhook
-- (/api/resend/webhook, Svix-signature verified). Powers the "Email
-- performance" panel in admin -> Automations.
create table if not exists email_events (
  id bigint generated always as identity primary key,
  provider_id text,                  -- Resend email id (groups events per email)
  event text not null,               -- sent|delivered|opened|clicked|bounced|complained|delivery_delayed
  email text,                        -- recipient
  kind text,                         -- our tag: weekly, drip1..5, cart, review7, arrivals30, loyalty, order, gift
  week text,                         -- weekly digest week tag, e.g. 2026-W33
  url text,                          -- clicked link (click events only)
  created_at timestamptz not null default now()
);
create index if not exists email_events_kind_event_idx on email_events (kind, event);
create index if not exists email_events_created_idx on email_events (created_at desc);
alter table email_events enable row level security;
create policy "email_events_admin_read" on email_events
  for select using (is_admin());
-- inserts happen only via the service-role client in the webhook route
