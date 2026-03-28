@echo off
REM One-click GitHub push for SNAC v2
setlocal EnableDelayedExpansion

cd /d "S:\snac-v2\snac-v2\backend"

echo =========================================
echo   SNAC v2 GitHub Push - One Click
echo =========================================
echo.

REM Check if git is available
git --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Git is not installed or not in PATH
    pause
    exit /b 1
)

REM Initialize if needed
if not exist .git (
    echo [1/6] Initializing Git repository...
    git init
) else (
    echo [1/6] Git repository already initialized
)

REM Set git config
echo [2/6] Setting Git configuration...
git config user.email "dev@snac.local" 2>nul
git config user.name "SNAC Dev" 2>nul
git config core.autocrlf true 2>nul
git config --global --add safe.directory S:/snac-v2/snac-v2/backend 2>nul

REM Handle nul file
echo [3/6] Checking for problematic files...
if exist nul (
    echo Removing 'nul' file...
    cmd /c "del \"nul\" /f 2>nul"
    powershell -Command "Remove-Item -LiteralPath 'nul' -Force -ErrorAction SilentlyContinue" 2>nul
)

REM Add all files
echo [4/6] Adding files to Git...
git add -A

REM Commit
echo [5/6] Creating commit...
git commit -m "Initial commit: SNAC v2 backend" 2>nul
if %errorlevel% neq 0 (
    echo No new changes to commit (already committed)
)

REM Setup remote and push
echo [6/6] Pushing to GitHub...
git remote remove origin 2>nul
git remote add origin https://github.com/vortsghost2025/snac-v2.git
git branch -M main
git push -u origin main --force

if %errorlevel% == 0 (
    echo.
    echo =========================================
    echo SUCCESS! Code pushed to GitHub
    echo =========================================
    echo Repository: https://github.com/vortsghost2025/snac-v2
    echo.
) else (
    echo.
    echo =========================================
    echo PUSH FAILED
    echo =========================================
    echo This usually means:
    echo 1. GitHub repo doesn't exist yet
    echo 2. Network issues
    echo 3. Authentication needed
    echo.
    echo To fix:
    echo 1. Go to https://github.com/new
    echo 2. Create repo named "snac-v2"
    echo 3. Don't initialize with README
    echo 4. Run this batch file again
    echo.
)

pause
