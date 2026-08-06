-- The admin Discounts panel orders promo codes by created_at, but the coupons
-- table never had that column — the query errored and the list rendered empty.
alter table coupons add column if not exists created_at timestamptz not null default now();
