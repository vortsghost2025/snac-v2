@echo off
setlocal EnableDelayedExpansion

cd /d "S:\snac-v2\snac-v2\backend"

echo =========================================
echo  SNAC v2 Git Repository Fix Script
echo =========================================
echo.

REM Step 1: Handle nul file
echo [1/5] Removing problematic files...
if exist nul (
    echo Found 'nul' file - attempting removal...
    cmd /c "del \"nul\" /f 2>nul"
    timeout /t 1 /nobreak >nul
    if exist nul (
        echo RETRY: Using PowerShell method...
        powershell -Command "if (Test-Path 'nul') { Remove-Item -LiteralPath 'nul' -Force -ErrorAction SilentlyContinue }"
    )
    if exist nul (
        echo ERROR: Cannot remove 'nul' file automatically.
        echo Please close all applications and try again, or remove manually.
        pause
        exit /b 1
    ) else (
        echo SUCCESS: 'nul' file removed
    )
) else (
    echo 'nul' file not found - good!
)

echo.
echo [2/5] Configuring Git...
git config core.autocrlf true
git config --global --add safe.directory S:/snac-v2/snac-v2/backend 2>nul

echo.
echo [3/5] Adding files to Git...
git add .
if %errorlevel% neq 0 (
    echo WARNING: Git add had issues, continuing anyway...
)

echo.
echo [4/5] Creating initial commit...
git commit -m "Initial commit: SNAC v2 backend with MessageBus, Dashboard, Security, and GPU acceleration"
if %errorlevel% neq 0 (
    echo ERROR: Commit failed. Checking status...
    git status
    pause
    exit /b 1
)

echo.
echo [5/5] Pushing to GitHub...
git remote remove origin 2>nul
git remote add origin https://github.com/vortsghost2025/snac-v2.git
git branch -M main
git push -u origin main --force
if %errorlevel% neq 0 (
    echo ERROR: Push failed. Common issues:
    echo - GitHub repo doesn't exist (create at https://github.com/new)
    echo - Authentication needed (run: gh auth login)
    echo - Network issues
    pause
    exit /b 1
)

echo.
echo =========================================
echo  SUCCESS! All operations completed.
echo =========================================
echo.
echo Repository: https://github.com/vortsghost2025/snac-v2
echo.
pause
