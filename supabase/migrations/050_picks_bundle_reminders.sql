-- Product Picks + Bundle of the Week + owner report + wishlist reminders.

-- Distinguish real "favorite" signals from plain product views so the wishlist
-- reminder only fires on hearts, not on browsing.
alter table browse_events add column if not exists source text not null default 'view';
create index if not exists browse_events_source_idx on browse_events (source, created_at desc);

-- One wishlist reminder per (email, product) ever.
create table if not exists wishlist_reminder_log (
  email      text not null,
  product_id uuid not null,
  sent_at    timestamptz not null default now(),
  primary key (email, product_id)
);
alter table wishlist_reminder_log enable row level security;

-- Toggles (all OFF until enabled in Admin → Automations).
alter table growth_settings add column if not exists bundle_week_enabled boolean not null default false;
alter table growth_settings add column if not exists owner_report_enabled boolean not null default false;
alter table growth_settings add column if not exists wishlist_reminder_enabled boolean not null default false;

-- Bundle of the Week state: { week, category_id, category_name, ids, expires_at, generated_at }
alter table site_settings add column if not exists weekly_bundle jsonb;
