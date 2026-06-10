@echo off
rem Wrapper to run install.ps1 without ExecutionPolicy restrictions.
rem Double-click or run "install.bat" to start installation.
chcp 65001 >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
pause
