-- Visibility for the per-person frequency cap (migration 113): every time a
-- broadcast skips someone because they already had their weekly share of
-- marketing email, one row lands here. Read by the Email performance card.
create table if not exists public.email_holds (
  id bigserial primary key,
  recipient text not null,
  kind text,
  held_at timestamptz not null default now()
);
create index if not exists email_holds_held_at_idx on public.email_holds (held_at desc);
alter table public.email_holds enable row level security;
drop policy if exists "email_holds_admin_read" on public.email_holds;
create policy "email_holds_admin_read" on public.email_holds for select using (is_admin());
