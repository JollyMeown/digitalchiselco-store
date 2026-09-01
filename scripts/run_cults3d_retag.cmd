@echo off
REM Local Cults3D tag refresh — run by Windows Task Scheduler ONCE per day.
REM Rewrites tagNames on 20 existing listings (oldest-refreshed first), so the
REM whole catalogue of ~884 listings cycles roughly every six weeks.
REM
REM Why local: Cults' Cloudflare serves 403s to shared cloud IPs; the home
REM residential IP works. Same reason the uploader runs here.
REM Why it matters: Cults' co-founder confirmed AI-labelled designs are filtered
REM out of default search, so keywords are the main remaining lever.
cd /d "D:\000 DIGITAL CHISEL WEBSITE"
echo. >> cults3d-retag.log
echo ==== %DATE% %TIME% ==== >> cults3d-retag.log
"C:\Program Files\nodejs\node.exe" scripts\cults3d_retag.mjs --limit 20 >> cults3d-retag.log 2>&1
