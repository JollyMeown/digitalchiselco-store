-- Re-engagement and sunset for subscribers who never open.
--
-- 2026-09-20: of 2,295 active subscribers, 818 had received 3+ emails in 60
-- days and never once opened one. Mailing them forever costs quota and, worse,
-- drags the whole domain's reputation down, which is what pushes the emails
-- real customers want into spam. They now get two honest "still want these?"
-- emails, then marketing stops for them (suppressed_at), while anything they
-- ask for themselves (downloads, receipts, sign-in links) still sends.
alter table public.subscribers add column if not exists reengage_stage   smallint not null default 0;
alter table public.subscribers add column if not exists reengage_sent_at timestamptz;
alter table public.subscribers add column if not exists sunset_at        timestamptz;   -- marketing stopped on this date
create index if not exists subscribers_reengage_idx on public.subscribers (reengage_stage, reengage_sent_at);

-- Toggles for the two new nightly steps. Both start OFF: the owner sees a test
-- of each email before anything reaches a customer.
alter table public.growth_settings add column if not exists reengage_enabled   boolean not null default false;
alter table public.growth_settings add column if not exists reengage_per_night integer not null default 150;
alter table public.growth_settings add column if not exists midweek_enabled    boolean not null default false;
