#!/bin/bash
# scripts/control_panel.sh
# Control panel for managing the next-gen benchmark suite

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$SCRIPT_DIR/../.pids"

show_status() {
    echo "📊 NEXT-GEN BENCHMARK SUITE STATUS"
    echo "=================================="

    # Check PIDs
    if [ -f "$PID_FILE" ]; then
        read -r ANOMALY_PID ORCHESTRATOR_PID DASHBOARD_PID EVOLUTION_PID < "$PID_FILE"

        echo "🔬 Anomaly Detector: $(check_pid $ANOMALY_PID)"
        echo "⚡ GPU Orchestrator: $(check_pid $ORCHESTRATOR_PID)"
        echo "📊 ML Dashboard: $(check_pid $DASHBOARD_PID)"
        echo "🔄 Evolution Engine: $(check_pid $EVOLUTION_PID)"
    else
        echo "⚠️ No PID file found - services may not be running"
    fi

    echo ""
    echo "🔍 System Resources:"
    if command -v nvidia-smi &> /dev/null; then
        nvidia-smi --query-gpu=name,memory.used,memory.total,utilization.gpu --format=csv,noheader
    else
        echo "NVIDIA drivers not available"
    fi

    echo ""
    echo "📈 Recent Activity:"
    if [ -d "logs" ]; then
        find logs -name "*.log" -exec tail -1 {} \; 2>/dev/null | head -5
    fi
}

check_pid() {
    local pid=$1
    if kill -0 "$pid" 2>/dev/null; then
        echo "✅ Running (PID: $pid)"
    else
        echo "❌ Stopped"
    fi
}

optimize_now() {
    echo "🎯 Running immediate optimization..."

    if command -v python3 &> /dev/null; then
        echo "🧠 Neural optimization..."
        python3 scripts/neural_optimizer.py --optimize --iterations=100

        echo "⚛️ Quantum optimization..."
        python3 scripts/quantum_optimizer.py --run --iterations=200
    else
        echo "❌ Python3 not available"
    fi
}

generate_report() {
    echo "📋 Generating comprehensive report..."

    REPORT_FILE="benchmark_report_$(date +%Y%m%d_%H%M%S).md"

    {
        echo "# GPU Benchmark Suite Report"
        echo "Generated: $(date)"
        echo ""

        echo "## System Information"
        echo "\`\`\`"
        uname -a
        if command -v nvidia-smi &> /dev/null; then
            nvidia-smi --query-gpu=name,driver_version --format=csv
        fi
        echo "\`\`\`"
        echo ""

        echo "## Benchmark Results"
        if [ -f "sweeps/benchmark_summary.csv" ]; then
            echo "\`\`\`csv"
            cat sweeps/benchmark_summary.csv
            echo "\`\`\`"
        else
            echo "No benchmark summary available"
        fi
        echo ""

        echo "## Optimization Recommendations"
        echo "- Run neural optimization for adaptive configurations"
        echo "- Monitor GPU temperatures (< 80°C recommended)"
        echo "- Use quantum-inspired algorithms for complex parameter spaces"
        echo ""

        echo "## Anomaly Detection Status"
        if [ -f "logs/anomaly_log.txt" ]; then
            echo "Recent anomalies:"
            tail -5 logs/anomaly_log.txt
        else
            echo "No anomalies detected"
        fi
    } > "$REPORT_FILE"

    echo "✅ Report saved to: $REPORT_FILE"
}

stop_all() {
    echo "🛑 Stopping all services..."

    if [ -f "$PID_FILE" ]; then
        read -r ANOMALY_PID ORCHESTRATOR_PID DASHBOARD_PID EVOLUTION_PID < "$PID_FILE"

        # Stop services gracefully
        for pid in $ANOMALY_PID $ORCHESTRATOR_PID $DASHBOARD_PID $EVOLUTION_PID; do
            if kill -0 "$pid" 2>/dev/null; then
                echo "Stopping PID $pid..."
                kill "$pid" 2>/dev/null
                sleep 1
                if kill -0 "$pid" 2>/dev/null; then
                    kill -9 "$pid" 2>/dev/null
                fi
            fi
        done

        rm -f "$PID_FILE"
    fi

    echo "✅ All services stopped"
}

case "$1" in
    "--status"|"-s")
        show_status
        ;;
    "--optimize-now"|"-o")
        optimize_now
        ;;
    "--generate-report"|"-r")
        generate_report
        ;;
    "--stop-all"|"-x")
        stop_all
        ;;
    *)
        echo "Usage: $0 {--status|--optimize-now|--generate-report|--stop-all}"
        echo ""
        echo "Commands:"
        echo "  -s, --status         Show suite status and system info"
        echo "  -o, --optimize-now   Run immediate optimization cycle"
        echo "  -r, --generate-report Generate comprehensive report"
        echo "  -x, --stop-all       Stop all running services"
        exit 1
        ;;
esac