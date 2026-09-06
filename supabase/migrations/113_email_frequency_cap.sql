-- Owner 2026-09-06: make email marketing effective. Audit found 348 people
-- receiving 8.5 marketing emails a month on average (max 37), 11 unsubscribes
-- in 30 days. Broadcast-type emails (weekly digest, film/guide campaigns,
-- maker recruit, win-back, browse, price drop, wishlist, referral nudge) now
-- yield when a person has already had this many marketing emails in the last
-- 7 days. Transactional mail, membership mail and onboarding drips are never
-- held back (drips count toward the cap so broadcasts make room for them).
alter table public.growth_settings add column if not exists email_max_per_week integer not null default 4;
comment on column public.growth_settings.email_max_per_week is 'Max marketing emails one person receives in any 7 days; broadcasts skip them beyond this. 0 = no cap.';
