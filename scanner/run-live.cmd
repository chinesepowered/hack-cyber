@echo off
REM Start the live scanner. Used for long background runs during the demo.
REM Usage: run-live.cmd [duration_seconds] [batch]
setlocal
set DURATION=%1
if "%DURATION%"=="" set DURATION=5400
set BATCH=%2
if "%BATCH%"=="" set BATCH=12

set PATH=%PATH%;%USERPROFILE%\.local\bin
set PYTHONUNBUFFERED=1

cd /d "%~dp0"
uv run beagle live --duration %DURATION% --batch %BATCH%
