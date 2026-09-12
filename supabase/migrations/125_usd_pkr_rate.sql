-- The rupee-to-dollar rate the ads dashboard converts with.
--
-- The Google Ads account bills in PKR and cannot be changed, while every other
-- number in this business (Paddle payouts, Etsy revenue, the breakeven maths) is
-- in USD. One stored rate keeps the comparison honest and, more importantly,
-- visible: a hidden constant buried in code would silently rot as the rate moves.
alter table public.growth_settings add column if not exists usd_pkr_rate numeric(10,2) not null default 280;
comment on column public.growth_settings.usd_pkr_rate is
  'Rupees per US dollar, used to convert Google Ads spend into the currency the rest of the business is measured in. Update when the rate moves materially.';
