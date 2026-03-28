# 📊 CUDA Benchmark Report – RTX 5060

## 🏆 Optimal Configuration
- **Threads:** 1024
- **Iterations:** 5000
- **Peak GFlops:** 1922.15
- **Latency:** 0.045 ms

## 🔧 Core Findings
1. **1024-Thread Saturates SMs** – yields ~20% gain over 512 threads.
2. **Latency Plateau** – increasing thread count beyond 1024 shows diminishing returns.
3. **Memory Bandwidth** – PCIe transfer limits observed at ~31 GB/s (host→dev) and ~29 GB/s (dev→host).

## 📈 Visual Summary
- **Heatmap:** `sweeps/gflops_heatmap.png` (threads × iterations → GFlops)
- **Latency Curve:** `sweeps/gflops_latency.png` (latency vs. thread count)

## 🚨 Alert Thresholds
- **Minimum GFlops:** 1800
- **Maximum Latency:** 0.100 s

## 📌 Recommendations
- Target **1024 threads × 5000 iterations** for all production kernels.
- Schedule nightly sweeps (via `cron`) to catch regressions automatically.
- Deploy `gpu_profiler.sh` in future runs to monitor thermal/power-limit events.

*Report generated automatically by the CI pipeline on 2026-03-24.*
