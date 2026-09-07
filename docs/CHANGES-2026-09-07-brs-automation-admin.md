# Changes 2026-09-06 / 07 — BRS automation meets the website admin

Companion to Bundle Relief Studio's automation round (see `CHANGES-2026-07-12.md` in the BRS project,
round 2026-09-06/07). Commits: beae74e, 7600131, 0ca039d.

## Admin ▸ Automations: BRS automation runs (new card, first on the tab)
- Every finished BRS batch (pipeline or ZBrush night batch) is listed newest first: designs completed,
  total processing time, per-design average; expands to the steps, per-step average/total times, the
  designs that stopped with the reason, the completed list and the report name.
- The structured part comes from the alert's `meta` (BRS sends it); older rows fall back to the text body.
- 🗑 Clear all deletes every automation message in one click; each message has its own delete.
  Admin-only API `POST /api/admin/brs-alerts-clear` (`{}` = all `brs_*` alerts, `{id}` = one), service role,
  never touches sale alerts.
- Live refresh every 30 s (`useLiveRefresh`).

## Sale alerts feed (Admin ▸ Cults3D)
- Shows sales only: `owner_alerts` rows whose kind starts with `brs_` are excluded from the feed.
- `OrderSoundListener`: BRS alerts show a toast with a 🤖 icon but no cha-ching (they are not money).

## `POST /api/admin/brs-notify`
- Accepts an optional `meta` object (≤ 20 KB) and stores it on the `owner_alerts` row as
  `{ source: 'brs', ...meta }`. BRS uses it for batch summaries: computer, bundle, designs, complete,
  steps, failed[{file, design, failed_at, detail}], complete_list, timing{total_h, avg_design_h,
  per_step[...]}, report.

## Admin ▸ Products: which BRS computer uploaded what
- BRS now sets `products.submitted_by` on EVERY upload (pending or not) to the uploading computer's label.
- New filter "🖥 All BRS computers" listing each computer with its product count (plus "no computer
  recorded"); the pending badge shows the computer; non-pending rows get a small 🖥 badge.

## Website uploads from the automation
- The BRS pipeline's website step always publishes as PENDING (`draft: true` → `pending_review`,
  inactive) even from the admin computer — the owner approves in Admin ▸ Products. The hero is picture 1,
  the category comes from the Etsy shop section (learned map / closest name), and the product carries its
  `etsy_listing_id` so the hourly Etsy video hand-over gives it the listing video by itself. The
  deliverable is the FULL branded download PDF (`Website Copy/`), never the Etsy-safe copy.

## Notes
- No schema change: `owner_alerts.meta` (jsonb) and `products.submitted_by` already existed.
- The free-pack opt-in block for PDFs (`docs/PDF_OPTIN_LINK.md` in BRS) is still not implemented.
