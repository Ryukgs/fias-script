@echo off
title ryuk verify - log
cd /d "%~dp0"
if not exist bot.log (
  echo Noch kein log vorhanden.
  pause
  exit /b 0
)
powershell -NoProfile -Command "Get-Content 'bot.log' -Tail 80 -Wait"
