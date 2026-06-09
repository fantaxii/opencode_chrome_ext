# OpenCode Chrome Extension - Native Messaging Host Installer

param(
    [string]$InstallPath = "$env:LOCALAPPDATA\OpenCodeChrome"
)

$ErrorActionPreference = "Continue"

# Chrome이 Native Messaging Host를 띄울 때 쓰는 프로세스 환경에는
# 사용자의 PATH가 그대로 반영되지 않는 경우가 많다 (Node 설치 후 PATH가
# 갱신돼도 이미 떠 있는 explorer/Chrome 세션은 못 봄). 그래서 host.bat에
# "node"를 그대로 쓰면 "Error when writing to Native Messaging host: -101"
# (프로세스가 즉시 종료)로 이어진다. 설치 시점에 node.exe의 절대 경로를
# 찾아 host.bat에 직접 박아 넣어 PATH 의존성을 없앤다.
function Find-NodeExecutable {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    $candidates = @(
        "$env:ProgramFiles\nodejs\node.exe",
        "${env:ProgramFiles(x86)}\nodejs\node.exe",
        "$env:LOCALAPPDATA\Programs\nodejs\node.exe"
    )
    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) { return $candidate }
    }

    try {
        $installDir = Get-ItemPropertyValue -Path "HKLM:\SOFTWARE\Node.js" -Name "InstallPath" -ErrorAction Stop
        $exe = Join-Path $installDir "node.exe"
        if (Test-Path $exe) { return $exe }
    } catch {}

    return $null
}

