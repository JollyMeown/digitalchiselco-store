-- Persist the customer's name on orders. The Paddle webhook already fetches
-- it via /customers/{id}; we just weren't storing it. Used in the admin
-- Membership tab to show who bought a membership.

alter table orders
  add column if not exists customer_name text;
