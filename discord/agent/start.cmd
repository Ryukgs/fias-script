@echo off
title ryuk agent
cd /d "%~dp0"
if not exist .env (
  echo .env fehlt. Installer nochmal ausfuehren.
  pause
  exit /b 1
)
node --env-file=.env bot.mjs
echo.
echo Bot beendet.
pause
