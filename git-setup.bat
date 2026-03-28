@echo off
setlocal

cd /d "S:\snac-v2\snac-v2\backend"

echo === SNAC v2 Git Setup ===
echo Current directory: %CD%
echo.

if not exist .git (
    echo Initializing Git repository...
    git init
)

echo.
echo Checking for nul file...
if exist nul (
    echo Removing nul file...
    del /f nul 2>nul
    if exist nul (
        echo Failed to delete nul
        exit /b 1
    )
)

echo.
echo Adding files...
git add .

echo.
echo Committing...
git commit -m "Initial commit: SNAC v2 backend"

echo.
echo Setting up remote...
git remote remove origin 2>nul
git remote add origin https://github.com/vortsghost2025/snac-v2.git

echo.
echo Pushing to GitHub...
git branch -M main
git push -u origin main --force

echo.
echo Done!
pause
