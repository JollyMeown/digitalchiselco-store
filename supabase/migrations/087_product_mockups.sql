-- Generated marketing imagery per product (2026-09-03).
--
-- mockup_url: the carving photographed in a room that suits its theme.
-- macro_url:  an extreme close-up of the same carving's surface.
--
-- Both are produced by scripts/gen_product_mockups.mjs, which sends the product
-- HERO to Gemini as a reference with a compositing prompt (same carving, same
-- element counts, only the surroundings change), then stores the result in the
-- site-media bucket. They feed Pinterest art, product pages and listings.
alter table public.products
  add column if not exists mockup_url text,
  add column if not exists macro_url text;
