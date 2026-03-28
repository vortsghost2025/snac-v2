/**
 * GPU-Accelerated Llama Bridge for SNAC v2
 * Interfaces with llama.cpp for local GPU-accelerated inference
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;

class LlamaBridge {
  constructor(modelPath, gpuLayers = 32) {
    this.modelPath = modelPath;
    this.gpuLayers = gpuLayers;
    this.process = null;
    this.isInitialized = false;
    
    // Verify model file exists
    this.validateModelPath();
  }

  async validateModelPath() {
    try {
      await fs.access(this.modelPath, fs.constants.R_OK);
      this.isInitialized = true;
      console.log(`LlamaBridge initialized with model: ${path.basename(this.modelPath)}`);
    } catch (error) {
      console.error(`Model file not accessible: ${this.modelPath}`, error.message);
      this.isInitialized = false;
    }
  }

  // Fire-and-forget a prompt → Promise<string>
  async infer(prompt, options = {}) {
    if (!this.isInitialized) {
      throw new Error('LlamaBridge not initialized - model file not accessible');
    }

    const {
      temperature = 0.7,
      maxTokens = 256,
      repeatPenalty = 1.1,
      topK = 40,
      topP = 0.9
    } = options;

    return new Promise((resolve, reject) => {
      // Prepare llama.cpp arguments
      const args = [
        '-m', this.modelPath,
        '-p', `"${prompt.replace(/"/g, '')}"`,  // Escape quotes in prompt
        '-n', maxTokens.toString(),             // Number of tokens to generate
        '-ngl', this.gpuLayers.toString(),      // Number of GPU layers (adjust to VRAM)
        '--temp', temperature.toString(),
        '--top_k', topK.toString(),
        '--top_p', topP.toString(),
        '--repeat_penalty', repeatPenalty.toString(),
        '--color', 'false',
        '--no-escape',
        '--quiet',
        '-s', '1337'                           // Seed for reproducibility
      ];

      // Path to llama.cpp main executable (assumes it's built in project root)
      const llamaPath = path.resolve(__dirname, '../../../llama.cpp/main');
      
      // Check if llama.cpp exists
      if (!fs.existsSync(llamaPath)) {
        reject(new Error(`llama.cpp executable not found at: ${llamaPath}. Please build llama.cpp with CUDA support.`));
        return;
      }

      console.log(`Executing llama with args: ${args.join(' ')}`);
      
      const child = spawn(llamaPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: false
      });

      let output = '';
      let errorOutput = '';

      child.stdout.on('data', (data) => {
        output += data.toString();
      });

      child.stderr.on('data', (data) => {
        errorOutput += data.toString();
        console.error('[LLAMA-STDERR]', data.toString());
      });

      child.on('close', (code) => {
        if (code !== 0) {
          console.error(`LLAMA exited with code ${code}, stderr:`, errorOutput);
          reject(new Error(`LLAMA exited with code ${code}: ${errorOutput}`));
        } else {
          // Clean up the output (remove prompt echo, etc.)
          const cleanedOutput = this.cleanLlamaOutput(output, prompt);
          resolve(cleanedOutput.trim());
        }
      });

      child.on('error', (error) => {
        console.error('LlamaBridge error:', error);
        reject(error);
      });
    });
  }

  cleanLlamaOutput(output, prompt) {
    // Remove the prompt echo from the output
    const promptIndex = output.indexOf(prompt);
    if (promptIndex !== -1) {
      return output.substring(promptIndex + prompt.length).trim();
    }
    
    // If prompt not found, return the full output
    return output.trim();
  }

  // Health check to see if the bridge is responsive
  async healthCheck() {
    try {
      const response = await this.infer("Hello, are you working?", { maxTokens: 10 });
      return {
        status: 'healthy',
        responsePreview: response.substring(0, 50) + '...'
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message
      };
    }
  }
}

module.exports = LlamaBridge;