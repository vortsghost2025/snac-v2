const express = require("express");
const path = require('path');
const logger = require('./utils/logger');
const { limiter, securityHeaders, validateInput, sanitizeError } = require('./security-middleware');

// Use relative path from current directory instead of hardcoded Windows path
const workspaceBase = process.env.KILO_WORKSPACE || path.resolve(__dirname);

const app = express();
app.use(securityHeaders);
app.use(limiter);
app.use(express.json({ limit: '5mb' }));

// Request ID middleware for tracing
app.use((req, res, next) => {
  req.id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  res.setHeader('X-Request-ID', req.id);
  next();
});

app.use(validateInput);

// GPU Acceleration Components
const gpuGuard = require('./utils/gpuGuard');
const gpuMetrics = require('./utils/gpuMetrics');
const { MultiGPUManager } = require('./src/gpu/multiGPUManager');
const { ModelRegistry } = require('./src/modelRegistry');
const healthRouter = require('./routes/health');

// VPS AI Integration
const vpsAiIntegration = require('./src/vps/vpsAiIntegration');
const vpsAiRoutes = require('./routes/vpsAi');
const clineRouter = require('./routes/cline');
const gordonMcpGateway = require('./gordon-mcp-gateway');
const chatRouter = require('./mcp-gateway');

// Initialize GPU components
let multiGPUManager = null;
let modelRegistry = null;

async function initGPUComponents() {
  try {
    // Start GPU metrics collection
    gpuMetrics.startMetricsCollection(5000);
    
    // Initialize multi-GPU manager
    multiGPUManager = new MultiGPUManager({ strategy: 'least-busy' });
    await multiGPUManager.detectGPUs();
    multiGPUManager.startMonitoring();
    
    // Initialize model registry
    modelRegistry = new ModelRegistry({
      registryPath: './models/registry',
      modelsDir: './models',
      autoPromote: true
    });
    await modelRegistry.initialize();
    
    logger.info('GPU acceleration components initialized');
  } catch (error) {
    logger.warn('GPU components initialization failed (will use CPU fallback):', error.message);
  }
}

// Initialize VPS AI integration
vpsAiIntegration.initialize()
  .then(success => {
    if (success) {
      logger.info('VPS AI integration initialized successfully');
    } else {
      logger.info('VPS AI integration failed to initialize, will use fallback methods');
    }
  })
  .catch(error => {
    logger.error('Failed to initialize VPS AI integration:', error);
  });

// Initialize mesh on startup
async function initMesh() {
  // Prevent double initialization
  if (mesh) {
    logger.info("Mesh already initialized, skipping re-initialization");
    return;
  }
  
  const Mesh = require('./we/pcm/Mesh'); // Dynamically require to avoid early loading
  
  mesh = new Mesh({
    hotPath: process.env.PCM_HOT || "./memory/hot.json",
    warmPath: process.env.PCM_WARM || "./memory/warm.db",
    coldPath: process.env.PCM_COLD || "./memory/cold",
    maxAgents: parseInt(process.env.PCM_AGENTS) || 10,
    blipSecret: process.env.PCM_BLIP_SECRET
  });
  
  await mesh.init({ agentCount: parseInt(process.env.PCM_AGENTS) || 10 });
  logger.info("PCM initialized via API");
  
  // Integrate VPS AI with MessageBus after mesh is initialized
  if (vpsAiIntegration && mesh.messageBus) {
    vpsAiIntegration.integrateWithMessageBus(mesh.messageBus);
    logger.info("VPS AI integrated with MessageBus");
  }
}

// Health check routes
app.use('/', healthRouter);

// Chat router
app.use('/', chatRouter);

// VPS AI routes
app.use('/vps-ai', vpsAiRoutes);

// Cline API routes (with truth guard)
app.use('/api/cline', clineRouter);

// ========================================
// GORDON MCP GATEWAY - Docker Deployment
// ========================================
app.use('/gordon', gordonMcpGateway);

// Initialize autonomous learning components
const FeedbackCollector = require('./src/agents/FeedbackCollector');
const ModelSwapper = require('./src/agents/ModelSwapper');
const ParamBandit = require('./src/agents/ParamBandit');

// Initialize the feedback collector
const feedbackCollector = new FeedbackCollector();
feedbackCollector.initialize().catch(err => {
  logger.warn('FeedbackCollector initialization failed:', err.message);
});

