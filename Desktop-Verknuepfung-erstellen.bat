@echo off
setlocal
title Fenerbahce News - Desktop-Verknuepfung
set "TARGET=%~dp0Start.bat"
set "WORKDIR=%~dp0"
set "ICON=%~dp0public\icon.ico"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\Fenerbahce News.lnk'); $s.TargetPath=$env:TARGET; $s.WorkingDirectory=$env:WORKDIR; $s.IconLocation=$env:ICON; $s.WindowStyle=7; $s.Save()"
if errorlevel 1 (
  echo Das Erstellen der Verknuepfung ist fehlgeschlagen.
) else (
  echo Verknuepfung "Fenerbahce News" wurde auf dem Desktop angelegt.
)
echo.
pause
