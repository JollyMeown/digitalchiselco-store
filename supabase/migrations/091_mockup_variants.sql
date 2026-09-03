-- Two staging variants per product, so Pinterest can decide which sells (2026-09-03).
--
-- Variant A is always the gift box. Variant B is the golden stand for panels and
-- the food styling for trays, because a tray on a stand is not a thing. Each
-- variant is reviewed and approved separately, and each is published as its own
-- Pin with its own campaign tag, so the click data says which staging works.
alter table public.products
  add column if not exists mockup_style text,
  add column if not exists mockup_b_url text,
  add column if not exists mockup_b_style text,
  add column if not exists mockup_b_status text not null default 'pending',
  -- set when the image has been pushed to the Etsy listing as an extra photo,
  -- so the push job never uploads the same image twice
  add column if not exists mockup_etsy_at timestamptz;
