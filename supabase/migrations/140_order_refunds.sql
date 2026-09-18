-- Refunds from the admin dashboard.
--
-- The owner never opens Paddle, so a buyer who paid twice (Jerry, Yggdrasil,
-- 2026-09-15, 39 minutes apart) waited days for a refund nobody saw was owed.
-- The admin now lists charges for designs the buyer already owned and refunds
-- them with one button (Paddle adjustment). The webhook still does the final
-- step when Paddle approves: status 'refunded' + that order's entitlements
-- removed (the earlier order's copy of the design stays).
alter table public.orders add column if not exists refund_requested_at   timestamptz;
alter table public.orders add column if not exists refund_adjustment_id  text;
alter table public.orders add column if not exists refund_note           text;
-- "Not a mistake": the owner decided a repeat purchase was intended.
alter table public.orders add column if not exists duplicate_dismissed_at timestamptz;
