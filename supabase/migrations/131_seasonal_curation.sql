-- Hand-curation on top of the automatic seasonal matches (owner, 2026-09-15:
-- "can we edit the selected products, remove/add, in that seasonal section").
-- Keywords still fill the collection; these two lists override them:
--   include_ids  always in, shown first, even if no keyword matches
--   exclude_ids  never in, even if a keyword matches
alter table public.seasonal_collections
  add column if not exists include_ids uuid[] not null default '{}',
  add column if not exists exclude_ids uuid[] not null default '{}';
