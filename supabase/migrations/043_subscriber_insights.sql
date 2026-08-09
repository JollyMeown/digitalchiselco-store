-- Subscriber Insights: per-person email engagement + product affinity.
-- Built entirely on data we already collect (email_events from the Resend
-- webhook, browse_events, orders/order_items). Aggregation lives in the DB via
-- views so the admin panel stays fast whether there are 100 subscribers or 100K.

-- Fast per-recipient and per-product lookups.
create index if not exists email_events_email_idx  on email_events (email, created_at desc);
create index if not exists email_events_url_idx     on email_events (url) where url is not null;
create index if not exists browse_events_email_idx  on browse_events (email);
create index if not exists browse_events_product_idx on browse_events (product_id);
create index if not exists orders_email_idx          on orders (email);

-- ── Per-subscriber engagement roll-up ────────────────────────────────
-- One row per subscriber with lifetime email counts, recency, and a simple
-- engagement tier. security_invoker=true → respects the admin-only RLS on the
-- underlying tables (only the service role / admins can read it).
create or replace view v_subscriber_engagement
with (security_invoker = true) as
select
  s.email,
  s.source,
  s.created_at                                                as joined_at,
  s.confirmed_at,
  s.unsubscribed_at,
  count(e.*) filter (where e.event = 'sent')                  as sent,
  count(e.*) filter (where e.event = 'delivered')             as delivered,
  count(e.*) filter (where e.event = 'opened')                as opened,
  count(e.*) filter (where e.event = 'clicked')               as clicked,
  count(e.*) filter (where e.event = 'bounced')               as bounced,
  count(e.*) filter (where e.event = 'complained')            as complained,
  max(e.created_at) filter (where e.event = 'opened')         as last_opened_at,
  max(e.created_at) filter (where e.event = 'clicked')        as last_clicked_at,
  max(e.created_at)                                           as last_event_at
from subscribers s
left join email_events e on e.email = lower(s.email)
group by s.email, s.source, s.created_at, s.confirmed_at, s.unsubscribed_at;

-- ── Product interest (affinity) ──────────────────────────────────────
-- Which products people actually engage with, from three signals:
--   email clicks (the product URL in a marketing email), site browses, purchases.
-- Product slug is parsed out of the clicked URL (/product/<slug>).
create or replace view v_product_interest
with (security_invoker = true) as
with clicks as (
  select substring(e.url from '/product/([^/?#]+)') as slug, e.email
  from email_events e
  where e.event = 'clicked' and e.url ~ '/product/'
),
buys as (
  select oi.product_id, o.email
  from order_items oi
  join orders o on o.id = oi.order_id
  where o.deleted_at is null
)
select
  p.id                              as product_id,
  p.slug,
  p.title,
  p.image_url,
  p.price_usd,
  count(distinct c.email)           as email_clickers,
  count(distinct b.email)           as browsers,
  count(distinct bu.email)          as buyers,
  -- weighted interest score: a purchase > a click > a browse
  (count(distinct bu.email) * 5
   + count(distinct c.email) * 2
   + count(distinct b.email))       as interest_score
from products p
left join clicks c        on c.slug = p.slug
left join browse_events b on b.product_id = p.id
left join buys bu         on bu.product_id = p.id
where p.active = true
group by p.id, p.slug, p.title, p.image_url, p.price_usd;

revoke all on v_subscriber_engagement from anon, authenticated;
revoke all on v_product_interest      from anon, authenticated;
