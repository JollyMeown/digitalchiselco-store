-- Foundations for features 1-9 (minus the free-STL giveaway):
-- personalized weekly, win-back, price-drop alerts, list health, related
-- designs, send-time optimization, RFM scoring, referral leaderboard/nudges.

-- ── toggles (all OFF until previewed/enabled) ────────────────────────
alter table growth_settings
  add column if not exists weekly_personalized   boolean default false,
  add column if not exists winback_enabled       boolean default false,
  add column if not exists price_drop_enabled     boolean default false,
  add column if not exists sendtime_enabled       boolean default false,
  add column if not exists referral_nudge_enabled boolean default false;

-- ── subscriber columns: deliverability + send-time ───────────────────
alter table subscribers
  add column if not exists suppressed_at   timestamptz,   -- stop emailing (dead weight)
  add column if not exists best_send_hour  int;           -- 0-23 UTC, learned from opens

-- ── dedup logs ───────────────────────────────────────────────────────
create table if not exists winback_log        (email text primary key, sent_at timestamptz default now());
create table if not exists referral_nudge_log (email text primary key, sent_at timestamptz default now());
create table if not exists price_drop_log (
  product_id uuid not null references products(id) on delete cascade,
  email text not null,
  price_usd numeric,
  sent_at timestamptz default now(),
  primary key (product_id, email)
);

-- ── price snapshots (detect drops) ───────────────────────────────────
create table if not exists product_price_snapshot (
  product_id uuid primary key references products(id) on delete cascade,
  price_usd  numeric,
  updated_at timestamptz default now()
);
-- seed with current prices so we never fire a false "drop" on first run
insert into product_price_snapshot (product_id, price_usd)
  select id, price_usd from products where active and price_usd is not null
  on conflict (product_id) do nothing;

alter table winback_log        enable row level security;
alter table referral_nudge_log enable row level security;
alter table price_drop_log     enable row level security;
alter table product_price_snapshot enable row level security;
drop policy if exists "admin read winback_log"        on winback_log;
drop policy if exists "admin read referral_nudge_log" on referral_nudge_log;
drop policy if exists "admin read price_drop_log"     on price_drop_log;
drop policy if exists "admin read price_snapshot"     on product_price_snapshot;
create policy "admin read winback_log"        on winback_log        for select to authenticated using (is_admin());
create policy "admin read referral_nudge_log" on referral_nudge_log for select to authenticated using (is_admin());
create policy "admin read price_drop_log"     on price_drop_log     for select to authenticated using (is_admin());
create policy "admin read price_snapshot"     on product_price_snapshot for select to authenticated using (is_admin());

-- ── per-subscriber category affinity (clicks 2, browses 1, buys 5) ───
create or replace view v_subscriber_category_affinity with (security_invoker = true) as
with sig as (
  select lower(e.email) as email, pc.category_id, 2 as w
    from email_events e
    join products p on p.slug = substring(e.url from '/product/([^/?#]+)')
    join product_categories pc on pc.product_id = p.id
    where e.event = 'clicked' and e.url ~ '/product/'
  union all
  select lower(b.email), pc.category_id, 1
    from browse_events b join product_categories pc on pc.product_id = b.product_id
  union all
  select lower(o.email), pc.category_id, 5
    from order_items oi
    join orders o on o.id = oi.order_id and o.deleted_at is null
    join product_categories pc on pc.product_id = oi.product_id
)
select email, category_id, sum(w)::int as score
from sig group by email, category_id;

-- ── RFM-ish base (recency / frequency / monetary + last open) ────────
create or replace view v_subscriber_rfm with (security_invoker = true) as
select
  s.email, s.source, s.created_at as joined_at,
  count(distinct o.id)                as orders,
  coalesce(sum(o.total), 0)::numeric  as revenue,
  max(o.created_at)                   as last_order_at,
  eo.last_open_at
from subscribers s
left join orders o on lower(o.email) = lower(s.email) and o.deleted_at is null
left join (select email, max(created_at) as last_open_at from email_events where event = 'opened' group by email) eo
  on eo.email = lower(s.email)
where s.unsubscribed_at is null and s.suppressed_at is null
group by s.email, s.source, s.created_at, eo.last_open_at;

-- ── referral leaderboard ─────────────────────────────────────────────
create or replace view v_referral_leaderboard with (security_invoker = true) as
select
  referrer_email,
  count(*) filter (where referred_email is not null) as referred,
  count(*) filter (where status = 'rewarded')        as rewarded,
  coalesce(sum(amount_usd), 0)::numeric              as revenue
from referrals
where referrer_email is not null
group by referrer_email;

revoke all on v_subscriber_category_affinity from anon, authenticated;
revoke all on v_subscriber_rfm                from anon, authenticated;
revoke all on v_referral_leaderboard          from anon, authenticated;
