-- Paddle integration: link our products/prices to Paddle catalog,
-- and an idempotency table for webhook event processing.

-- 1) Products: link to Paddle catalog
alter table products
  add column if not exists paddle_product_id text,
  add column if not exists paddle_price_id   text;
create index if not exists products_paddle_price_idx on products(paddle_price_id);

-- 2) Membership plans: link to Paddle catalog too
alter table membership_plans
  add column if not exists paddle_product_id text,
  add column if not exists paddle_price_id   text;
create index if not exists membership_plans_paddle_price_idx on membership_plans(paddle_price_id);

-- 3) Orders: store Paddle-specific identifiers
alter table orders
  add column if not exists paddle_transaction_id text,
  add column if not exists paddle_customer_id    text;
create unique index if not exists orders_paddle_txn_unique on orders(paddle_transaction_id);

-- 4) Webhook events — idempotency + audit log
create table if not exists webhook_events (
  id            uuid primary key default gen_random_uuid(),
  provider      text not null,                 -- 'paddle'
  event_id      text not null,                 -- Paddle's event ID (e.g. evt_…)
  event_type    text not null,                 -- e.g. 'transaction.completed'
  payload       jsonb not null,                -- full webhook body
  received_at   timestamptz default now(),
  processed_at  timestamptz,
  error         text
);
create unique index if not exists webhook_events_provider_event_unique
  on webhook_events(provider, event_id);
create index if not exists webhook_events_received_idx on webhook_events(received_at desc);

-- RLS: only server (service_role) can touch webhook events
alter table webhook_events enable row level security;
-- (no policies = nobody but service_role can read/write)
