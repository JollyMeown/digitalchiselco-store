# 2026-09-04 — Film email per film, and YouTube Shorts in Admin

Two changes to this repo, both driven from BRS (Bundle Relief Studio) on the
owner's machine. Neither adds a secret to Netlify.

Commits: `1a3b989`, `87f0154`.
Migrations: `093_showcase_video_email.sql`, `094_youtube_stats.sql` — **both applied
to the live database**.

---

## 1. The film email was hardcoded to the Highland cow

### What was wrong

`filmEmail()` in `src/lib/marketing-emails.ts` opened **every** film email with:

> "We made a little film. 31 seconds, no sales pitch, just a Highland cow, a lot
> of oak and one very patient wife."

and defaulted `runtime` to `'31 seconds'`.

That copy was written for one film and then sent for all of them. A test send for
the *Our Lady of Perpetual Help* film carried the Highland cow line underneath a
picture of the Blessed Virgin, and claimed 31 seconds for a 19-second film. For a
devotional subject that is not a cosmetic bug.

### What changed

The opener, the subject and the runtime now travel **with the film** instead of
living in the template.

**`093_showcase_video_email.sql`** adds to `showcase_videos`:

| column | purpose |
|---|---|
| `email_intro` | the 1–2 sentence opener, written per film |
| `email_subject` | overrides the generated subject line |
| `runtime_seconds` | the true length, so the email never claims a runtime it does not have |

The migration also backfills the original Highland cow sentence onto the Highland
cow film, so that film keeps the copy it was written for.

**`src/lib/marketing-emails.ts`**
- `filmEmail()` takes a new optional `intro`.
- `runtime` no longer defaults to `'31 seconds'`. With no runtime known, the
  subject reads "a new short film" and the "▶ 31 seconds ·" line drops the number
  rather than inventing one.
- The fallback opener is neutral and film-agnostic.
- The plain-text half now carries the intro too.

**`src/pages/api/admin/send-film.ts`**
- Selects the three new columns and passes `intro`, `runtime` and
  `email_subject` through to `filmEmail()`.
- `loadFilm()` tries the full column list and **falls back to the base columns**
  if migration 093 has not been applied, so the endpoint keeps working whichever
  lands first.

### Who writes the copy

BRS writes it when it publishes a film (`_film_email_copy()`), in a register that
matches the story's tone — reverent, lesson, anecdote, duet or plain — and never
uses em dashes. The admin can edit it in Admin → Media → Sawdust Cinema before
sending. Example for Our Lady:

> **Subject:** 🎬 The Mother's Protection, a new short film
> **Opener:** A plain board, and then somebody cut this face into it. 19 seconds,
> quiet, no sales pitch. Just the carving and the light moving across it.

### Note for whoever sends next

The email's poster and button both link to the **product page**, which renders the
film itself (`product/[slug].astro` reads `showcase_videos`), so "tap the picture
to watch" is honest.

Sending is deduped **per film id**. Replacing a film in place keeps its id, so
anyone who received the old version will not receive the replacement. BRS says so
when that happens, and can publish as a new film instead.

---

## 2. YouTube Shorts performance in Admin

### Why the site does not call YouTube

The OAuth refresh token lives in BRS on the owner's machine. It is a
channel-management token: it can create and delete playlists, and edit or delete
videos. That is a far bigger key than anything else this site holds, so it stays
out of Netlify.

So the split is the same one the finance and Cults panels use: **BRS pulls the
numbers and writes them here; the site only reads.**

### What changed

**`094_youtube_stats.sql`**

- `youtube_stats` — one row per video: title, description, thumbnail, duration,
  published date, privacy, views, likes, comments, `product_id`, `synced_at`.
- `youtube_stats_daily` — one row per video per day, so the panel can show a
  trend rather than a snapshot.
- Both admin-only under RLS (`public.is_admin()`).

**`src/components/admin/tabs/Shorts.tsx`** (new) — the ▶ YouTube Shorts tab.
Channel totals (live, drafts, views, likes, comments), then a card per video with
thumbnail, live/draft badge, counts, views gained since the first snapshot held,
and a link to that video's YouTube analytics. Shows when BRS last synced.

**`src/components/admin/AdminApp.tsx`** — registers the tab after Cults3D Sales.

### How each Short is tied to a product

By the **product URL in the Short's own description**, which BRS puts there. Two
earlier approaches failed and are worth not repeating:

1. Matching the film's title against the video title — fails as soon as they
   differ, which is normal: the Short is titled for search, the film for story.
2. Loading the whole `products` table and matching in memory — silently missed
   anything past PostgREST's row cap, so one Short linked and the other did not.

Slugs are now looked up individually.

### Update interval

BRS syncs:

- automatically **after every upload**,
- automatically **every 3 hours** while BRS is running,
- on demand via **📊 Sync stats** in the Video Studio panel.

If BRS is closed, the numbers hold still. The panel shows how long ago it synced,
so stale data is visible rather than silently wrong. Quota cost is a couple of
units per sync against a 10,000/day allowance.

---

## 3. Deep analytics: why a Short stalled (added 2026-09-05)

`098_youtube_analytics.sql` adds `youtube_analytics`, one row per public Short from
the **YouTube Analytics API** (not the Data API): engaged views (chose to watch
rather than swipe), average percentage viewed, the retention curve, traffic
sources, countries, day-by-day views, the second at which half the audience is
gone, and a written **verdict** that applies the Shorts playbook (hook problem /
story problem / ending problem / not served in the feed).

BRS pulls it in the same 3-hourly sync and on demand (`/api/video/youtube-deep`).
The Analytics API finalises data two to three days late, so a fresh upload shows
"waiting for YouTube to finalise" in Admin until then; realtime counts stay in
`youtube_stats`.

`Shorts.tsx` renders a `DeepRow` under each video: engaged %, watched %, exit
second, top traffic sources, a small retention bar chart and the verdict.

Required once on the Google Cloud project that owns the OAuth client: **enable
the YouTube Analytics API** (done 2026-09-05).

## Still open

- `cults3d-retag.log` sits untracked in the repo root. It looks like a stray log
  and probably belongs in `.gitignore`.
- The channel is not yet phone-verified for **clickable description links**
  (resolved later the same day — advanced features unlocked).
