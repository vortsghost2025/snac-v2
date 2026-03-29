// Simple CUDA test kernel
#include <stdio.h>
#include <cuda_runtime.h>

#define N 1024
#define BLOCK_SIZE 256

// Error checking macro
#define CUDA_CHECK(call) \
    do { \
        cudaError_t err = call; \
        if (err != cudaSuccess) { \
            fprintf(stderr, "CUDA error at %s:%d: %s\n", __FILE__, __LINE__, cudaGetErrorString(err)); \
            exit(1); \
        } \
    } while(0)

__global__ void matrixAdd(float *A, float *B, float *C, int n) {
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx < n) {
        C[idx] = A[idx] + B[idx];
    }
}

__global__ void computeKernel(float *data, int n, int iters) {
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx < n) {
        float val = data[idx];
        for (int i = 0; i < iters; i++) {
            val = val * 1.001f + 0.001f;
            val = sinf(val);
        }
        data[idx] = val;
    }
}

int main(int argc, char *argv[]) {
    int threads = (argc > 1) ? atoi(argv[1]) : BLOCK_SIZE;
    int iters = (argc > 2) ? atoi(argv[2]) : 1000;
    
    // Clamp threads to valid range
    if (threads < 32) threads = 32;
    if (threads > 1024) threads = 1024;
    // Round to warp boundary
    threads = (threads / 32) * 32;
    
    printf("=== CUDA Device Test ===\n");
    printf("Threads: %d, Iterations: %d\n", threads, iters);
    
    // Get device properties
    int deviceId;
    CUDA_CHECK(cudaGetDevice(&deviceId));
    cudaDeviceProp prop;
    CUDA_CHECK(cudaGetDeviceProperties(&prop, deviceId));
    printf("Device: %s\n", prop.name);
    printf("Compute Capability: %d.%d\n", prop.major, prop.minor);
    printf("Global Memory: %.2f GB\n", prop.totalGlobalMem / 1024.0/1024.0/1024.0);
    printf("Shared Mem per Block: %zu KB\n", prop.sharedMemPerBlock / 1024);
    printf("Registers per Block: %d\n", prop.regsPerBlock);
    printf("Max Threads per Block: %d\n", prop.maxThreadsPerBlock);
    
    // Warmup
    float *d_warmup;
    CUDA_CHECK(cudaMalloc(&d_warmup, 32 * sizeof(float)));
    computeKernel<<<1, 32>>>(d_warmup, 32, 1);
    CUDA_CHECK(cudaDeviceSynchronize());
    CUDA_CHECK(cudaFree(d_warmup));
    
    // Allocate memory
    float *d_data;
    CUDA_CHECK(cudaMalloc(&d_data, N * sizeof(float)));
    
    // Initialize
    float *h_data = (float*)malloc(N * sizeof(float));
    if (!h_data) {
        fprintf(stderr, "Failed to allocate host memory\n");
        return 1;
    }
    for (int i = 0; i < N; i++) h_data[i] = (float)i;
    CUDA_CHECK(cudaMemcpy(d_data, h_data, N * sizeof(float), cudaMemcpyHostToDevice));
    
    // Timing
    cudaEvent_t start, stop;
    CUDA_CHECK(cudaEventCreate(&start));
    CUDA_CHECK(cudaEventCreate(&stop));
    
    CUDA_CHECK(cudaEventRecord(start));
    computeKernel<<<(N + threads - 1) / threads, threads>>>(d_data, N, iters);
    CUDA_CHECK(cudaEventRecord(stop));
    
    CUDA_CHECK(cudaEventSynchronize(stop));
    float ms;
    CUDA_CHECK(cudaEventElapsedTime(&ms, start, stop));
    
    printf("\n=== Results ===\n");
    printf("Kernel Time: %.3f ms\n", ms);
    printf("Throughput: %.2f ops/sec\n", (float)N * iters / (ms / 1000.0));
    printf("Avg time per op: %.3f us\n", ms * 1000.0 / (float)(N * iters));
    
    // Cleanup
    CUDA_CHECK(cudaFree(d_data));
    free(h_data);
    CUDA_CHECK(cudaEventDestroy(start));
    CUDA_CHECK(cudaEventDestroy(stop));
    
    printf("\n=== SUCCESS ===\n");
    return 0;
}