// Initialize the param bandit with different configuration options
const bandit = new ParamBandit([
  { temp: 0.2, top_p: 0.9, ngl: 16 },
  { temp: 0.5, top_p: 0.8, ngl: 24 },
  { temp: 0.7, top_p: 0.7, ngl: 32 },
]);

let mesh = null;

// Health check - uses router from routes/health.js mounted at /
// Additional health endpoint with mesh-specific info
app.get("/health/mesh", (req, res) => {
  res.json({ 
    status: "ok", 
    pcm: mesh?.initialized || false,
    gpuAcceleration: mesh?.metabolismAddon?.loaded || false,
    modelVersion: ModelSwapper.getCurrentVersion ? ModelSwapper.getCurrentVersion() : 'unknown'
  });
});

// Improved token cost estimation with proper sanitization
function estimateTokenCost(input, model) {
  // Validate input
  if (typeof input !== 'string' || !input) {
    return 0;
  }
  
  // Rough estimate: 4 chars ≈ 1 token
  const chars = Buffer.byteLength(input, 'utf8');
  const base = chars * 0.75;
  
  const TOKEN_WEIGHTS = {
    "gemma3:1b": 0.5,
    "qwen2.5": 0.6,
    "code": 0.8,
    "plan": 1.0,
    "debug": 0.7
  };
  
  return base * (TOKEN_WEIGHTS[model] || 1.0);
}

