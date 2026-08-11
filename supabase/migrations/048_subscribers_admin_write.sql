-- Admin write access on subscribers.
-- 002 only granted admins SELECT; the admin Subscribers tab writes with the
-- browser client, so Add hit "new row violates row-level security policy"
-- and Edit/Delete silently matched 0 rows. Public inserts still go through
-- the server-side service_role route (api/subscribe) — no anon write here.
drop policy if exists "admin write subscribers" on subscribers;
create policy "admin write subscribers" on subscribers
  for all to authenticated
  using (is_admin()) with check (is_admin());
