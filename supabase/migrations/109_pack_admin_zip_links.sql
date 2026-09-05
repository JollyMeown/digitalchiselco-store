-- Owner 2026-09-06: members' download buttons (email + portal) deliver the
-- branded PDF only (standard_drive_link / bonus_drive_link). The full ZIP
-- (every design picture + the PDF) is admin-only, shown as a button in
-- Admin > Membership > Monthly packs. BRS writes both.
alter table public.monthly_files add column if not exists admin_zip_link text;
alter table public.monthly_files add column if not exists bonus_zip_link text;
comment on column public.monthly_files.standard_drive_link is 'MEMBER download: direct link to the branded pack PDF only (never a zip/folder).';
comment on column public.monthly_files.bonus_drive_link is 'MEMBER download (Premium): direct link to the bonus PDF only.';
comment on column public.monthly_files.admin_zip_link is 'ADMIN only: zip with every design picture + the pack PDF. Never sent to members.';
comment on column public.monthly_files.bonus_zip_link is 'ADMIN only: zip with the bonus pictures + bonus PDF. Never sent to members.';
