@echo off
setlocal

REM Check if nvcc is available
where nvcc >nul 2>nul
if %errorlevel% neq 0 (
    echo ERROR: nvcc (NVIDIA CUDA Compiler) not found in PATH.
    echo Please install CUDA Toolkit and ensure nvcc is in your PATH.
    exit /b 1
)

echo Building CUDA kernels for SNAC v2...

REM Create build directory if it doesn't exist
if not exist "..\..\build" mkdir "..\..\build"

REM Compile the CUDA kernel to a shared library
nvcc -Xcompiler -fPIC -shared -o ..\..\build\libmetabolism.dll metabolism.cu

if %errorlevel% equ 0 (
    echo Successfully built libmetabolism.dll
    echo Location: ..\..\build\libmetabolism.dll
) else (
    echo Failed to build CUDA kernel
    exit /b 1
)

endlocal