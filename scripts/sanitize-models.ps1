# Model configuration sanitization script
param(
    [string]$RootPath = ".",
    [string]$OutputLog = "model-sanitization-log.txt"
)

Write-Host "=== Model Configuration Sanitization ===" -ForegroundColor Cyan
Write-Host "Target Root: $RootPath"
Write-Host "Log File: $OutputLog"
Write-Host ""

$logEntries = @()

# Function to log changes
function Log-Change($file, $lineNum, $original, $replacement) {
    $entry = "[$file] [$lineNum] $original -> $replacement"
    $logEntries += $entry
    Write-Host $entry -ForegroundColor Yellow
}

# 1. Find model configuration references
Write-Host "Phase 1: Scanning for model configuration references..." -ForegroundColor Green

$modelPatterns = @(
    'OPENROUTER_MODEL',
    'KILO_MODEL',
    'MODEL=',
    'gpt-4o',
    'gpt-4.1',
    'gemini',
    'claude',
    'openrouter',
    'kilogateway'
)

$files = Get-ChildItem -Path $RootPath -Recurse -File -Include .env,.env.local,*.json,*.md,*.yml,*.yaml,*.toml

foreach ($file in $files) {
    $content = Get-Content $file.FullName -Raw
    $originalContent = $content
    
    foreach ($pattern in $modelPatterns) {
        if ($content -match $pattern) {
            # Just log findings for now - actual sanitization would be project-specific
            $matches = [regex]::Matches($content, $pattern)
            foreach ($match in $matches) {
                Log-Change $file.FullName $match.Index $match.Value "Found - Review needed"
            }
        }
    }
}

# 2. Suggest standardized model configuration
Write-Host "Phase 2: Generating standardized model configuration template..." -ForegroundColor Green

$templatePath = Join-Path $RootPath "scripts\model-config-template.env"
$templateContent = @"
# Standardized Model Configuration Template
# Replace values as needed for your environment

# OpenRouter Models
OPENROUTER_MODEL_PRIMARY=anthropic/claude-3.5-sonnet
OPENROUTER_MODEL_FALLBACK=openai/gpt-4o
OPENROUTER_MODEL_CODING=anthropic/claude-3-opus

# Kilo Configuration
KILO_MODEL=claude-3.5-sonnet
KILO_TEMPERATURE=0.7
KILO_MAX_TOKENS=4000

# Fallback settings
MODEL_FALLBACK_ENABLED=true
MODEL_FALLBACK_ATTEMPTS=3
"@

if (-not (Test-Path $templatePath)) {
    $templateContent | Out-File -FilePath $templatePath -Encoding UTF8
    Write-Host "Created model configuration template at $templatePath" -ForegroundColor Green
}

# 3. Write log
$logEntries | Out-File -FilePath $OutputLog -Encoding UTF8

Write-Host ""
Write-Host "=== Summary ===" -ForegroundColor Cyan
Write-Host "Total files scanned: $($files.Count)"
Write-Host "Model references found: $($logEntries.Count)"
Write-Host "See $OutputLog for details"
Write-Host "Template created: scripts\model-config-template.env"