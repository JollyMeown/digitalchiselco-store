@echo off
REM Local Cults3D publisher — run by Windows Task Scheduler every 2h.
REM Uses the home/residential IP, which Cults3D's anti-bot does not block
REM (GitHub Actions' shared IPs get intermittent 403s). Idempotent via the DB.
cd /d "D:\000 DIGITAL CHISEL WEBSITE"
echo. >> cults3d-local.log
echo ==== %DATE% %TIME% ==== >> cults3d-local.log
"C:\Program Files\nodejs\node.exe" scripts\cults3d_upload.mjs --apply --limit 2 --visibility PUBLIC >> cults3d-local.log 2>&1
