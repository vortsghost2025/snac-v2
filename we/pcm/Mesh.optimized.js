/**
 * Optimized Persistent Cognitive Mesh (PCM) System
 * Fixes performance issues and improves scalability
 */

const HotStore = require('./storage/HotStore');
const WarmStore = require('./storage/WarmStore');
const ColdArchive = require('./storage/ColdArchive');
const Swarm = require('./swarm/Swarm');
const HealthMonitor = require('./HealthMonitor');
const Bootstrap = require('./Bootstrap');
const Pipelines = require('./Pipelines');
const fs = require('fs').promises;
const path = require('path');

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
    this.bootstrap = new Bootstrap(this.config.blipSecret);
    this.pipelines = new Pipelines();
    
    // Performance optimizations
    this.cache = new Map();  // Simple in-memory cache
    this.queryIndex = {};    // Index for faster queries
    this.initialized = false;
  }

  async init(options = {}) {
    console.log("Initializing optimized Mesh system...");
    
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
    console.log("Optimized Mesh system initialized");
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
        pipelines: await this.pipelines.healthCheck()
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
    
    // 3. Optionally trigger GC (but avoid in production)
    // if (process.env.NODE_ENV !== 'production') {
    //   global.gc && global.gc();
    // }
    
    console.log("Emergency protocol completed");
  }

  // Optimized query method with indexing
  async query(pattern, options = {}) {
    const startTime = Date.now();
    
    // Check cache first
    const cacheKey = `query_${pattern}_${JSON.stringify(options)}`;
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < 30000) { // 30s TTL
        return cached.result;
      }
    }
    
    // Use index if available, otherwise fall back to full scan
    let results;
    if (this.queryIndex[pattern]) {
      // Use precomputed index
      results = this.queryIndex[pattern];
    } else {
      // Perform query with pagination to avoid O(N) loading
      const pageSize = options.pageSize || 50;
      let offset = options.offset || 0;
      let pageResults = [];
      results = [];
      
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
    }
    
    // Cache results
    this.cache.set(cacheKey, {
      timestamp: Date.now(),
      result: results
    });
    
    const duration = Date.now() - startTime;
    console.log(`Query completed in ${duration}ms for pattern: ${pattern}`);
    
    return results;
  }

  async retrieveContext(contextIds) {
    // Retrieve context with caching
    const context = [];
    
    for (const id of contextIds) {
      const cacheKey = `context_${id}`;
      
      if (this.cache.has(cacheKey)) {
        context.push(this.cache.get(cacheKey));
      } else {
        const item = await this.hot.get(id);
        if (item) {
          this.cache.set(cacheKey, item);
          context.push(item);
        }
      }
    }
    
    return context;
  }

  async store(key, value, metadata = {}) {
    // Store with cache invalidation
    const result = await this.hot.set(key, value, metadata);
    
    // Invalidate any related cache entries
    this.cache.delete(`context_${key}`);
    this.invalidateQueryCache(key);
    
    return result;
  }

  async get(key) {
    // Check cache first
    const cacheKey = `context_${key}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }
    
    let cap = await this.hot.get(key);
    
    if (!cap) {
      // Try warm storage
      cap = await this.warm.get(key);
      
      if (cap) {
        // Move to hot storage (promote warm to hot)
        await this.hot.set(key, cap.value, cap.metadata);
        await this.warm.delete(key);
        
        // Update thermal state
        cap.thermal_state = "hot";
      }
    }
    
    if (cap) {
      // Update cache
      this.cache.set(cacheKey, cap);
    }
    
    return cap;
  }

  // Method to invalidate query cache when data changes
  invalidateQueryCache(changedKey) {
    // Remove any cached queries that might be affected
    for (const [key, _] of this.cache.entries()) {
      if (key.startsWith('query_') && key.includes(changedKey)) {
        this.cache.delete(key);
      }
    }
  }

  async think(input, options = {}) {
    const startTime = Date.now();
    
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
      result = await this.swarm.process({
        input,
        context,
        options
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
    
    // Post-processing - store results if needed
    if (options.storeResponse) {
      const responseKey = `response_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await this.store(
        responseKey,
        { input, output: result.response, context: result.contextUsed },
        { 
          source: 'think-response',
          timestamp: new Date().toISOString(),
          confidence: result.confidence
        }
      );
      
      result.storedKey = responseKey;
    }
    
    // Evaluate phase 9 (learning/evolution)
    this.evaluatePhase9(result, options);
    
    // Calculate and log metrics
    const duration = Date.now() - startTime;
    console.log(`Think operation completed in ${duration}ms with confidence ${result.confidence}`);
    
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
        cacheSize: this.cache.size,
        activeAgents: this.swarm.getActiveAgentCount(),
        uptime: process.uptime()
      },
      config: {
        hotPath: this.config.hotPath,
        maxAgents: this.config.maxAgents
      }
    };
  }

  async runMetabolism() {
    // Metabolism process - move data between storage tiers
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
    
    // Update query index periodically
    this.updateQueryIndex();
    
    // Clean up cache
    this.cleanupCache();
  }

  updateQueryIndex() {
    // Update query index for faster lookups
    // This is a simplified implementation - in production you'd want
    // a more sophisticated indexing strategy
    const hotCaps = this.hot.getAllSync(); // Synchronous for performance
    
    // Rebuild index
    this.queryIndex = {};
    
    for (const [key, cap] of Object.entries(hotCaps)) {
      // Create indices for common query patterns
      const tags = cap.metadata?.tags || [];
      const category = cap.metadata?.category;
      
      if (category) {
        if (!this.queryIndex[category]) {
          this.queryIndex[category] = [];
        }
        this.queryIndex[category].push({ key, ...cap });
      }
      
      for (const tag of tags) {
        if (!this.queryIndex[tag]) {
          this.queryIndex[tag] = [];
        }
        this.queryIndex[tag].push({ key, ...cap });
      }
    }
  }

  cleanupCache() {
    // Remove old cache entries
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      // Remove entries older than 5 minutes
      if (now - entry.timestamp > 300000) {
        this.cache.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      console.log(`Cleaned ${cleaned} entries from cache`);
    }
  }
}

module.exports = Mesh;