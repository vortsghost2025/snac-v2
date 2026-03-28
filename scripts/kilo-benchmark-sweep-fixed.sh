#!/bin/bash
# kilo-benchmark-sweep-fixed.sh - GPU Parameter Sweep Script
# Optimized for GTX 5060 / CUDA compute capability 8.9+

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== GPU Benchmark Parameter Sweep ===${NC}"
echo "GTX 5060 Optimized Sweep Script"
echo ""

# Configuration
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$PROJECT_ROOT/we/src"
BUILD_DIR="$PROJECT_ROOT/we/build"
RESULTS_DIR="$PROJECT_ROOT/sweeps"
LOG_FILE="$RESULTS_DIR/sweep_log.txt"

# Create results directory
mkdir -p "$RESULTS_DIR"

# GTX 5060 optimal parameters (compute 8.9, ~1536 cores)
THREAD_BLOCKS=(256 512 1024 1536 2048)
GRID_SIZES=(32 64 128 256 512)
ITERATIONS=(1000 5000 10000 50000)

# Function to log messages
log() {
    echo -e "$1" | tee -a "$LOG_FILE"
}

# Function to check CUDA availability
check_cuda() {
    if ! command -v nvcc &> /dev/null; then
        log "${RED}ERROR: nvcc not found. Please install CUDA Toolkit.${NC}"
        exit 1
    fi
    
    CUDA_VERSION=$(nvcc --version | grep -oP 'release \K[0-9]+\.[0-9]+')
    log "${GREEN}CUDA Version: $CUDA_VERSION${NC}"
    
    if command -v nvidia-smi &> /dev/null; then
        GPU_NAME=$(nvidia-smi --query-gpu=name --format=csv,noheader)
        GPU_MEMORY=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader)
        log "${GREEN}GPU: $GPU_NAME${NC}"
        log "${GREEN}VRAM: $GPU_MEMORY${NC}"
    fi
}

# Function to compile benchmark
compile_benchmark() {
    log "${YELLOW}Compiling benchmark...${NC}"
    
    cd "$SRC_DIR"
    
    # GTX 5060 optimized compilation
    nvcc -O3 --use_fast_math \
        -arch=sm_89 \
        -o benchmark_sweep.exe \
        benchmark.cu 2>&1 | tee -a "$LOG_FILE"
    
    if [ -f "benchmark_sweep.exe" ]; then
        log "${GREEN}Compilation successful!${NC}"
    else
        log "${RED}Compilation failed!${NC}"
        exit 1
    fi
}

# Function to run sweep
run_sweep() {
    log "${YELLOW}Starting parameter sweep...${NC}"
    
    CSV_FILE="$RESULTS_DIR/benchmark_history.csv"
    echo "timestamp,threads,grid_size,iterations,time_ms,gflops,power_w,temp_c" > "$CSV_FILE"
    
    for threads in "${THREAD_BLOCKS[@]}"; do
        for grid in "${GRID_SIZES[@]}"; do
            for iter in "${ITERATIONS[@]}"; do
                log "Testing: threads=$threads grid=$grid iter=$iter"
                
                # Get GPU stats before
                POWER_BEFORE=$(nvidia-smi --query-gpu=power.draw --format=csv,noheader 2>/dev/null || echo "0")
                TEMP_BEFORE=$(nvidia-smi --query-gpu=temperature.gpu --format=csv,noheader 2>/dev/null || echo "0")
                
                # Run benchmark
                START_TIME=$(date +%s%N)
                OUTPUT=$(./benchmark_sweep.exe $threads $grid $iter 2>&1)
                END_TIME=$(date +%s%N)
                
                # Parse results
                TIME_MS=$(echo "$OUTPUT" | grep -oP 'Time: \K[0-9.]+' || echo "0")
                GFLOPS=$(echo "$OUTPUT" | grep -oP 'GFLOPS: \K[0-9.]+' || echo "0")
                
                # Get GPU stats after
                POWER_AFTER=$(nvidia-smi --query-gpu=power.draw --format=csv,noheader 2>/dev/null || echo "0")
                TEMP_AFTER=$(nvidia-smi --query-gpu=temperature.gpu --format=csv,noheader 2>/dev/null || echo "0")
                
                # Calculate average
                POWER_AVG=$(echo "($POWER_BEFORE + $POWER_AFTER) / 2" | bc 2>/dev/null || echo "0")
                TEMP_AVG=$(echo "($TEMP_BEFORE + $TEMP_AFTER) / 2" | bc 2>/dev/null || echo "0")
                
                # Write to CSV
                echo "$(date +%s),$threads,$grid,$iter,$TIME_MS,$GFLOPS,$POWER_AVG,$TEMP_AVG" >> "$CSV_FILE"
                
                log "  -> Time: ${TIME_MS}ms, GFLOPS: ${GFLOPS}, Power: ${POWER_AVG}W, Temp: ${TEMP_AVG}C"
            done
        done
    done
    
    log "${GREEN}Sweep complete! Results saved to: $CSV_FILE${NC}"
}

# Function to generate summary
generate_summary() {
    log "${YELLOW}Generating summary...${NC}"
    
    CSV_FILE="$RESULTS_DIR/benchmark_history.csv"
    SUMMARY_FILE="$RESULTS_DIR/benchmark_summary.csv"
    
    # Calculate statistics
    if [ -f "$CSV_FILE" ]; then
        echo "metric,value" > "$SUMMARY_FILE"
        echo "total_runs,$(tail -n +2 "$CSV_FILE" | wc -l)" >> "$SUMMARY_FILE"
        echo "avg_gflops,$(tail -n +2 "$CSV_FILE" | cut -d',' -f6 | awk '{sum+=$1; count++} END {print sum/count}')" >> "$SUMMARY_FILE"
        echo "max_gflops,$(tail -n +2 "$CSV_FILE" | cut -d',' -f6 | sort -n | tail -1)" >> "$SUMMARY_FILE"
        echo "best_config,$(tail -n +2 "$CSV_FILE" | sort -t',' -k6 -n | tail -1 | cut -d',' -f2,3,4)" >> "$SUMMARY_FILE"
        
        log "${GREEN}Summary saved to: $SUMMARY_FILE${NC}"
    fi
}

# Main execution
main() {
    check_cuda
    compile_benchmark
    run_sweep
    generate_summary
    
    log "${BLUE}=== Sweep Complete ===${NC}"
    log "Results: $RESULTS_DIR/benchmark_history.csv"
    log "Summary: $RESULTS_DIR/benchmark_summary.csv"
}

# Run main
main "$@"
