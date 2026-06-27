-- audit_status is written by scripts/audit_download_filenames.mjs on every
-- run, marking rows as 'auto_ok' (passed all heuristic checks) or 'flagged'
-- (needs human eyes). Admin Products list pairs it with verified_at to show
-- two distinct badges: blue for auto_ok-but-not-yet-confirmed, green for
-- manually-verified.
alter table public.product_downloads
  add column if not exists audit_status text;

create index if not exists idx_product_downloads_audit_status
  on public.product_downloads(audit_status);