// Enhanced main endpoint with autonomous learning integration
app.post("/free-coding-agent/run", async (req, res) => {
  const startTime = Date.now();
  
  try {
    const ip = req.ip || "unknown";
    const body = req.body || {};
    const { input, options = {}, mode = "", force_model: adminForce } = body;
    
    // Validate input
    if (!input || typeof input !== 'string') {
      return res.status(400).json({ error: "Missing or invalid input - must be a string" });
    }

    // Normalize incoming file paths in options/metadata to avoid absolute-path validation errors
    try {
      const path = require('path');
      const workspaceBase = process.env.KILO_WORKSPACE || path.resolve(__dirname);

      function sanitizeFilesContainer(obj) {
        if (!obj) return;
        const files = obj.files || (obj.metadata && obj.metadata.files);
        if (!files || !Array.isArray(files)) return;

        const abs = [];
        const rel = [];

        for (let entry of files) {
          try {
            if (!entry) { abs.push(null); rel.push(null); continue; }
            let candidate = null;
            if (typeof entry === 'string') {
              // Use secure path join to prevent traversal
              try {
                candidate = path.resolve(workspaceBase, entry);
              } catch (e) {
                logger.warn('Path validation failed:', e.message);
                continue;
              }
            } else if (entry && typeof entry === 'object' && entry.path) {
              try {
                candidate = path.resolve(workspaceBase, entry.path);
              } catch (e) {
                logger.warn('Path validation failed:', e.message);
                continue;
              }
            } else {
              candidate = null;
            }

            if (candidate) {
              abs.push(candidate);
              let rRaw = path.relative(workspaceBase, candidate);
              let r = rRaw.split(path.sep).join('/');
              // Keep relative only when it's inside the workspace and not an absolute/drive result
              if (!r || r.startsWith('..') || path.isAbsolute(r) || r.includes(':')) r = null;

              // Heuristic: if we have an absolute path from OneDrive or another
              // synced location that contains a workspace 'we' suffix (e.g.
              // .../we/pcm/core/...), attempt to map that suffix into the
              // configured workspace. This handles editors that send absolute
              // OneDrive paths while the repository is mounted at a different
              // drive letter.
              try {
                if (!r && typeof candidate === 'string') {
                  const lower = candidate.toLowerCase();
                  const marker = `${path.sep}we${path.sep}`;
                  const idx = lower.indexOf(marker);
                  if (idx !== -1) {
                    const suffix = candidate.substring(idx + marker.length);
                    const mapped = path.resolve(workspaceBase, 'we', suffix);
                    if (require('fs').existsSync(mapped)) {
                      let mappedRel = path.relative(workspaceBase, mapped).split(path.sep).join('/');
                      if (mappedRel && !mappedRel.startsWith('..')) r = mappedRel;
                    }
                  }
                }
              } catch (e) {
                // ignore mapping failures
              }

              rel.push(r);
            } else {
              abs.push(null);
              rel.push(null);
            }
          } catch (e) {
            abs.push(null); rel.push(null);
          }
        }

        // Prefer relative forms when available; otherwise fall back to absolute
        const normalized = rel.map((r, i) => (r ? r : abs[i]));
        if (obj.files) {
          obj.files_abs = abs;
          obj.files_rel = rel;
          obj.files = normalized;
        } else if (obj.metadata && obj.metadata.files) {
          obj.metadata.files_abs = abs;
          obj.metadata.files_rel = rel;
          obj.metadata.files = normalized;
        }
      }

      sanitizeFilesContainer(options);
      // Defensive validation: if any files resolved to absolute paths outside the
      // configured workspace, return a 400 with diagnostics instead of allowing
      // downstream code to throw UI-facing errors.
      try {
        const filesArr = options.files || (options.metadata && options.metadata.files) || [];
        const absArr = options.files_abs || (options.metadata && options.metadata.files_abs) || [];
        const relArr = options.files_rel || (options.metadata && options.metadata.files_rel) || [];
        const bad = [];
        for (let i = 0; i < (filesArr || []).length; i++) {
          const abs = absArr[i];
          const rel = relArr[i];
          if (abs && !rel) {
            // If abs is not inside workspaceBase, flag it as problematic
            if (!abs.startsWith(workspaceBase)) {
              bad.push({ index: i, abs });
            }
          }
        }

        if (bad.length) {
          // Instead of returning a hard 400 that surfaces absolute paths to the UI,
          // strip offending entries and continue processing. Record warnings
          // for later inclusion in the response and server logs.
          const warnings = bad.map(b => `Removed file index ${b.index} (${b.abs}) - outside workspace`);
          // remove entries from arrays by descending index to avoid shifting
          const indices = bad.map(b => b.index).sort((a, b) => b - a);
          for (const idx of indices) {
            if (options.files && options.files.length > idx) options.files.splice(idx, 1);
            if (options.files_abs && options.files_abs.length > idx) options.files_abs.splice(idx, 1);
            if (options.files_rel && options.files_rel.length > idx) options.files_rel.splice(idx, 1);
            if (options.metadata && options.metadata.files && options.metadata.files.length > idx) options.metadata.files.splice(idx, 1);
            if (options.metadata && options.metadata.files_abs && options.metadata.files_abs.length > idx) options.metadata.files_abs.splice(idx, 1);
            if (options.metadata && options.metadata.files_rel && options.metadata.files_rel.length > idx) options.metadata.files_rel.splice(idx, 1);
          }

          req._sanitizationWarnings = warnings;
          logger.warn('Sanitized request - removed outside-workspace files:', warnings);
        }
      } catch (e) {
        // If our defensive check fails, do not block the request; proceed with original options
        logger.warn('Path validation failed:', e && e.message);
      }
    } catch (e) {
      // If sanitization fails, do not block the request; proceed with original options
      logger.warn('Failed to sanitize incoming file paths:', e && e.message);
    }

    // Select parameters using the bandit algorithm
    const arm = bandit.selectArm();
    const selectedParams = { ...arm.config, ...options };
    
    // === Token cost estimation ===
    const MODELS = ["gemma3:1b", "qwen2.5", "code"];
    const modelChoice = adminForce ||
      (mode && process.env.MODEL_OVERRIDE?.[mode]) ||
      MODELS[arm.index % MODELS.length];

    const costEstimate = estimateTokenCost(input, modelChoice);

    logger.info(`[${ip}] Processed "${input.substring(0, 30)}..." | Model: ${modelChoice} | Cost: ${costEstimate.toFixed(2)}`);

    // === Core processing ===
    if (!mesh) {
      return res.status(503).json({ error: "Mesh not initialized" });
    }
    logger.info("Processing:", input.substring(0, 50) + "...");
    const result = await mesh.think(input, { ...selectedParams, useTriad: true });

    // Calculate metrics for feedback
    const latency = Date.now() - startTime;
    const reward = calculateReward(result, latency, costEstimate);

    // Record the reward for the bandit
    bandit.recordReward(arm, reward);

    // Collect feedback for training
    await feedbackCollector.addFeedback({
      prompt: input,
      response: result.response,
      reward: reward,
      latency: latency,
      costUsd: costEstimate,
      timestamp: Date.now(),
      agentId: 'dev-kimi'
    });

    res.json({
      success: true,
      response: result.response,
      confidence: result.confidence,
      method: result.method,
      contextUsed: result.contextUsed,
      capsCreated: result.capsCreated,
      model: modelChoice,
      cost: costEstimate.toFixed(2),
      warnings: req._sanitizationWarnings || [],
      selectedParams: selectedParams
    });
  } catch (err) {
    // Sanitize errors before sending to client
    logger.error("Processing error:", err && err.stack);
    
    // Redact obvious absolute paths (Windows drive letters and workspaceBase)
    let redacted = (err && err.message) ? err.message : String(err);
    redacted = redacted.replace(new RegExp(workspaceBase.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g'), '[WORKSPACE_PATH]');
    redacted = redacted.replace(/[A-Za-z]:\\[^\n\r]*/g, '[ABS_PATH]');
    redacted = redacted.replace(/\/[^\s"']+\/(?:[^\s"']+)/g, '[ABS_PATH]');

    res.status(500).json({ 
      error: 'Internal server error (details redacted)',
      details: process.env.NODE_ENV === 'development' ? redacted : undefined
    });
  }
});

// Helper function to calculate reward based on response quality, latency and cost
function calculateReward(result, latency, costEstimate) {
  // Simple reward calculation - adjust based on your specific requirements
  // Higher confidence = higher reward
  // Lower latency = higher reward (up to a point)
  // Lower cost = higher reward
  const confidenceFactor = result.confidence || 0.5;
  const latencyFactor = Math.max(0, 1 - (latency / 10000)); // Normalize latency impact
  const costFactor = Math.max(0, 1 - (costEstimate / 100)); // Normalize cost impact
  
  return (confidenceFactor * 0.5) + (latencyFactor * 0.3) + (costFactor * 0.2);
}

// Authentication middleware for sensitive endpoints
const authenticateApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
  const validKey = process.env.API_KEY || process.env.PCM_BLIP_SECRET;
  
  // Require API key in production - never bypass
  if (!validKey) {
    return res.status(401).json({ error: 'Unauthorized: API_KEY not configured' });
  }
  
  if (!apiKey) {
    return res.status(401).json({ error: 'Unauthorized: Missing API key' });
  }
  
  // Use timing-safe comparison to prevent timing attacks
  const crypto = require('crypto');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(apiKey), Buffer.from(validKey))) {
      return res.status(401).json({ error: 'Unauthorized: Invalid API key' });
    }
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized: Invalid API key' });
  }
  
  next();
};

