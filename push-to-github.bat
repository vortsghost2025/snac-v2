@echo off
REM Git Push Script for SNAC v2
REM This script will push to GitHub

cd /d "S:\snac-v2\snac-v2\backend"

echo Setting up Git configuration...
git config --global user.email "dev@snac.local"
git config --global user.name "SNAC Dev"
git config --global --add safe.directory S:/snac-v2/snac-v2/backend

echo.
echo Checking repository status...
git status

echo.
echo Adding remote origin...
git remote remove origin 2>nul
git remote add origin https://github.com/vortsghost2025/snac-v2.git

echo.
echo Setting branch to main...
git branch -M main

echo.
echo Pushing to GitHub...
git push -u origin main

echo.
echo Done! Check output above for errors.
pause
