/*
 * Optimized CUDA kernel for batch token embedding & attention
 * Blackwell (RTX 5060) optimized
 * Compile: nvcc -arch=sm_100 -O3 -o inference_kernel inference_kernel.cu
 */

#include <cuda_runtime.h>
#include <device_launch_parameters.h>
#include <stdio.h>

#define BLOCK_SIZE 256
#define WARP_SIZE 32

/**
 * Batch embedding lookup kernel
 * Maps token IDs to embeddings from lookup table
 */
__global__ void batch_embed_lookup(
    const int* token_ids,      // [batch_size * seq_len]
    const float* embedding_table,  // [vocab_size, embed_dim]
    float* embeddings,         // output [batch_size, seq_len, embed_dim]
    int batch_size,
    int seq_len,
    int vocab_size,
    int embed_dim
) {
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    int total_tokens = batch_size * seq_len;
    
    if (idx >= total_tokens * embed_dim) return;
    
    int token_idx = idx / embed_dim;
    int embed_idx = idx % embed_dim;
    
    int token_id = token_ids[token_idx];
    if (token_id < 0 || token_id >= vocab_size) {
        embeddings[idx] = 0.0f;
        return;
    }
    
    embeddings[idx] = embedding_table[token_id * embed_dim + embed_idx];
}

/**
 * Fused layer norm kernel
 * Computes: y = (x - mean) / sqrt(var + eps) * weight + bias
 */
__global__ void fused_layer_norm(
    const float* input,        // [N, hidden_size]
    const float* weight,       // [hidden_size]
    const float* bias,         // [hidden_size]
    float* output,             // [N, hidden_size]
    int N,
    int hidden_size,
    float eps
) {
    // Safer (correct) per-row computation.
    // To avoid subtle shared-memory indexing/race issues with tiled 2D blocks,
    // each thread will compute the per-row mean and variance by scanning the
    // row. This is less optimal but correct and avoids cross-block reduction
    // races. We can optimize later with a multi-phase reduction if needed.

    int row = blockIdx.y * blockDim.y + threadIdx.y;
    int col = blockIdx.x * blockDim.x + threadIdx.x;

    if (row >= N || col >= hidden_size) return;

    int idx = row * hidden_size + col;

    // Compute mean by scanning the row
    float sum = 0.0f;
    for (int i = 0; i < hidden_size; ++i) {
        sum += input[row * hidden_size + i];
    }
    float mean = sum / (float)hidden_size;

    // Compute variance
    float var_sum = 0.0f;
    for (int i = 0; i < hidden_size; ++i) {
        float d = input[row * hidden_size + i] - mean;
        var_sum += d * d;
    }
    float var = var_sum / (float)hidden_size;

    // Normalize and apply affine transform
    float normalized = (input[idx] - mean) / sqrtf(var + eps);
    output[idx] = normalized * weight[col] + bias[col];
}

/**
 * Softmax kernel (for attention scores)
 * Numerically stable implementation
 */
__global__ void batch_softmax(
    float* scores,             // [batch_size * seq_len, seq_len]
    int batch_size,
    int seq_len
) {
    int row = blockIdx.x * blockDim.x + threadIdx.x;
    int total_rows = batch_size * seq_len;

    if (row >= total_rows) return;

    if (seq_len <= 0) return;

    float max_val = -INFINITY;
    float sum_exp = 0.0f;

    // Find max for numerical stability
    for (int i = 0; i < seq_len; i++) {
        float v = scores[row * seq_len + i];
        if (v > max_val) max_val = v;
    }

    // Compute exp and sum
    for (int i = 0; i < seq_len; i++) {
        float exp_val = expf(scores[row * seq_len + i] - max_val);
        scores[row * seq_len + i] = exp_val;
        sum_exp += exp_val;
    }

    // Normalize (guard against divide-by-zero)
    if (sum_exp == 0.0f) sum_exp = 1e-6f;
    for (int i = 0; i < seq_len; i++) {
        scores[row * seq_len + i] /= sum_exp;
    }
}

/**
 * Matrix multiply: C = A @ B (optimized for Blackwell)
 * A: [M, K], B: [K, N], C: [M, N]
 */
__global__ void optimized_matmul(
    const float* A,
    const float* B,
    float* C,
    int M, int K, int N
) {
    int row = blockIdx.y * blockDim.y + threadIdx.y;
    int col = blockIdx.x * blockDim.x + threadIdx.x;
    
    if (row >= M || col >= N) return;
    
    float sum = 0.0f;
    for (int k = 0; k < K; k++) {
        sum += A[row * K + k] * B[k * N + col];
    }
    C[row * N + col] = sum;
}

/**
 * Host wrapper: batch embedding lookup
 */
extern "C" {
    int cuda_embed_lookup(
        int* token_ids,
        float* embedding_table,
        float* embeddings,
        int batch_size,
        int seq_len,
        int vocab_size,
        int embed_dim
    ) {
        int total_tokens = batch_size * seq_len;
        int grid_size = (total_tokens * embed_dim + BLOCK_SIZE - 1) / BLOCK_SIZE;
        
        batch_embed_lookup<<<grid_size, BLOCK_SIZE>>>(
            token_ids, embedding_table, embeddings,
            batch_size, seq_len, vocab_size, embed_dim
        );
        
        cudaError_t err = cudaGetLastError();
        if (err != cudaSuccess) {
            printf("CUDA error: %s\n", cudaGetErrorString(err));
            return -1;
        }
        return 0;
    }
    
    int cuda_layer_norm(
        float* input,
        float* weight,
        float* bias,
        float* output,
        int N,
        int hidden_size,
        float eps
    ) {
        dim3 block(16, 16);
        dim3 grid((hidden_size + 15) / 16, (N + 15) / 16);
        
        fused_layer_norm<<<grid, block>>>(
            input, weight, bias, output,
            N, hidden_size, eps
        );
        
        cudaError_t err = cudaGetLastError();
        if (err != cudaSuccess) {
            printf("CUDA error: %s\n", cudaGetErrorString(err));
            return -1;
        }
        return 0;
    }
    
    int cuda_softmax(float* scores, int batch_size, int seq_len) {
        int grid_size = (batch_size * seq_len + BLOCK_SIZE - 1) / BLOCK_SIZE;
        batch_softmax<<<grid_size, BLOCK_SIZE>>>(scores, batch_size, seq_len);
        
        cudaError_t err = cudaGetLastError();
        if (err != cudaSuccess) {
            printf("CUDA error: %s\n", cudaGetErrorString(err));
            return -1;
        }
        return 0;
    }
    
    int cuda_matmul(float* A, float* B, float* C, int M, int K, int N) {
        dim3 block(16, 16);
        dim3 grid((N + 15) / 16, (M + 15) / 16);
        
        optimized_matmul<<<grid, block>>>(A, B, C, M, K, N);
        
        cudaError_t err = cudaGetLastError();
        if (err != cudaSuccess) {
            printf("CUDA error: %s\n", cudaGetErrorString(err));
            return -1;
        }
        return 0;
    }
}
