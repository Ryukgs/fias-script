@echo off
title ryuk verify - stop
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*verify.mjs*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
echo Bot gestoppt (falls er lief).
pause
