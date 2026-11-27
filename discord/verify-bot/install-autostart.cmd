@echo off
title ryuk verify - autostart installieren
cd /d "%~dp0"

rem alten bot beenden, falls er noch laeuft
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*verify.mjs*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>&1

rem verknuepfung im autostart-ordner anlegen
powershell -NoProfile -Command "$ws=New-Object -ComObject WScript.Shell; $lnk=$ws.CreateShortcut([Environment]::GetFolderPath('Startup')+'\ryuk-verify.lnk'); $lnk.TargetPath='wscript.exe'; $lnk.Arguments='\"%~dp0start-hidden.vbs\"'; $lnk.WorkingDirectory='%~dp0'; $lnk.Description='ryuk verify bot'; $lnk.Save()"

rem sofort im hintergrund starten
wscript.exe "%~dp0start-hidden.vbs"

echo.
echo Fertig. Der Bot laeuft jetzt ohne Fenster und startet ab jetzt
echo automatisch mit Windows.
echo.
echo Log ansehen:   show-log.cmd
echo Bot stoppen:   stop.cmd
echo Autostart weg: shell:startup  -^> ryuk-verify.lnk loeschen
echo.
pause
