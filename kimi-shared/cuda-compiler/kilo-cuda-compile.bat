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

echo.
echo === Kilo CUDA Build ===
echo Source: %SOURCE%
echo Output: %OUTPUT%
echo Arch: %ARCH%
echo Flags: %EXTRA_FLAGS%
echo.

REM Set up environment
call "C:\Program Files\Microsoft Visual Studio\18\Community\Common7\Tools\VsDevCmd.bat" -arch=amd64

REM Compile
echo Compiling...
nvcc %EXTRA_FLAGS% -arch=%ARCH% %SOURCE% -o %OUTPUT%

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Compilation failed!
    exit /b 1
)

echo.
echo === Compilation Successful ===
echo.

REM Run if output exists
if exist %OUTPUT% (
    echo Running %OUTPUT%...
    echo.
    %OUTPUT%
) else (
    echo [WARNING] Output file not found: %OUTPUT%
)
