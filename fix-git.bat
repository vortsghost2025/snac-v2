@echo off
REM Fix Git setup for SNAC v2

cd /d "S:\snac-v2\snac-v2\backend"

echo === Fixing Git Repository ===
echo.

REM Remove nul file using cmd
echo Removing nul file...
cmd /c "del /f nul 2>nul"
if exist nul (
    echo Failed to delete nul. Trying alternative...
    powershell -Command "Remove-Item -Force nul -ErrorAction SilentlyContinue"
)

REM Check if still exists
if exist nul (
    echo ERROR: Cannot delete nul file. Manual intervention needed.
    pause
    exit /b 1
)

echo.
echo Adding files to git...
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
echo === Done ===
if %errorlevel% == 0 (
    echo SUCCESS: Code pushed to GitHub!
) else (
    echo ERROR: Push failed. Check messages above.
)
pause
