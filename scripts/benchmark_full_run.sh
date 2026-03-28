#!/bin/bash
# Benchmark Full Run – sweep -> analyze -> visualize -> regress check

set -e

echo "🔨 Compiling advanced kernels..."
mkdir -p build
nvcc -O3 -arch=sm_86 src/matrix_benchmark.cu -o build/matrix_benchmark.exe
nvcc -O3 -arch=sm_86 src/bandwidth_test.cu -o build/bandwidth_test.exe

echo "📈 Starting GPU Profiler..."
chmod +x scripts/gpu_profiler.sh
./scripts/gpu_profiler.sh start

echo "🔥 Running VRAM Bandwidth Test..."
./build/bandwidth_test.exe

echo "🔥 Running Matrix TFlops Test..."
./build/matrix_benchmark.exe

echo "🛑 Stopping GPU Profiler..."
./scripts/gpu_profiler.sh stop

echo "🚨 Running Regression Alert System..."
python scripts/alert_system.py

echo "✅ Full RTX Suite Complete."
