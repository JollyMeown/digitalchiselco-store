-- Toggle: show the bulk-discount promo codes on the cart page (admin-controlled).
ALTER TABLE public.site_settings ADD COLUMN IF NOT EXISTS cart_promos_active boolean DEFAULT true;
