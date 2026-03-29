/**
 * Persistent Cognitive Mesh (PCM) System
 */

const HotStore = require('./storage/HotStore');
const WarmStore = require('./storage/WarmStore');
const ColdArchive = require('./storage/ColdArchive');
const Swarm = require('./swarm/Swarm');
const HealthMonitor = require('./swarm/HealthMonitor');
const Bootstrap = require('./Bootstrap');
const Pipelines = require('./Pipelines');
const fs = require('fs').promises;
const path = require('path');
const MetabolismAddon = require('../../src/agents/metabolismAddon');
const { QuantizationManager } = require('./QuantizationManager');

class Mesh {
  constructor(config = {}) {
    // Configuration
    this.config = {
      hotPath: config.hotPath || './memory/hot.json',
      warmPath: config.warmPath || './memory/warm.db',
      coldPath: config.coldPath || './memory/cold',
      maxAgents: config.maxAgents || 10,
      blipSecret: config.blipSecret,
      ...config
    };

    // Storage layers
    this.hot = new HotStore(this.config.hotPath);
    this.warm = new WarmStore(this.config.warmPath);
    this.cold = new ColdArchive(this.config.coldPath);
    
    // Cognitive systems
    this.swarm = new Swarm(this.config.maxAgents);
    this.health = new HealthMonitor(
      () => this.healthCheck(),
      () => this.emergency()
    );
    this.bootstrap = new Bootstrap({ mesh: this, blipSecret: this.config.blipSecret });
    this.pipelines = new Pipelines();
    
    // GPU acceleration components
    this.metabolismAddon = new MetabolismAddon();
    
    // Quantization manager for precision control
    this.quantization = new QuantizationManager({
      quantizationLevel: config.quantizationLevel || 'fp16',
      quantizationMethod: config.quantizationMethod || 'dynamic',
      embeddingDimensions: config.embeddingDimensions || 384,
    });
    
    this.initialized = false;
  }

  async init(options = {}) {
    console.log("Initializing Mesh system with GPU acceleration...");
    
    // Initialize storage layers
    await this.hot.init();
    await this.warm.init();
    await this.cold.init();
    
    // Initialize cognitive systems
    await this.swarm.init();
    await this.bootstrap.init();
    await this.pipelines.init();
    
    // Set up health monitoring
    this.health.init();
    
    // Bootstrap with specified agent count
    await this.bootstrap.bootstrap({ agentCount: options.agentCount || 10 });
    
    this.initialized = true;
    console.log("Mesh system initialized with GPU acceleration");
  }

  async shutdown() {
    console.log("Shutting down Mesh system...");
    
    // Shutdown in reverse order
    await this.bootstrap.shutdown();
    await this.swarm.shutdown();
    await this.pipelines.shutdown();
    
    // Close storage layers
    await this.hot.close();
    await this.warm.close();
    await this.cold.close();
    
    this.initialized = false;
    console.log("Mesh system shutdown complete");
  }

  async healthCheck() {
    // Perform health checks on all components
    const healthReport = {
      timestamp: new Date().toISOString(),
      components: {
        hotStore: await this.hot.healthCheck(),
        warmStore: await this.warm.healthCheck(),
        coldStore: await this.cold.healthCheck(),
        swarm: await this.swarm.healthCheck(),
        bootstrap: await this.bootstrap.healthCheck(),
        pipelines: await this.pipelines.healthCheck(),
        gpuAcceleration: this.metabolismAddon.loaded ? 'available' : 'unavailable'
      }
    };
    
    // Check for any critical failures
    const criticalFailures = Object.entries(healthReport.components)
      .filter(([_, status]) => status.severity === 'critical');
      
    if (criticalFailures.length > 0) {
      console.error("Critical failures detected:", criticalFailures);
      return { healthy: false, report: healthReport };
    }
    
    return { healthy: true, report: healthReport };
  }

