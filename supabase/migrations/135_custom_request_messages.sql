-- The full correspondence for each custom design request.
--
-- Owner, 2026-09-16: "where to see the record of the quote and correspondence".
-- The request row only kept the LAST reply (reply_body), so when the owner
-- sent Brano two replies three minutes apart, the first one's wording was lost
-- from the site. Every message now gets its own row, in order.
--
--   direction  'in'  = from the customer (the original request, or a reply the
--                      owner pastes in, since customer replies arrive in the
--                      owner's own inbox)
--              'out' = from us (the automatic confirmation, and every reply
--                      sent from Admin > Custom Requests)
--   provider_id links an outgoing message to its delivery events
--   (email_events: delivered / opened / clicked).
create table if not exists public.custom_request_messages (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references public.custom_design_requests(id) on delete cascade,
  direction    text not null check (direction in ('in', 'out')),
  kind         text not null default 'message',   -- request | confirmation | reply | customer_reply | note
  body         text,
  images       jsonb not null default '[]'::jsonb,
  quote_usd    numeric(10,2),
  subject      text,
  provider_id  text,
  created_at   timestamptz not null default now(),
  created_by   text
);
create index if not exists custom_request_messages_request_idx
  on public.custom_request_messages (request_id, created_at);

alter table public.custom_request_messages enable row level security;
drop policy if exists "custom_request_messages_admin_all" on public.custom_request_messages;
create policy "custom_request_messages_admin_all" on public.custom_request_messages
  for all using (public.is_admin()) with check (public.is_admin());
