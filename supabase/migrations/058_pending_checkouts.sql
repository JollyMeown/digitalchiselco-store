-- Server-side snapshot of every Paddle transaction checkout-init creates.
-- The webhook fulfils from THIS row (what we actually sold), never from
-- txn.custom_data — which Paddle.js on our own approved domain lets any
-- page-context script set to arbitrary values (fake bundle5 lines, fake
-- gift_remainder, someone else's coupon_id…). Also stamps fulfilment progress
-- so a webhook that dies mid-way is resumed correctly, not skipped.
create table if not exists pending_checkouts (
  txn_id        text primary key,               -- Paddle txn_…
  created_at    timestamptz not null default now(),
  email         text,
  cart_ids      jsonb not null,                 -- exactly what checkout-init sent, in Paddle item order
  customizations jsonb,
  coupon_id     uuid,
  coupon_code   text,
  coupon_discount numeric,
  gift_remainder numeric,
  gift          jsonb,                          -- {to, from, note}
  fx            jsonb,                          -- {currency, rate, usd_subtotal}
  expected_total_usd numeric                    -- USD subtotal after discounts (sanity check)
);
alter table pending_checkouts enable row level security;   -- service role only

alter table orders add column if not exists fulfilled_at timestamptz;
alter table orders add column if not exists confirmation_sent_at timestamptz;
