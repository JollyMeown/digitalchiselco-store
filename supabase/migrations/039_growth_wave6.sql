-- Wave 6: free-gift threshold, on-site reviews w/ photos, referrals,
-- seasonal collections, abandoned-browse. One migration for the batch.

-- ── Free-gift threshold (config on the single settings row) ──────────
alter table site_settings add column if not exists free_gift_threshold numeric not null default 0;   -- 0 = off
alter table site_settings add column if not exists free_gift_product_id uuid;                          -- the sampler product

-- ── growth toggles for the two new email/reward systems ──────────────
alter table growth_settings add column if not exists abandoned_browse_enabled boolean not null default false;
alter table growth_settings add column if not exists referral_rewards_enabled boolean not null default false;

-- ── On-site reviews with photos ──────────────────────────────────────
-- Extend the existing reviews table: link to a product, allow a photo, and a
-- moderation status. Existing (Etsy/admin) rows are treated as approved.
alter table reviews add column if not exists product_id uuid references products(id) on delete set null;
alter table reviews add column if not exists photo_url text;
alter table reviews add column if not exists status text not null default 'approved';   -- pending|approved|rejected
alter table reviews add column if not exists email text;
alter table reviews add column if not exists title text;
create index if not exists reviews_product_status_idx on reviews (product_id, status);
-- Public can read approved reviews (existing policy already allows active=true;
-- product reviews use status). Add an explicit approved-read policy.
drop policy if exists "reviews_public_approved" on reviews;
create policy "reviews_public_approved" on reviews
  for select using (active = true and status = 'approved');

-- ── Abandoned-browse: viewed products tied to a KNOWN email ──────────
-- Only rows where the visitor has already given us their email (subscribe /
-- checkout / account) get stored — anonymous views never land here.
create table if not exists browse_events (
  id bigint generated always as identity primary key,
  email text not null,
  product_id uuid references products(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists browse_events_email_idx on browse_events (email, created_at desc);
alter table browse_events enable row level security;
create policy "browse_events_admin_read" on browse_events for select using (is_admin());
-- one reminder per email ever (claimed like order_followups)
create table if not exists browse_reminders (
  email text primary key,
  sent_at timestamptz not null default now()
);
alter table browse_reminders enable row level security;
create policy "browse_reminders_admin_read" on browse_reminders for select using (is_admin());

-- ── Referral program (give 15% / get 15%) ────────────────────────────
-- A stable share code per customer email; referrals log who used whose code.
create table if not exists referral_codes (
  email text primary key,
  code text unique not null,
  created_at timestamptz not null default now()
);
alter table referral_codes enable row level security;
create policy "referral_codes_admin_read" on referral_codes for select using (is_admin());

create table if not exists referrals (
  id bigint generated always as identity primary key,
  code text not null,                       -- the referrer's share code that was used
  referrer_email text not null,
  referred_email text,                      -- the friend who bought
  order_id uuid references orders(id) on delete set null,
  status text not null default 'pending',   -- pending|rewarded
  reward_code text,                         -- the coupon minted for the referrer
  amount_usd numeric,                       -- friend's order total (for stats)
  created_at timestamptz not null default now()
);
create index if not exists referrals_referrer_idx on referrals (referrer_email);
create unique index if not exists referrals_order_uidx on referrals (order_id);
alter table referrals enable row level security;
create policy "referrals_admin_read" on referrals for select using (is_admin());

-- ── Seasonal collections (auto show/hide by date, keyword-populated) ──
create table if not exists seasonal_collections (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  subtitle text,
  keywords text[] not null default '{}',    -- title ilike ANY → members
  hero_image_url text,
  starts_at timestamptz,                     -- null = always-on window edge
  ends_at timestamptz,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
alter table seasonal_collections enable row level security;
create policy "seasonal_public_read" on seasonal_collections for select using (active = true);
create policy "seasonal_admin_all" on seasonal_collections for all using (is_admin()) with check (is_admin());