  async emergency() {
    console.log("Emergency protocol activated");
    
    // Perform emergency procedures
    // 1. Save critical state to persistent storage
    await this.hot.flush();
    
    // 2. Alert monitoring system
    this.health.alert("EMERGENCY", "System performing emergency procedures");
    
    // 3. Skip GC call (removed for production safety)
    // Instead, log memory usage for monitoring
    const memUsage = process.memoryUsage();
    console.log("Memory usage during emergency:", memUsage);
    
    console.log("Emergency protocol completed");
  }

  async query(pattern, options = {}) {
    // Use GPU acceleration for vector similarity searches if available
    if (options.useGpu && this.metabolismAddon.loaded) {
      return this.gpuEnhancedQuery(pattern, options);
    }
    
    // Use traditional method with pagination to avoid O(N) loading of all keys
    const pageSize = options.pageSize || 50;
    let offset = options.offset || 0;
    let pageResults = [];
    let results = [];
    
    do {
      pageResults = await this.hot.queryPage(pattern, {
        offset,
        limit: pageSize,
        ...options
      });
      
      results = results.concat(pageResults);
      offset += pageSize;
      
      // Break if we have fewer results than the page size (end of results)
      if (pageResults.length < pageSize) {
        break;
      }
      
      // Prevent infinite loops
      if (results.length > 10000) {
        console.warn("Query exceeded 10000 results, stopping for performance");
        break;
      }
    } while (pageResults.length === pageSize);
    
    return results;
  }

  async gpuEnhancedQuery(pattern, options = {}) {
    console.log("Performing GPU-enhanced query");
    
    // This is a placeholder implementation that would use FAISS GPU or similar
    // In a real implementation, this would interface with the Python FAISS module
    try {
      // If we had GPU-accelerated vector search, we would:
      // 1. Embed the query pattern using a neural network
      // 2. Perform similarity search using FAISS GPU
      // 3. Return the most similar results
      
      // For now, return regular results but with a performance note
      console.log("Note: GPU acceleration would significantly speed up vector similarity searches");
      return await this.query(pattern, { ...options, useGpu: false });
    } catch (error) {
      console.error("GPU query failed, falling back to CPU:", error);
      return await this.query(pattern, { ...options, useGpu: false });
    }
  }

  async retrieveContext(contextIds) {
    const context = [];
    
    for (const id of contextIds) {
      const item = await this.hot.get(id);
      if (item) {
        context.push(item);
      }
    }
    
    // Potentially GPU-accelerate context ranking if needed
    if (context.length > 100) {
      console.log(`Large context set (${context.length} items), consider GPU acceleration for ranking`);
    }
    
    return context;
  }

  async store(key, value, metadata = {}) {
    // Compress embeddings if quantization is enabled and value has embeddings
    if (value && value.embedding && this.quantization.level !== 'fp32') {
      const compressed = this.quantization.compressWeights(value.embedding, {
        level: this.quantization.level,
        layerName: 'embedding',
      });
      value = {
        ...value,
        embedding: compressed.data,
        _quantized: {
          format: compressed.format,
          scale: compressed.scale,
          compressionRatio: compressed.compressionRatio,
        },
      };
    }
    
    return await this.hot.set(key, value, metadata);
  }

  async get(key) {
    let cap = await this.hot.get(key);
    
    if (!cap) {
      // Try warm storage
      cap = await this.warm.get(key);
      
      if (cap) {
        // Decompress if quantized
        if (cap.value && cap.value._quantized && cap.value.embedding) {
          cap.value.embedding = this.quantization.decompressWeights({
            data: cap.value.embedding,
            format: cap.value._quantized.format,
            scale: cap.value._quantized.scale,
          });
          delete cap.value._quantized;
        }
        
        // Move to hot storage (promote warm to hot)
        await this.hot.set(key, cap.value, cap.metadata);
        await this.warm.delete(key);
        
        // Update thermal state
        cap.thermal_state = "hot";
      }
    } else {
      // Decompress if quantized (hot storage)
      if (cap.value && cap.value._quantized && cap.value.embedding) {
        cap.value.embedding = this.quantization.decompressWeights({
          data: cap.value.embedding,
          format: cap.value._quantized.format,
          scale: cap.value._quantized.scale,
        });
        delete cap.value._quantized;
      }
    }
    
    return cap;
  }

