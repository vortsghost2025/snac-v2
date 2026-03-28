# Simple CUDA/C++ Setup for Windsurf
# This script sets up clangd for CUDA development

Write-Host "=== CUDA/C++ Setup for Windsurf ===" -ForegroundColor Cyan
Write-Host ""

# Check if clangd is installed
$clangdPath = (Get-Command clangd -ErrorAction SilentlyContinue).Source

if (-not $clangdPath) {
    Write-Host "clangd NOT found." -ForegroundColor Red
    Write-Host ""
    Write-Host "Please install clangd:"
    Write-Host "  1. Go to: https://github.com/clangd/clangd/releases"
    Write-Host "  2. Download clangd-windows-X.X.X.zip"
    Write-Host "  3. Extract it to C:\clangd\ (or anywhere you prefer)"
    Write-Host "  4. Add it to your PATH environment variable"
    Write-Host ""
    Write-Host "Press any key to exit..."
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    exit 1
}

Write-Host "clangd found at: $clangdPath" -ForegroundColor Green
Write-Host ""

# Find CUDA installation
$cudaPaths = @(
    "C:/Program Files/NVIDIA GPU Computing Toolkit/CUDA/v12.8",
    "C:/Program Files/NVIDIA GPU Computing Toolkit/CUDA/v12.6",
    "C:/Program Files/NVIDIA GPU Computing Toolkit/CUDA/v12.4",
    "C:/Program Files/NVIDIA GPU Computing Toolkit/CUDA/v12.2",
    "C:/Program Files/NVIDIA GPU Computing Toolkit/CUDA/v12.0",
    "C:/Program Files/NVIDIA GPU Computing Toolkit/CUDA/v11.8",
    "C:/Program Files/NVIDIA GPU Computing Toolkit/CUDA/v11.4"
)

$cudaPath = $null
foreach ($path in $cudaPaths) {
    if (Test-Path $path) {
        $cudaPath = $path
        break
    }
}

if (-not $cudaPath) {
    Write-Host "CUDA installation not found in standard locations." -ForegroundColor Yellow
    Write-Host "Please enter your CUDA path (e.g., C:/Program Files/NVIDIA GPU Computing Toolkit/CUDA/v12.0):"
    $cudaPath = Read-Host
    if (-not (Test-Path $cudaPath)) {
        Write-Host "Invalid path. Exiting." -ForegroundColor Red
        exit 1
    }
}

Write-Host "Using CUDA at: $cudaPath" -ForegroundColor Green
Write-Host ""

# Create .clangd config file
$clangdConfig = @"
CompileFlags:
  Add:
    - -I"$cudaPath/include"
    - -xcuda
    - --cuda-path=$cudaPath
    - -std=c++17

Diagnostics:
  UnusedIncludes: Strict
  MissingIncludes: Strict

Index:
  Background: Build
"@

$configPath = ".clangd"
$clangdConfig | Out-File -FilePath $configPath -Encoding UTF8

Write-Host "Created .clangd config file in current directory" -ForegroundColor Green
Write-Host ""
Write-Host "=== Next Steps ===" -ForegroundColor Cyan
Write-Host "1. Make sure you have the 'clangd' extension installed in Windsurf"
Write-Host "2. Open a .cu or .cpp file - clangd should now provide:"
Write-Host "   - Code completion"
Write-Host "   - Go to definition"
Write-Host "   - Error checking"
Write-Host ""
Write-Host "Setup complete! Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
