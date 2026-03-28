# GPU Brain Worker Setup Guide
## RTX 5060 (Blackwell) + CUDA Kernels

### What You Just Got

1. **`brain_worker.py`** - Enhanced inference worker with GPU acceleration
2. **`inference_kernel.cu`** - Optimized CUDA kernels for Blackwell
3. **`cuda_kernels.py`** - Python wrapper for GPU kernels
4. **`build_kernels.sh`** - Build script for your architecture
5. **Docker GPU support** - NVIDIA CUDA 12.5 container
6. **Makefile** - Easy command shortcuts

---

## Quick Start (5 Minutes)

### Step 1: Pull Ollama Model

```bash
docker compose exec ollama ollama pull mistral
# Wait for download (~4GB)
```

### Step 2: Build CUDA Kernels (Optional but Recommended)

```bash
make build-kernels
# Requires: NVIDIA CUDA Toolkit installed locally
# If you don't have it, skip this step - workers still work fine
```

### Step 3: Start Services

**With GPU acceleration:**
```bash
make run-gpu
```

**Or CPU-only:**
```bash
make run-nogpu
```

### Step 4: Verify Everything Works

```bash
# Check services
make status

# Test a simple inference
make test-worker

# Watch GPU worker
make logs
```

---

## How It Works

```
Agent Request
    ↓
OpenClaw Server (8080)
    ↓
Swarm Brain (8000)
    ↓
Brain Worker (GPU)
    ├─→ CUDA Kernels (optional preprocessing)
    ├─→ Ollama (GPU inference)
    └─→ CUDA Kernels (optional postprocessing)
    ↓
Result → Redis → Agent
```

**GPU Flow:**
- Your RTX 5060 VRAM: 8GB
- Ollama uses GPU for inference
- CUDA kernels accelerate embedding/attention operations
- Browser (VS Code) talks to port 8000

---

## Docker GPU Setup Explained

Your **docker-compose.yml** now has:

```yaml
brain-worker:
  image: nvidia/cuda:12.5-devel-ubuntu22.04  # Full CUDA toolkit
  deploy:
    resources:
      reservations:
        devices:
          - driver: nvidia      # Use GPU driver
            count: 1             # 1 GPU
            capabilities: [gpu]  # Enable GPU
```

**Check GPU inside container:**
```bash
docker compose exec swarm-worker nvidia-smi
```

---

## What Each File Does

| File | Purpose |
|------|---------|
| `inference_kernel.cu` | Blackwell-optimized CUDA kernels (embedding, layer norm, attention) |
| `cuda_kernels.py` | Python interface to call GPU kernels |
| `brain_worker.py` | Main worker that processes Ollama jobs + optional GPU acceleration |
| `build_kernels.sh` | Compiles `.cu` → `.so` (shared library) |
| `docker-compose.yml` | Added `nvidia/cuda:12.5-devel` + GPU device reservation |

---

## Common Commands

```bash
# Start with GPU
make run-gpu

# Check if GPU is being used
make logs

# Run benchmarks
make test-kernels

# See all services
make status

# Stop everything
make stop

# Pull different model
docker compose exec ollama ollama pull neural-chat
docker compose exec ollama ollama list
```

---

## Performance Tips

### RTX 5060 Specs
- VRAM: 8GB (Ollama models fit: mistral, neural-chat, orca-mini)
- CUDA Cores: 3072
- Memory Bandwidth: 360 GB/s
- Best for: 7B-13B models

### Optimize for Speed
```bash
# Use smaller model (faster)
export OLLAMA_MODEL=orca-mini
docker compose up -d

# Or switch in docker-compose.yml:
# OLLAMA_MODEL=orca-mini
```

### Monitor Performance
```bash
docker stats swarm-worker
docker stats ollama
```

---

## Development Workflow (VS Code)

1. **Blue Icon (VS Code):**
   - Open folder in Remote Container
   - Edit `brain_worker.py`, `cuda_kernels.py`
   - Changes auto-reload

2. **Pink Icon (Nsight):**
   - When optimizing CUDA kernels
   - Debug GPU threads/warps
   - Profile kernel execution

3. **Rebuild after kernel changes:**
   ```bash
   make build-kernels
   docker compose restart swarm-worker
   ```

---

## Troubleshooting

### GPU not detected
```bash
docker compose exec swarm-worker nvidia-smi
# If error: GPU driver not installed on host
# Solution: Install NVIDIA drivers on Windows
```

### Out of memory
```bash
# Docker Desktop → Settings → Resources → Memory: increase to 8GB
# Then restart
```

### Ollama models not downloading
```bash
docker compose logs ollama
docker compose exec ollama ollama pull mistral
```

### Kernel build fails
```bash
# Install CUDA Toolkit: https://developer.nvidia.com/cuda-downloads
# Then: make build-kernels
```

---

## Next Steps

1. **Scale to multiple workers:**
   ```yaml
   # docker-compose.yml
   brain-worker-2:
     image: nvidia/cuda:12.5-devel-ubuntu22.04
     # ... same config, different worker_id
   ```

2. **Profile with Nsight (pink icon):**
   - Open Nsight VSE
   - Attach to `brain_worker` container
   - Debug GPU kernels

3. **Build custom kernels:**
   - Modify `inference_kernel.cu`
   - Add your inference optimizations
   - Rebuild with `make build-kernels`

4. **Monitor with Grafana:**
   - Open http://localhost:3000
   - View GPU/CPU metrics

---

## Getting Help

```bash
# Check all available commands
make help

# View worker logs with errors
docker compose logs swarm-worker | grep -i error

# Test inference directly
make test-worker

# Benchmark your kernels
make test-kernels
```

---

**You've got a solid GPU setup now.** The kernels are optional—the worker runs fine without them. But with custom CUDA kernels, you'll see real speed improvements for AI inference workloads.

Happy coding. 🚀
