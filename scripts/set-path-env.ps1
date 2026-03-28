# Set path environment variables for workspace consistency
param(
    [string]$RootPath = "."
)

Write-Host "=== Setting Path Environment Variables ===" -ForegroundColor Cyan

$absolutePath = Resolve-Path $RootPath
$relativePath = (Get-Location).Path

# Set environment variables
$env:WORKSPACE_ROOT = $absolutePath
$env:WORKSPACE_BASE = Split-Path $absolutePath -Parent
$env:WORKSPACE_PARENT = Split-Path $env:WORKSPACE_BASE -Parent
$env:PROJECT_ROOT = $RootPath

Write-Host ("WORKSPACE_ROOT = {0}" -f $env:WORKSPACE_ROOT) -ForegroundColor Green
Write-Host ("WORKSPACE_BASE = {0}" -f $env:WORKSPACE_BASE) -ForegroundColor Green
Write-Host ("WORKSPACE_PARENT = {0}" -f $env:WORKSPACE_PARENT) -ForegroundColor Green
Write-Host ("PROJECT_ROOT = {0}" -f $env:PROJECT_ROOT) -ForegroundColor Green

# Create .env file for project
$envFilePath = Join-Path $RootPath ".env"
$envContent = "WORKSPACE_ROOT={0}`nWORKSPACE_BASE={1}`nWORKSPACE_PARENT={2}`nPROJECT_ROOT={3}" -f $env:WORKSPACE_ROOT, $env:WORKSPACE_BASE, $env:WORKSPACE_PARENT, $env:PROJECT_ROOT

if (-not (Test-Path $envFilePath)) {
    $envContent | Out-File -FilePath $envFilePath -Encoding UTF8
    Write-Host "Created .env file with path variables" -ForegroundColor Green
}

# Create path variables for use in scripts
$variablesPath = Join-Path $RootPath "scripts\path-variables.ps1"
$variablesContent = "`$WorkspaceRoot = '{0}'" -f $env:WORKSPACE_ROOT
$variablesContent += "`n`$WorkspaceBase = '{0}'" -f $env:WORKSPACE_BASE
$variablesContent += "`n`$WorkspaceParent = '{0}'" -f $env:WORKSPACE_PARENT
$variablesContent += "`n`$ProjectRoot = '{0}'" -f $env:PROJECT_ROOT

if (-not (Test-Path $variablesPath)) {
    $variablesContent | Out-File -FilePath $variablesPath -Encoding UTF8
    Write-Host "Created scripts\path-variables.ps1" -ForegroundColor Green
}

Write-Host ""
Write-Host "=== Usage ===" -ForegroundColor Cyan
Write-Host ".\scripts\set-path-env.ps1" -ForegroundColor Yellow
Write-Host ". scripts\path-variables.ps1" -ForegroundColor Yellow
Write-Host ""
Write-Host "Run this script before other workspace operations to ensure consistent paths"