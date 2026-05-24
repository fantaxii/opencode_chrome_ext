# OpenCode Chrome Extension - Native Messaging Host Installer

param(
    [string]$InstallPath = "$env:LOCALAPPDATA\OpenCodeChrome"
)

$ErrorActionPreference = "Continue"

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

$sourceBat = Join-Path $scriptDir "host.bat"
if (Test-Path $sourceBat) {
    try {
        Copy-Item -Path $sourceBat -Destination $nativeHostDir -Force
        Write-Host "   host.bat installed" -ForegroundColor Gray
    } catch {
        Write-Host "ERROR: Failed to copy host.bat - $($_.Exception.Message)" -ForegroundColor Red
    }
}

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