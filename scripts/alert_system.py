#!/usr/bin/env python3
import pandas as pd
import sys

MIN_GFLOPS = 1800.0
MAX_LATENCY_MS = 0.100

def check_performance():
    df = pd.read_csv('sweeps/benchmark_history.csv')
    df.columns = df.columns.str.strip()

    if 'gflops' in df.columns:
        best_run = df.loc[df['gflops'].idxmax()]
    elif 'GFlops' in df.columns:
        best_run = df.loc[df['GFlops'].idxmax()]
    else:
        print('ERROR: gflops column not found')
        sys.exit(2)

    gflops = float(best_run.get('gflops', best_run.get('GFlops', 0)))
    latency_ms = float(best_run.get('latency_ms', best_run.get('Latency_ms', best_run.get('latency', 0))))

    print(f"[CHAMPION] Top Perf: {gflops:.2f} GFlops | {latency_ms:.4f} ms")

    if gflops < MIN_GFLOPS:
        print(f"[ERROR] ALERT: Performance Regression! GFlops dropped below {MIN_GFLOPS}")
        sys.exit(1)
    if latency_ms > MAX_LATENCY_MS:
        print(f"[ERROR] ALERT: Latency Spike! Latency is above {MAX_LATENCY_MS} ms")
        sys.exit(1)

    print('[OK] Performance checks passed. Code is optimized.')
    sys.exit(0)

if __name__ == '__main__':
    check_performance()
