-- One link that delivers a whole Drive folder (owner 2026-09-10, after a
-- customer could not get the files out of a shared folder).
--
-- Google Drive has no folder-level download URL. Its own "download folder"
-- button zips server-side, which fails or splits on a folder of this size
-- (1 GB), and it is buried in a UI the customer has to understand first. So the
-- single link is one of ours: a page that lists every file with its own
-- one-click download, plus a button that starts them all in turn.
--
-- The files themselves stay on Drive. Nothing is copied, re-hosted or streamed
-- through our functions, which is the same rule the bundle ZIP endpoint follows
-- so a busy delivery can never eat the site's bandwidth.
create table if not exists public.folder_deliveries (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,              -- the short word in the public URL
  title text not null,
  folder_id text,                         -- the Drive folder it was built from
  files jsonb not null default '[]'::jsonb, -- [{id, name, size}]
  note text,                              -- shown to the customer, optional
  active boolean not null default true,
  opened_count integer not null default 0,
  last_opened_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists folder_deliveries_code_idx on public.folder_deliveries (code) where active;

alter table public.folder_deliveries enable row level security;
-- Anyone with the link may read an active delivery: the link IS the credential,
-- exactly like the Drive share link the customer already holds, and the files
-- are ones they have paid for.
drop policy if exists "folder_deliveries_public_read" on public.folder_deliveries;
create policy "folder_deliveries_public_read" on public.folder_deliveries for select using (active);
drop policy if exists "folder_deliveries_admin" on public.folder_deliveries;
create policy "folder_deliveries_admin" on public.folder_deliveries for all using (is_admin()) with check (is_admin());
