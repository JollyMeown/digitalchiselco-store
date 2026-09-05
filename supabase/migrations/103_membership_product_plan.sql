-- A membership can be bought two ways: the plan itself (Paddle price id on
-- membership_plans, or a membership:<slug> cart marker) or a CATALOGUE PRODUCT
-- flagged is_subscription. The second path created an order but no membership
-- (real case 2026-09-05, added by hand). Each subscription product now names
-- the plan it grants, and the webhook + a nightly reconciliation honour it.
alter table public.products add column if not exists membership_plan_slug text;
comment on column public.products.membership_plan_slug is 'When set (and is_subscription), buying this product creates a membership term on this plan.';
update public.products set membership_plan_slug = '3-month'
 where is_subscription = true and membership_plan_slug is null and title ilike '%3-month%';
