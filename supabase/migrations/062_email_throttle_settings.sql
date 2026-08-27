-- 062: admin-controllable email throttle (daily cap + buyer reserve).
--
-- Until now the daily send cap and the buyer-email reserve lived only in
-- Netlify env vars, so the owner could not tune them without a redeploy — and
-- a too-low cap silently throttled the weekly digest. These columns move both
-- into growth_settings (id=1, already admin-writable) so the admin UI can edit
-- them live. resend.ts reads these (env vars remain an override/fallback).
--
--   email_daily_cap     : max emails/day the site will send (keep under the
--                         real Resend plan limit; ~200/day observed working).
--   email_daily_reserve : of that cap, how many to hold back for buyer emails
--                         (order confirmations, sign-in links) so a big
--                         marketing send can never starve a paying customer.
alter table public.growth_settings
  add column if not exists email_daily_cap integer not null default 180,
  add column if not exists email_daily_reserve integer not null default 20;

-- Keep them sane: reserve can never exceed the cap.
update public.growth_settings
  set email_daily_reserve = least(email_daily_reserve, email_daily_cap)
  where id = 1;
