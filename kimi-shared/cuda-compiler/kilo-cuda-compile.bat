@echo off
REM Kilo CUDA Compile & Run Script
REM Usage: kilo-cuda-compile.bat <source.cu> <output.exe> [arch] [extra-nvcc-flags]

if "%1"=="" (
    echo Usage: kilo-cuda-compile.bat ^<source.cu^> ^<output.exe^> [arch] [extra flags]
    echo Example: kilo-cuda-compile.bat device_test.cu device_test.exe sm_86 "-O3 -lineinfo"
    exit /b 1
)

set SOURCE=%1
set OUTPUT=%2
set ARCH=%3
set EXTRA_FLAGS=%4

if "%ARCH%"=="" set ARCH=sm_86
if "%EXTRA_FLAGS%"=="" set EXTRA_FLAGS=-O3

REM Validate source file exists
if not exist "%SOURCE%" (
    echo [ERROR] Source file not found: "%SOURCE%"
    exit /b 1
)

echo.
echo === Kilo CUDA Build ===
echo Source: %SOURCE%
echo Output: %OUTPUT%
echo Arch: %ARCH%
echo Flags: %EXTRA_FLAGS%
echo.

REM Set up Visual Studio environment using vswhere for portability
set VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe
if exist "%VSWHERE%" (
    for /f "usebackq delims=" %%i in (`"%VSWHERE%" -version "[17.0,)" -latest -property installationPath`) do set VS_DIR=%%i
    if defined VS_DIR (
        call "%VS_DIR%\Common7\Tools\VsDevCmd.bat" -arch=amd64
        goto :compile
    )
)

REM Fallback: try common VS locations
if exist "C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\Tools\VsDevCmd.bat" (
    call "C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\Tools\VsDevCmd.bat" -arch=amd64
    goto :compile
)
if exist "C:\Program Files\Microsoft Visual Studio\2022\Professional\Common7\Tools\VsDevCmd.bat" (
    call "C:\Program Files\Microsoft Visual Studio\2022\Professional\Common7\Tools\VsDevCmd.bat" -arch=amd64
    goto :compile
)
if exist "C:\Program Files\Microsoft Visual Studio\18\Community\Common7\Tools\VsDevCmd.bat" (
    call "C:\Program Files\Microsoft Visual Studio\18\Community\Common7\Tools\VsDevCmd.bat" -arch=amd64
    goto :compile
)

echo [ERROR] Could not find Visual Studio installation.
echo Please install Visual Studio 2022+ with C++ workload or set VSINSTALLDIR manually.
exit /b 1

:compile
REM Compile
echo Compiling...
nvcc %EXTRA_FLAGS% -arch=%ARCH% "%SOURCE%" -o "%OUTPUT%"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Compilation failed!
    exit /b 1
)

echo.
echo === Compilation Successful ===
echo.

REM Run if output exists
if exist "%OUTPUT%" (
    echo Running "%OUTPUT%"...
    echo.
    "%OUTPUT%"
) else (
    echo [WARNING] Output file not found: "%OUTPUT%"
)
