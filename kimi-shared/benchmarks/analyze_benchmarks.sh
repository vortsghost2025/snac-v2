#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CSV="$SCRIPT_DIR/../sweeps/benchmark_history_clean.csv"

# fallback to benchmark_history.csv if _clean doesn't exist
if [[ ! -f "$CSV" ]]; then
  CSV="$SCRIPT_DIR/../sweeps/benchmark_history.csv"
fi

if [[ ! -f "$CSV" ]]; then
  echo "ERROR: benchmark CSV not found. Checked:"
  echo "  $SCRIPT_DIR/../sweeps/benchmark_history_clean.csv"
  echo "  $SCRIPT_DIR/../sweeps/benchmark_history.csv"
  exit 1
fi

echo "=== Using CSV: $CSV ==="
echo "=== Top 5 Configurations by GFLops ==="
cat "$CSV" | tail -n +2 | sort -t',' -k4 -rn | head -5 | \
  awk -F',' '{printf "Threads: %4s | Iterations: %4s | GFLops: %6.2f | Latency: %6.3f ms\n", $2, $3, $4, $5}'

