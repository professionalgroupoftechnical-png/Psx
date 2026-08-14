@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js install karo, phir dubara chalao.
  pause
  exit /b 1
)
start "" http://127.0.0.1:8765/psx-dashboard.html
node server.js
pause
