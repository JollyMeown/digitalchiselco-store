-- One staged group photo per collection (2026-09-03).
--
-- The themed Pin used to be a 2x2 grid of separate product photos, which reads
-- as a contact sheet. scripts/gen_theme_mockups.mjs sends the four best on-theme
-- designs to Gemini together and asks for ONE interior scene containing those
-- exact pieces, which is far more attractive in a Pinterest feed.
alter table public.categories
  add column if not exists mockup_url text,
  add column if not exists mockup_at timestamptz;