  async think(input, options = {}) {
    const startTime = Date.now();
    
    // Build quantization config for this inference
    const quantizationConfig = options.precision 
      ? this.quantization.buildConfig({ level: options.precision })
      : this.quantization.buildConfig();
    
    // Adapt quantization to current conditions
    const conditions = {
      phase: options.phase || 'explore',
      memoryPressure: options.memoryPressure || 0,
      taskPriority: options.priority || 'normal',
      gpuUtilization: options.gpuUtilization || 0,
    };
    
    const adaptation = this.quantization.adaptToConditions(conditions);
    if (adaptation.changed) {
      console.log(`Quantization adapted: ${adaptation.oldLevel} -> ${adaptation.newLevel} (${adaptation.reason})`);
    }
    
    // Pre-think validation
    if (!input || typeof input !== 'string' || input.length > 10000) {
      throw new Error('Invalid input: must be a string between 1-10000 characters');
    }
    
    // Context retrieval
    const contextPattern = options.contextPattern || '*';
    const context = await this.query(contextPattern, { 
      limit: options.contextLimit || 10,
      confidenceThreshold: options.confidenceThreshold || 0.7
    });
    
    // Process with swarm if enabled
    const useTriad = options.useTriad !== false; // Default to true if not explicitly false
    
    let result;
    if (useTriad) {
      // Pass quantization config to swarm
      result = await this.swarm.process({
        input,
        context,
        options: {
          ...options,
          quantization: quantizationConfig,
        }
      });
    } else {
      // Fallback processing without swarm
      result = {
        response: `Processed: ${input.substring(0, 100)}...`,
        confidence: 0.8,
        method: 'fallback-processing',
        contextUsed: context.map(c => c.key).slice(0, 5),
        capsCreated: 0
      };
    }
    
    // Record inference timing for quantization metrics
    const duration = Date.now() - startTime;
    this.quantization.recordInference(
      quantizationConfig.level,
      duration,
      result.confidence || 0.8
    );
    
    // Add optimization info to result
    result.optimization = {
      quantization: {
        level: quantizationConfig.level,
        method: quantizationConfig.method,
        memoryFactor: quantizationConfig.memoryFactor,
        expectedSpeedup: quantizationConfig.expectedSpeedup,
        cudaHints: quantizationConfig.cudaHints,
      },
      adaptation,
      duration,
    };
    
    // Post-processing - store results if needed
    if (options.storeResponse) {
      const responseKey = `response_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await this.store(
        responseKey,
        { input, output: result.response, context: result.contextUsed },
        { 
          source: 'think-response',
          timestamp: new Date().toISOString(),
          confidence: result.confidence,
          quantization: quantizationConfig.level,
        }
      );
      
      result.storedKey = responseKey;
    }
    
    // Evaluate phase 9 (learning/evolution)
    this.evaluatePhase9(result, options);
    
    return result;
  }

  evaluatePhase9(result, options) {
    // Phase 9 evaluation - learning and evolution
    // This is where we evaluate the effectiveness of our processing
    const metrics = {
      duration: result.duration || 0,
      confidence: result.confidence || 0,
      contextSize: result.contextUsed ? result.contextUsed.length : 0,
      method: result.method || 'unknown'
    };
    
    // Store decision for future learning
    if (options.recordDecision !== false) {
      const decisionKey = `decision_${Date.now()}_${result.method}`;
      this.store(decisionKey, {
        ...result,
        metrics,
        timestamp: new Date().toISOString()
      }, {
        type: 'decision',
        category: 'phase9-evaluation'
      });
    }
  }

  getStatus() {
    return {
      initialized: this.initialized,
      stats: {
        hotStoreSize: this.hot.size(),
        activeAgents: this.swarm.getActiveAgentCount(),
        uptime: process.uptime(),
        gpuAcceleration: this.metabolismAddon.loaded
      },
      config: {
        hotPath: this.config.hotPath,
        maxAgents: this.config.maxAgents
      },
      quantization: this.quantization.getStatus()
    };
  }
  
  diagnose() {
    const conditions = {
      phase: 'explore', // Would be determined by phase controller
      memoryPressure: process.memoryUsage().heapUsed / process.memoryUsage().heapTotal,
    };
    
    return {
      mesh: this.getStatus(),
      quantization: this.quantization.diagnose(conditions),
      health: this.health.getStatus ? this.health.getStatus() : 'unknown',
    };
  }

  async runMetabolism() {
    console.log("Starting GPU-accelerated metabolism process...");
    const startTime = Date.now();
    
    // Get all hot capsules for processing
    const hotCaps = await this.hot.getAll();
    const entries = Object.entries(hotCaps);
    
    if (entries.length === 0) {
      console.log("No hot capsules to process");
      return;
    }
    
    // Prepare data for GPU processing if addon is loaded
    if (this.metabolismAddon.loaded) {
      try {
        // Convert capsule data to format suitable for GPU processing
        // This is a simplified example - in reality, you'd extract meaningful features
        const N = entries.length;
        const a = 0.1;  // Example coefficient
        const b = 0.2;  // Example coefficient  
        const c = 0.3;  // Example coefficient
        
        // Create arrays of features (simplified - would use actual capsule properties)
        const xValues = new Float32Array(N).fill(1.0);  // Placeholder values
        const yValues = new Float32Array(N).fill(1.0);  // Placeholder values
        const zValues = new Float32Array(N).fill(1.0);  // Placeholder values
        
        // Perform GPU-accelerated scoring
        const scores = this.metabolismAddon.scoreBatch(a, b, c, xValues, yValues, zValues);
        
        // Rank top capsules for promotion/demotion
        const topIndices = this.metabolismAddon.rankTopK(scores, Math.min(10, N));
        
        console.log(`GPU-accelerated metabolism processed ${N} items in ${Date.now() - startTime}ms`);
        console.log(`Top candidates for action: ${topIndices.join(', ')}`);
        
        // Process the top-ranked capsules
        for (const idx of topIndices) {
          const [key, cap] = entries[idx];
          
          const now = Date.now();
          const lastAccess = cap.lastAccess || cap.createdAt || now;
          const age = now - lastAccess;
          
          // Move to warm if older than 1 hour and not recently accessed
          if (age > 3600000 && cap.thermal_state === 'hot') {
            await this.warm.set(key, cap.value, cap.metadata);
            await this.hot.delete(key);
            
            // Update thermal state
            cap.thermal_state = "warm";
            console.log(`Moved ${key} from hot to warm storage based on GPU-ranked priority`);
          }
        }
      } catch (error) {
        console.error("GPU metabolism failed, falling back to CPU:", error);
        await this.runMetabolismCPU();
      }
    } else {
      // Fall back to CPU-based metabolism
      await this.runMetabolismCPU();
    }
  }

  async runMetabolismCPU() {
    console.log("Running CPU-based metabolism process...");
    const startTime = Date.now();
    
    // Traditional CPU-based metabolism process
    const hotCaps = await this.hot.getAll();
    
    for (const [key, cap] of Object.entries(hotCaps)) {
      const now = Date.now();
      const lastAccess = cap.lastAccess || cap.createdAt || now;
      const age = now - lastAccess;
      
      // Move to warm if older than 1 hour and not recently accessed
      if (age > 3600000 && cap.thermal_state === 'hot') {
        await this.warm.set(key, cap.value, cap.metadata);
        await this.hot.delete(key);
        
        // Update thermal state
        cap.thermal_state = "warm";
        console.log(`Moved ${key} from hot to warm storage`);
      }
    }
    
    // Trigger garbage collection for old warm data
    await this.warm.expireOldEntries();
    
    console.log(`CPU metabolism completed in ${Date.now() - startTime}ms`);
  }
}

module.exports = Mesh;