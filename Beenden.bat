@echo off
setlocal
title Fenerbahce News - Beenden
set PORT=3000
set FOUND=0
for /f "tokens=5" %%p in ('netstat -ano ^| find ":%PORT% " ^| find "LISTENING"') do (
  taskkill /f /pid %%p >nul 2>nul
  set FOUND=1
)
if "%FOUND%"=="1" (
  echo Server wurde beendet.
) else (
  echo Der Server lief nicht.
)
timeout /t 2 /nobreak >nul
