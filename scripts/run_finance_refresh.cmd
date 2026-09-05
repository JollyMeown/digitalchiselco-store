@echo off
REM Daily refresh for the website + admin dashboard. Runs where the Etsy OAuth
REM token lives (this machine). Scheduled via Windows Task Scheduler.
REM ORDER MATTERS: the quick Etsy shop-stats sync runs FIRST so the homepage
REM numbers (sales / rating / reviews / favorites) always update even if the
REM heavier finance ledger pull is slow. Timestamped markers aid diagnosis.
cd /d "D:\000 DIGITAL CHISEL WEBSITE"
echo ===== run %date% %time% ===== >> finance-refresh.log
echo --- etsy shop stats --- >> finance-refresh.log
"C:\Program Files\nodejs\node.exe" scripts\etsy_stats_sync.mjs >> finance-refresh.log 2>&1
echo --- link etsy reviews to products (powers star snippets) --- >> finance-refresh.log
"C:\Program Files\nodejs\node.exe" scripts\link_etsy_reviews.mjs --apply >> finance-refresh.log 2>&1
echo --- recompute per-product rating badges --- >> finance-refresh.log
"C:\Program Files\nodejs\node.exe" scripts\recompute_ratings.mjs >> finance-refresh.log 2>&1
echo --- link BRS-published products to their Etsy listings by title + fetch videos (API key only, both shops) --- >> finance-refresh.log
"C:\Program Files\nodejs\node.exe" scripts\etsy_link_videos.mjs >> finance-refresh.log 2>&1
echo --- pull etsy videos for new products (missing only) --- >> finance-refresh.log
"C:\Program Files\nodejs\node.exe" scripts\pull_etsy_videos.mjs >> finance-refresh.log 2>&1
echo --- etsy per-listing stats (views/favorers for Design Scout) --- >> finance-refresh.log
"C:\Program Files\nodejs\node.exe" scripts\etsy_listing_stats_sync.mjs >> finance-refresh.log 2>&1
echo --- etsy SEO rewrite: after-snapshot (views/favs/sales per rewritten listing) --- >> finance-refresh.log
"C:\Program Files\nodejs\node.exe" scripts\etsy_seo\etsy_seo_progress.mjs >> finance-refresh.log 2>&1
echo --- finance ledger refresh --- >> finance-refresh.log
"C:\Program Files\nodejs\node.exe" scripts\finance_refresh.mjs --months 13 >> finance-refresh.log 2>&1
echo --- done %time% --- >> finance-refresh.log
