-- Membership subscription automation (fixed-term drip model).
-- A member buys an N-month plan (one-time Paddle purchase) and receives one
-- monthly file "drop" for N months, then the term expires. Renewal = re-purchase.
-- This mirrors the old Etsy/Next.js system, rebuilt on the Astro+Paddle stack.

-- ── Per-purchase membership term ─────────────────────────────────────
create table if not exists member_subscriptions (
  id                 uuid primary key default gen_random_uuid(),
  email              text not null,
  customer_name      text,
  plan_slug          text not null,                 -- membership_plans.slug (loose ref)
  months             integer not null,              -- 3 | 6 | 12
  files_per_month    integer not null default 8,
  tier               text not null default 'standard', -- 'standard' | 'premium' (12-mo gets bonus)
  status             text not null default 'active',   -- active | paused | cancelled | expired
  start_date         date not null default current_date,
  end_date           date not null,
  next_drop_date     date,                          -- next monthly drop due; null when finished
  drops_sent         integer not null default 0,
  total_drops        integer not null,              -- = months
  price_usd          numeric,
  is_renewal         boolean not null default false,
  order_id           uuid references orders(id) on delete set null,
  paddle_transaction_id text,                       -- idempotency for webhook
  cancel_reason      text,
  cancelled_at       timestamptz,
  paused_at          timestamptz,
  pause_resumes_at   date,
  created_at         timestamptz not null default now()
);
create index if not exists member_subscriptions_email_idx on member_subscriptions(lower(email));
create index if not exists member_subscriptions_due_idx on member_subscriptions(status, next_drop_date);
create unique index if not exists member_subscriptions_txn_idx
  on member_subscriptions(paddle_transaction_id) where paddle_transaction_id is not null;

-- ── Monthly file packs (one row per calendar month) ──────────────────
create table if not exists monthly_files (
  id                  uuid primary key default gen_random_uuid(),
  month               text unique not null,          -- 'YYYY-MM'
  title               text,                          -- e.g. 'June 2026 — Floral'
  preview_note        text,                          -- short caption shown in the drop email
  standard_drive_link text,                          -- Standard folder (all members)
  bonus_drive_link    text,                          -- Bonus/Premium folder (12-month members)
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ── Email send log (also the idempotency ledger for the cron) ────────
create table if not exists subscription_email_logs (
  id              uuid primary key default gen_random_uuid(),
  subscription_id uuid references member_subscriptions(id) on delete cascade,
  email           text,
  email_type      text,        -- first_pack | monthly_drop | pre_expiry | expiry | custom
  drop_month      text,        -- 'YYYY-MM' this send refers to (dedup key; '' for non-monthly)
  status          text,        -- sent | failed | skipped
  error_message   text,
  sent_at         timestamptz not null default now()
);
-- One successful send per (subscription, type, month) — prevents the daily cron
-- from ever double-dropping if it runs twice in a day.
create unique index if not exists sub_email_once_idx
  on subscription_email_logs(subscription_id, email_type, drop_month);

-- ── RLS: admin full access; no public access (service role bypasses RLS
--    for the webhook, cron, and portal server reads). ─────────────────
alter table member_subscriptions      enable row level security;
alter table monthly_files             enable row level security;
alter table subscription_email_logs   enable row level security;

drop policy if exists "admin all member_subscriptions" on member_subscriptions;
create policy "admin all member_subscriptions" on member_subscriptions
  for all to authenticated using (is_admin()) with check (is_admin());

drop policy if exists "admin all monthly_files" on monthly_files;
create policy "admin all monthly_files" on monthly_files
  for all to authenticated using (is_admin()) with check (is_admin());

drop policy if exists "admin all subscription_email_logs" on subscription_email_logs;
create policy "admin all subscription_email_logs" on subscription_email_logs
  for all to authenticated using (is_admin()) with check (is_admin());
