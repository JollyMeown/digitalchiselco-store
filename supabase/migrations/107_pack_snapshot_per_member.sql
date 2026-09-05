-- Owner 2026-09-06: when a month's bundle is regenerated, members who already
-- received the old bundle keep it in their account; members who have not yet
-- received that month get the new one. Each pack email therefore records the
-- exact pack it carried (links, title, cover, designs); the tracked pack links
-- and the portal read that snapshot first and fall back to the live row.
alter table public.subscription_email_logs add column if not exists pack_snapshot jsonb;
comment on column public.subscription_email_logs.pack_snapshot is 'The monthly_files row as sent to this member: {title, preview_note, standard_drive_link, bonus_drive_link, cover_image_url, items, bonus_items, captured_at}. Null for welcome/reminder mails and for logs written before 2026-09-06 that the backfill could not resolve.';
create index if not exists subscription_email_logs_sub_month_idx on public.subscription_email_logs (subscription_id, drop_month);
