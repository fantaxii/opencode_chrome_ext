@echo off
chcp 65001 >nul 2>&1
setlocal

set "MANIFEST=%LOCALAPPDATA%\OpenCodeChrome\native-host\manifest.json"

if not exist "%MANIFEST%" (
    echo ERROR: Native Host가 설치되어 있지 않습니다.
    echo        먼저 opencode-native-host-setup-vX.X.X.exe를 실행하세요.
    pause & exit /b 1
)

if "%~1"=="" (
    echo 사용법: configure-extension-id.bat ^<ExtensionId^>
    echo.
    echo  ExtensionId 확인 방법:
    echo   1. Chrome에서 chrome://extensions 열기
    echo   2. 개발자 모드 활성화
    echo   3. OpenCode 확장 프로그램의 ID 복사
    echo.
    pause & exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "$m = Get-Content '%MANIFEST%' | ConvertFrom-Json; $m.allowed_origins = @('chrome-extension://%~1/'); $m | ConvertTo-Json -Depth 3 | Set-Content '%MANIFEST%' -Encoding UTF8; Write-Host 'Extension ID 업데이트 완료: %~1' -ForegroundColor Green"

if %errorlevel% neq 0 (
    echo ERROR: Extension ID 업데이트 실패
    pause & exit /b 1
)

echo.
echo Chrome을 재시작하거나 chrome://extensions 에서 확장 프로그램을
echo 비활성화 후 다시 활성화하세요.
pause
