<#
.SYNOPSIS
    Starts the API, the Vite dev server and (optionally) the desktop shell.

.EXAMPLE
    ./scripts/dev.ps1
    ./scripts/dev.ps1 -Mode Mock -NoDesktop
#>
[CmdletBinding()]
param(
    # Overrides YouTube:Mode for this run. Demo needs no API key; Mock needs no network.
    [ValidateSet('Auto', 'Api', 'Demo', 'Mock')]
    [string]$Mode = 'Auto',

    [switch]$NoDesktop
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

Write-Host "TAIKO LABS Multiview - 개발 환경 시작 (Mode=$Mode)" -ForegroundColor Cyan

# --- backend ---------------------------------------------------------------
$api = Join-Path $root 'backend/TaikoLabs.Api'
Write-Host "  백엔드  http://localhost:5180" -ForegroundColor DarkGray

# Start-Process has no -Environment on Windows PowerShell 5.1, so set the
# variables on this process first - child processes inherit them.
$env:ASPNETCORE_ENVIRONMENT = 'Development'
$env:YouTube__Mode = $Mode

Start-Process -FilePath 'dotnet' `
    -ArgumentList 'run', '--urls', 'http://localhost:5180' `
    -WorkingDirectory $api

# --- frontend --------------------------------------------------------------
$frontend = Join-Path $root 'frontend'
if (-not (Test-Path (Join-Path $frontend 'node_modules'))) {
    Write-Host "  npm install 실행 중..." -ForegroundColor DarkGray
    Push-Location $frontend
    npm install --no-audit --no-fund
    Pop-Location
}

Write-Host "  프론트  http://localhost:5173" -ForegroundColor DarkGray
Start-Process -FilePath 'npm' -ArgumentList 'run', 'dev' -WorkingDirectory $frontend

# --- desktop ---------------------------------------------------------------
if (-not $NoDesktop) {
    # Give the dev server a moment: the shell picks its source at startup and
    # falls back to frontend/dist if 5173 is not answering yet.
    Start-Sleep -Seconds 6

    $desktop = Join-Path $root 'desktop/TaikoLabs.Desktop'
    Write-Host "  데스크톱 셸 시작" -ForegroundColor DarkGray
    Start-Process -FilePath 'dotnet' -ArgumentList 'run' -WorkingDirectory $desktop
}

Write-Host ""
Write-Host "종료하려면: Get-Process dotnet, node | Stop-Process" -ForegroundColor DarkGray
