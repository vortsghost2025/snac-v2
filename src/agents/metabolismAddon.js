/**
 * GPU Accelerated Metabolism Functions for SNAC v2
 * Interfaces with CUDA kernels for high-performance computation
 */

const ffi = require('ffi-napi');
const ref = require('ref-napi');
const ArrayType = require('ref-array-napi');
const path = require('path');

class MetabolismAddon {
  constructor() {
    // Determine platform-specific library extension
    const platform = process.platform;
    let libName;
    
    if (platform === 'win32') {
      libName = 'libmetabolism.dll';
    } else if (platform === 'darwin') {
      libName = 'libmetabolism.dylib';
    } else {
      libName = 'libmetabolism.so';
    }
    
    const libPath = path.join(__dirname, '../../build', libName);
    
    try {
      // Define the native library interface
      this.lib = ffi.Library(libPath, {
        'score_kernel': [
          'void', 
          [
            'pointer', // const float* a
            'pointer', // const float* b
            'pointer', // const float* c
            'pointer', // const float* x
            'pointer', // const float* y
            'pointer', // const float* z
            'pointer', // float* out
            'int'      // int N
          ]
        ],
        'rank_kernel': [
          'void',
          [
            'pointer', // const float* scores
            'pointer', // int* ranked_indices
            'int',     // int N
            'int'      // int K
          ]
        ],
        'softmax_kernel': [
          'void',
          [
            'pointer', // const float* input
            'pointer', // float* output
            'int'      // int N
          ]
        ]
      });
      
      console.log('CUDA MetabolismAddon loaded successfully');
      this.loaded = true;
    } catch (error) {
      console.error('Failed to load CUDA MetabolismAddon:', error.message);
      console.error('Ensure CUDA kernel is compiled and available at:', libPath);
      this.loaded = false;
    }
  }

  /**
   * GPU accelerated batch scoring function
   * Computes: out[i] = a[0]*x[i] + b[0]*y[i] + c[0]*z[i] for all i
   */
  scoreBatch(a, b, c, xs, ys, zs) {
    if (!this.loaded) {
      throw new Error('MetabolismAddon not loaded - falling back to CPU');
    }
    
    if (!(xs instanceof Float32Array) || !(ys instanceof Float32Array) || !(zs instanceof Float32Array)) {
      throw new Error('Inputs must be Float32Array');
    }
    
    if (xs.length !== ys.length || xs.length !== zs.length) {
      throw new Error('All input arrays must have the same length');
    }
    
    const N = xs.length;
    const Float32ArrayRef = ArrayType('float');
    const Int32ArrayRef = ArrayType('int');
    
    // Allocate buffers
    const aBuf = new Float32ArrayRef([a]);
    const bBuf = new Float32ArrayRef([b]);
    const cBuf = new Float32ArrayRef([c]);
    const xBuf = new Float32ArrayRef(xs);
    const yBuf = new Float32ArrayRef(ys);
    const zBuf = new Float32ArrayRef(zs);
    const outBuf = new Float32ArrayRef(new Array(N).fill(0));
    
    // Calculate grid/block dimensions
    const threadsPerBlock = 256;
    const blocksPerGrid = Math.ceil(N / threadsPerBlock);
    
    // Create CUDA grid/block configuration
    const gridDim = { x: blocksPerGrid, y: 1, z: 1 };
    const blockDim = { x: threadsPerBlock, y: 1, z: 1 };
    
    // Call the kernel
    this.lib.score_kernel(
      aBuf.buffer,
      bBuf.buffer,
      cBuf.buffer,
      xBuf.buffer,
      yBuf.buffer,
      zBuf.buffer,
      outBuf.buffer,
      N
    );
    
    // Return the result as a Float32Array
    return new Float32Array([...outBuf]);
  }

  /**
   * GPU accelerated ranking function
   * Returns indices of top-K highest scoring items
   */
  rankTopK(scores, k) {
    if (!this.loaded) {
      throw new Error('MetabolismAddon not loaded - falling back to CPU');
    }
    
    if (!(scores instanceof Float32Array)) {
      throw new Error('Scores must be Float32Array');
    }
    
    const N = scores.length;
    if (k > N) k = N;
    
    const Float32ArrayRef = ArrayType('float');
    const Int32ArrayRef = ArrayType('int');
    
    // Allocate buffers
    const scoresBuf = new Float32ArrayRef(scores);
    const indicesBuf = new Int32ArrayRef(new Array(k).fill(-1));
    
    // Call the kernel
    this.lib.rank_kernel(
      scoresBuf.buffer,
      indicesBuf.buffer,
      N,
      k
    );
    
    // Return the top-K indices
    return [...indicesBuf].slice(0, k);
  }

  /**
   * GPU accelerated softmax function
   */
  softmax(input) {
    if (!this.loaded) {
      throw new Error('MetabolismAddon not loaded - falling back to CPU');
    }
    
    if (!(input instanceof Float32Array)) {
      throw new Error('Input must be Float32Array');
    }
    
    const N = input.length;
    const Float32ArrayRef = ArrayType('float');
    
    // Allocate buffers
    const inputBuf = new Float32ArrayRef(input);
    const outputBuf = new Float32ArrayRef(new Array(N).fill(0));
    
    // Call the kernel
    this.lib.softmax_kernel(
      inputBuf.buffer,
      outputBuf.buffer,
      N
    );
    
    // Return the softmax result
    return new Float32Array([...outputBuf]);
  }
}

module.exports = MetabolismAddon;