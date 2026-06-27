-- Track which download links have been manually verified via the audit
-- workbench. Stamped by scripts/apply_download_link_fixes.mjs every time a
-- row passes through the apply step (whether the URL changed or was just
-- re-confirmed as already-correct). The admin Products list uses this to
-- display a "✓ verified" badge so future audits don't redo settled work.
alter table public.product_downloads
  add column if not exists verified_at timestamptz;

create index if not exists idx_product_downloads_verified_at
  on public.product_downloads(verified_at);
