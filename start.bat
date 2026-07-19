@echo off
setlocal
set "ROOT=%~dp0"
cd /d "%ROOT%"

if not exist "node_modules" call npm install
call npm run build
if errorlevel 1 pause & exit /b 1

start "Watch Together Server" cmd /k "cd /d ""%ROOT%"" && npm run dev:server"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$deadline=(Get-Date).AddSeconds(30); do { try { $response=Invoke-RestMethod -Uri 'http://127.0.0.1:8787/readyz' -TimeoutSec 2; if ($response.status -eq 'ok' -and $response.version -eq '0.2.0') { exit 0 } } catch { Write-Verbose $_ }; Start-Sleep -Milliseconds 500 } while ((Get-Date) -lt $deadline); exit 1"
if errorlevel 1 (
  echo Signaling server did not become ready on http://127.0.0.1:8787.
  echo Check the server window for a port conflict or startup error, then run this file again.
  exit /b 1
)
start "" "http://localhost:8787"
echo Watch Together started at http://localhost:8787
exit /b 0
