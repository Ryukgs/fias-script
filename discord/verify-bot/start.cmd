@echo off
title ryuk verify
cd /d "%~dp0"

set "TOKENFILE=%USERPROFILE%\Documents\discord-token.txt"
if not exist "%TOKENFILE%" (
  echo Token-Datei fehlt: %TOKENFILE%
  echo Datei anlegen und nur den Bot-Token hineinschreiben.
  pause
  exit /b 1
)

set "DISCORD_TOKEN="
set /p DISCORD_TOKEN=<"%TOKENFILE%"
if "%DISCORD_TOKEN%"=="" (
  echo Token-Datei ist leer: %TOKENFILE%
  pause
  exit /b 1
)

if not exist .env (
  echo .env fehlt. Erst .env.example kopieren und ausfuellen.
  pause
  exit /b 1
)

:run
if exist .env (node --env-file=.env verify.mjs) else (node verify.mjs)
echo.
echo Exit-Code: %ERRORLEVEL%
echo Bot beendet oder abgestuerzt - restart in 5s. Fenster schliessen = stop.
timeout /t 5 >nul
goto run
