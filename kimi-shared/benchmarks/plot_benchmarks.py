import csv
from pathlib import Path
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns

BASE = Path(__file__).resolve().parent.parent
CSV_PATH = BASE / "sweeps" / "benchmark_history.csv"
OUT_DIR = BASE / "sweeps"

rows = []
with open(CSV_PATH, newline="", encoding="utf-8") as f:
    reader = csv.reader(f)
    header = next(reader, None)
    for row in reader:
        if len(row) >= 8 and row[0] == "baseline":
            try:
                threads = int(row[1])
                iterations = int(row[2])
                gflops = float(row[3])
                latency = float(row[4])
                rows.append((threads, iterations, gflops, latency))
            except ValueError:
                continue

if not rows:
    raise SystemExit("No benchmark rows found")

bench = pd.DataFrame(rows, columns=["threads", "iterations", "gflops", "latency_ms"])

pivot = bench.pivot_table(
    values="gflops", index="threads", columns="iterations", aggfunc="mean"
)
plt.figure()
plt.gcf().set_size_inches(10, 7)
sns.heatmap(pivot, annot=True, fmt=".3f", cmap="YlOrRd", linewidths=0.5)
plt.title("Average GFlops by Threads and Iterations")
plt.xlabel("Iterations")
plt.ylabel("Threads")
plt.tight_layout()
plt.savefig(OUT_DIR / "gflops_heatmap.png", dpi=200)
plt.close()

thread_data = (
    bench.groupby("threads").agg({"gflops": "mean", "latency_ms": "mean"}).reset_index()
)
thread_data = thread_data.rename(
    columns={"gflops": "avg_gflops", "latency_ms": "avg_latency"}
)
plt.figure()
plt.gcf().set_size_inches(10, 6)
ax = sns.lineplot(
    data=thread_data, x="threads", y="avg_gflops", marker="o", label="Avg GFlops"
)
ax2 = ax.twinx()
sns.lineplot(
    data=thread_data,
    x="threads",
    y="avg_latency",
    marker="s",
    color="green",
    label="Avg Latency",
    ax=ax2,
)
ax.set_title("Average GFlops and Latency by Thread Count")
ax.set_xlabel("Threads")
ax.set_ylabel("Avg GFlops")
ax2.set_ylabel("Avg Latency ms")
ax.legend()
ax2.legend()
plt.tight_layout()
plt.savefig(OUT_DIR / "gflops_latency.png", dpi=200)
plt.close()

summary = thread_data[["threads", "avg_gflops", "avg_latency"]]
summary.to_csv(OUT_DIR / "benchmark_summary.csv", index=False)
print("SUCCESS: Visualizations and summary CSV saved in", OUT_DIR)
