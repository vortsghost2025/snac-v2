// metabolism.cu
#include <cuda_runtime.h>
#include <stdio.h>
#include <float.h>

extern "C" __global__
void score_kernel(const float* __restrict__ a, const float* __restrict__ b, const float* __restrict__ c,
                  const float* __restrict__ x, const float* __restrict__ y, const float* __restrict__ z,
                  float* __restrict__ out, int N) {
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx < N) {
        out[idx] = a[0]*x[idx] + b[0]*y[idx] + c[0]*z[idx];
    }
}

extern "C" __global__
void rank_kernel(const float* __restrict__ scores, int* __restrict__ ranked_indices, int N, int K) {
    // Guard against K > 32 which would overflow local register arrays
    if (K > 32) return;
    
    // Each thread maintains a local top-K list, then block-reduces.
    // This avoids the race condition in the original shared-memory approach.

    // Shared memory layout: [K floats for scores] + [K ints for indices] per warp
    // Use char as base type to avoid strict aliasing issues
    extern __shared__ char shared_mem_base[];
    float* shared_scores = (float*)shared_mem_base;
    int* shared_indices = (int*)&shared_scores[K * (blockDim.x / 32)];

    int tid = threadIdx.x;
    int warp_id = tid / 32;
    int lane_id = tid % 32;
    int warps_per_block = blockDim.x / 32;
    int warp_offset = warp_id * K;

    // Each thread maintains a local top-K in registers
    float local_scores[32];  // Max K=32
    int local_indices[32];
    for (int k = 0; k < K && k < 32; k++) {
        local_scores[k] = -FLT_MAX;
        local_indices[k] = -1;
    }

    // Each thread processes elements strided across the grid
    for (int i = blockIdx.x * blockDim.x + tid; i < N; i += gridDim.x * blockDim.x) {
        float val = scores[i];
        // Insert into local top-K if it qualifies
        for (int k = 0; k < K && k < 32; k++) {
            if (val > local_scores[k]) {
                // Shift down
                for (int j = ::min(K - 1, 31); j > k; j--) {
                    local_scores[j] = local_scores[j - 1];
                    local_indices[j] = local_indices[j - 1];
                }
                local_scores[k] = val;
                local_indices[k] = i;
                break;
            }
        }
    }

    // Warp-level reduction: merge local top-K lists within each warp
    for (int offset = 16; offset > 0; offset >>= 1) {
        for (int k = 0; k < K && k < 32; k++) {
            float other_score = __shfl_down_sync(0xFFFFFFFF, local_scores[k], offset);
            int other_idx = __shfl_down_sync(0xFFFFFFFF, local_indices[k], offset);
            // Merge: if the other thread has a better entry, take it
            if (other_score > local_scores[k] && lane_id < offset) {
                // Insert other into our list
                for (int j = 0; j < K && j < 32; j++) {
                    if (other_score > local_scores[j]) {
                        for (int m = ::min(K - 1, 31); m > j; m--) {
                            local_scores[m] = local_scores[m - 1];
                            local_indices[m] = local_indices[m - 1];
                        }
                        local_scores[j] = other_score;
                        local_indices[j] = other_idx;
                        break;
                    }
                }
            }
        }
    }

    // Lane 0 of each warp writes to shared memory
    if (lane_id == 0) {
        for (int k = 0; k < K; k++) {
            shared_scores[warp_offset + k] = local_scores[k];
            shared_indices[warp_offset + k] = local_indices[k];
        }
    }
    __syncthreads();

    // Thread 0 merges all warp results into final top-K
    if (tid == 0) {
        float final_scores[32];
        int final_indices[32];
        for (int k = 0; k < K && k < 32; k++) {
            final_scores[k] = -FLT_MAX;
            final_indices[k] = -1;
        }

        for (int w = 0; w < warps_per_block; w++) {
            for (int k = 0; k < K && k < 32; k++) {
                float w_score = shared_scores[w * K + k];
                int w_idx = shared_indices[w * K + k];
                if (w_idx < 0) continue;
                // Insert into final
                for (int j = 0; j < K && j < 32; j++) {
                    if (w_score > final_scores[j]) {
                        for (int m = ::min(K - 1, 31); m > j; m--) {
                            final_scores[m] = final_scores[m - 1];
                            final_indices[m] = final_indices[m - 1];
                        }
                        final_scores[j] = w_score;
                        final_indices[j] = w_idx;
                        break;
                    }
                }
            }
        }

        // Write block's top-K to global memory
        for (int k = 0; k < K; k++) {
            ranked_indices[blockIdx.x * K + k] = final_indices[k];
        }
    }
}

extern "C" __global__
void softmax_kernel(const float* __restrict__ input, float* __restrict__ output, int N) {
    // Per-block softmax: each block handles one softmax vector.
    // Uses shared memory for reduction but preserves original values for output.
    // 
    // SHARED MEMORY REQUIREMENT:
    // The kernel requires: (N + num_warps + 2) * sizeof(float) bytes of shared memory
    // where num_warps = (blockDim.x + 31) / 32
    // 
    // Host code must ensure: sharedMem >= (N + (blockDim.x/32) + 2) * sizeof(float)
    
    extern __shared__ float shared_data[];
    int tid = threadIdx.x;

    // Phase 1: Load data and find max via reduction
    float thread_max = -3.402823466e+38f; // -FLT_MAX
    for (int i = tid; i < N; i += blockDim.x) {
        float val = input[i];
        shared_data[i] = val;
        thread_max = fmaxf(thread_max, val);
    }

    // Warp-level max reduction
    for (int offset = 16; offset > 0; offset >>= 1) {
        thread_max = fmaxf(thread_max, __shfl_down_sync(0xFFFFFFFF, thread_max, offset));
    }

    // Write warp results to shared memory, then reduce across warps
    int warp_id = tid / 32;
    int lane_id = tid % 32;
    if (lane_id == 0) {
        shared_data[N + warp_id] = thread_max;
    }
    __syncthreads();

    // Final max reduction by thread 0
    if (tid == 0) {
        float max_val = -3.402823466e+38f; // -FLT_MAX
        int num_warps = (blockDim.x + 31) / 32;
        for (int w = 0; w < num_warps; w++) {
            max_val = fmaxf(max_val, shared_data[N + w]);
        }
        shared_data[N] = max_val;  // Store final max at shared_data[N]
    }
    __syncthreads();

    float max_val = shared_data[N];

    // Phase 2: Compute exp(x - max) and sum
    float thread_sum = 0.0f;
    for (int i = tid; i < N; i += blockDim.x) {
        float exp_val = expf(input[i] - max_val);
        output[i] = exp_val;
        thread_sum += exp_val;
    }

    // Warp-level sum reduction
    for (int offset = 16; offset > 0; offset >>= 1) {
        thread_sum += __shfl_down_sync(0xFFFFFFFF, thread_sum, offset);
    }

    if (lane_id == 0) {
        shared_data[N + 1 + warp_id] = thread_sum;
    }
    __syncthreads();

    // Final sum reduction by thread 0
    if (tid == 0) {
        float sum_exp = 0.0f;
        int num_warps = (blockDim.x + 31) / 32;
        for (int w = 0; w < num_warps; w++) {
            sum_exp += shared_data[N + 1 + w];
        }
        shared_data[N + 1] = sum_exp;
    }
    __syncthreads();

    float sum_exp = shared_data[N + 1];

    // Phase 3: Normalize
    for (int i = tid; i < N; i += blockDim.x) {
        output[i] = output[i] / fmaxf(sum_exp, 1e-6f);
    }
}
