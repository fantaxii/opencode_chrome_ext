@echo off
rem install.ps1을 PowerShell 실행 정책(ExecutionPolicy) 제약 없이 실행하기 위한 래퍼.
rem 더블클릭하거나 "install.bat" 실행만으로 설치가 진행됩니다.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
pause
