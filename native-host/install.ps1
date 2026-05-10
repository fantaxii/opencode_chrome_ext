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

$hostBatPath = Join-Path $nativeHostDir "host.bat"
$manifestPath = Join-Path $nativeHostDir "manifest.json"
$manifestContent = @{
    name            = "com.opencode.chrome"
    description     = "OpenCode Chrome Extension Native Messaging Host"
    path            = $hostBatPath
    type            = "stdio"
    allowed_origins = @("chrome-extension://*")
} | ConvertTo-Json -Depth 3
[System.IO.File]::WriteAllText($manifestPath, $manifestContent, [System.Text.Encoding]::UTF8)
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
