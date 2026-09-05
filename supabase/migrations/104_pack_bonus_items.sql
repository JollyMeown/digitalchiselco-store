-- Premium (12-month) members get a bonus bundle each month. The pack row now
-- carries the bonus designs (pictures + titles) so the pack email can show
-- them to Premium members, the portal can list them, and standard members
-- can be told what Premium adds.
alter table public.monthly_files add column if not exists bonus_items jsonb not null default '[]'::jsonb;  -- [{title, slug, image_url}]
alter table public.monthly_files add column if not exists bonus_cover_image_url text;
comment on column public.monthly_files.bonus_items is 'Designs in the Premium bonus bundle. Written by the BRS pack builder.';
