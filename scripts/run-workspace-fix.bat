@echo off
REM Workspace Fix Batch File
REM Run this to fix workspace drift issues

echo Running workspace fix scripts...
echo.

REM Set path environment variables
echo Setting path environment variables...
powershell -ExecutionPolicy Bypass -File .\scripts\set-path-env.ps1
echo.

REM Clean paths
echo Cleaning absolute path references...
powershell -ExecutionPolicy Bypass -File .\scripts\clean-paths.ps1
echo.

REM Sanitize model configuration
echo Sanitizing model configuration...
powershell -ExecutionPolicy Bypass -File .\scripts\sanitize-models.ps1
echo.

REM Run final health check
echo Running final health check...
powershell -ExecutionPolicy Bypass -File .\scripts\kilo-health-check.ps1
echo.

echo Workspace fix complete!
echo Check the generated log files for details:
echo   - path-cleaning-log.txt
echo   - model-sanitization-log.txt
echo.