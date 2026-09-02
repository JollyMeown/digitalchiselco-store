# Etsy weak-listing SEO rewrite

Target: listings with < 20 lifetime views AND 0 sales in the last 365 days (273 on 2026-09-02).
Rule (derived from the shop's own winners vs losers): subject-first title, 13 multi-word
buyer-intent tags (>= 9 name the subject/room/occasion, <= 4 tooling tags).

    node scripts/etsy_seo/etsy_weak.mjs          # rebuild the weak set (views + sales via receipts)
    node scripts/etsy_seo/etsy_fetch_weak.mjs    # pull live title/tags/description for them
    node scripts/etsy_seo/etsy_rewrite.mjs       # generate proposals (Claude; needs ANTHROPIC_API_KEY credit)
    node scripts/etsy_seo/etsy_rewrite_gemini.mjs# same, using the BRS Gemini key
    node scripts/etsy_seo/etsy_apply.mjs --batch b2 --limit 60          # dry run
    node scripts/etsy_seo/etsy_apply.mjs --batch b2 --limit 60 --apply  # live, backed up
    node scripts/etsy_seo/etsy_apply.mjs --revert b1 --apply            # put a batch back

Backups + baselines live in `etsy_seo_experiment`; the readout is Admin > SEO > "Etsy SEO rewrite test".
Etsy rotates refresh tokens: never run two of these at the same time.
