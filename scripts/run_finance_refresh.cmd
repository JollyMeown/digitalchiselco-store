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
echo --- finance ledger refresh --- >> finance-refresh.log
"C:\Program Files\nodejs\node.exe" scripts\finance_refresh.mjs --months 13 >> finance-refresh.log 2>&1
echo --- done %time% --- >> finance-refresh.log
