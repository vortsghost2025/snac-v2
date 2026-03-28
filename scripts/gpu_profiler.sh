#!/bin/bash
# scripts/gpu_profiler.sh - Logs real-time GPU metrics

OUTPUT_FILE="sweeps/gpu_telemetry.csv"

if [ "$1" == "start" ]; then
    mkdir -p sweeps
    echo "timestamp,gpu_util_pct,mem_util_pct,temp_c,power_w,clock_sm_mhz" > $OUTPUT_FILE
    # Run nvidia-smi in the background logging every 1 second
    nvidia-smi --query-gpu=timestamp,utilization.gpu,utilization.memory,temperature.gpu,power.draw,clocks.sm --format=csv,noheader,nounits -l 1 >> $OUTPUT_FILE &
    PROFILER_PID=$!
    echo $PROFILER_PID > sweeps/profiler.pid
    echo "🟢 GPU Profiler started in background (PID: $PROFILER_PID)"
elif [ "$1" == "stop" ]; then
    if [ -f sweeps/profiler.pid ]; then
        kill $(cat sweeps/profiler.pid)
        rm sweeps/profiler.pid
        echo "🔴 GPU Profiler stopped. Data saved to $OUTPUT_FILE"
    else
        echo "Profiler PID not found."
    fi
else
    echo "Usage: ./gpu_profiler.sh [start|stop]"
fi
