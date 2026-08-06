-- Wave 7: configurable post-purchase add-on %, loyalty points/store credit,
-- and an AI/community design-request board.

-- ── One-click add-on config (moves the % into the Discounts tab) ──────
alter table site_settings add column if not exists addon_enabled boolean not null default true;
alter table site_settings add column if not exists addon_discount_percent int not null default 25;

-- ── Loyalty points / store credit ────────────────────────────────────
alter table site_settings add column if not exists loyalty_enabled boolean not null default false;
alter table site_settings add column if not exists loyalty_earn_per_dollar int not null default 10;    -- points earned per $1 spent
alter table site_settings add column if not exists loyalty_redeem_per_dollar int not null default 100;  -- points needed for $1 credit

-- Append-only ledger; a customer's balance = sum(points) for their email.
create table if not exists loyalty_ledger (
  id bigint generated always as identity primary key,
  email text not null,
  points int not null,                       -- + earned, - redeemed/adjusted
  reason text not null,                      -- earned | redeemed | adjust | signup
  order_id uuid references orders(id) on delete set null,
  coupon_code text,
  created_at timestamptz not null default now()
);
create index if not exists loyalty_ledger_email_idx on loyalty_ledger (email);
-- one 'earned' row per order (idempotent against webhook retries)
create unique index if not exists loyalty_earned_order_uidx on loyalty_ledger (order_id) where reason = 'earned';
alter table loyalty_ledger enable row level security;
create policy "loyalty_admin_read" on loyalty_ledger for select using (is_admin());

-- ── Design-request / feedback board ──────────────────────────────────
create table if not exists design_requests (
  id uuid primary key default gen_random_uuid(),
  email text,
  name text,
  title text not null,
  description text,
  image_url text,                            -- optional reference image
  votes int not null default 0,
  status text not null default 'open',       -- open | planned | in_progress | done | declined
  admin_response text,
  product_slug text,                         -- linked design once made
  created_at timestamptz not null default now()
);
create index if not exists design_requests_status_idx on design_requests (status);
alter table design_requests enable row level security;
-- public can read non-declined requests; writes go through the service role only
create policy "design_requests_public_read" on design_requests
  for select using (status <> 'declined');
create policy "design_requests_admin_all" on design_requests
  for all using (is_admin()) with check (is_admin());

-- one vote per visitor per request (dedupe)
create table if not exists design_request_votes (
  request_id uuid references design_requests(id) on delete cascade,
  voter text not null,                       -- sha256(ip|ua|secret)
  created_at timestamptz not null default now(),
  primary key (request_id, voter)
);
alter table design_request_votes enable row level security;
create policy "drv_admin_read" on design_request_votes for select using (is_admin());

-- atomic vote increment used by the vote endpoint
create or replace function increment_design_votes(p_id uuid)
returns void language sql as $$
  update design_requests set votes = votes + 1 where id = p_id;
$$;
