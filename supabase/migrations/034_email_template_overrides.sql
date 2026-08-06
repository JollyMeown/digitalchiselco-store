-- Owner-editable overrides for the automation email templates. A row overrides
-- only the fields that are set; anything null falls back to the built-in
-- template. Edited + saved from Admin -> Automations.
create table if not exists email_template_overrides (
  kind       text primary key,   -- drip1..drip5 | cart | review7 | arrivals30 | loyalty
  subject    text,
  heading    text,
  body_html  text,               -- replaces the inner body; brand shell + logo + unsubscribe stay
  updated_at timestamptz not null default now()
);
alter table email_template_overrides enable row level security;
drop policy if exists "admin all email_template_overrides" on email_template_overrides;
create policy "admin all email_template_overrides" on email_template_overrides
  for all to authenticated using (is_admin()) with check (is_admin());
