-- Cults3D upload tracking, so the daily cloud job (GitHub Actions) is stateless
-- and never re-uploads a product (Cults3D has no delete — duplicates would be permanent).
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS cults3d_url text,
  ADD COLUMN IF NOT EXISTS cults3d_uploaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS cults3d_file_name text; -- real Drive filename (with extension) for the file URL hint

CREATE INDEX IF NOT EXISTS idx_products_cults3d_uploaded_at ON public.products (cults3d_uploaded_at);
