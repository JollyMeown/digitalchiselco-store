-- Search visibility pass, 2026-09-05 (from the first Search Console readout).
--
-- 1) Collections had no copy at all: hidden H1, no intro, "STL STL" titles,
--    and they sit at positions 18 to 22 with impressions and no clicks. Give
--    each one a real title, description, an intro and a small FAQ.
alter table public.categories add column if not exists seo_title       text;
alter table public.categories add column if not exists seo_description text;
alter table public.categories add column if not exists intro_html      text;
alter table public.categories add column if not exists faq             jsonb not null default '[]'::jsonb;
comment on column public.categories.intro_html is 'Editorial intro rendered above the grid (sanitised). Written 2026-09-05 for search visibility.';
comment on column public.categories.faq is '[{q, a}] rendered under the grid and as FAQPage JSON-LD.';

-- 2) Half the site is "not indexed" per Search Console (1,231 vs 1,229). The
--    Pages report has no API, but URL Inspection does (2,000 URLs a day), so
--    the nightly run inspects a slice of the sitemap and keeps the verdicts.
create table if not exists public.gsc_url_status (
  url               text primary key,
  verdict           text,          -- PASS / NEUTRAL / FAIL / VERDICT_UNSPECIFIED
  coverage_state    text,          -- Google's sentence, e.g. "Crawled - currently not indexed"
  indexing_state    text,          -- INDEXING_ALLOWED / BLOCKED_BY_META_TAG ...
  robots_txt_state  text,
  page_fetch_state  text,
  google_canonical  text,
  user_canonical    text,
  last_crawl        timestamptz,
  crawled_as        text,
  rich_results      text,          -- verdict of the rich results test, when returned
  inspected_at      timestamptz not null default now()
);
alter table public.gsc_url_status enable row level security;
do $$ begin
  execute 'drop policy if exists gsc_url_status_admin on public.gsc_url_status';
  execute 'create policy gsc_url_status_admin on public.gsc_url_status for all to authenticated using (public.is_admin()) with check (public.is_admin())';
end $$;
create index if not exists gsc_url_status_inspected_idx on public.gsc_url_status (inspected_at);
create index if not exists gsc_url_status_coverage_idx on public.gsc_url_status (coverage_state);
comment on table public.gsc_url_status is 'Search Console URL Inspection verdict per sitemap URL. Filled by the nightly run (a slice a night) and the admin "Audit now" button.';
