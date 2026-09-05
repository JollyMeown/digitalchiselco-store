-- 12-month Premium plan, launching January 2027 (owner decision 2026-09-06).
-- The plan exists now so the whole path (bonus bundle from BRS, Premium
-- pack email, portal) can be tested, but the public plan picker only shows
-- a plan once its available_from date has arrived. Admin, the cart marker
-- (membership:<slug>) and /membership?preview=1 see it regardless.
alter table public.membership_plans add column if not exists available_from date;
comment on column public.membership_plans.available_from is 'Hidden from the public plan picker before this date. Null = available now.';

insert into public.membership_plans (slug, name, months, files_per_month, price_usd, original_price_usd, features, active, sort_order, highlight, available_from)
select '12-month-premium', '12-Month Premium CNC STL Membership', 12, 8, 69.99, 960,
       '["8 fresh bas-relief STL designs every month, 96 in a year","2 extra Premium bonus designs every month, Premium only","Every pack arrives by email and stays in your account forever","10% member discount on every single design in the catalogue","Commercial use included, carve and sell as many as you like","One payment, no recurring charge"]'::jsonb,
       true, 3, false, date '2027-01-01'
where not exists (select 1 from public.membership_plans where slug = '12-month-premium');
