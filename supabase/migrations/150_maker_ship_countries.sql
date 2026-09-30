-- Cut Local: which other countries a maker ships to (2026-09-30).
--
-- The first real buyer request came from Magog, Quebec. The only switch a
-- maker had was "I ship internationally", which none of the 22 approved makers
-- ticked, so no US maker was told about it, although several ship across their
-- own country and sit within a day's drive of the border. A short list of
-- countries is a question a maker can actually answer ("would you ship to
-- Canada?"). Codes: US, CA, MX, GB, IE, AU (see SHIP_COUNTRY_CHOICES in
-- src/lib/maker-reach.ts, which cleans every write).
--
-- New COLUMN on an existing table: the table's grants and RLS already cover it.
alter table public.makers add column if not exists ship_countries text[] not null default '{}'::text[];
comment on column public.makers.ship_countries is 'Other countries this maker ships to, as codes (US, CA, MX, GB, IE, AU). Written by /api/maker-apply and /api/mp/profile.';
