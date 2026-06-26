-- Blog post storage. Drives /blog (index) and /blog/[slug].
-- Public can read only 'published' posts; admin (via service_role) writes.

create table if not exists posts (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique,
  title           text not null,
  excerpt         text,
  body            text not null,                  -- HTML; rendered with set:html in the Astro page
  cover_image_url text,
  author          text default 'DigitalChiselCo',
  status          text not null default 'draft',  -- 'draft' | 'published'
  published_at    timestamptz,
  seo_title       text,
  seo_description text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index if not exists posts_status_published_idx on posts(status, published_at desc);
create index if not exists posts_slug_idx on posts(slug);

alter table posts enable row level security;

-- Anonymous + authenticated can read published posts only
drop policy if exists posts_public_read on posts;
create policy posts_public_read on posts
  for select
  to anon, authenticated
  using (status = 'published');

-- Service role (server-side admin operations) can do everything; no public-facing
-- write policies needed because the admin SPA writes through service_role.
