@echo off
title ryuk verify
cd /d "%~dp0"
if not exist .env (
  echo .env fehlt. Erst .env.example kopieren und ausfuellen.
  pause
  exit /b 1
)
node --env-file=.env verify.mjs
echo.
echo Bot beendet.
pause
