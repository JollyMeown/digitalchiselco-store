-- Gift memberships.
--
-- The cart already had "this order is a gift", and for designs it delivers to
-- the friend. For a MEMBERSHIP the webhook still created the term for the
-- BUYER, so a gifted membership would have gone to the person paying. Terms
-- now go to the recipient, and remember who gave them so the welcome email
-- can say so. Owner, 2026-09-17: gift memberships for Christmas.
alter table public.member_subscriptions
  add column if not exists gift_from text,          -- the name the giver chose to show
  add column if not exists gift_note text,          -- their message, shown in the welcome email
  add column if not exists gift_buyer_email text;   -- who paid (never shown to the recipient)