function Install-NodeJS {
    Write-Host ""
    Write-Host "Node.js를 자동 설치합니다..." -ForegroundColor Cyan

    # 1순위: winget (Windows 10 1709+ / Windows 11 기본 탑재)
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        Write-Host "  [winget] Node.js LTS 설치 중..." -ForegroundColor Gray
        try {
            winget install --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements -e --silent 2>&1 | Out-Null
            if ($LASTEXITCODE -eq 0) {
                Write-Host "  Node.js 설치 완료 (winget)" -ForegroundColor Green
                $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                            [System.Environment]::GetEnvironmentVariable("Path", "User")
                return $true
            }
            Write-Host "  winget 종료 코드: $LASTEXITCODE" -ForegroundColor Yellow
        } catch {
            Write-Host "  winget 실패: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    } else {
        Write-Host "  winget을 찾을 수 없음. MSI 직접 설치를 시도합니다." -ForegroundColor Yellow
    }

    # 2순위: nodejs.org LTS MSI 직접 다운로드
    Write-Host "  [MSI] nodejs.org LTS 버전 정보 조회 중..." -ForegroundColor Gray
    try {
        $indexJson = Invoke-RestMethod -Uri "https://nodejs.org/dist/index.json" -TimeoutSec 30
        $lts = $indexJson | Where-Object { $_.lts -ne $false } | Select-Object -First 1
        $version = $lts.version
        $arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
        $msiUrl = "https://nodejs.org/dist/$version/node-$version-$arch.msi"
        $msiPath = Join-Path $env:TEMP "node-installer.msi"

        Write-Host "  다운로드 중: Node.js $version ($arch)..." -ForegroundColor Gray
        Invoke-WebRequest -Uri $msiUrl -OutFile $msiPath -TimeoutSec 300

        Write-Host "  설치 중 (자동 설치)..." -ForegroundColor Gray
        $proc = Start-Process msiexec.exe -ArgumentList "/i `"$msiPath`" /quiet /norestart" -Wait -PassThru
        Remove-Item $msiPath -Force -ErrorAction SilentlyContinue

        if ($proc.ExitCode -eq 0) {
            Write-Host "  Node.js 설치 완료 (MSI)" -ForegroundColor Green
            $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                        [System.Environment]::GetEnvironmentVariable("Path", "User")
            return $true
        }
        Write-Host "  MSI 설치 실패 (ExitCode: $($proc.ExitCode))" -ForegroundColor Red
    } catch {
        Write-Host "  다운로드/설치 실패: $($_.Exception.Message)" -ForegroundColor Red
    }

    return $false
}

Write-Host "=== OpenCode Chrome Extension Installer ===" -ForegroundColor Cyan

if ($PSScriptRoot) {
    $scriptDir = $PSScriptRoot
} else {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    if ([string]::IsNullOrEmpty($scriptDir)) {
        $scriptDir = "."
    }
}

Write-Host "Script location: $scriptDir" -ForegroundColor Gray

$sourceHost = Join-Path $scriptDir "host.js"
$sourceManifest = Join-Path $scriptDir "manifest.json"

if (-not (Test-Path $sourceHost)) {
    Write-Host "ERROR: host.js not found" -ForegroundColor Red
    Write-Host "   This script must be run from the native-host folder" -ForegroundColor Yellow
    exit 1
}

$nativeHostDir = Join-Path $InstallPath "native-host"

Write-Host "1. Installing files..." -ForegroundColor Gray

if (-not (Test-Path $InstallPath)) {
    New-Item -ItemType Directory -Path $InstallPath -Force | Out-Null
}

if (-not (Test-Path $nativeHostDir)) {
    New-Item -ItemType Directory -Path $nativeHostDir -Force | Out-Null
}

try {
    Copy-Item -Path $sourceHost -Destination $nativeHostDir -Force
    Write-Host "   host.js installed" -ForegroundColor Gray
} catch {
    Write-Host "ERROR: Failed to copy host.js - $($_.Exception.Message)" -ForegroundColor Red
}

$nodePath = Find-NodeExecutable
if (-not $nodePath) {
    Write-Host "Node.js(node.exe)를 찾을 수 없습니다." -ForegroundColor Yellow
    $installed = Install-NodeJS
    if ($installed) {
        $nodePath = Find-NodeExecutable
    }
    if (-not $nodePath) {
        Write-Host "ERROR: Node.js 자동 설치에 실패했습니다." -ForegroundColor Red
        Write-Host "   https://nodejs.org/ 에서 수동으로 설치한 뒤 이 스크립트를 다시 실행하세요." -ForegroundColor Yellow
        exit 1
    }
}
Write-Host "   Node.js 발견: $nodePath" -ForegroundColor Gray

$sourcePackageJson = Join-Path $scriptDir "package.json"
if (Test-Path $sourcePackageJson) {
    try {
        Copy-Item -Path $sourcePackageJson -Destination $nativeHostDir -Force
        Write-Host "   package.json installed" -ForegroundColor Gray
    } catch {
        Write-Host "ERROR: Failed to copy package.json - $($_.Exception.Message)" -ForegroundColor Red
    }
}

$hostBatPath = Join-Path $nativeHostDir "host.bat"
$hostJsPath = Join-Path $nativeHostDir "host.js"
$hostBatContent = "@echo off`r`n`"$nodePath`" `"$hostJsPath`" %*`r`n"
[System.IO.File]::WriteAllText($hostBatPath, $hostBatContent, (New-Object System.Text.UTF8Encoding $false))
Write-Host "   host.bat generated (node: $nodePath)" -ForegroundColor Gray

$manifestPath = Join-Path $nativeHostDir "manifest.json"
$manifestContent = @{
    name            = "com.opencode.chrome"
    description     = "OpenCode Chrome Extension Native Messaging Host"
    path            = $hostBatPath
    type            = "stdio"
    allowed_origins = @("chrome-extension://adiacpiichkecbkodjeddeocfpkhigfg/")
} | ConvertTo-Json -Depth 3
[System.IO.File]::WriteAllText($manifestPath, $manifestContent, (New-Object System.Text.UTF8Encoding $false))
Write-Host "   manifest.json installed (path: $hostBatPath)" -ForegroundColor Gray

Write-Host "2. Registering in registry..." -ForegroundColor Gray

$regPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.opencode.chrome"
if (-not (Test-Path $regPath)) {
    New-Item -Path $regPath -Force | Out-Null
}

try {
    Set-ItemProperty -Path $regPath -Name "(Default)" -Value $manifestPath
    Write-Host "   Registry registered" -ForegroundColor Gray
} catch {
    Write-Host "ERROR: Failed to register registry - $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "INSTALL COMPLETE!" -ForegroundColor Green
Write-Host "  Install location: $nativeHostDir" -ForegroundColor Gray
Write-Host "  Manifest: $manifestPath" -ForegroundColor Gray
Write-Host ""
Write-Host "Please reload Chrome extension." -ForegroundColor Yellow

# npm dependencies install
Write-Host ""
Write-Host "Installing npm dependencies..." -ForegroundColor Gray
$npmPath = Get-Command npm -ErrorAction SilentlyContinue
if ($npmPath) {
    try {
        Push-Location $nativeHostDir
        npm install
        Pop-Location
        Write-Host "  ✓ npm install complete" -ForegroundColor Green
    } catch {
        Write-Host "  ⚠ npm install failed. Please run manually:" -ForegroundColor Yellow
        Write-Host "    cd $nativeHostDir" -ForegroundColor Gray
        Write-Host "    npm install" -ForegroundColor Gray
    }
} else {
    Write-Host "  ⚠ npm not found. Please install Node.js first:" -ForegroundColor Yellow
    Write-Host "    https://nodejs.org/" -ForegroundColor Gray
    Write-Host "    Then run: cd $nativeHostDir && npm install" -ForegroundColor Gray
}

# WSL2 networking configuration check
Write-Host ""
Write-Host "Checking WSL2 networking configuration..." -ForegroundColor Gray

$wslConfigPath = "$env:USERPROFILE\.wslconfig"
$wslConfigContent = if (Test-Path $wslConfigPath) { Get-Content $wslConfigPath -Raw } else { "" }

if ($wslConfigContent -notmatch "networkingMode\s*=\s*mirrored") {
    Write-Host ""
    Write-Host "─────────────────────────────────────────────────" -ForegroundColor Cyan
    Write-Host " WSL OpenCode Integration Setup" -ForegroundColor Cyan
    Write-Host "─────────────────────────────────────────────────" -ForegroundColor Cyan
    Write-Host " OpenCode is not found on Windows. To use WSL opencode,"
    Write-Host " WSL2 Mirrored Networking configuration is required."
    Write-Host ""
    Write-Host " Config file: $wslConfigPath"
    Write-Host ""
    Write-Host " ⚠️  WARNING: All running WSL sessions will be closed." -ForegroundColor Yellow
    Write-Host "     Please save your work first." -ForegroundColor Yellow
    Write-Host "─────────────────────────────────────────────────" -ForegroundColor Cyan
    $confirm = Read-Host " Auto-configure and restart WSL? [Y/n]"

    if ($confirm -ne 'n' -and $confirm -ne 'N') {
        # Add networkingMode=mirrored to [wsl2] section
        if ($wslConfigContent -match "\[wsl2\]") {
            $wslConfigContent = $wslConfigContent -replace "(\[wsl2\])", "`$1`nnetworkingMode=mirrored"
        } else {
            $wslConfigContent += "`n[wsl2]`nnetworkingMode=mirrored`n"
        }
        Set-Content -Path $wslConfigPath -Value $wslConfigContent
        Write-Host " .wslconfig updated successfully." -ForegroundColor Green
        Write-Host " Restarting WSL (wsl.exe --shutdown)..." -ForegroundColor Green
        wsl.exe --shutdown
        Write-Host " WSL restarted. You can now use WSL opencode." -ForegroundColor Green
    } else {
        Write-Host ""
        Write-Host " Manual setup:" -ForegroundColor Cyan
        Write-Host "  1. Open or create the file:"
        Write-Host "     $wslConfigPath"
        Write-Host "  2. Add the following content:"
        Write-Host "       [wsl2]"
        Write-Host "       networkingMode=mirrored"
        Write-Host "  3. Close all WSL windows and run in PowerShell:"
        Write-Host "       wsl.exe --shutdown"
        Write-Host "  4. Open WSL again to apply the settings."
    }
} else {
    Write-Host " WSL2 Mirrored Networking already configured." -ForegroundColor Green
}