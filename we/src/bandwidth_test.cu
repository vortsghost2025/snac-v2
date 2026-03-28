#include <iostream>
#include <cuda_runtime.h>
#include <chrono>

int main() {
    size_t MB = 1024 * 1024;
    size_t size = 1024ULL * MB;
    float *h_data, *d_data;

    cudaMallocHost(&h_data, size);
    cudaMalloc(&d_data, size);

    auto start = std::chrono::high_resolution_clock::now();
    cudaMemcpy(d_data, h_data, size, cudaMemcpyHostToDevice);
    cudaDeviceSynchronize();
    auto end = std::chrono::high_resolution_clock::now();
    double h2d_time = std::chrono::duration<double>(end - start).count();

    start = std::chrono::high_resolution_clock::now();
    cudaMemcpy(h_data, d_data, size, cudaMemcpyDeviceToHost);
    cudaDeviceSynchronize();
    end = std::chrono::high_resolution_clock::now();
    double d2h_time = std::chrono::duration<double>(end - start).count();

    std::cout << "Host-to-Device (PCIe): " << (size / h2d_time) / MB / 1024.0 << " GB/s\n";
    std::cout << "Device-to-Host (PCIe): " << (size / d2h_time) / MB / 1024.0 << " GB/s\n";

    cudaFree(d_data);
    cudaFreeHost(h_data);
    return 0;
}
