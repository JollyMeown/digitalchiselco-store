-- Proposed corrections for a product whose download link points at the wrong
-- file (owner 2026-09-10, after the download check found designs sharing one
-- file: "ETSY is my Master File where everything is fine").
--
-- The suggestion is computed on the owner's machine, because the two sources of
-- truth both live there: the full Google Drive index (4 MB, far too large to
-- ship inside a serverless function) and the Etsy OAuth token. The website only
-- displays what was proposed and waits for the owner to press Save. Nothing
-- here changes a live link by itself, which is the standing rule.
create table if not exists public.download_link_suggestions (
  product_id uuid primary key references public.products(id) on delete cascade,
  suggested_link text not null,
  suggested_name text,                    -- the Drive file's own name
  current_link text,                      -- what the product had when proposed
  source text not null default 'drive',   -- 'drive' | 'etsy'
  score numeric(4,2),                     -- how well the file name fits the title
  note text,
  created_at timestamptz not null default now()
);
alter table public.download_link_suggestions enable row level security;
drop policy if exists "download_link_suggestions_admin" on public.download_link_suggestions;
create policy "download_link_suggestions_admin" on public.download_link_suggestions
  for all using (is_admin()) with check (is_admin());
