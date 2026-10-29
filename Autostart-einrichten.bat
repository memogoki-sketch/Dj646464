@echo off
setlocal
title Fenerbahce News - Autostart
set "TARGET=%~dp0Server-im-Hintergrund.vbs"
set "WORKDIR=%~dp0"

echo Der Server startet kuenftig automatisch mit Windows (unsichtbar im Hintergrund).
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup')+'\Fenerbahce News Server.lnk'); $s.TargetPath=$env:TARGET; $s.WorkingDirectory=$env:WORKDIR; $s.Save()"
if errorlevel 1 (
  echo Das Einrichten ist fehlgeschlagen.
) else (
  echo Autostart eingerichtet.
  echo Entfernen: Win+R, "shell:startup" eingeben und die Verknuepfung loeschen.
)
echo.
pause
