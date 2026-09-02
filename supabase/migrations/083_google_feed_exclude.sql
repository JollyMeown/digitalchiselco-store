-- Some designs can never be approved by Google no matter how good the feed is:
-- their weapons policy disallows firearm imagery, which covers our hunting
-- scenes with rifles and scopes. Keeping them in the feed just accrues policy
-- violations against the account, so they are excluded from Google only. They
-- remain on the website, Etsy, Cults and Pinterest, which allow them.
alter table public.products add column if not exists google_feed_excluded boolean not null default false;
comment on column public.products.google_feed_excluded is 'Excluded from google-feed.xml only (Google policy). Still sold everywhere else.';
