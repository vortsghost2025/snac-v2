#!/usr/bin/env python3
# plot_benchmarks.py - Benchmark Visualization Script
# Generates plots and heatmaps from benchmark data

import csv
import os
import sys
from datetime import datetime
from collections import defaultdict

# Try to import matplotlib, fallback to text if not available
try:
    import matplotlib

    matplotlib.use("Agg")  # Non-interactive backend
    import matplotlib.pyplot as plt
    import matplotlib.cm as cm

    HAS_MATPLOTLIB = True
except ImportError:
    HAS_MATPLOTLIB = False
    print("Note: matplotlib not found, will generate text plots only")

# Configuration
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RESULTS_DIR = os.path.join(PROJECT_ROOT, "sweeps")
CSV_FILE = os.path.join(RESULTS_DIR, "benchmark_history.csv")


def load_data():
    """Load benchmark data from CSV"""
    data = []
    with open(CSV_FILE, "r") as f:
        reader = csv.DictReader(f)
        for row in reader:
            data.append(
                {
                    "threads": int(row["threads"]),
                    "grid_size": int(row["grid_size"]),
                    "iterations": int(row["iterations"]),
                    "time_ms": float(row["time_ms"]),
                    "gflops": float(row["gflops"]),
                    "power_w": float(row["power_w"]) if row["power_w"] else 0,
                    "temp_c": float(row["temp_c"]) if row["temp_c"] else 0,
                }
            )
    return data


def analyze_data(data):
    """Analyze benchmark data"""
    analysis = {
        "by_threads": defaultdict(list),
        "by_grid": defaultdict(list),
        "by_iterations": defaultdict(list),
        "by_threads_grid": defaultdict(lambda: defaultdict(list)),
    }

    for d in data:
        analysis["by_threads"][d["threads"]].append(d["gflops"])
        analysis["by_grid"][d["grid_size"]].append(d["gflops"])
        analysis["by_iterations"][d["iterations"]].append(d["gflops"])
        analysis["by_threads_grid"][d["threads"]][d["grid_size"]].append(d["gflops"])

    return analysis


def plot_with_matplotlib(data, analysis):
    """Generate matplotlib plots"""
    output_dir = RESULTS_DIR

    # 1. GFLOPS by Thread Count
    plt.figure(figsize=(12, 5))

    threads = sorted(analysis["by_threads"].keys())
    avg_gflops = [
        sum(analysis["by_threads"][t]) / len(analysis["by_threads"][t]) for t in threads
    ]

    plt.subplot(1, 2, 1)
    plt.bar(range(len(threads)), avg_gflops, color="steelblue")
    plt.xticks(range(len(threads)), threads)
    plt.xlabel("Thread Block Size")
    plt.ylabel("Average GFLOPS")
    plt.title("Performance by Thread Count")
    plt.grid(True, alpha=0.3)

    # 2. GFLOPS by Grid Size
    grids = sorted(analysis["by_grid"].keys())
    avg_gflops_grid = [
        sum(analysis["by_grid"][g]) / len(analysis["by_grid"][g]) for g in grids
    ]

    plt.subplot(1, 2, 2)
    plt.bar(range(len(grids)), avg_gflops_grid, color="coral")
    plt.xticks(range(len(grids)), grids)
    plt.xlabel("Grid Size")
    plt.ylabel("Average GFLOPS")
    plt.title("Performance by Grid Size")
    plt.grid(True, alpha=0.3)

    plt.tight_layout()
    plt.savefig(os.path.join(output_dir, "gflops_comparison.png"), dpi=150)
    plt.close()

    # 3. Heatmap: Threads vs Grid
    plt.figure(figsize=(10, 8))

    threads = sorted(analysis["by_threads_grid"].keys())
    grids = sorted(analysis["by_threads_grid"][threads[0]].keys())

    heatmap_data = []
    for t in threads:
        row = []
        for g in grids:
            vals = analysis["by_threads_grid"][t][g]
            row.append(sum(vals) / len(vals) if vals else 0)
        heatmap_data.append(row)

    plt.imshow(heatmap_data, cmap="YlOrRd", aspect="auto")
    plt.colorbar(label="GFLOPS")
    plt.xticks(range(len(grids)), grids)
    plt.yticks(range(len(threads)), threads)
    plt.xlabel("Grid Size")
    plt.ylabel("Thread Block Size")
    plt.title("GFLOPS Heatmap: Threads vs Grid")

    # Add values to heatmap
    for i in range(len(threads)):
        for j in range(len(grids)):
            plt.text(
                j, i, f"{heatmap_data[i][j]:.0f}", ha="center", va="center", fontsize=8
            )

    plt.tight_layout()
    plt.savefig(os.path.join(output_dir, "gflops_heatmap.png"), dpi=150)
    plt.close()

    # 4. Latency vs Throughput
    plt.figure(figsize=(10, 6))

    times = [d["time_ms"] for d in data]
    gflops = [d["gflops"] for d in data]

    plt.scatter(times, gflops, alpha=0.6, c="steelblue", s=50)
    plt.xlabel("Execution Time (ms)")
    plt.ylabel("GFLOPS")
    plt.title("Latency vs Throughput")
    plt.grid(True, alpha=0.3)

    plt.tight_layout()
    plt.savefig(os.path.join(output_dir, "gflops_latency.png"), dpi=150)
    plt.close()

    print(f"Generated plots in {output_dir}:")
    print("  - gflops_comparison.png")
    print("  - gflops_heatmap.png")
    print("  - gflops_latency.png")


