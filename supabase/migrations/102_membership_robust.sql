-- Membership system, hardened (owner request 2026-09-05: "implement every
-- feature of the old system, make it robust, with feedback on whether the
-- bundle email was sent and opened, and update the member portal").
--
-- 1) Feedback per email: keep the provider id on the ledger row so opens and
--    clicks (email_events, from the Resend webhook) join back to the exact
--    membership email, and record when a member actually downloaded a pack.
alter table public.subscription_email_logs add column if not exists provider_id text;
alter table public.subscription_email_logs add column if not exists subject text;
create index if not exists sub_email_logs_provider_idx on public.subscription_email_logs (provider_id);
create index if not exists sub_email_logs_sub_idx on public.subscription_email_logs (subscription_id, sent_at desc);

create table if not exists public.pack_downloads (
  id              uuid primary key default gen_random_uuid(),
  subscription_id uuid references public.member_subscriptions(id) on delete cascade,
  email           text,
  month           text not null,                  -- 'YYYY-MM'
  kind            text not null default 'standard',  -- standard | bonus
  via             text,                           -- email | portal
  user_agent      text,
  created_at      timestamptz not null default now()
);
create index if not exists pack_downloads_sub_idx on public.pack_downloads (subscription_id, created_at desc);
create index if not exists pack_downloads_month_idx on public.pack_downloads (month);
alter table public.pack_downloads enable row level security;
do $$ begin
  execute 'drop policy if exists pack_downloads_admin on public.pack_downloads';
  execute 'create policy pack_downloads_admin on public.pack_downloads for all to authenticated using (public.is_admin()) with check (public.is_admin())';
end $$;

-- 2) Richer packs: a cover picture, the designs inside (shown in the email
--    and the portal), and who built it (BRS pack builder writes these).
alter table public.monthly_files add column if not exists cover_image_url text;
alter table public.monthly_files add column if not exists items           jsonb not null default '[]'::jsonb;  -- [{title, slug, image_url}]
alter table public.monthly_files add column if not exists file_count      integer;
alter table public.monthly_files add column if not exists zip_size_mb     numeric;
alter table public.monthly_files add column if not exists built_by        text;      -- 'manual' | 'brs'
alter table public.monthly_files add column if not exists notes           text;

-- 3) Terms: renewal chaining and admin bookkeeping.
alter table public.member_subscriptions add column if not exists renewed_from   uuid references public.member_subscriptions(id) on delete set null;
alter table public.member_subscriptions add column if not exists renewed_to     uuid references public.member_subscriptions(id) on delete set null;
alter table public.member_subscriptions add column if not exists last_email_at  timestamptz;
alter table public.member_subscriptions add column if not exists last_download_at timestamptz;
alter table public.member_subscriptions add column if not exists admin_notes    text;

-- 4) Owner-editable behaviour (Admin > Automations).
alter table public.growth_settings add column if not exists membership_reminder_days text not null default '10,3';   -- days before end_date
alter table public.growth_settings add column if not exists membership_winback_days  integer not null default 14;   -- days after expiry
alter table public.growth_settings add column if not exists membership_winback_coupon text not null default 'COMEBACK15';
alter table public.growth_settings add column if not exists membership_pack_alert_days integer not null default 7; -- warn owner this many days before a month whose pack is missing
alter table public.growth_settings add column if not exists membership_last_alert_at timestamptz;

comment on table public.pack_downloads is 'Every click on a tracked pack link (email or portal). The "did they actually get it" signal.';
comment on column public.subscription_email_logs.provider_id is 'Resend email id; joins email_events for delivered/opened/clicked.';
