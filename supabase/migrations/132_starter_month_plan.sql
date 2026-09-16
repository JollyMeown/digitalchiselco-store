-- The starter month: a one-month membership used ONLY as an emailed offer.
--
-- Why it is hidden. The public ladder is 3 months $24.99 ($8.33/mo), 6 months
-- $39.99 ($6.67/mo), 12 months Premium $69.99 ($5.83/mo). Putting a cheap
-- single month on the pricing page would cannibalise the $24.99: a visitor who
-- would have paid $24.99 pays $4.99 instead, and 60% of them would have to
-- upgrade later just to break even on that swap.
--
-- So it is gated the same way Premium was before launch: `available_from` in
-- the future keeps it off the public picker (getMembershipPlans filters on it)
-- while checkout by the `membership:starter-month` cart marker still works.
-- It is therefore reachable ONLY through a link we email to a chosen segment,
-- and never to anyone who already has a term.
--
-- Why 6 designs at $6.99 (not free, not $1, not 8 for $4.99):
--   * free would give away the pack paying members bought, and there is
--     already a working free offer at the top of the funnel (the 5-file free
--     pack, 13.2% conversion);
--   * $1 does not cover the payment fee (~5% + $0.50);
--   * the ladder must fall as commitment rises. At $6.99 for 6 the starter is
--     $1.17 a design, above the 3-month plan's $1.04, so upgrading is plainly
--     the better deal. 8 for $4.99 would have been $0.62, cheaper than every
--     plan above it, and would have killed the 3-month;
--   * 6 is one more than the free five, so it reads as a real step up.

-- UPDATED 2026-09-16 to the values actually live. The first version of this
-- file sold the current member month for $4.99. The owner ruled that member
-- packs stay with members, so the starter became its own fixed 6-design
-- bundle at $6.99 (monthly_files month 0001-01). Re-running the old file
-- once silently reset the live plan to $4.99/8; keep this file in step with
-- the database, because it is an upsert and wins whenever it runs.
insert into membership_plans
  (slug, name, months, files_per_month, price_usd, original_price_usd,
   features, active, sort_order, highlight, available_from)
values
  ('starter-month',
   'Starter Bundle: 6 Bas-Relief STL Designs',
   1, 6, 6.99, 38.75,
   '["6 hand-picked bas-relief STL designs, sent straight away",
     "A bundle built for first-timers, not a repeat of the member pack",
     "Commercial use included, sell what you carve",
     "Upgrade whenever you like and we credit the $6.99",
     "One payment, nothing renews, nothing to cancel"]'::jsonb,
   true, 99, false,
   '2099-01-01')          -- far future = never on the public picker
on conflict (slug) do update set
  name = excluded.name,
  months = excluded.months,
  files_per_month = excluded.files_per_month,
  price_usd = excluded.price_usd,
  original_price_usd = excluded.original_price_usd,
  features = excluded.features,
  active = excluded.active,
  available_from = excluded.available_from;

comment on table membership_plans is
  'Membership plans. A row with available_from in the future is hidden from the public picker but still buyable by cart marker (membership:<slug>) - used for emailed-only offers such as starter-month.';
