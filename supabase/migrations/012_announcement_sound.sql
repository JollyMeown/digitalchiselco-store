-- Slim announcement strip + admin order-sound notifications
alter table site_settings add column if not exists announcement_font_size int default 13;     -- px on desktop
alter table site_settings add column if not exists announcement_speed_seconds int default 35; -- marquee scroll duration
alter table site_settings add column if not exists order_sound_enabled boolean default true;
alter table site_settings add column if not exists order_sound_volume int default 80;         -- 0–100

-- Enable Postgres realtime on orders so the admin can hear new orders live.
do $$ begin
  perform 1 from pg_publication where pubname = 'supabase_realtime';
  if found then
    begin
      execute 'alter publication supabase_realtime add table public.orders';
    exception when duplicate_object then null;
    end;
  end if;
end $$;
