-- An opaque, stored token for the free-pack link.
--
-- The first version signed the link with an HMAC over an env-var secret. In
-- production the SAME deployment signed a token at 15:19:25 and then refused
-- it at 15:32, so the two functions were resolving that secret differently
-- (SUBSCRIBE_TOKEN_SECRET falls back to SUPABASE_SERVICE_ROLE_KEY, and which
-- one is visible depends on how the variable is scoped in Netlify). That is not
-- something the code can see or assert, and a link that silently stops
-- verifying is exactly the failure this whole feature exists to end.
--
-- A random token stored on the row has no such dependency: the link is valid
-- because the database says so. It also survives a secret rotation, and can be
-- revoked per person by nulling the column.
alter table public.subscribers
  add column if not exists free_pack_token text;

create unique index if not exists subscribers_free_pack_token_idx
  on public.subscribers (free_pack_token)
  where free_pack_token is not null;
