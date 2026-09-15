-- The maker-portfolio bucket, in code.
--
-- Until now this bucket existed only because someone clicked it into the
-- Supabase dashboard: no migration created it, and its limits and policies
-- could not be reviewed, restored or reasoned about from the repository. The
-- 2026-09-14 maker-photo failure (HEIC refused, 6 MB cap) was hidden in that
-- dashboard-only configuration. This records the intended state so a fresh
-- project, or a review, sees the same thing production runs.
--
-- Public read: the URLs are rendered straight into <img> on /makers and
-- /m/<id>. Writes go only through the service role in /api/maker-upload
-- (token-gated, rate-limited, resized), never from the browser.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('maker-portfolio', 'maker-portfolio', true, 12582912, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- anyone may read; nobody but the service role may write
drop policy if exists "maker-portfolio public read" on storage.objects;
create policy "maker-portfolio public read"
  on storage.objects for select
  using (bucket_id = 'maker-portfolio');
