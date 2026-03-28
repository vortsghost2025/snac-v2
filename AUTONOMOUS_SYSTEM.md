# SNAC v2 Autonomous Learning System

This document describes the self-running, self-learning, self-adjusting SNAC v2 system with GPU acceleration.

## Overview

The SNAC v2 system is a complete autonomous learning platform that:
- Operates 24/7 with automatic restarts
- Continuously learns from interactions and feedback
- Automatically adapts parameters for optimal performance
- Uses GPU acceleration for all computationally intensive tasks
- Monitors itself and adjusts based on performance metrics

## System Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Agent        │───▶│  Message Bus     │───▶│   Mesh (Node)   │
│  (dev-kilo)    │    │   (Redis)        │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         ▲                        ▲                       │
         │                        │                       ▼
         │                ┌──────────────────┐    ┌─────────────────┐
         │                │  Metrics         │◀───│  Trainer        │
         │                │  (Prometheus)    │    │  (Python/GPU)   │
         │                └──────────────────┘    └─────────────────┘
         │                        │                       │
         └────────────────────────┼───────────────────────┘
                                  │
                         ┌──────────────────┐
                         │  Meta-Agent      │
                         │  (Model Swapper) │
                         └──────────────────┘
```

## Components

### 1. Core API Service (`snac-api`)
- Node.js API with GPU acceleration
- Handles all requests and responses
- Integrates feedback collection and adaptive parameter tuning

### 2. Message Bus (`redis`)
- Stores feedback and training data
- Coordinates between system components

### 3. Vector Database (`qdrant`)
- GPU-accelerated similarity search
- Stores embeddings for context retrieval

### 4. Training Service (`trainer`)
- Continuously fine-tunes models based on feedback
- Uses GPU acceleration for rapid model updates
- Registers new models in MLflow

### 5. Model Registry (`mlflow`)
- Tracks all model versions
- Manages model lifecycle (staging, production)

### 6. Model Swapper (`ModelSwapper.js`)
- Monitors MLflow for new production models
- Automatically swaps in new models without downtime

### 7. Parameter Bandit (`ParamBandit.js`)
- Continuously experiments with inference parameters
- Optimizes temperature, top_p, and GPU layer allocation
- Uses UCB algorithm to balance exploration/exploitation

### 8. Monitoring Stack (`prometheus`, `grafana`)
- Collects system metrics
- Monitors GPU utilization and performance
- Provides alerting and visualization

## Setup and Deployment

### Prerequisites

- Docker and Docker Compose
- NVIDIA GPU with CUDA support
- NVIDIA Container Toolkit installed

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd snac-v2/backend
```

2. Build and start the system:
```bash
# Build all Docker images
npm run docker-build

# Start all services
npm run docker-up
```

Or directly with Docker Compose:
```bash
docker compose build
docker compose up -d
```

### Verification

Check that all services are running:
```bash
docker compose ps
```

Verify the system health:
```bash
curl http://localhost:8000/health
```

Check metrics:
```bash
curl http://localhost:8000/metrics
```

Access the monitoring dashboard at:
- Prometheus: http://localhost:9090
- Grafana: http://localhost:3000 (admin/admin)

## Operation

### Automatic Learning Loop

1. **Agents** generate requests → API responds
2. **FeedbackCollector** captures response quality and performance metrics
3. **Training Queue** accumulates feedback samples in Redis
4. **Trainer** periodically fine-tunes the model on GPU using accumulated feedback
5. **MLflow** registers new model versions
6. **ModelSwapper** automatically deploys new production models
7. **ParamBandit** continuously optimizes inference parameters
8. **Monitoring** tracks all metrics and enables alerting

### Configuration

Key environment variables:

- `BASE_MODEL`: Base model to fine-tune (default: microsoft/DialoGPT-medium)
- `TRAIN_BATCH_SIZE`: Size of training batches (default: 256)
- `MLFLOW_URL`: MLflow tracking server URL (default: http://mlflow:5000)
- `REDIS_URL`: Redis connection URL (default: redis://redis:6379)
- `QDRANT_HOST`: Qdrant instance host (default: qdrant)

### GPU Utilization

The system leverages GPU acceleration for:

1. **Model Inference**: Through llama.cpp with CUDA
2. **Model Training**: Fine-tuning with PyTorch and CUDA
3. **Vector Operations**: Similarity search with Qdrant GPU
4. **Custom Kernels**: Custom CUDA kernels for specific operations

## Monitoring and Observability

The system provides comprehensive monitoring:

- **Request Latency**: Per-endpoint timing metrics
- **Token Cost**: Tracking of computational expenses
- **Model Versions**: Tracking of deployed model versions
- **GPU Utilization**: Real-time GPU usage metrics
- **Training Jobs**: Status of ongoing training processes
- **Parameter Optimization**: Bandit algorithm performance

## Safety and Guardrails

The system includes multiple safety mechanisms:

- **Rate Limiting**: Prevents abuse and ensures fair usage
- **Content Moderation**: Optional post-generation filtering
- **Model Validation**: Testing of new models before production deployment
- **Rollback Capability**: Automatic rollback if new models degrade performance
- **Budget Controls**: Per-agent token consumption limits

## Scaling

The system is designed to scale horizontally:

- **API Services**: Can be scaled independently
- **Training Workers**: Multiple trainers can operate in parallel
- **Vector Database**: Qdrant supports clustering
- **Message Bus**: Redis cluster support

## Maintenance

### Logs

Access service logs:
```bash
# View API logs
docker logs snac-api

# View trainer logs
docker logs trainer

# View all logs in real-time
docker compose logs -f
```

### Backups

- Models are stored in the `mlflow` volume
- Training data is stored in the `redis_data` volume
- Vector database data is stored in the `qdrant_data` volume

### Updates

To update the system:

1. Pull the latest code
2. Rebuild the Docker images
3. Restart the services

```bash
git pull
docker compose build
docker compose up -d
```

## Troubleshooting

### Common Issues

- **GPU not detected**: Ensure NVIDIA Container Toolkit is installed
- **CUDA errors**: Verify GPU driver and CUDA version compatibility
- **Memory issues**: Adjust model sizes or batch sizes accordingly
- **Network issues**: Check connectivity between services

### Health Checks

Services perform self-health checks:

- API: `/health` endpoint
- Qdrant: `/ping` endpoint
- Redis: Built-in ping command
- MLflow: `/health` endpoint

## Roadmap

Future enhancements include:

- Advanced A/B testing capabilities
- More sophisticated reward modeling
- Federated learning support
- Enhanced security features
- Advanced model architectures