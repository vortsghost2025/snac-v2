#!/bin/bash
# analyze_benchmarks.sh - Benchmark Analysis Script
# Analyzes benchmark results and generates insights

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${BLUE}=== Benchmark Analysis ===${NC}"
echo ""

# Configuration
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RESULTS_DIR="$PROJECT_ROOT/sweeps"
CSV_FILE="$RESULTS_DIR/benchmark_history.csv"
SUMMARY_FILE="$RESULTS_DIR/benchmark_summary.csv"

# Check if data exists
if [ ! -f "$CSV_FILE" ]; then
    echo -e "${RED}ERROR: No benchmark data found at $CSV_FILE${NC}"
    echo "Run kilo-benchmark-sweep-fixed.sh first!"
    exit 1
fi

echo -e "${GREEN}Found benchmark data: $CSV_FILE${NC}"
echo ""

# ============================================
# ANALYSIS 1: Basic Statistics
# ============================================
echo -e "${CYAN}=== Basic Statistics ===${NC}"

TOTAL_RUNS=$(tail -n +2 "$CSV_FILE" | wc -l)
echo "Total benchmark runs: $TOTAL_RUNS"

# Get column headers
HEADERS=$(head -1 "$CSV_FILE")
echo "Data columns: $HEADERS"
echo ""

# ============================================
# ANALYSIS 2: Performance Metrics
# ============================================
echo -e "${CYAN}=== Performance Metrics ===${NC}"

# Calculate averages
AVG_TIME=$(tail -n +2 "$CSV_FILE" | cut -d',' -f4 | awk '{sum+=$1; count++} END {print sum/count}')
AVG_GFLOPS=$(tail -n +2 "$CSV_FILE" | cut -d',' -f6 | awk '{sum+=$1; count++} END {print sum/count}')

echo "Average execution time: ${AVG_TIME}ms"
echo "Average GFLOPS: ${AVG_GFLOPS}"
echo ""

# ============================================
# ANALYSIS 3: Best Configurations
# ============================================
echo -e "${CYAN}=== Best Configurations ===${NC}"

echo "Top 5 by GFLOPS:"
tail -n +2 "$CSV_FILE" | sort -t',' -k6 -n -r | head -5 | while IFS=',' read -r ts threads grid iter time gflops power temp; do
    echo "  GFLOPS: $gflops | threads: $threads | grid: $grid | iter: $iter | time: ${time}ms"
done
echo ""

echo "Top 5 by execution time:"
tail -n +2 "$CSV_FILE" | sort -t',' -k4 -n | head -5 | while IFS=',' read -r ts threads grid iter time gflops power temp; do
    echo "  Time: ${time}ms | GFLOPS: $gflops | threads: $threads | grid: $grid"
done
echo ""

# ============================================
# ANALYSIS 4: Parameter Impact
# ============================================
echo -e "${CYAN}=== Parameter Impact Analysis ===${NC}"

echo "Impact of thread count (average GFLOPS):"
tail -n +2 "$CSV_FILE" | cut -d',' -f2,6 | sort -t',' -k1 -n | \
    awk -F',' '{sum[$1]+=$2; count[$1]++} END {for (t in count) print "  threads=" t ": avg " sum[t]/count[t] " GFLOPS"}' | \
    sort -t'=' -k2 -n -r
echo ""

echo "Impact of grid size (average GFLOPS):"
tail -n +2 "$CSV_FILE" | cut -d',' -f3,6 | sort -t',' -k1 -n | \
    awk -F',' '{sum[$1]+=$2; count[$1]++} END {for (g in count) print "  grid=" g ": avg " sum[g]/count[g] " GFLOPS"}' | \
    sort -t'=' -k2 -n -r
echo ""

# ============================================
# ANALYSIS 5: Power Efficiency
# ============================================
echo -e "${CYAN}=== Power Efficiency Analysis ===${NC}"

echo "GFLOPS per Watt (top 10):"
tail -n +2 "$CSV_FILE" | awk -F',' '{if ($7 > 0) print $6/$7 " " $0}' | sort -n -r | head -10 | \
    while read eff rest; do
        echo "  Efficiency: $eff GFLOPS/W | GFLOPS: $(echo $rest | cut -d',' -f6) | Power: $(echo $rest | cut -d',' -f7)W"
    done
echo ""

# ============================================
# ANALYSIS 6: Thermal Analysis
# ============================================
echo -e "${CYAN}=== Thermal Analysis ===${NC}"

MAX_TEMP=$(tail -n +2 "$CSV_FILE" | cut -d',' -f8 | sort -n | tail -1)
AVG_TEMP=$(tail -n +2 "$CSV_FILE" | cut -d',' -f8 | awk '{sum+=$1; count++} END {print sum/count}')

echo "Maximum temperature: ${MAX_TEMP}C"
echo "Average temperature: ${AVG_TEMP}C"

if (( $(echo "$MAX_TEMP > 80" | bc -l) )); then
    echo -e "${RED}WARNING: Temperature exceeded 80C - thermal throttling may occur!${NC}"
elif (( $(echo "$MAX_TEMP > 70" | bc -l) )); then
    echo -e "${YELLOW}CAUTION: Temperature above 70C - consider improving cooling${NC}"
else
    echo -e "${GREEN}Temperature in safe range${NC}"
fi
echo ""

# ============================================
# GENERATE REPORT
# ============================================
echo -e "${CYAN}=== Generating Report ===${NC}"

REPORT_FILE="$RESULTS_DIR/analysis_report.txt"

cat > "$REPORT_FILE" << EOF
GPU BENCHMARK ANALYSIS REPORT
Generated: $(date)
===========================

BASIC STATISTICS
-----------------
Total Runs: $TOTAL_RUNS
Average Time: ${AVG_TIME}ms
Average GFLOPS: ${AVG_GFLOPS}

BEST CONFIGURATIONS
------------------
$(tail -n +2 "$CSV_FILE" | sort -t',' -k6 -n -r | head -5 | while IFS=',' read -r ts threads grid iter time gflops power temp; do echo "GFLOPS: $gflops | threads: $threads | grid: $grid | iter: $iter"; done)

THERMAL STATUS
--------------
Max Temp: ${MAX_TEMP}C
Avg Temp: ${AVG_TEMP}C

EOF

echo -e "${GREEN}Report saved to: $REPORT_FILE${NC}"
echo ""
echo -e "${BLUE}=== Analysis Complete ===${NC}"
