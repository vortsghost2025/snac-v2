param()

# Simple PowerShell wrapper to compile a CUDA sample if nvcc is available.
# It is intentionally conservative: checks for files and tools and prints helpful hints.

$workspace = Split-Path -Parent $MyInvocation.MyCommand.Definition
$repoRoot = Resolve-Path "$workspace\.." | Select-Object -ExpandProperty Path

Write-Host "Checking for nvcc and CUDA sample..."

$nvccPath = (& where.exe nvcc 2>$null) -join ''
if (-not $nvccPath) {
  Write-Host "nvcc not found in PATH. Ensure CUDA is installed and CUDA\bin is on PATH." -ForegroundColor Yellow
  exit 2
}

Write-Host "nvcc found: $nvccPath"

# Locate a candidate .cu source file. Prefer CudaTest/test.cu if present.
$candidate = Join-Path $repoRoot "CudaTest\test.cu"
if (-not (Test-Path $candidate)) {
  Write-Host "No CudaTest/test.cu found; searching for any .cu in repo..."
  $found = Get-ChildItem -Path $repoRoot -Recurse -Include *.cu -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($found) { $candidate = $found.FullName }
}

if (-not (Test-Path $candidate)) {
  Write-Host "No .cu source file found to build." -ForegroundColor Yellow
  exit 3
}

Write-Host "Compiling $candidate"

$outDir = Join-Path $repoRoot "build"
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

$exeName = Join-Path $outDir "cuda_sample.exe"

try {
  # Ensure nvcc sees the CUDA include (helps host compiler find nvtx headers)
  # Enable verbose output and show MSVC include diagnostics to help debug missing nvtx headers
  & nvcc -v -Xcompiler "/showIncludes" -I "S:\\CUDA\\include" -o $exeName $candidate 2>&1 | ForEach-Object { Write-Host $_ }
} catch {
  Write-Host "nvcc invocation failed." -ForegroundColor Red
  exit 4
}

if (Test-Path $exeName) {
  Write-Host "Build succeeded: $exeName" -ForegroundColor Green
  exit 0
} else {
  Write-Host "Build did not produce an executable." -ForegroundColor Red
  exit 5
}
