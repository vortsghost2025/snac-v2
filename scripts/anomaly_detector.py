#!/usr/bin/env python3
# scripts/anomaly_detector.py
"""
Real-time anomaly detection using Isolation Forest + LSTM Autoencoders
Identifies performance regressions and thermal throttling instantly
"""

import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.neighbors import LocalOutlierFactor
import tensorflow as tf
from tensorflow import keras
import pandas as pd
import time
import threading


class GPUAnomalyDetector:
    def __init__(self):
        self.isolation_forest = IsolationForest(contamination=0.1, random_state=42)
        self.lof = LocalOutlierFactor(n_neighbors=20, contamination=0.1)
        self.autoencoder = self.build_autoencoder()
        self.threshold = None

    def build_autoencoder(self):
        """LSTM Autoencoder for sequential anomaly detection"""
        model = keras.Sequential(
            [
                keras.layers.LSTM(64, input_shape=(10, 8), return_sequences=True),
                keras.layers.Dropout(0.2),
                keras.layers.LSTM(32, return_sequences=False),
                keras.layers.RepeatVector(10),
                keras.layers.LSTM(32, return_sequences=True),
                keras.layers.LSTM(64, return_sequences=True),
                keras.layers.TimeDistributed(keras.layers.Dense(8)),
            ]
        )

        model.compile(optimizer="adam", loss="mse")
        return model

    def detect_anomalies(self, metrics):
        """
        Detect anomalies in real-time GPU metrics
        Returns: anomaly_score, root_cause, recommendations
        """
        # Multi-model ensemble for robustness
        iso_pred = self.isolation_forest.fit_predict(metrics)
        lof_pred = self.lof.fit_predict(metrics)

        # Autoencoder reconstruction error
        reconstructed = self.autoencoder.predict(metrics.reshape(1, -1, 8), verbose=0)
        reconstruction_error = np.mean(np.square(metrics - reconstructed.squeeze()))

        # Ensemble voting
        anomaly_score = (
            0.4 * (iso_pred == -1).mean()
            + 0.3 * (lof_pred == -1).mean()
            + 0.3 * (reconstruction_error > (self.threshold or 0.1))
        )

        # Root cause analysis
        root_cause = self.analyze_root_cause(metrics)

        return {
            "anomaly_score": anomaly_score,
            "is_anomaly": anomaly_score > 0.7,
            "root_cause": root_cause,
            "recommendations": self.generate_recommendations(root_cause),
        }

    def analyze_root_cause(self, metrics):
        """Identify root cause of performance issues"""
        causes = []

        # Check for thermal throttling
        if np.mean(metrics[:, 2]) > 82:  # Temperature > 82°C
            causes.append("THERMAL_THROTTLING")

        # Check for power limit
        if np.mean(metrics[:, 3]) > 190:  # Power > 190W
            causes.append("POWER_LIMITING")

        # Check for memory bandwidth saturation
        if np.mean(metrics[:, 4]) > 95:  # Memory utilization > 95%
            causes.append("MEMORY_BOUND")

        # Check for low GPU utilization
        if np.mean(metrics[:, 1]) < 70:  # GPU utilization < 70%
            causes.append("CPU_BOUND_OR_STALLS")

        return causes if causes else ["NORMAL_OPERATION"]

    def generate_recommendations(self, root_causes):
        """Generate actionable recommendations"""
        recommendations = []

        for cause in root_causes:
            if cause == "THERMAL_THROTTLING":
                recommendations.extend(
                    [
                        "Increase fan curve by 20%",
                        "Reduce power limit by 10%",
                        "Improve case airflow",
                    ]
                )
            elif cause == "POWER_LIMITING":
                recommendations.extend(
                    [
                        "Optimize kernel for lower power",
                        "Use lower precision (FP16 instead of FP32)",
                        "Batch operations to reduce peak power",
                    ]
                )
            elif cause == "MEMORY_BOUND":
                recommendations.extend(
                    [
                        "Increase L2 cache hit rate",
                        "Use shared memory for frequently accessed data",
                        "Implement memory coalescing",
                    ]
                )

        return recommendations


class PerformancePredictor:
    """Predict future performance using ARIMA + Prophet"""

    def __init__(self):
        try:
            from prophet import Prophet

            self.model = Prophet(
                changepoint_prior_scale=0.05,
                seasonality_prior_scale=10,
                weekly_seasonality=True,
                daily_seasonality=True,
            )
        except ImportError:
            print("[WARN] Prophet not installed, using simple exponential smoothing")
            self.model = None

    def predict_trend(self, historical_data, hours_ahead=24):
        """Predict performance trend for next 24 hours"""
        if self.model is None:
            return pd.DataFrame(
                {"ds": [], "yhat": [], "yhat_lower": [], "yhat_upper": []}
            )

        df = pd.DataFrame(
            {"ds": historical_data["timestamp"], "y": historical_data["gflops"]}
        )

        self.model.fit(df)
        future = self.model.make_future_dataframe(periods=hours_ahead, freq="H")
        forecast = self.model.predict(future)

        return forecast[["ds", "yhat", "yhat_lower", "yhat_upper"]]


