-- Keep every replaced pack link (owner 2026-09-06: BRS rebuilds October 2026
-- to February 2027; the old Drive links must be kept, not deleted). A trigger
-- archives the previous standard/bonus links whenever either changes, so it
-- works for BRS's REST upsert and the admin form alike.
alter table public.monthly_files add column if not exists link_history jsonb not null default '[]'::jsonb;
comment on column public.monthly_files.link_history is '[{standard_drive_link, bonus_drive_link, title, built_by, replaced_at}] every earlier set of links, newest last.';

create or replace function public.monthly_files_archive_links() returns trigger language plpgsql as $$
begin
  if (old.standard_drive_link is distinct from new.standard_drive_link and old.standard_drive_link is not null)
     or (old.bonus_drive_link is distinct from new.bonus_drive_link and old.bonus_drive_link is not null) then
    new.link_history := coalesce(old.link_history, '[]'::jsonb) || jsonb_build_object(
      'standard_drive_link', old.standard_drive_link,
      'bonus_drive_link', old.bonus_drive_link,
      'title', old.title,
      'built_by', old.built_by,
      'replaced_at', now()
    );
  end if;
  return new;
end $$;

drop trigger if exists monthly_files_archive_links on public.monthly_files;
create trigger monthly_files_archive_links before update on public.monthly_files
  for each row execute function public.monthly_files_archive_links();
