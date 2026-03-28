@echo off
REM Kilo CUDA Environment Setup
REM Call this before running nvcc to set up VS + CUDA paths

call "C:\Program Files\Microsoft Visual Studio\18\Community\Common7\Tools\VsDevCmd.bat" -arch=amd64

echo.
echo === Kilo CUDA Environment Ready ===
echo VS: %VSCMD_VER%
echo CUDA: 
nvcc --version | findstr /C:"release"
echo.
