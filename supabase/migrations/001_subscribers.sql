-- Email subscribers (free STL pack lead magnet)
create table if not exists subscribers (
  id         uuid primary key default gen_random_uuid(),
  email      text unique not null,
  source     text default 'free-pack',
  created_at timestamptz default now()
);
alter table subscribers enable row level security;
-- No public read/insert. Inserts happen server-side via the service_role key (api/subscribe).
