-- Extra fields for manually-added members (Etsy buyers entered by the admin).
alter table member_subscriptions add column if not exists source text;      -- 'paddle' | 'etsy' | 'manual' | 'import'
alter table member_subscriptions add column if not exists notes text;
alter table member_subscriptions add column if not exists coupon_code text;
