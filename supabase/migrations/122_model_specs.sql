-- What the file actually IS, measured from the STL itself (customer request
-- 2026-09-11: "I did not get an information PDF about the design. Is there one
-- available?").
--
-- There was no answer to that. The PDF a buyer receives is a download guide: a
-- thank-you note, a button, and more designs. Nothing in it, and nothing on the
-- product page, says how big the model is, how deep it carves, or how heavy the
-- mesh is. Those are the first three questions a maker has before putting a
-- blank on the machine, and every one of them can be read straight out of the
-- file.
--
-- Stored per product rather than computed on demand because the models are
-- 50 to 100 MB each: measuring is a one-off job, on the machine that holds
-- them, not something to repeat per page view.
alter table public.products add column if not exists model_specs jsonb;
comment on column public.products.model_specs is
  'Measured from the STL: {width, height, depth, units, triangles, file_mb, base_flat, measured_at}. Written by scripts/stl_specs.mjs.';
