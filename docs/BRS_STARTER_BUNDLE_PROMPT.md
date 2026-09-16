# Prompt to give BRS

Copy everything between the lines into BRS.

---

Build a **Starter Bundle** for the website. It is not a membership month. It is
a one-off pack of **6 designs** sold for $6.99 through an emailed offer, to
people who have bought little or nothing from us yet.

Use the Membership Pack Builder pipeline you already have, with these changes.

**How many, and which six**

- Six designs, not eight.
- Six different subject areas. Spread them, for example wildlife, faith,
  western, floral, pets, patriotic. The person opening this has probably never
  bought from us, so the bundle has to show range.
- Mid-tier sellers only. Do **not** use the shop's top organic sellers: those
  already earn on their own and must not be given away at this price.
- Nothing that is already inside a Premium bundle.
- Nothing that is in the five free files on the free-pack Drive folder.
  Somebody who took the free pack and then pays $6.99 must not receive a design
  they already have.
- Same link check as a monthly pack. Every file verified before approval.
- Record these six as used, exactly as you do for a monthly pack, so no future
  membership month repeats them. A starter buyer who upgrades must never get
  the same design twice.

**Where it goes on the website**

The same Supabase upsert you already use for a monthly pack:

```
POST /rest/v1/monthly_files?on_conflict=month
```

but with the month set to the sentinel below. That value is what marks it as
the starter bundle, and the website routes every starter purchase to it.

| field | value |
|---|---|
| `month` | `0001-01` exactly. Not a real date. Do not change it. |
| `title` | `Starter Bundle` |
| `file_count` | `6` |
| `items` | 6 entries of `{title, slug, image_url}`, same shape as a monthly pack |
| `cover_image_url` | grid cover uploaded to `site-media/membership/starter/cover.jpg` |
| `standard_drive_link` | the branded download **PDF**, not the zip |
| `admin_zip_link` | the zip with pictures plus PDF |
| `built_by` | `brs` |
| `bonus_drive_link` | leave empty. The starter has no bonus tier. |
| `bonus_items` | leave empty |

Drive folder: `Membership/starter`, alongside the monthly folders.

**Rules that must hold**

- Never write a real month (`2026-09` and so on) while building this. The
  member months are separate and must not be touched.
- The website refuses to sell the bundle until `standard_drive_link` is filled,
  so approve only when the PDF link is real and tested.
- Draft first, then let me review, then approve. Do not publish straight to
  live.

**When you are done**

Tell me the six design titles and the two links, and notify the website the
usual way.

---
