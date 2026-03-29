/**
 * GPU-Accelerated Llama Bridge for SNAC v2
 * Interfaces with llama.cpp for local GPU-accelerated inference
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');

const DEFAULT_TIMEOUT_MS = 60_000; // 60 second timeout for inference

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

  /**
   * Escape a string for safe shell argument passing.
   * Uses JSON.stringify to produce a safely quoted string.
   */
  _escapeShellArg(str) {
    return JSON.stringify(String(str));
  }

  // Fire-and-forget a prompt → Promise<string>
  async infer(prompt, options = {}) {
    if (!this.isInitialized) {
      throw new Error('LlamaBridge not initialized - model file not accessible');
    }

    if (typeof prompt !== 'string' || prompt.length === 0) {
      throw new Error('Prompt must be a non-empty string');
    }

    const {
      temperature = 0.7,
      maxTokens = 256,
      repeatPenalty = 1.1,
      topK = 40,
      topP = 0.9,
      timeout = DEFAULT_TIMEOUT_MS
    } = options;

    return new Promise((resolve, reject) => {
      // Prepare llama.cpp arguments as an array (no shell interpolation)
      const args = [
        '-m', this.modelPath,
        '-p', prompt,
        '-n', String(Math.max(1, Math.min(maxTokens, 4096))),
        '-ngl', String(this.gpuLayers),
        '--temp', String(Math.max(0, Math.min(temperature, 2.0))),
        '--top_k', String(Math.max(1, Math.min(topK, 100))),
        '--top_p', String(Math.max(0, Math.min(topP, 1.0))),
        '--repeat_penalty', String(Math.max(0.1, Math.min(repeatPenalty, 2.0))),
        '--color', 'false',
        '--no-escape',
        '--quiet',
        '-s', '1337'
      ];

      // Path to llama.cpp main executable (assumes it's built in project root)
      const llamaPath = path.resolve(__dirname, '../../../llama.cpp/main');
      
      // Check if llama.cpp exists (use sync to avoid race in promise context)
      if (!fsSync.existsSync(llamaPath)) {
        reject(new Error(`llama.cpp executable not found at: ${llamaPath}. Please build llama.cpp with CUDA support.`));
        return;
      }

      const child = spawn(llamaPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: false
      });

      let output = '';
      let errorOutput = '';
      let killed = false;

      // Timeout handler
      const timer = setTimeout(() => {
        killed = true;
        child.kill('SIGTERM');
        reject(new Error(`LlamaBridge inference timed out after ${timeout}ms`));
      }, timeout);

      child.stdout.on('data', (data) => {
        output += data.toString();
      });

      child.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (killed) return; // Already rejected via timeout
        
        if (code !== 0) {
          reject(new Error(`LLAMA exited with code ${code}: ${errorOutput}`));
        } else {
          const cleanedOutput = this.cleanLlamaOutput(output, prompt);
          resolve(cleanedOutput.trim());
        }
      });

      child.on('error', (error) => {
        clearTimeout(timer);
        if (killed) return;
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