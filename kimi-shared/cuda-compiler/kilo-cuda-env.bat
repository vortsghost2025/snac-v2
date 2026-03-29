@echo off
REM Kilo CUDA Environment Setup
REM Call this before running nvcc to set up VS + CUDA paths

REM Try vswhere for VS discovery
set VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe
if exist "%VSWHERE%" (
    for /f "usebackq delims=" %%i in (`"%VSWHERE%" -version "[17.0,)" -latest -property installationPath`) do set VS_DIR=%%i
    if defined VS_DIR (
        call "%VS_DIR%\Common7\Tools\VsDevCmd.bat" -arch=amd64
        goto :ready
    )
)

REM Fallback locations
if exist "C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\Tools\VsDevCmd.bat" (
    call "C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\Tools\VsDevCmd.bat" -arch=amd64
    goto :ready
)
if exist "C:\Program Files\Microsoft Visual Studio\18\Community\Common7\Tools\VsDevCmd.bat" (
    call "C:\Program Files\Microsoft Visual Studio\18\Community\Common7\Tools\VsDevCmd.bat" -arch=amd64
    goto :ready
)

echo [ERROR] Could not find Visual Studio installation.
exit /b 1

:ready
echo.
echo === Kilo CUDA Environment Ready ===
echo VS: %VSCMD_VER%
echo CUDA: 
nvcc --version 2>nul | findstr /C:"release"
if %errorlevel% neq 0 (
    echo [WARNING] nvcc not found in PATH. Ensure CUDA Toolkit is installed and on PATH.
)
echo.
