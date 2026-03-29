@echo off
setlocal

REM Check if nvcc is available
where nvcc >nul 2>nul
if errorlevel 1 (
    echo ERROR: nvcc ^(NVIDIA CUDA Compiler^) not found in PATH.
    echo Please install CUDA Toolkit and ensure nvcc is in your PATH.
    exit /b 1
)

echo Building CUDA kernels for SNAC v2...

REM Create build directory if it doesn't exist
if not exist "..\..\build" mkdir "..\..\build"

REM Compile the CUDA kernel to a shared library
REM Using sm_86 as default target (Ada Lovelace / RTX 40-series)
REM Add additional --generate-code flags for multi-arch support
nvcc -O3 -arch=sm_86 --generate-code arch=compute_86,code=sm_86 -shared -o ..\..\build\libmetabolism.dll metabolism.cu

if %errorlevel% equ 0 (
    echo Successfully built libmetabolism.dll
    echo Location: ..\..\build\libmetabolism.dll
) else (
    echo Failed to build CUDA kernel
    exit /b 1
)

endlocal
