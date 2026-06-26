-- Homepage overhaul (2026-06-26): admin-managed reviews, FAQs, membership plans,
-- best sellers, plus more site_settings image slots for logo / favicon / membership
-- poster / free-pack image / welfare image.

-- ---------- site_settings ----------
alter table site_settings add column if not exists logo_image_url       text;
alter table site_settings add column if not exists favicon_image_url    text;
alter table site_settings add column if not exists membership_image_url text;
alter table site_settings add column if not exists membership_title     text default 'Become a Member — $6.70/month';
alter table site_settings add column if not exists membership_subtitle  text default 'Get 8 fresh bas-relief STL designs every month — 24 carving files for $20. Lock in your low price now.';
alter table site_settings add column if not exists free_image_url       text;
alter table site_settings add column if not exists welfare_image_url    text;
alter table site_settings add column if not exists welfare_text         text default 'Half of every sale builds something bigger than a shop. We donate 50% of our profits to families in need and to animal welfare. Every time you download a file, you''re helping us make that happen.';
alter table site_settings add column if not exists trust_badges         jsonb default '[
  {"icon":"⬇","label":"Instant Download"},
  {"icon":"👍","label":"99% Positive Feedback"},
  {"icon":"♾","label":"Unlimited Time Download"},
  {"icon":"🔒","label":"100% Payment Security"},
  {"icon":"💬","label":"Contact Us for Help"}
]'::jsonb;

-- ---------- products: bestseller flag ----------
alter table products add column if not exists is_bestseller boolean default false;
create index if not exists products_bestseller_idx on products(is_bestseller) where is_bestseller = true;

-- ---------- reviews (admin-managed, public read) ----------
create table if not exists reviews (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  text        text not null,
  rating      int  default 5 check (rating between 1 and 5),
  source      text default 'Etsy',
  sort_order  int  default 0,
  active      boolean default true,
  created_at  timestamptz default now()
);
alter table reviews enable row level security;
drop policy if exists "public read reviews" on reviews;
create policy "public read reviews" on reviews for select using (active = true);
drop policy if exists "admin all reviews" on reviews;
create policy "admin all reviews" on reviews for all to authenticated using (is_admin()) with check (is_admin());

-- Seed the 3 baked-in reviews so the homepage stays populated until admin edits them
insert into reviews (name, text, rating, source, sort_order) values
  ('Vickie', 'The value of this purchase is amazing. They are all top quality. Easy downloads, works perfectly with the Vcarve software. Thank you so much!', 5, 'Etsy', 0),
  ('Diane',  'Love these, and seller is very good with help! Would definitely recommend! And they are awesome with the customized files.', 5, 'Etsy', 1),
  ('Clyde',  'Nice finish carving with great detail. Quality, new products for this CNC wood carver. I will get more.', 5, 'Etsy', 2)
on conflict do nothing;

-- ---------- faqs (admin-managed) ----------
create table if not exists faqs (
  id          uuid primary key default gen_random_uuid(),
  question    text not null,
  answer      text not null,
  sort_order  int  default 0,
  active      boolean default true,
  created_at  timestamptz default now()
);
alter table faqs enable row level security;
drop policy if exists "public read faqs" on faqs;
create policy "public read faqs" on faqs for select using (active = true);
drop policy if exists "admin all faqs" on faqs;
create policy "admin all faqs" on faqs for all to authenticated using (is_admin()) with check (is_admin());

insert into faqs (question, answer, sort_order) values
  ('What file format do I get?', 'High-detail STL files, ready for CNC routers, 3D printers and laser engravers. Tested in Aspire, VCarve Pro, Carveco, ArtCAM and Fusion 360.', 0),
  ('How do I receive my files after buying?', 'Instantly. You get a secure download link by email the moment your payment clears, and the files also appear in your account dashboard to re-download anytime.', 1),
  ('Can I use the designs commercially?', 'Yes — every purchase includes a personal and commercial-use license, so you can sell the items you carve or print.', 2),
  ('What is the 50% donation?', 'We donate 50% of every sale to people in need and animal welfare. Every download helps make that happen.', 3),
  ('Do you take custom orders?', 'Yes! We create custom bas-relief portraits and designs from your photos. See our Custom Commissions collection or contact us.', 4)
on conflict do nothing;

-- ---------- membership_plans (seeded) ----------
create table if not exists membership_plans (
  id                  uuid primary key default gen_random_uuid(),
  slug                text unique not null,
  name                text not null,
  months              int not null,
  files_per_month     int default 8,
  price_usd           numeric(10,2) not null,
  original_price_usd  numeric(10,2),
  features            jsonb default '[]'::jsonb,
  active              boolean default true,
  sort_order          int  default 0,
  highlight           boolean default false,
  created_at          timestamptz default now()
);
alter table membership_plans enable row level security;
drop policy if exists "public read membership_plans" on membership_plans;
create policy "public read membership_plans" on membership_plans for select using (active = true);
drop policy if exists "admin all membership_plans" on membership_plans;
create policy "admin all membership_plans" on membership_plans for all to authenticated using (is_admin()) with check (is_admin());

insert into membership_plans (slug, name, months, files_per_month, price_usd, original_price_usd, features, sort_order, highlight) values
  ('3-month', '3-Month CNC STL Membership', 3, 8, 20.00, 192.00,
   '["8 fresh bas-relief STL files every month","24 total files over 3 months","~$192 retail value","About 90% off retail","Commercial use included","Instant first pack delivery"]'::jsonb, 0, true),
  ('6-month', '6-Month CNC STL Membership', 6, 8, 39.99, 384.00,
   '["8 fresh bas-relief STL files every month","48 total files over 6 months","~$384 retail value","About 90% off retail","Commercial use included","Instant first pack delivery"]'::jsonb, 1, false)
on conflict (slug) do nothing;

-- ---------- membership_leads ----------
create table if not exists membership_leads (
  id           uuid primary key default gen_random_uuid(),
  name         text,
  email        text not null,
  plan_slug    text,
  source       text default 'membership-page',
  created_at   timestamptz default now()
);
create index if not exists membership_leads_email_idx on membership_leads(email);
alter table membership_leads enable row level security;
drop policy if exists "admin all membership_leads" on membership_leads;
create policy "admin all membership_leads" on membership_leads for all to authenticated using (is_admin()) with check (is_admin());
-- insert is performed via service_role from /api/membership-lead, so no public insert policy
