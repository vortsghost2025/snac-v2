Write-Host "=== Kilo PASS/FAIL Health Check ===" -ForegroundColor Cyan
Write-Host ""
$root = (Get-Location).Path
Write-Host "Workspace: $root" -ForegroundColor Yellow
Write-Host ""
$fail = 0
$warn = 0
function Pass($msg) { Write-Host "[PASS] $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "[WARN] $msg" -ForegroundColor Yellow; $script:warn++ }
function Fail($msg) { Write-Host "[FAIL] $msg" -ForegroundColor Red; $script:fail++ }
if (Test-Path ".\.kilo") { Pass ".kilo folder present" } else { Warn ".kilo folder missing" }
if (Test-Path ".\.vscode") { Pass ".vscode folder present" } else { Warn ".vscode folder missing" }
if (Test-Path ".\KILO_BOOTSTRAP.md") { Pass "KILO_BOOTSTRAP.md present" } else { Warn "KILO_BOOTSTRAP.md missing" }
Write-Host ""
Write-Host "Checking for stale absolute path references..." -ForegroundColor Cyan
$pathHits = Get-ChildItem -Recurse -File -Include *.js,*.cjs,*.ts,*.json,*.md,*.env,*.yml,*.yaml,*.py -ErrorAction SilentlyContinue | Select-String -Pattern 'S:\\|C:\\|s:/|c:/' -ErrorAction SilentlyContinue
if ($pathHits) { Warn ("Found {0} absolute path reference(s)" -f $pathHits.Count); $pathHits | Select-Object -First 20 Path, LineNumber, Line | Format-Table -AutoSize } else { Pass "No stale absolute path references found" }
Write-Host ""
Write-Host "Checking model configuration..." -ForegroundColor Cyan
$modelHits = Get-ChildItem -Recurse -File -Include .env,.env.local,*.json,*.md,*.yml,*.yaml,*.toml -ErrorAction SilentlyContinue | Select-String -Pattern 'OPENROUTER_MODEL|KILO_MODEL|MODEL=|gpt-4o|gpt-4.1|gemini|claude|openrouter|kilogateway' -ErrorAction SilentlyContinue
if ($modelHits) { Pass ("Found {0} model-related config reference(s)" -f $modelHits.Count); $modelHits | Select-Object -First 30 Path, LineNumber, Line | Format-Table -AutoSize } else { Warn "No model-related settings found" }
Write-Host ""
Write-Host "=== Summary ===" -ForegroundColor Cyan
Write-Host "Warnings: $warn" -ForegroundColor Yellow
Write-Host "Failures: $fail" -ForegroundColor Red
