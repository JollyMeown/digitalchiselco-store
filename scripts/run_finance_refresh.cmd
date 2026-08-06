@echo off
REM Daily finance refresh for the admin dashboard. Runs where the Etsy OAuth
REM token lives (this machine). Schedule via Windows Task Scheduler, like the
REM Cults3D engine. Writes finance_daily + finance_status in Supabase.
cd /d "D:\000 DIGITAL CHISEL WEBSITE"
"C:\Program Files\nodejs\node.exe" scripts\finance_refresh.mjs --months 13 >> finance-refresh.log 2>&1
REM Live Etsy shop stats (sales/rating/reviews/favorites) for the homepage bar + admin Overview
"C:\Program Files\nodejs\node.exe" scripts\etsy_stats_sync.mjs >> finance-refresh.log 2>&1
