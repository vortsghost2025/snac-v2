// Comprehensive CUDA Benchmark
#include <stdio.h>
#include <cuda_runtime.h>

#define N 1024

// Different kernel types to test
__global__ void kernel_sin(float *data, int n, int iters) {
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx < n) {
        float val = data[idx];
        for (int i = 0; i < iters; i++) {
            val = sinf(val) * 1.001f + 0.001f;
        }
        data[idx] = val;
    }
}

__global__ void kernel_fma(float *data, int n, int iters) {
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx < n) {
        float val = data[idx];
        for (int i = 0; i < iters; i++) {
            val = fmaf(val, 1.001f, 0.001f);
        }
        data[idx] = val;
    }
}

__global__ void kernel_mul(float *data, int n, int iters) {
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx < n) {
        float val = data[idx];
        for (int i = 0; i < iters; i++) {
            val = val * 1.001f + 0.001f;
        }
        data[idx] = val;
    }
}

// Fixed: uses actual __shared__ memory instead of global memory parameter
__global__ void kernel_shared(float *data, int n, int iters) {
    extern __shared__ float shared_data[];
    
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    int local_idx = threadIdx.x;
    
    // Copy to actual shared memory
    if (idx < n) {
        shared_data[local_idx] = data[idx];
    }
    __syncthreads();
    
    if (idx < n) {
        float val = shared_data[local_idx];
        for (int i = 0; i < iters; i++) {
            val = val * 1.001f + 0.001f;
        }
        data[idx] = val;
    }
}

void run_benchmark(const char* name, void (*kernel)(float*, int, int), 
                   float *d_data, int n, int threads, int iters) {
    dim3 blocks((n + threads - 1) / threads);
    dim3 threads_per_block(threads);
    
    cudaEvent_t start, stop;
    cudaEventCreate(&start);
    cudaEventCreate(&stop);
    
    // Warmup
    kernel<<<blocks, threads_per_block>>>(d_data, n, iters);
    cudaDeviceSynchronize();
    
    cudaEventRecord(start);
    kernel<<<blocks, threads_per_block>>>(d_data, n, iters);
    cudaEventRecord(stop);
    
    cudaEventSynchronize(stop);
    float ms;
    cudaEventElapsedTime(&ms, start, stop);
    
    float ops = (float)n * iters;
    printf("%-20s | threads=%3d | iters=%4d | %8.2f ms | %12.2f ops/sec | %8.3f us/op\n", 
           name, threads, iters, ms, ops / (ms / 1000.0), ms * 1000.0 / ops);
    
    cudaEventDestroy(start);
    cudaEventDestroy(stop);
}

void run_shared_benchmark(const char* name, float *d_data, int n, int threads, int iters) {
    dim3 blocks((n + threads - 1) / threads);
    dim3 threads_per_block(threads);
    size_t shared_mem_size = threads * sizeof(float);
    
    cudaEvent_t start, stop;
    cudaEventCreate(&start);
    cudaEventCreate(&stop);
    
    // Warmup
    kernel_shared<<<blocks, threads_per_block, shared_mem_size>>>(d_data, n, iters);
    cudaDeviceSynchronize();
    
    cudaEventRecord(start);
    kernel_shared<<<blocks, threads_per_block, shared_mem_size>>>(d_data, n, iters);
    cudaEventRecord(stop);
    
    cudaEventSynchronize(stop);
    float ms;
    cudaEventElapsedTime(&ms, start, stop);
    
    float ops = (float)n * iters;
    printf("%-20s | threads=%3d | iters=%4d | %8.2f ms | %12.2f ops/sec | %8.3f us/op\n", 
           name, threads, iters, ms, ops / (ms / 1000.0), ms * 1000.0 / ops);
    
    cudaEventDestroy(start);
    cudaEventDestroy(stop);
}

int main(int argc, char *argv[]) {
    int iters = (argc > 1) ? atoi(argv[1]) : 1000;
    
    printf("\n================================================================================\n");
    printf("CUDA Parameter Sweep\n");
    printf("================================================================================\n");
    
    // Device info
    int deviceId;
    cudaGetDevice(&deviceId);
    cudaDeviceProp prop;
    cudaGetDeviceProperties(&prop, deviceId);
    printf("Device: %s\n", prop.name);
    printf("Compute Capability: %d.%d\n", prop.major, prop.minor);
    printf("Global Memory: %.2f GB\n", prop.totalGlobalMem / 1024.0/1024.0/1024.0);
    printf("Warps per SM: %d\n", prop.warpSize);
    printf("Max threads per SM: %d\n", prop.maxThreadsPerMultiProcessor);
    printf("\n");
    
    printf("%-20s | %-18s | %-8s | %10s | %14s | %10s\n", 
           "Kernel", "Config", "Iters", "Time", "Throughput", "Per-Op");
    printf("%-20s-+-%-18s-+-%-8s-+-%10s-+-%-14s-+-%10s\n", 
           "--------------------", "------------------", "--------", "----------", "--------------", "----------");
    
    // Allocate memory
    float *d_data;
    cudaMalloc(&d_data, N * sizeof(float));
    float *h_data = (float*)malloc(N * sizeof(float));
    for (int i = 0; i < N; i++) h_data[i] = (float)i;
    cudaMemcpy(d_data, h_data, N * sizeof(float), cudaMemcpyHostToDevice);
    
    int thread_counts[] = {32, 64, 128, 256, 512, 1024};
    
    printf("\n--- KERNEL_SIN ---\n");
    for (int t : thread_counts) {
        cudaMemcpy(d_data, h_data, N * sizeof(float), cudaMemcpyHostToDevice);
        run_benchmark("kernel_sin", kernel_sin, d_data, N, t, iters);
    }
    
    printf("\n--- KERNEL_FMA (fused multiply-add) ---\n");
    for (int t : thread_counts) {
        cudaMemcpy(d_data, h_data, N * sizeof(float), cudaMemcpyHostToDevice);
        run_benchmark("kernel_fma", kernel_fma, d_data, N, t, iters);
    }
    
    printf("\n--- KERNEL_MUL ---\n");
    for (int t : thread_counts) {
        cudaMemcpy(d_data, h_data, N * sizeof(float), cudaMemcpyHostToDevice);
        run_benchmark("kernel_mul", kernel_mul, d_data, N, t, iters);
    }
    
    printf("\n--- KERNEL_SHARED (with __shared__ mem) ---\n");
    for (int t : thread_counts) {
        cudaMemcpy(d_data, h_data, N * sizeof(float), cudaMemcpyHostToDevice);
        run_shared_benchmark("kernel_shared", d_data, N, t, iters);
    }
    
    printf("\n--- VARYING ITERATIONS ---\n");
    int iters_arr[] = {100, 500, 1000, 2000, 5000};
    for (int i : iters_arr) {
        cudaMemcpy(d_data, h_data, N * sizeof(float), cudaMemcpyHostToDevice);
        run_benchmark("kernel_sin", kernel_sin, d_data, N, 256, i);
    }
    
    cudaFree(d_data);
    free(h_data);
    
    printf("\n================================================================================\n");
    printf("BENCHMARK COMPLETE\n");
    printf("================================================================================\n");
    
    return 0;
}
