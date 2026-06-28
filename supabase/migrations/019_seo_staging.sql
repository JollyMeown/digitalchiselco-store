-- SEO rewrite staging + review workflow.
--
-- Generated copy lands in proposed_* columns with seo_status='generated'.
-- The admin SEO Review tab shows current vs proposed side by side; on Approve
-- the proposed_* values promote into the live columns (title, seo_title,
-- seo_description, description, image_alt) and seo_status flips to 'approved'.
-- Nothing the generator writes is ever shown to customers until approved.
--
-- original_title backs up the pre-SEO title once, so any approval is reversible.

alter table public.products
  add column if not exists seo_status text not null default 'pending',  -- pending | generated | approved | rejected
  add column if not exists original_title text,
  add column if not exists image_alt text,
  add column if not exists seo_keywords jsonb,
  add column if not exists proposed_title text,
  add column if not exists proposed_seo_title text,
  add column if not exists proposed_seo_description text,
  add column if not exists proposed_body text,
  add column if not exists proposed_alt_text text,
  add column if not exists seo_generated_at timestamptz,
  add column if not exists seo_reviewed_at timestamptz;

create index if not exists idx_products_seo_status on public.products(seo_status);
