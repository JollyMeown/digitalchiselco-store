-- Pinterest publish tracking, so the Pinterest cloud job (GitHub Actions) is
-- stateless and never re-pins a product. Mirrors the Cults3D tracking pattern
-- (023_cults3d_tracking.sql).
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS pinterest_pin_id text,
  ADD COLUMN IF NOT EXISTS pinterest_posted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_products_pinterest_posted_at ON public.products (pinterest_posted_at);