def plot_text(data, analysis):
    """Generate text-based plots when matplotlib unavailable"""
    output_dir = RESULTS_DIR

    # Threads comparison (ASCII bar chart)
    print("\n=== Performance by Thread Count ===")
    threads = sorted(analysis["by_threads"].keys())
    max_gflops = max(
        sum(analysis["by_threads"][t]) / len(analysis["by_threads"][t]) for t in threads
    )

    for t in threads:
        avg = sum(analysis["by_threads"][t]) / len(analysis["by_threads"][t])
        bar_len = int(avg / max_gflops * 40)
        bar = "█" * bar_len
        print(f"  {t:5d} threads: {bar} {avg:.1f} GFLOPS")

    # Grid comparison
    print("\n=== Performance by Grid Size ===")
    grids = sorted(analysis["by_grid"].keys())
    max_gflops_grid = max(
        sum(analysis["by_grid"][g]) / len(analysis["by_grid"][g]) for g in grids
    )

    for g in grids:
        avg = sum(analysis["by_grid"][g]) / len(analysis["by_grid"][g])
        bar_len = int(avg / max_gflops_grid * 40)
        bar = "█" * bar_len
        print(f"  {g:5d} grid:   {bar} {avg:.1f} GFLOPS")


def main():
    print("=== Benchmark Plot Generator ===")
    print(f"Project root: {PROJECT_ROOT}")
    print(f"Results dir: {RESULTS_DIR}")
    print(f"CSV file: {CSV_FILE}")
    print("")

    if not os.path.exists(CSV_FILE):
        print(f"ERROR: No data file found at {CSV_FILE}")
        print("Run kilo-benchmark-sweep-fixed.sh first!")
        sys.exit(1)

    # Load data
    print("Loading benchmark data...")
    data = load_data()
    print(f"Loaded {len(data)} benchmark runs")

    # Analyze
    print("Analyzing data...")
    analysis = analyze_data(data)

    # Generate plots
    if HAS_MATPLOTLIB:
        print("Generating matplotlib plots...")
        plot_with_matplotlib(data, analysis)
    else:
        print("Generating text plots...")
        plot_text(data, analysis)

    # Generate summary
    print("\n=== Summary ===")
    if data:
        max_gflops = max(d["gflops"] for d in data)
        avg_gflops = sum(d["gflops"] for d in data) / len(data)
        avg_time = sum(d["time_ms"] for d in data) / len(data)

        best = max(data, key=lambda x: x["gflops"])

        print(f"Total runs: {len(data)}")
        print(f"Best GFLOPS: {max_gflops:.1f}")
        print(f"Average GFLOPS: {avg_gflops:.1f}")
        print(f"Average time: {avg_time:.1f}ms")
        print(
            f"Best config: threads={best['threads']}, grid={best['grid_size']}, iter={best['iterations']}"
        )

        if best.get("power_w", 0) > 0:
            efficiency = best["gflops"] / best["power_w"]
            print(f"Best efficiency: {efficiency:.1f} GFLOPS/W")

    print("\n=== Plot Generation Complete ===")


if __name__ == "__main__":
    main()
