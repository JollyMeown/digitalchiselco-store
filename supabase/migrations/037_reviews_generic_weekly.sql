-- (1) Curated pool for product-page social proof: only reviews flagged generic
--     (English, 5-star, not naming a specific design) rotate on product pages.
--     Flags are set by scripts/mark_generic_reviews.mjs and editable in admin.
alter table reviews add column if not exists generic boolean not null default false;

-- (2) Weekly fresh-designs digest (Automations toggle, OFF until owner enables)
alter table growth_settings add column if not exists weekly_digest_enabled boolean not null default false;

-- One row per ISO week actually sent — makes the weekly digest idempotent
-- across cron retries and redeploys.
create table if not exists weekly_digest_log (
  week_key text primary key,          -- e.g. '2026-W32'
  sent_count int not null default 0,
  product_count int not null default 0,
  pdf_url text,
  created_at timestamptz not null default now()
);
alter table weekly_digest_log enable row level security;
create policy "weekly_digest_admin_read" on weekly_digest_log
  for select using (is_admin());
