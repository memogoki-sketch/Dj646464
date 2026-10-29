@echo off
setlocal
cd /d "%~dp0"
title Fenerbahce News - Start

rem --- 1. Node.js vorhanden? ---------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js wurde nicht gefunden.
  where winget >nul 2>nul
  if errorlevel 1 (
    echo.
    echo Bitte installiere Node.js LTS von https://nodejs.org
    echo und starte danach diese Datei noch einmal.
    start "" https://nodejs.org
    pause
    exit /b 1
  )
  echo Node.js wird jetzt installiert. Bitte bestaetige ggf. die Windows-Abfrage.
  winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
  echo.
  echo Fertig. Bitte schliesse dieses Fenster und starte Start.bat NOCH EINMAL.
  pause
  exit /b 0
)

rem --- 2. Server starten, falls er nicht schon laeuft --------------------
set PORT=3000
netstat -ano | find ":%PORT% " | find "LISTENING" >nul
if errorlevel 1 (
  echo Server wird gestartet ...
  wscript "%~dp0Server-im-Hintergrund.vbs"
  timeout /t 3 /nobreak >nul
) else (
  echo Server laeuft bereits.
)

rem --- 3. App-Fenster oeffnen (Edge im App-Modus, sonst Standardbrowser) ---
reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe" >nul 2>nul
if errorlevel 1 (
  start "" "http://localhost:%PORT%"
) else (
  start "" msedge --app="http://localhost:%PORT%" --window-size=1280,860
)
exit /b 0