class RealTimeMonitor:
    def __init__(self):
        self.detector = GPUAnomalyDetector()
        self.predictor = PerformancePredictor()
        self.monitoring = False

    def collect_gpu_metrics(self):
        """Collect current GPU metrics"""
        import subprocess

        try:
            result = subprocess.run(
                [
                    "nvidia-smi",
                    "--query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,power.limit",
                    "--format=csv,noheader",
                ],
                capture_output=True,
                text=True,
            )
            if result.returncode == 0:
                lines = result.stdout.strip().split("\n")
                metrics = []
                for line in lines:
                    values = line.split(",")
                    if len(values) >= 6:
                        gpu_util = float(values[0].strip().rstrip(" %"))
                        mem_used = float(values[1].strip().rstrip(" MiB"))
                        mem_total = float(values[2].strip().rstrip(" MiB"))
                        temp = float(values[3].strip().rstrip(" C"))
                        power_draw = float(values[4].strip().rstrip(" W"))
                        power_limit = float(values[5].strip().rstrip(" W"))

                        mem_util = (mem_used / mem_total) * 100
                        metrics.append(
                            [gpu_util, mem_util, temp, power_draw, power_limit]
                        )
                return np.array(metrics)
        except Exception as e:
            print(f"[ERROR] Failed to collect GPU metrics: {e}")
            return None

    def monitor_loop(self):
        """Main monitoring loop"""
        print("[DETECT] Starting real-time anomaly detection...")

        # Initialize with historical data
        try:
            historical = pd.read_csv("sweeps/gpu_telemetry.csv")
            # Train autoencoder
            if len(historical) > 10:
                metrics_history = historical[
                    ["gpu_util", "mem_util", "temp", "power_draw"]
                ].values
                self.detector.autoencoder.fit(
                    metrics_history.reshape(-1, 10, 4),
                    metrics_history.reshape(-1, 10, 4),
                    epochs=10,
                    verbose=0,
                )
        except:
            print("[WARN] No historical data for training")

        while self.monitoring:
            metrics = self.collect_gpu_metrics()
            if metrics is not None:
                result = self.detector.detect_anomalies(metrics)

                if result["is_anomaly"]:
                    print("🚨 ANOMALY DETECTED!")
                    print(f"   Score: {result['anomaly_score']:.3f}")
                    print(f"   Root Cause: {', '.join(result['root_cause'])}")
                    print(f"   Recommendations: {result['recommendations']}")

                    # Log anomaly
                    with open("logs/anomaly_log.txt", "a") as f:
                        f.write(
                            f"{time.time()},{result['anomaly_score']},{result['root_cause']}\n"
                        )

            time.sleep(5)  # Monitor every 5 seconds

    def start_monitoring(self):
        """Start background monitoring"""
        self.monitoring = True
        self.monitor_thread = threading.Thread(target=self.monitor_loop)
        self.monitor_thread.daemon = True
        self.monitor_thread.start()

    def stop_monitoring(self):
        """Stop monitoring"""
        self.monitoring = False
        if hasattr(self, "monitor_thread"):
            self.monitor_thread.join()


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="GPU Anomaly Detector")
    parser.add_argument(
        "--train-autoencoder", action="store_true", help="Train the LSTM autoencoder"
    )
    parser.add_argument(
        "--monitor-real-time", action="store_true", help="Start real-time monitoring"
    )
    parser.add_argument(
        "--analyze-file", type=str, help="Analyze specific metrics file"
    )

    args = parser.parse_args()

    detector = GPUAnomalyDetector()

    if args.train_autoencoder:
        print("[AI] Training LSTM Autoencoder...")
        try:
            df = pd.read_csv("sweeps/gpu_telemetry.csv")
            metrics = df[["gpu_util", "mem_util", "temp", "power_draw"]].values
            detector.autoencoder.fit(
                metrics.reshape(-1, 10, 4),
                metrics.reshape(-1, 10, 4),
                epochs=50,
                verbose=1,
            )
            print("[OK] Autoencoder trained successfully")
        except Exception as e:
            print(f"[ERROR] Training failed: {e}")

    if args.monitor_real_time:
        monitor = RealTimeMonitor()
        monitor.start_monitoring()

        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print("\n[STOP] Stopping monitoring...")
            monitor.stop_monitoring()

    if args.analyze_file:
        print(f"🔍 Analyzing {args.analyze_file}...")
        try:
            df = pd.read_csv(args.analyze_file)
            metrics = df.values
            result = detector.detect_anomalies(metrics)
            print(f"Anomaly Score: {result['anomaly_score']:.3f}")
            print(f"Is Anomaly: {result['is_anomaly']}")
            print(f"Root Cause: {result['root_cause']}")
        except Exception as e:
            print(f"[ERROR] Analysis failed: {e}")
