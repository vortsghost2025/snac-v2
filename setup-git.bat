@echo off
REM Git Setup Script for SNAC v2
REM Run this to initialize Git and prepare for GitHub

cd /d "%~dp0"

echo [1/5] Initializing Git repository...
git init

echo [2/5] Adding all files...
git add .

echo [3/5] Committing...
git commit -m "Initial commit: SNAC v2 backend with MessageBus, Dashboard, Terminal Echo Bridge, Security Hardening, and GPU acceleration"

echo [4/5] Checking status...
git status

echo [5/5] Done!
echo.
echo Next steps:
echo 1. Create repo at https://github.com/new (name: snac-v2)
echo 2. Run: git remote add origin https://github.com/YOURUSERNAME/snac-v2.git
echo 3. Run: git branch -M main
echo 4. Run: git push -u origin main
echo.
pause