// Model registry status
app.get("/gpu/models", authenticateApiKey, (req, res) => {
  if (!modelRegistry) {
    return res.status(503).json({ error: "Model registry not initialized" });
  }
  res.json(modelRegistry.getStats());
});

// Register new model - requires authentication
app.post("/gpu/models/register", authenticateApiKey, async (req, res) => {
  if (!modelRegistry) {
    return res.status(503).json({ error: "Model registry not initialized" });
  }
  try {
    const model = await modelRegistry.registerModel(req.body);
    res.json(model);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Promote model to production - requires authentication
app.post("/gpu/models/:id/promote", authenticateApiKey, async (req, res) => {
  if (!modelRegistry) {
    return res.status(503).json({ error: "Model registry not initialized" });
  }
  try {
    const model = await modelRegistry.promoteModel(req.params.id);
    res.json(model);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Rollback to previous model - requires authentication
app.post("/gpu/models/rollback", authenticateApiKey, async (req, res) => {
  if (!modelRegistry) {
    return res.status(503).json({ error: "Model registry not initialized" });
  }
  try {
    const model = await modelRegistry.rollback();
    res.json(model);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Multi-GPU status
app.get("/gpu/status", authenticateApiKey, (req, res) => {
  if (!multiGPUManager) {
    return res.status(503).json({ error: "Multi-GPU manager not initialized" });
  }
  res.json(multiGPUManager.getStats());
});

// GPU guard stats
app.get("/gpu/guard-stats", (req, res) => {
  res.json(gpuGuard.getStats());
});

// === End GPU & Model Management Endpoints ===
// Prometheus metrics - use the register from routes/health.js
// Custom SNAC metrics are registered once at startup
const client = require('prom-client');

// Create metrics once at module level
const latencyHistogram = new client.Histogram({
  name: 'snac_request_duration_seconds',
  help: 'Request duration in seconds',
  labelNames: ['method'],
});

const banditStatsGauge = new client.Gauge({
  name: 'snac_bandit_total_pulls',
  help: 'Total number of bandit selections',
});

const armPullsGauge = new client.Gauge({
  name: 'snac_bandit_arm_pulls',
  help: 'Number of pulls per arm',
  labelNames: ['arm_index'],
});

const armRewardsGauge = new client.Gauge({
  name: 'snac_bandit_arm_avg_reward',
  help: 'Average reward per arm',
  labelNames: ['arm_index'],
});

app.get("/metrics", async (req, res) => {
  try {
    // Update metrics with current bandit state
    const stats = bandit.getStats();
    banditStatsGauge.set(stats.totalPulls);
    
    stats.arms.forEach((arm, idx) => {
      armPullsGauge.labels({ arm_index: idx }).set(arm.pulls);
      armRewardsGauge.labels({ arm_index: idx }).set(arm.avgReward);
    });
    
    res.set('Content-Type', client.register.contentType);
    res.end(await client.register.metrics());
  } catch (err) {
    res.status(500).send("# Metrics collection error");
  }
});

// Mesh status endpoint
app.get("/free-coding-agent/mesh-status", (req, res) => {
  try {
    if (!mesh) {
      return res.status(500).json({ error: "Mesh not initialized" });
    }
    const status = mesh.getStatus();
    // Add bandit stats to mesh status
    status.autonomous_learning = {
      bandit_stats: bandit.getStats(),
      model_version: ModelSwapper.getCurrentVersion ? ModelSwapper.getCurrentVersion() : 'unknown'
    };
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Swarm status
app.get("/free-coding-agent/swarm-status", (req, res) => {
  try {
    if (!mesh) {
      return res.status(500).json({ error: "Mesh not initialized" });
    }
    res.json(mesh.swarm.getStatus());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generate blip code
app.post("/free-coding-agent/blip/generate", (req, res) => {
  try {
    if (!mesh) {
      return res.status(500).json({ error: "Mesh not initialized" });
    }
    const blip = mesh.bootstrap.generateBlip();
    res.json(blip);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admit agent via blip
app.post("/free-coding-agent/blip/admit", async (req, res) => {
  try {
    if (!mesh) {
      return res.status(500).json({ error: "Mesh not initialized" });
    }
    const { agentSpec, blipCode } = req.body;
    const result = await mesh.bootstrap.blipIn(agentSpec, blipCode);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Pipeline runner
app.post("/free-coding-agent/pipeline/:name", async (req, res) => {
  try {
    if (!mesh) {
      return res.status(500).json({ error: "Mesh not initialized" });
    }
    const pipelineName = req.params.name;
    const { input } = req.body;
    if (!mesh.pipelines.pipelines.has(pipelineName)) {
      if (pipelineName === "medical") mesh.pipelines.medical();
      else if (pipelineName === "weather") mesh.pipelines.weather();
      else if (pipelineName === "satellite") mesh.pipelines.satellite();
      else if (pipelineName === "cdc") mesh.pipelines.epidemiology();
    }
    const result = await mesh.pipelines.run(pipelineName, input);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Watchdog status
app.get("/free-coding-agent/watchdog", (req, res) => {
  try {
    if (!mesh) {
      return res.status(500).json({ error: "Mesh not initialized" });
    }
    res.json({
      health: mesh.health.status(),
      swarm: mesh.swarm.getStatus(),
      bootstrap: mesh.bootstrap.getStatus(),
      autonomous_learning: {
        feedback_collector: "active",
        model_swapper: ModelSwapper.getCurrentVersion ? ModelSwapper.getCurrentVersion() : 'unknown',
        bandit_active: true
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Graceful shutdown handler
process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully');
  gpuMetrics.stopMetricsCollection();
  if (multiGPUManager) {
    multiGPUManager.stopMonitoring();
  }
  if (feedbackCollector && typeof feedbackCollector.close === 'function') {
    await feedbackCollector.close();
  }
  if (mesh && typeof mesh.shutdown === 'function') {
    await mesh.shutdown();
  }
  if (server) {
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
});

process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully');
  gpuMetrics.stopMetricsCollection();
  if (multiGPUManager) {
    multiGPUManager.stopMonitoring();
  }
  if (feedbackCollector && typeof feedbackCollector.close === 'function') {
    await feedbackCollector.close();
  }
  if (mesh && typeof mesh.shutdown === 'function') {
    await mesh.shutdown();
  }
  if (server) {
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
});

const PORT = process.env.PORT || 3000;
let server = null;

// Error handling middleware - must be last, BEFORE starting server
app.use(sanitizeError);

Promise.all([initGPUComponents(), initMesh()]).then(() => {
  server = app.listen(PORT, () => logger.info(`SNAC v2 API running on port ${PORT}`));
}).catch(err => {
  logger.error('Failed to init:', err);
  process.exit(1);
});

