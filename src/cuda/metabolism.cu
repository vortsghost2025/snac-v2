// metabolism.cu
#include <cuda_runtime.h>
#include <stdio.h>

extern "C" __global__
void score_kernel(const float* a, const float* b, const float* c,
                  const float* x, const float* y, const float* z,
                  float* out, int N) {
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx < N) {
        out[idx] = a[0]*x[idx] + b[0]*y[idx] + c[0]*z[idx];
    }
}

extern "C" __global__
void rank_kernel(const float* scores, int* ranked_indices, int N, int K) {
    // Simple selection sort for top-K - for demonstration
    // In practice, use thrust::sort or CUB for better performance
    extern __shared__ float shared_scores[];
    int* shared_indices = (int*)&shared_scores[K];
    
    int tid = threadIdx.x;
    if (tid < K) {
        shared_scores[tid] = -FLT_MAX;
        shared_indices[tid] = -1;
    }
    __syncthreads();
    
    // Each thread processes one element
    for (int i = blockIdx.x * blockDim.x + tid; i < N; i += gridDim.x * blockDim.x) {
        float val = scores[i];
        // Find insertion point in top-K
        for (int k = 0; k < K; k++) {
            if (val > shared_scores[k]) {
                // Shift and insert
                for (int j = K - 1; j > k; j--) {
                    shared_scores[j] = shared_scores[j - 1];
                    shared_indices[j] = shared_indices[j - 1];
                }
                shared_scores[k] = val;
                shared_indices[k] = i;
                break;
            }
        }
    }
    __syncthreads();
    
    // Write results back to global memory
    if (tid < K) {
        if (blockIdx.x == 0) {  // Only first block writes results
            ranked_indices[tid] = shared_indices[tid];
        }
    }
}

extern "C" __global__
void softmax_kernel(const float* input, float* output, int N) {
    // Compute max for numerical stability
    extern __shared__ float shared_data[];
    int tid = threadIdx.x;
    
    // Load data into shared memory
    if (tid < N) {
        shared_data[tid] = input[tid];
    } else {
        shared_data[tid] = -INFINITY;
    }
    __syncthreads();
    
    // Reduce to find max
    for (int stride = blockDim.x / 2; stride > 0; stride >>= 1) {
        if (tid < stride && (tid + stride) < N) {
            shared_data[tid] = fmaxf(shared_data[tid], shared_data[tid + stride]);
        }
        __syncthreads();
    }
    
    float max_val = shared_data[0];
    __syncthreads();
    
    // Compute exp(x - max) and sum
    if (tid < N) {
        shared_data[tid] = expf(input[tid] - max_val);
    } else {
        shared_data[tid] = 0.0f;
    }
    __syncthreads();
    
    // Sum exponentials
    for (int stride = blockDim.x / 2; stride > 0; stride >>= 1) {
        if (tid < stride && (tid + stride) < N) {
            shared_data[tid] += shared_data[tid + stride];
        }
        __syncthreads();
    }
    
    float sum_exp = shared_data[0];
    __syncthreads();
    
    // Compute final softmax values
    if (tid < N) {
        output[tid] = shared_data[tid] / sum_exp;
    }
}