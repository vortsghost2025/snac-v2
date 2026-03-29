param()

# PowerShell wrapper to compile a CUDA sample if nvcc is available.

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
  & nvcc -O3 -arch=sm_86 -o $exeName $candidate 2>&1 | ForEach-Object { Write-Host $_ }
  
  if ($LASTEXITCODE -ne 0) {
    Write-Host "nvcc returned exit code $LASTEXITCODE" -ForegroundColor Red
    exit $LASTEXITCODE
  }
} catch {
  Write-Host "nvcc invocation failed: $_" -ForegroundColor Red
  exit 4
}

if (Test-Path $exeName) {
  Write-Host "Build succeeded: $exeName" -ForegroundColor Green
  exit 0
} else {
  Write-Host "Build did not produce an executable." -ForegroundColor Red
  exit 5
}
