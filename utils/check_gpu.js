/**
 * GPU Functionality Verification Script for SNAC v2
 * Checks if CUDA kernels and GPU acceleration components are working
 */

const fs = require('fs').promises;
const path = require('path');

async function checkGPUSetup() {
  console.log("=== SNAC v2 GPU Functionality Verification ===\n");
  
  // 1. Check if CUDA kernel library exists
  console.log("1. Checking CUDA kernel library...");
  const platform = process.platform;
  let libName;
  
  if (platform === 'win32') {
    libName = 'libmetabolism.dll';
  } else if (platform === 'darwin') {
    libName = 'libmetabolism.dylib';
  } else {
    libName = 'libmetabolism.so';
  }
  
  const libPath = path.join(__dirname, '..', 'build', libName);
  
  try {
    await fs.access(libPath, fs.constants.R_OK);
    console.log(`   ✅ CUDA kernel library found: ${libName}`);
  } catch (error) {
    console.log(`   ❌ CUDA kernel library NOT FOUND at: ${libPath}`);
    console.log("      Run: cd src/cuda && ./build_kernel.bat (Windows) or ./build_kernel.sh (Linux/Mac)");
  }

  // 2. Check if required Node.js packages are installed
  console.log("\n2. Checking required Node.js packages...");
  try {
    require('ffi-napi');
    console.log("   ✅ ffi-napi package is installed");
  } catch (error) {
    console.log("   ❌ ffi-napi package is NOT installed");
    console.log("      Run: npm install ffi-napi ref-napi ref-array-napi");
  }

  try {
    const { spawn } = require('child_process');
    const result = spawn('nvidia-smi', ['-L']);
    
    result.on('error', (err) => {
      console.log("   ❌ nvidia-smi command not available:", err.message);
    });
    
    result.on('close', (code) => {
      if (code === 0) {
        console.log("   ✅ nvidia-smi command is available");
      } else {
        console.log("   ❌ nvidia-smi command failed");
      }
    });
  } catch (error) {
    console.log("   ❌ Could not run nvidia-smi check");
  }

  // 3. Test loading the MetabolismAddon
  console.log("\n3. Testing MetabolismAddon load...");
  try {
    const MetabolismAddon = require('../src/agents/metabolismAddon');
    const addon = new MetabolismAddon();
    
    if (addon.loaded) {
      console.log("   ✅ MetabolismAddon loaded successfully with GPU access");
    } else {
      console.log("   ⚠️  MetabolismAddon loaded but without GPU access");
      console.log("       This may be OK if CUDA is not installed on this system");
    }
  } catch (error) {
    console.log(`   ❌ Failed to load MetabolismAddon: ${error.message}`);
  }

  // 4. Check if llama.cpp directory exists
  console.log("\n4. Checking llama.cpp availability...");
  try {
    const llamaPath = path.join(__dirname, '..', '..', 'llama.cpp', 'main');
    await fs.access(llamaPath, fs.constants.R_OK);
    console.log(`   ✅ llama.cpp executable found at: ${llamaPath}`);
  } catch (error) {
    console.log("   ❌ llama.cpp executable NOT FOUND");
    console.log("      You need to build llama.cpp with CUDA support:");
    console.log("      git clone https://github.com/ggerganov/llama.cpp.git");
    console.log("      cd llama.cpp && make LLAMA_CUDA=1");
  }

  // 5. Check Python GPU libraries
  console.log("\n5. Checking Python GPU libraries...");
  const { spawn } = require('child_process');
  
  const pythonChecks = [
    { name: 'PyTorch', cmd: 'python', args: ['-c', 'import torch; print("CUDA available:", torch.cuda.is_available()); print("GPU count:", torch.cuda.device_count())'] },
    { name: 'FAISS', cmd: 'python', args: ['-c', 'import faiss; print("GPU available:", faiss.get_num_gpus() > 0)'] }
  ];
  
  for (const check of pythonChecks) {
    console.log(`   Testing ${check.name}...`);
    
    const child = spawn(check.cmd, check.args);
    let output = '';
    let error = '';
    
    child.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    child.stderr.on('data', (data) => {
      error += data.toString();
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        console.log(`      ✅ ${check.name} check passed`);
        console.log(`         Output: ${output.trim()}`);
      } else {
        console.log(`      ❌ ${check.name} check failed with code ${code}`);
        if (error) console.log(`         Error: ${error.trim()}`);
      }
    });
  }

  console.log("\n=== GPU Verification Complete ===");
  console.log("\nFor full GPU acceleration in SNAC v2, ensure you have:");
  console.log("- CUDA Toolkit installed with nvcc compiler");
  console.log("- NVIDIA GPU with compatible drivers");
  console.log("- CUDA-enabled libraries (PyTorch, FAISS, etc.)");
  console.log("- Compiled CUDA kernels in the build directory");
  console.log("- llama.cpp built with CUDA support (optional for LLM inference)");
}

// Run the verification
checkGPUSetup().catch(console.error);