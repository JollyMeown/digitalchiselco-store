-- Diamond Select (2026-09-26), replacing the All-Access pass of migration 145.
--
-- Owner approved the credit model: 12 months, $129 founding price, 10 credits
-- on joining and 10 more every month (1 credit = 1 single design the member
-- chooses), unused credits roll over, plus 30 days after the term to use
-- leftovers. No curated monthly pack for this plan. The pass allowed 100
-- designs every 30 days, which was effectively unlimited.
-- Still HIDDEN (available_from 2099-01-01) until the owner has tested it and
-- sets the launch date in Admin > Membership. The plan had no members.

update public.membership_plans
set slug = 'diamond-select',
    name = 'Diamond Select, 12 months',
    price_usd = 129,
    files_per_month = 10,
    features = '["Founding price until 31 December 2026, then $149", "15% off any design you buy beyond your credits", "Commercial use included: sell what you carve"]'::jsonb,
    available_from = '2099-01-01'
where slug = 'all-access-year';

update public.entitlements set source = 'diamond-select' where source = 'all-access';

-- Every download a Diamond Select member makes from their account goes
-- through /api/member/dl, which records it here and then opens the file.
-- Feeds the admin view (downloads per member and design, countries) and the
-- sharing warning. Server-only: no browser role reads or writes it.
create table if not exists public.member_downloads (
  id              bigint generated always as identity primary key,
  email           text not null,
  product_id      uuid references public.products(id) on delete set null,
  entitlement_id  uuid,
  file_index      int not null default 0,
  country         text,
  ip_hash         text,
  user_agent      text,
  ts              timestamptz not null default now()
);
create index if not exists member_downloads_email_ts_idx on public.member_downloads (email, ts desc);
create index if not exists member_downloads_product_idx on public.member_downloads (product_id);
alter table public.member_downloads enable row level security;
grant select, insert, update, delete on public.member_downloads to service_role;
grant usage, select on sequence public.member_downloads_id_seq to service_role;
