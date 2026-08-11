-- Enhancement batch: refund win-back, failed-payment recovery, multi-currency fx,
-- shopper-action analytics.

-- E3: refund timestamp powers the 30-day post-refund win-back window.
alter table orders add column if not exists refunded_at timestamptz;

-- E3: toggle (OFF until owner enables in Admin → Automations) + send ledger.
alter table growth_settings add column if not exists refund_winback_enabled boolean not null default false;
create table if not exists refund_winback_log (
  email   text primary key,
  sent_at timestamptz not null default now()
);
alter table refund_winback_log enable row level security;

-- E5: USD→foreign fx rates refreshed daily by the growth cron; checkout-init
-- reads these to charge in the buyer's currency. { "EUR": 0.92, ..., "updated_at": iso }
alter table site_settings add column if not exists fx_rates jsonb;

-- Shopper actions: site_events.type is free text — no schema change needed for
-- 'buy_now' / 'wishlist_add' / 'wishlist_remove' / 'txn_created'. Index for the
-- per-product rollups shown in the Traffic tab.
create index if not exists site_events_type_product_idx on site_events(type, product_id) where product_id is not null;
