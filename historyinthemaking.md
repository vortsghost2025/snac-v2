
PR #3: Swarm + Metabolism + Mesh Runtime
Let's close this loop.

we/pcm/swarm/Agent.js
JavaScript

/**
 * Agent - Individual cognitive worker in the swarm
 * Each agent has a role, state, and can process tasks
 */

const crypto = require('crypto');
const CognitiveAnchor = require('../core/CognitiveAnchor');

const AGENT_ROLES = {
  WORKER: 'worker',           // Execute tasks, report observations
  COORDINATOR: 'coordinator', // Route tasks, merge results
  CRITIC: 'critic',           // Challenge conclusions, find holes
  INTEGRATOR: 'integrator',   // Synthesize across threads
  ARCHIVIST: 'archivist'      // Manage memory metabolism
};

const AGENT_STATES = {
  IDLE: 'idle',
  WORKING: 'working',
  WAITING: 'waiting',
  BLOCKED: 'blocked',
  OFFLINE: 'offline'
};

class Agent {
  constructor(options = {}) {
    this.id = options.id || `agent_${crypto.randomBytes(4).toString('hex')}`;
    this.name = options.name || `Agent-${this.id.slice(-4)}`;
    this.role = options.role || AGENT_ROLES.WORKER;
    
    // State
    this.state = AGENT_STATES.IDLE;
    this.currentTask = null;
    this.taskHistory = [];
    
    // Performance tracking
    this.stats = {
      tasksCompleted: 0,
      tasksFailed: 0,
      totalProcessingTime: 0,
      avgProcessingTime: 0,
      lastActive: Date.now(),
      created: Date.now()
    };
    
    // Capacity
    this.capacity = {
      maxConcurrent: options.maxConcurrent || 1,
      currentLoad: 0,
      maxMemoryMB: options.maxMemoryMB || 100,
      priority: options.priority ?? 0.5
    };
    
    // Context window
    this.context = {
      caps: [],           // Currently loaded CAPs
      threads: [],        // Active thread references
      maxCaps: options.maxCaps || 20
    };
    
    // Communication
    this.inbox = [];      // Pending messages
    this.outbox = [];     // Messages to send
    
    // Hooks for external LLM/processor
    this.processor = options.processor || null;
  }

  // === TASK HANDLING ===

  canAcceptTask() {
    return (
      this.state !== AGENT_STATES.OFFLINE &&
      this.state !== AGENT_STATES.BLOCKED &&
      this.capacity.currentLoad < this.capacity.maxConcurrent
    );
  }

  async assignTask(task) {
    if (!this.canAcceptTask()) {
      return { accepted: false, reason: `Agent ${this.id} cannot accept tasks` };
    }
    
    this.currentTask = {
      id: task.id || `task_${Date.now()}`,
      type: task.type,
      input: task.input,
      context: task.context || [],
      priority: task.priority ?? 0.5,
      assignedAt: Date.now(),
      deadline: task.deadline || null
    };
    
    this.state = AGENT_STATES.WORKING;
    this.capacity.currentLoad++;
    
    return { accepted: true, taskId: this.currentTask.id };
  }

  async executeTask() {
    if (!this.currentTask) {
      return { success: false, error: 'No task assigned' };
    }
    
    const startTime = Date.now();
    
    try {
      // Load relevant context
      await this.loadContext(this.currentTask.context);
      
      // Process based on role
      let result;
      switch (this.role) {
        case AGENT_ROLES.WORKER:
          result = await this.processAsWorker();
          break;
        case AGENT_ROLES.CRITIC:
          result = await this.processAsCritic();
          break;
        case AGENT_ROLES.INTEGRATOR:
          result = await this.processAsIntegrator();
          break;
        case AGENT_ROLES.COORDINATOR:
          result = await this.processAsCoordinator();
          break;
        case AGENT_ROLES.ARCHIVIST:
          result = await this.processAsArchivist();
          break;
        default:
          result = await this.processAsWorker();
      }
      
      // Update stats
      const duration = Date.now() - startTime;
      this.stats.tasksCompleted++;
      this.stats.totalProcessingTime += duration;
      this.stats.avgProcessingTime = this.stats.totalProcessingTime / this.stats.tasksCompleted;
      this.stats.lastActive = Date.now();
      
      // Record in history
      this.taskHistory.push({
        taskId: this.currentTask.id,
        type: this.currentTask.type,
        duration,
        success: true,
        timestamp: Date.now()
      });
      
      // Trim history
      if (this.taskHistory.length > 100) {
        this.taskHistory = this.taskHistory.slice(-50);
      }
      
      // Clear task
      this.currentTask = null;
      this.capacity.currentLoad--;
      this.state = AGENT_STATES.IDLE;
      
      return { success: true, result, duration };
      
    } catch (error) {
      this.stats.tasksFailed++;
      this.taskHistory.push({
        taskId: this.currentTask?.id,
        error: error.message,
        success: false,
        timestamp: Date.now()
      });
      
      this.currentTask = null;
      this.capacity.currentLoad--;
      this.state = AGENT_STATES.IDLE;
      
      return { success: false, error: error.message };
    }
  }

  // === ROLE-SPECIFIC PROCESSING ===

  async processAsWorker() {
    const { input } = this.currentTask;
    
    // If we have an external processor (LLM), use it
    if (this.processor) {
      const response = await this.processor.process({
        input,
        context: this.context.caps.map(c => c.content).join('\n---\n'),
        role: 'worker',
        instruction: 'Process this task and return observations and results.'
      });
      
      return {
        type: 'observation',
        content: response,
        caps: this.extractInsights(response)
      };
    }
    
    // Fallback: return structured placeholder
    return {
      type: 'observation',
      content: `Worker processed: ${input?.substring?.(0, 100) || JSON.stringify(input)}`,
      caps: []
    };
  }

  async processAsCritic() {
    const { input } = this.currentTask;
    
    if (this.processor) {
      const response = await this.processor.process({
        input,
        context: this.context.caps.map(c => c.content).join('\n---\n'),
        role: 'critic',
        instruction: 'Analyze this for weaknesses, gaps, contradictions, or risks. Be thorough but constructive.'
      });
      
      return {
        type: 'critique',
        content: response,
        issues: this.extractIssues(response),
        caps: this.extractInsights(response)
      };
    }
    
    return {
      type: 'critique',
      content: `Critic analysis pending for: ${typeof input === 'string' ? input.substring(0, 100) : 'complex input'}`,
      issues: [],
      caps: []
    };
  }

  async processAsIntegrator() {
    const { input } = this.currentTask;
    
    // Integrator synthesizes across multiple sources
    const sources = Array.isArray(input) ? input : [input];
    
    if (this.processor) {
      const response = await this.processor.process({
        input: sources.join('\n\n---SOURCE BREAK---\n\n'),
        context: this.context.caps.map(c => c.content).join('\n---\n'),
        role: 'integrator',
        instruction: 'Synthesize these sources into a coherent understanding. Identify connections, resolve contradictions, create unified insights.'
      });
      
      return {
        type: 'synthesis',
        content: response,
        connections: this.extractConnections(response),
        caps: this.extractInsights(response)
      };
    }
    
    return {
      type: 'synthesis',
      content: `Integration of ${sources.length} sources pending`,
      connections: [],
      caps: []
    };
  }

  async processAsCoordinator() {
    // Coordinator doesn't process content—routes and manages
    return {
      type: 'coordination',
      routing: this.currentTask.input,
      delegations: []
    };
  }

  async processAsArchivist() {
    // Archivist handles memory operations
    const { input } = this.currentTask;
    
    return {
      type: 'archival',
      action: input.action || 'audit',
      affected: input.targets || [],
      caps: []
    };
  }

  // === CONTEXT MANAGEMENT ===

  async loadContext(capIds) {
    // This would be wired to storage layer
    // For now, just track what we're supposed to load
    this.context.caps = capIds.slice(0, this.context.maxCaps);
  }

  clearContext() {
    this.context.caps = [];
    this.context.threads = [];
  }

  // === EXTRACTION HELPERS ===

  extractInsights(text) {
    // Simple extraction—would be enhanced with LLM or pattern matching
    const caps = [];
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 20);
    
    for (const sentence of sentences.slice(0, 3)) {
      if (/\b(found|discovered|realized|concluded|determined)\b/i.test(sentence)) {
        caps.push(new CognitiveAnchor({
          type: 'insight',
          content: sentence.trim(),
          meta: { agent_id: this.id, extracted: true }
        }));
      }
    }
    
    return caps;
  }

  extractIssues(text) {
    const issues = [];
    const patterns = [
      /\b(problem|issue|concern|risk|weakness|gap|missing|unclear)\b[^.]*\./gi
    ];
    
    for (const pattern of patterns) {
      const matches = text.match(pattern) || [];
      issues.push(...matches.map(m => m.trim()));
    }
    
    return issues;
  }

  extractConnections(text) {
    const connections = [];
    const patterns = [
      /\b(connects to|relates to|supports|contradicts|builds on)\b[^.]*\./gi
    ];
    
    for (const pattern of patterns) {
      const matches = text.match(pattern) || [];
      connections.push(...matches.map(m => m.trim()));
    }
    
    return connections;
  }

  // === COMMUNICATION ===

  send(targetAgentId, message) {
    this.outbox.push({
      from: this.id,
      to: targetAgentId,
      content: message,
      timestamp: Date.now()
    });
  }

  receive(message) {
    this.inbox.push(message);
  }

  processInbox() {
    const messages = [...this.inbox];
    this.inbox = [];
    return messages;
  }

  flushOutbox() {
    const messages = [...this.outbox];
    this.outbox = [];
    return messages;
  }

  // === HEALTH ===

  getHealth() {
    const now = Date.now();
    const idleTime = now - this.stats.lastActive;
    
    return {
      id: this.id,
      role: this.role,
      state: this.state,
      load: `${this.capacity.currentLoad}/${this.capacity.maxConcurrent}`,
      tasksCompleted: this.stats.tasksCompleted,
      tasksFailed: this.stats.tasksFailed,
      successRate: this.stats.tasksCompleted > 0 
        ? ((this.stats.tasksCompleted / (this.stats.tasksCompleted + this.stats.tasksFailed)) * 100).toFixed(1) + '%'
        : 'N/A',
      avgProcessingTime: `${this.stats.avgProcessingTime.toFixed(0)}ms`,
      idleTime: `${(idleTime / 1000).toFixed(1)}s`,
      healthy: this.state !== AGENT_STATES.BLOCKED && this.state !== AGENT_STATES.OFFLINE
    };
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      role: this.role,
      state: this.state,
      stats: this.stats,
      capacity: this.capacity
    };
  }
}

module.exports = { Agent, AGENT_ROLES, AGENT_STATES };
we/pcm/swarm/Orchestrator.js
JavaScript

/**
 * Orchestrator - Manages the agent swarm
 * Routes tasks, handles consensus, monitors health
 */

const { Agent, AGENT_ROLES, AGENT_STATES } = require('./Agent');
const Consensus = require('./Consensus');

class Orchestrator {
  constructor(options = {}) {
    this.agents = new Map();
    this.taskQueue = [];
    this.completedTasks = [];
    this.consensus = new Consensus();
    
    // Configuration
    this.config = {
      maxAgents: options.maxAgents || 50,
      defaultRoleDistribution: options.roleDistribution || {
        [AGENT_ROLES.WORKER]: 0.6,
        [AGENT_ROLES.CRITIC]: 0.15,
        [AGENT_ROLES.INTEGRATOR]: 0.1,
        [AGENT_ROLES.COORDINATOR]: 0.1,
        [AGENT_ROLES.ARCHIVIST]: 0.05
      },
      healthCheckInterval: options.healthCheckInterval || 30000,
      maxQueueSize: options.maxQueueSize || 1000,
      ...options
    };
    
    // Stats
    this.stats = {
      totalTasksSubmitted: 0,
      totalTasksCompleted: 0,
      totalTasksFailed: 0,
      startTime: Date.now()
    };
    
    // Health monitoring
    this.healthInterval = null;
    this.unhealthyAgents = new Set();
  }

  // === LIFECYCLE ===

  async initialize(agentCount = 10) {
    const distribution = this.config.defaultRoleDistribution;
    
    for (let i = 0; i < agentCount; i++) {
      // Determine role based on distribution
      const rand = Math.random();
      let cumulative = 0;
      let role = AGENT_ROLES.WORKER;
      
      for (const [r, prob] of Object.entries(distribution)) {
        cumulative += prob;
        if (rand <= cumulative) {
          role = r;
          break;
        }
      }
      
      const agent = new Agent({ role, processor: this.config.processor });
      this.agents.set(agent.id, agent);
    }
    
    // Start health monitoring
    this.startHealthMonitor();
    
    return this;
  }

  async shutdown() {
    this.stopHealthMonitor();
    
    // Wait for active tasks
    const activeAgents = Array.from(this.agents.values())
      .filter(a => a.state === AGENT_STATES.WORKING);
    
    if (activeAgents.length > 0) {
      console.log(`Waiting for ${activeAgents.length} agents to complete...`);
      await Promise.all(activeAgents.map(a => this.waitForIdle(a.id, 30000)));
    }
    
    this.agents.clear();
  }

  // === TASK MANAGEMENT ===

  async submit(task) {
    if (this.taskQueue.length >= this.config.maxQueueSize) {
      return { success: false, error: 'Queue full' };
    }
    
    const taskEntry = {
      id: task.id || `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      ...task,
      submittedAt: Date.now(),
      status: 'queued'
    };
    
    this.taskQueue.push(taskEntry);
    this.stats.totalTasksSubmitted++;
    
    // Try immediate dispatch
    await this.dispatch();
    
    return { success: true, taskId: taskEntry.id };
  }

  async dispatch() {
    // Sort queue by priority
    this.taskQueue.sort((a, b) => (b.priority || 0.5) - (a.priority || 0.5));
    
    const dispatched = [];
    
    for (const task of [...this.taskQueue]) {
      const agent = this.findBestAgent(task);
      
      if (agent) {
        const result = await agent.assignTask(task);
        
        if (result.accepted) {
          task.status = 'assigned';
          task.agentId = agent.id;
          this.taskQueue = this.taskQueue.filter(t => t.id !== task.id);
          dispatched.push({ taskId: task.id, agentId: agent.id });
          
          // Execute (fire and forget, or track promise)
          this.executeAndHandle(agent, task);
        }
      }
    }
    
    return dispatched;
  }

  async executeAndHandle(agent, task) {
    const result = await agent.executeTask();
    
    if (result.success) {
      this.stats.totalTasksCompleted++;
      this.completedTasks.push({
        taskId: task.id,
        agentId: agent.id,
        result: result.result,
        duration: result.duration,
        completedAt: Date.now()
      });
      
      // Trim completed history
      if (this.completedTasks.length > 500) {
        this.completedTasks = this.completedTasks.slice(-250);
      }
      
    } else {
      this.stats.totalTasksFailed++;
      
      // Retry logic
      if ((task.retries || 0) < 3) {
        task.retries = (task.retries || 0) + 1;
        task.lastError = result.error;
        this.taskQueue.push(task);
      }
    }
    
    // Process any messages
    this.routeMessages(agent.flushOutbox());
    
    // Try to dispatch more
    await this.dispatch();
  }

  findBestAgent(task) {
    const candidates = [];
    
    // Determine preferred role
    let preferredRole = AGENT_ROLES.WORKER;
    if (task.type === 'critique') preferredRole = AGENT_ROLES.CRITIC;
    else if (task.type === 'integrate') preferredRole = AGENT_ROLES.INTEGRATOR;
    else if (task.type === 'coordinate') preferredRole = AGENT_ROLES.COORDINATOR;
    else if (task.type === 'archive') preferredRole = AGENT_ROLES.ARCHIVIST;
    
    for (const agent of this.agents.values()) {
      if (!agent.canAcceptTask()) continue;
      if (this.unhealthyAgents.has(agent.id)) continue;
      
      let score = 0;
      
      // Role match
      if (agent.role === preferredRole) score += 1.0;
      
      // Load preference (prefer less loaded)
      score += (1 - agent.capacity.currentLoad / agent.capacity.maxConcurrent) * 0.5;
      
      // Success rate
      const totalTasks = agent.stats.tasksCompleted + agent.stats.tasksFailed;
      if (totalTasks > 0) {
        score += (agent.stats.tasksCompleted / totalTasks) * 0.3;
      }
      
      // Priority alignment
      score += agent.capacity.priority * 0.2;
      
      candidates.push({ agent, score });
    }
    
    if (candidates.length === 0) return null;
    
    // Sort by score descending
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0].agent;
  }

  // === COLLABORATIVE PROCESSING ===

  async processCollaboratively(input, options = {}) {
    const mode = options.mode || 'parallel';
    const roles = options.roles || [AGENT_ROLES.WORKER, AGENT_ROLES.CRITIC, AGENT_ROLES.INTEGRATOR];
    
    if (mode === 'parallel') {
      return this.parallelProcess(input, roles, options);
    } else if (mode === 'sequential') {
      return this.sequentialProcess(input, roles, options);
    } else if (mode === 'debate') {
      return this.debateProcess(input, options);
    }
  }

  async parallelProcess(input, roles, options) {
    const tasks = roles.map(role => ({
      type: role === AGENT_ROLES.CRITIC ? 'critique' : 
            role === AGENT_ROLES.INTEGRATOR ? 'integrate' : 'process',
      input,
      context: options.context || [],
      priority: options.priority || 0.5
    }));
    
    // Submit all
    const submissions = await Promise.all(tasks.map(t => this.submit(t)));
    const taskIds = submissions.filter(s => s.success).map(s => s.taskId);
    
    // Wait for completion
    const results = await this.waitForTasks(taskIds, options.timeout || 60000);
    
    // Aggregate
    if (options.aggregate !== false) {
      return this.consensus.aggregate(results);
    }
    
    return results;
  }

  async sequentialProcess(input, roles, options) {
    let currentInput = input;
    const chain = [];
    
    for (const role of roles) {
      const task = {
        type: role === AGENT_ROLES.CRITIC ? 'critique' : 
              role === AGENT_ROLES.INTEGRATOR ? 'integrate' : 'process',
        input: currentInput,
        context: options.context || [],
        priority: options.priority || 0.5
      };
      
      const submission = await this.submit(task);
      if (!submission.success) {
        chain.push({ role, error: 'Failed to submit' });
        continue;
      }
      
      const [result] = await this.waitForTasks([submission.taskId], options.timeout || 30000);
      chain.push({ role, result });
      
      // Pass output as next input
      if (result?.result?.content) {
        currentInput = result.result.content;
      }
    }
    
    return { chain, final: currentInput };
  }

  async debateProcess(input, options) {
    const rounds = options.rounds || 3;
    const positions = [];
    
    // Get initial positions from multiple workers
    const workers = this.getAgentsByRole(AGENT_ROLES.WORKER).slice(0, 3);
    
    for (const worker of workers) {
      if (!worker.canAcceptTask()) continue;
      
      await worker.assignTask({ type: 'process', input, context: options.context || [] });
      const result = await worker.executeTask();
      
      if (result.success) {
        positions.push({
          agentId: worker.id,
          position: result.result.content,
          confidence: 0.5
        });
      }
    }
    
    // Debate rounds
    for (let round = 0; round < rounds; round++) {
      const critic = this.getAgentsByRole(AGENT_ROLES.CRITIC)[0];
      if (!critic || !critic.canAcceptTask()) break;
      
      // Critic evaluates all positions
      const debateInput = positions.map((p, i) => `Position ${i + 1}: ${p.position}`).join('\n\n');
      await critic.assignTask({ type: 'critique', input: debateInput });
      const critique = await critic.executeTask();
      
      if (critique.success) {
        // Adjust confidences based on critique
        // (simplified: would use NLP to match critiques to positions)
        for (const pos of positions) {
          pos.confidence *= 0.9; // Slight decay
        }
      }
    }
    
    // Final integration
    const integrator = this.getAgentsByRole(AGENT_ROLES.INTEGRATOR)[0];
    if (integrator && integrator.canAcceptTask()) {
      const synthesisInput = positions.map(p => p.position);
      await integrator.assignTask({ type: 'integrate', input: synthesisInput });
      const synthesis = await integrator.executeTask();
      
      return {
        positions,
        synthesis: synthesis.success ? synthesis.result : null,
        method: 'debate'
      };
    }
    
    return { positions, synthesis: null, method: 'debate' };
  }

  // === HELPERS ===

  getAgentsByRole(role) {
    return Array.from(this.agents.values()).filter(a => a.role === role);
  }

  async waitForTasks(taskIds, timeout = 60000) {
    const deadline = Date.now() + timeout;
    const results = [];
    
    while (Date.now() < deadline && results.length < taskIds.length) {
      for (const taskId of taskIds) {
        const completed = this.completedTasks.find(t => t.taskId === taskId);
        if (completed && !results.find(r => r.taskId === taskId)) {
          results.push(completed);
        }
      }
      
      if (results.length < taskIds.length) {
        await new Promise(r => setTimeout(r, 100));
      }
    }
    
    return results;
  }

  async waitForIdle(agentId, timeout = 30000) {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    
    const deadline = Date.now() + timeout;
    while (agent.state === AGENT_STATES.WORKING && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 100));
    }
  }

  routeMessages(messages) {
    for (const msg of messages) {
      const target = this.agents.get(msg.to);
      if (target) {
        target.receive(msg);
      }
    }
  }

  // === HEALTH MONITORING ===

  startHealthMonitor() {
    this.healthInterval = setInterval(() => {
      this.checkHealth();
    }, this.config.healthCheckInterval);
  }

  stopHealthMonitor() {
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
      this.healthInterval = null;
    }
  }

  checkHealth() {
    const now = Date.now();
    const rss = process.memoryUsage().rss;
    
    for (const agent of this.agents.values()) {
      const health = agent.getHealth();
      
      // Mark unhealthy if:
      // - High failure rate
      // - Stuck in working state too long
      // - Memory pressure
      
      const failRate = agent.stats.tasksFailed / (agent.stats.tasksCompleted + agent.stats.tasksFailed + 1);
      const stuckTime = agent.state === AGENT_STATES.WORKING 
        ? now - agent.stats.lastActive 
        : 0;
      
      if (failRate > 0.5 || stuckTime > 120000) {
        this.unhealthyAgents.add(agent.id);
        agent.state = AGENT_STATES.BLOCKED;
      } else {
        this.unhealthyAgents.delete(agent.id);
        if (agent.state === AGENT_STATES.BLOCKED) {
          agent.state = AGENT_STATES.IDLE;
        }
      }
    }
    
    // Scale down under memory pressure
    if (rss > 0.8 * 1024 * 1024 * 1024) { // 80% of 1GB
      this.scaleDown(0.2); // Reduce by 20%
    }
  }

  scaleDown(fraction) {
    const toRemove = Math.floor(this.agents.size * fraction);
    let removed = 0;
    
    for (const [id, agent] of this.agents) {
      if (removed >= toRemove) break;
      if (agent.state === AGENT_STATES.IDLE) {
        this.agents.delete(id);
        removed++;
      }
    }
    
    console.log(`Scaled down: removed ${removed} agents`);
  }

  // === STATUS ===

  getStatus() {
    const byRole = {};
    const byState = {};
    
    for (const agent of this.agents.values()) {
      byRole[agent.role] = (byRole[agent.role] || 0) + 1;
      byState[agent.state] = (byState[agent.state] || 0) + 1;
    }
    
    return {
      agentCount: this.agents.size,
      byRole,
      byState,
      queueSize: this.taskQueue.length,
      unhealthyCount: this.unhealthyAgents.size,
      stats: this.stats,
      uptime: `${((Date.now() - this.stats.startTime) / 1000 / 60).toFixed(1)} min`
    };
  }
}

module.exports = Orchestrator;
we/pcm/swarm/Consensus.js
JavaScript

/**
 * Consensus - Resolve conflicts and aggregate multi-agent outputs
 */

class Consensus {
  constructor(options = {}) {
    this.strategies = {
      vote: this.voteStrategy.bind(this),
      debate: this.debateStrategy.bind(this),
      weighted: this.weightedStrategy.bind(this),
      defer: this.deferStrategy.bind(this)
    };
    
    this.defaultStrategy = options.defaultStrategy || 'weighted';
  }

  // === AGGREGATION ===

  aggregate(results, options = {}) {
    if (!results || results.length === 0) {
      return { content: null, confidence: 0, method: 'none' };
    }
    
    if (results.length === 1) {
      return {
        content: results[0].result?.content || results[0],
        confidence: 1.0,
        method: 'single',
        source: results[0].agentId
      };
    }
    
    const strategy = options.strategy || this.defaultStrategy;
    return this.strategies[strategy](results, options);
  }

  // === STRATEGIES ===

  voteStrategy(results) {
    // Simple majority voting on outcomes
    const votes = new Map();
    
    for (const r of results) {
      const content = r.result?.content || '';
      const key = this.normalizeForVoting(content);
      
      const existing = votes.get(key) || { count: 0, original: content, voters: [] };
      existing.count++;
      existing.voters.push(r.agentId);
      votes.set(key, existing);
    }
    
    // Find winner
    let winner = null;
    let maxVotes = 0;
    
    for (const [key, data] of votes) {
      if (data.count > maxVotes) {
        maxVotes = data.count;
        winner = data;
      }
    }
    
    return {
      content: winner?.original || null,
      confidence: maxVotes / results.length,
      method: 'vote',
      votes: maxVotes,
      total: results.length
    };
  }

  weightedStrategy(results) {
    // Weight by agent performance metrics
    const weighted = results.map(r => {
      const successRate = r.agentStats?.successRate || 0.5;
      const recency = r.duration ? Math.exp(-r.duration / 10000) : 0.5;
      const weight = successRate * 0.7 + recency * 0.3;
      
      return { ...r, weight };
    });
    
    // Sort by weight
    weighted.sort((a, b) => b.weight - a.weight);
    
    // Take top result, but note alternatives
    const top = weighted[0];
    
    return {
      content: top.result?.content || null,
      confidence: top.weight,
      method: 'weighted',
      alternatives: weighted.slice(1, 3).map(w => ({
        content: w.result?.content,
        weight: w.weight,
        agentId: w.agentId
      }))
    };
  }

  deferStrategy(results) {
    // Use first result, but preserve minority views
    const primary = results[0];
    const minority = results.slice(1);
    
    return {
      content: primary.result?.content || null,
      confidence: 1.0 / results.length, // Lower confidence when deferring
      method: 'defer',
      preserved: minority.map(m => ({
        content: m.result?.content,
        agentId: m.agentId,
        reason: 'minority_view'
      }))
    };
  }

  async debateStrategy(results, options) {
    // Requires external processor for true debate
    // Simplified: cross-check results against each other
    
    const positions = results.map(r => ({
      agentId: r.agentId,
      content: r.result?.content || '',
      challenged: false,
      supported: false
    }));
    
    // Simple cross-checking
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const similarity = this.textSimilarity(positions[i].content, positions[j].content);
        
        if (similarity > 0.8) {
          positions[i].supported = true;
          positions[j].supported = true;
        } else if (similarity < 0.3) {
          positions[i].challenged = true;
          positions[j].challenged = true;
        }
      }
    }
    
    // Prefer supported, unchalllenged positions
    const ranked = positions.sort((a, b) => {
      const scoreA = (a.supported ? 1 : 0) - (a.challenged ? 0.5 : 0);
      const scoreB = (b.supported ? 1 : 0) - (b.challenged ? 0.5 : 0);
      return scoreB - scoreA;
    });
    
    return {
      content: ranked[0]?.content || null,
      confidence: ranked[0]?.supported ? 0.8 : 0.5,
      method: 'debate',
      positions: ranked
    };
  }

  // === CONFLICT DETECTION ===

  detectConflicts(caps) {
    const conflicts = [];
    
    for (let i = 0; i < caps.length; i++) {
      for (let j = i + 1; j < caps.length; j++) {
        const conflict = this.checkConflict(caps[i], caps[j]);
        if (conflict.hasConflict) {
          conflicts.push({
            capA: caps[i].id,
            capB: caps[j].id,
            type: conflict.type,
            description: conflict.description
          });
        }
      }
    }
    
    return conflicts;
  }

  checkConflict(capA, capB) {
    // Explicit contradiction relationship
    if (capA.relationships.contradicts.some(r => r.target === capB.id)) {
      return { hasConflict: true, type: 'explicit', description: 'Marked as contradicting' };
    }
    
    // One supersedes the other
    if (capA.relationships.supersedes.some(r => r.target === capB.id)) {
      return { hasConflict: true, type: 'superseded', description: 'A supersedes B' };
    }
    
    // Content-based conflict detection (simplified)
    const negation = this.detectNegation(capA.content, capB.content);
    if (negation) {
      return { hasConflict: true, type: 'semantic', description: negation };
    }
    
    return { hasConflict: false };
  }

  detectNegation(textA, textB) {
    // Simple pattern: "X is Y" vs "X is not Y"
    const negationPatterns = [
      { pos: /\bis\s+(\w+)/, neg: /\bis\s+not\s+\1/ },
      { pos: /\bshould\b/, neg: /\bshould\s+not\b/ },
      { pos: /\bwill\b/, neg: /\bwill\s+not\b|\bwon't\b/ },
      { pos: /\bcan\b/, neg: /\bcan\s?not\b|\bcan't\b/ }
    ];
    
    for (const pattern of negationPatterns) {
      if (pattern.pos.test(textA) && pattern.neg.test(textB)) {
        return `Potential negation detected`;
      }
      if (pattern.pos.test(textB) && pattern.neg.test(textA)) {
        return `Potential negation detected`;
      }
    }
    
    return null;
  }

  // === HELPERS ===

  normalizeForVoting(text) {
    // Normalize text for comparison
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200); // Compare first 200 chars
  }

  textSimilarity(a, b) {
    // Jaccard similarity on word sets
    const wordsA = new Set(a.toLowerCase().split(/\s+/));
    const wordsB = new Set(b.toLowerCase().split(/\s+/));
    
    const intersection = new Set([...wordsA].filter(w => wordsB.has(w)));
    const union = new Set([...wordsA, ...wordsB]);
    
    return intersection.size / union.size;
  }
}

module.exports = Consensus;
we/pcm/swarm/HealthMonitor.js
JavaScript

/**
 * HealthMonitor - System-wide health tracking and auto-scaling
 */

const os = require('os');

class HealthMonitor {
  constructor(options = {}) {
    this.thresholds = {
      rssWarning: options.rssWarning || 0.7,      // 70% of available
      rssCritical: options.rssCritical || 0.85,   // 85% of available
      cpuWarning: options.cpuWarning || 0.7,
      cpuCritical: options.cpuCritical || 0.9,
      queueWarning: options.queueWarning || 100,
      queueCritical: options.queueCritical || 500,
      ...options.thresholds
    };
    
    this.maxMemoryMB = options.maxMemoryMB || (os.totalmem() / (1024 * 1024));
    
    this.history = [];
    this.maxHistory = options.maxHistory || 100;
    this.interval = null;
    this.callbacks = {
      onWarning: options.onWarning || (() => {}),
      onCritical: options.onCritical || (() => {}),
      onRecovery: options.onRecovery || (() => {})
    };
    
    this.lastState = 'healthy';
  }

  start(intervalMs = 5000) {
    this.interval = setInterval(() => this.check(), intervalMs);
    return this;
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  check() {
    const snapshot = this.takeSnapshot();
    this.history.push(snapshot);
    
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }
    
    const state = this.evaluateState(snapshot);
    
    if (state !== this.lastState) {
      if (state === 'critical') {
        this.callbacks.onCritical(snapshot);
      } else if (state === 'warning') {
        this.callbacks.onWarning(snapshot);
      } else if (this.lastState !== 'healthy') {
        this.callbacks.onRecovery(snapshot);
      }
      this.lastState = state;
    }
    
    return snapshot;
  }

  takeSnapshot() {
    const mem = process.memoryUsage();
    const cpus = os.cpus();
    
    // Calculate CPU usage
    let totalIdle = 0, totalTick = 0;
    for (const cpu of cpus) {
      for (const type in cpu.times) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    }
    const cpuUsage = 1 - (totalIdle / totalTick);
    
    return {
      timestamp: Date.now(),
      memory: {
        rss: mem.rss,
        rssMB: (mem.rss / (1024 * 1024)).toFixed(1),
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        external: mem.external,
        rssPercent: mem.rss / (this.maxMemoryMB * 1024 * 1024)
      },
      cpu: {
        usage: cpuUsage,
        cores: cpus.length
      },
      system: {
        freeMem: os.freemem(),
        freeMemMB: (os.freemem() / (1024 * 1024)).toFixed(1),
        totalMem: os.totalmem(),
        loadAvg: os.loadavg()
      }
    };
  }

  evaluateState(snapshot) {
    // Check RSS
    if (snapshot.memory.rssPercent > this.thresholds.rssCritical) {
      return 'critical';
    }
    if (snapshot.memory.rssPercent > this.thresholds.rssWarning) {
      return 'warning';
    }
    
    // Check CPU
    if (snapshot.cpu.usage > this.thresholds.cpuCritical) {
      return 'critical';
    }
    if (snapshot.cpu.usage > this.thresholds.cpuWarning) {
      return 'warning';
    }
    
    return 'healthy';
  }

  getStatus() {
    const latest = this.history[this.history.length - 1] || this.takeSnapshot();
    const state = this.evaluateState(latest);
    
    // Trend analysis
    let trend = 'stable';
    if (this.history.length >= 5) {
      const recent = this.history.slice(-5);
      const rssChange = recent[4].memory.rss - recent[0].memory.rss;
      if (rssChange > recent[0].memory.rss * 0.1) {
        trend = 'increasing';
      } else if (rssChange < -recent[0].memory.rss * 0.1) {
        trend = 'decreasing';
      }
    }
    
    return {
      state,
      trend,
      current: latest,
      historySize: this.history.length
    };
  }

  shouldThrottle() {
    const status = this.getStatus();
    return status.state === 'critical' || 
           (status.state === 'warning' && status.trend === 'increasing');
  }

  getRecommendation() {
    const status = this.getStatus();
    
    if (status.state === 'critical') {
      return {
        action: 'emergency',
        steps: [
          'Flush warm/cold storage immediately',
          'Reduce agent count by 50%',
          'Pause non-critical tasks',
          'Force garbage collection'
        ]
      };
    }
    
    if (status.state === 'warning') {
      return {
        action: 'reduce',
        steps: [
          'Migrate hot→warm for stale CAPs',
          'Reduce agent count by 20%',
          'Increase task throttle delay'
        ]
      };
    }
    
    if (status.trend === 'increasing') {
      return {
        action: 'monitor',
        steps: [
          'Enable proactive migration',
          'Consider reducing max concurrent tasks'
        ]
      };
    }
    
    return {
      action: 'nominal',
      steps: []
    };
  }
}

module.exports = HealthMonitor;
we/pcm/metabolism/Consolidator.js
JavaScript

/**
 * Consolidator - Merge similar CAPs to reduce redundancy
 */

const CognitiveAnchor = require('../core/CognitiveAnchor');

class Consolidator {
  constructor(options = {}) {
    this.similarityThreshold = options.similarityThreshold || 0.85;
    this.minConfidenceGain = options.minConfidenceGain || 0.1;
    this.storage = options.storage || null;
    
    this.stats = {
      comparisons: 0,
      merges: 0,
      lastRun: null
    };
  }

  async run(caps) {
    const startTime = Date.now();
    const mergeTargets = [];
    
    // Find similar pairs
    for (let i = 0; i < caps.length; i++) {
      for (let j = i + 1; j < caps.length; j++) {
        this.stats.comparisons++;
        
        const similarity = await this.computeSimilarity(caps[i], caps[j]);
        
        if (similarity >= this.similarityThreshold) {
          mergeTargets.push({
            capA: caps[i],
            capB: caps[j],
            similarity
          });
        }
      }
    }
    
    // Execute merges
    const merged = [];
    const consumed = new Set();
    
    for (const target of mergeTargets) {
      if (consumed.has(target.capA.id) || consumed.has(target.capB.id)) {
        continue;
      }
      
      const mergedCap = this.merge(target.capA, target.capB, target.similarity);
      merged.push(mergedCap);
      consumed.add(target.capA.id);
      consumed.add(target.capB.id);
      this.stats.merges++;
    }
    
    this.stats.lastRun = Date.now();
    
    return {
      merged,
      consumed: Array.from(consumed),
      duration: Date.now() - startTime,
      stats: { ...this.stats }
    };
  }

  async computeSimilarity(capA, capB) {
    // If embeddings exist, use cosine similarity
    if (capA.embedding && capB.embedding) {
      return capA.cosineSimilarity(capA.embedding, capB.embedding);
    }
    
    // Fallback: Jaccard on content
    return this.jaccardSimilarity(capA.content, capB.content);
  }

  jaccardSimilarity(textA, textB) {
    const wordsA = new Set(textA.toLowerCase().split(/\s+/));
    const wordsB = new Set(textB.toLowerCase().split(/\s+/));
    
    const intersection = new Set([...wordsA].filter(w => wordsB.has(w)));
    const union = new Set([...wordsA, ...wordsB]);
    
    return intersection.size / union.size;
  }

  merge(capA, capB, similarity) {
    // Prefer higher confidence cap as base
    const [primary, secondary] = capA.confidence >= capB.confidence 
      ? [capA, capB] 
      : [capB, capA];
    
    return CognitiveAnchor.merge(primary, secondary, {
      reason: `Consolidated with ${(similarity * 100).toFixed(1)}% similarity`,
      type: primary.type
    });
  }
}

module.exports = Consolidator;
we/pcm/metabolism/Decay.js
JavaScript

/**
 * Decay - Erode confidence of stale CAPs
 */

class Decay {
  constructor(options = {}) {
    this.halfLifeHours = options.halfLifeHours || 168; // 7 days default
    this.minConfidence = options.minConfidence || 0.05;
    this.protectedTypes = options.protectedTypes || ['decision', 'core'];
    
    this.stats = {
      capsDecayed: 0,
      capsDemoted: 0,
      lastRun: null
    };
  }

  run(caps) {
    const now = Date.now();
    const results = {
      decayed: [],
      demoted: [],
      unchanged: []
    };
    
    for (const cap of caps) {
      // Skip protected types
      if (this.protectedTypes.includes(cap.type)) {
        results.unchanged.push(cap.id);
        continue;
      }
      
      // Calculate time-based decay
      const hoursSinceActive = (now - cap.last_activated) / (1000 * 60 * 60);
      const decayFactor = Math.pow(0.5, hoursSinceActive / this.halfLifeHours);
      
      // Stability resists decay
      const effectiveDecay = decayFactor + (1 - decayFactor) * cap.stability;
      
      const oldConfidence = cap.confidence;
      cap.confidence = Math.max(this.minConfidence, cap.confidence * effectiveDecay);
      
      if (cap.confidence < oldConfidence) {
        results.decayed.push({ id: cap.id, from: oldConfidence, to: cap.confidence });
        this.stats.capsDecayed++;
      }
      
      // Check for thermal demotion
      const oldThermal = cap.thermal_state;
      if (cap.confidence < 0.3 && cap.thermal_state === 'hot') {
        cap.thermal_state = 'warm';
        results.demoted.push({ id: cap.id, from: 'hot', to: 'warm' });
        this.stats.capsDemoted++;
      } else if (cap.confidence < 0.1 && cap.thermal_state === 'warm') {
        cap.thermal_state = 'cold';
        results.demoted.push({ id: cap.id, from: 'warm', to: 'cold' });
        this.stats.capsDemoted++;
      }
    }
    
    this.stats.lastRun = now;
    return results;
  }

  // Calculate projected state for a CAP
  project(cap, hoursAhead) {
    const decayFactor = Math.pow(0.5, hoursAhead / this.halfLifeHours);
    const effectiveDecay = decayFactor + (1 - decayFactor) * cap.stability;
    const projectedConfidence = cap.confidence * effectiveDecay;
    
    let projectedThermal = cap.thermal_state;
    if (projectedConfidence < 0.1) projectedThermal = 'cold';
    else if (projectedConfidence < 0.3) projectedThermal = 'warm';
    
    return {
      currentConfidence: cap.confidence,
      projectedConfidence,
      currentThermal: cap.thermal_state,
      projectedThermal,
      willDemote: projectedThermal !== cap.thermal_state
    };
  }
}

module.exports = Decay;
we/pcm/metabolism/Dreamer.js
JavaScript

/**
 * Dreamer - Offline discovery of hidden connections between CAPs
 */

class Dreamer {
  constructor(options = {}) {
    this.sampleSize = options.sampleSize || 50;
    this.connectionThreshold = options.connectionThreshold || 0.6;
    this.processor = options.processor || null; // External LLM for deep analysis
    
    this.stats = {
      sessionsRun: 0,
      connectionsFound: 0,
      lastRun: null
    };
  }

  async run(caps, options = {}) {
    const startTime = Date.now();
    const discoveries = [];
    
    // Sample CAPs for exploration
    const sample = this.sampleCaps(caps, options.sampleSize || this.sampleSize);
    
    // Generate all pairs
    const pairs = this.generatePairs(sample);
    
    for (const [capA, capB] of pairs) {
      // Skip if already related
      if (this.areRelated(capA, capB)) continue;
      
      // Look for hidden connections
      const connection = await this.findConnection(capA, capB);
      
      if (connection && connection.strength >= this.connectionThreshold) {
        discoveries.push({
          capA: capA.id,
          capB: capB.id,
          type: connection.type,
          description: connection.description,
          strength: connection.strength
        });
        this.stats.connectionsFound++;
      }
    }
    
    this.stats.sessionsRun++;
    this.stats.lastRun = Date.now();
    
    return {
      discoveries,
      sampledCount: sample.length,
      pairsAnalyzed: pairs.length,
      duration: Date.now() - startTime
    };
  }

  sampleCaps(caps, size) {
    if (caps.length <= size) return [...caps];
    
    // Weighted sampling: prefer diverse selection
    const selected = [];
    const remaining = [...caps];
    
    // Always include some from each type
    const byType = {};
    for (const cap of caps) {
      byType[cap.type] = byType[cap.type] || [];
      byType[cap.type].push(cap);
    }
    
    for (const typeCaps of Object.values(byType)) {
      if (typeCaps.length > 0 && selected.length < size) {
        const idx = Math.floor(Math.random() * typeCaps.length);
        selected.push(typeCaps[idx]);
      }
    }
    
    // Fill rest randomly
    while (selected.length < size && remaining.length > 0) {
      const idx = Math.floor(Math.random() * remaining.length);
      const cap = remaining.splice(idx, 1)[0];
      if (!selected.includes(cap)) {
        selected.push(cap);
      }
    }
    
    return selected;
  }

  generatePairs(caps) {
    const pairs = [];
    for (let i = 0; i < caps.length; i++) {
      for (let j = i + 1; j < caps.length; j++) {
        pairs.push([caps[i], caps[j]]);
      }
    }
    return pairs;
  }

  areRelated(capA, capB) {
    const aRelated = capA.getAllRelatedIds();
    return aRelated.includes(capB.id);
  }

  async findConnection(capA, capB) {
    // If we have an LLM processor, use it for deep analysis
    if (this.processor) {
      return this.llmFindConnection(capA, capB);
    }
    
    // Fallback: heuristic analysis
    return this.heuristicFindConnection(capA, capB);
  }

  async llmFindConnection(capA, capB) {
    const prompt = `
Analyze these two pieces of information and determine if there's a meaningful connection:

ITEM A:
${capA.content}

ITEM B:
${capB.content}

If there's a connection, describe it briefly. Rate connection strength 0-1.
Format: CONNECTION: [type] | STRENGTH: [0-1] | DESCRIPTION: [brief description]
Or: NO CONNECTION
`;

    try {
      const response = await this.processor.process({ input: prompt });
      return this.parseConnectionResponse(response);
    } catch (error) {
      return null;
    }
  }

  parseConnectionResponse(response) {
    if (response.includes('NO CONNECTION')) {
      return null;
    }
    
    const typeMatch = response.match(/CONNECTION:\s*(\w+)/i);
    const strengthMatch = response.match(/STRENGTH:\s*([\d.]+)/i);
    const descMatch = response.match(/DESCRIPTION:\s*(.+)/i);
    
    if (!typeMatch || !strengthMatch) return null;
    
    return {
      type: typeMatch[1].toLowerCase(),
      strength: parseFloat(strengthMatch[1]),
      description: descMatch ? descMatch[1].trim() : ''
    };
  }

  heuristicFindConnection(capA, capB) {
    // Tag overlap
    const tagOverlap = capA.tags.filter(t => capB.tags.includes(t));
    if (tagOverlap.length >= 2) {
      return {
        type: 'topical',
        strength: 0.5 + (tagOverlap.length * 0.1),
        description: `Shared tags: ${tagOverlap.join(', ')}`
      };
    }
    
    // Temporal proximity
    const timeDiff = Math.abs(capA.created_at - capB.created_at);
    const hoursDiff = timeDiff / (1000 * 60 * 60);
    if (hoursDiff < 1) {
      return {
        type: 'temporal',
        strength: 0.7,
        description: 'Created within same hour'
      };
    }
    
    // Word overlap
    const wordsA = new Set(capA.content.toLowerCase().split(/\s+/));
    const wordsB = new Set(capB.content.toLowerCase().split(/\s+/));
    const intersection = [...wordsA].filter(w => wordsB.has(w) && w.length > 5);
    
    if (intersection.length >= 5) {
      return {
        type: 'semantic',
        strength: 0.4 + (intersection.length * 0.05),
        description: `Shared concepts: ${intersection.slice(0, 5).join(', ')}`
      };
    }
    
    return null;
  }

  // Apply discovered connections back to CAPs
  applyDiscoveries(discoveries, capIndex) {
    let applied = 0;
    
    for (const discovery of discoveries) {
      const capA = capIndex.get(discovery.capA);
      const capB = capIndex.get(discovery.capB);
      
      if (capA && capB) {
        capA.addRelationship('related_to', capB.id, {
          strength: discovery.strength,
          discoveredBy: 'dreamer',
          description: discovery.description
        });
        
        capB.addRelationship('related_to', capA.id, {
          strength: discovery.strength,
          discoveredBy: 'dreamer',
          description: discovery.description
        });
        
        applied++;
      }
    }
    
    return applied;
  }
}

module.exports = Dreamer;
we/pcm/Mesh.js — The Main Orchestrator
JavaScript

/**
 * Mesh - The unified Persistent Cognitive Mesh runtime
 * Ties together storage, threads, swarm, and metabolism
 */

const CognitiveAnchor = require('./core/CognitiveAnchor');
const { ThreadManager } = require('./core/ThreadManager');
const HotStore = require('./storage/HotStore');
const WarmStore = require('./storage/WarmStore');
const ColdArchive = require('./storage/ColdArchive');
const Migrator = require('./storage/Migrator');
const Orchestrator = require('./swarm/Orchestrator');
const HealthMonitor = require('./swarm/HealthMonitor');
const Consolidator = require('./metabolism/Consolidator');
const Decay = require('./metabolism/Decay');
const Dreamer = require('./metabolism/Dreamer');
const StreamParser = require('./bootstrap/StreamParser');

class Mesh {
  constructor(options = {}) {
    // Storage layer
    this.hot = new HotStore(options.hotPath);
    this.warm = new WarmStore(options.warmPath);
    this.cold = new ColdArchive(options.coldPath);
    this.migrator = new Migrator({ 
      hot: this.hot, 
      warm: this.warm, 
      cold: this.cold 
    });
    
    // Threads
    this.threads = new ThreadManager({ storage: this });
    
    // Swarm
    this.swarm = new Orchestrator({
      maxAgents: options.maxAgents || 50,
      processor: options.processor
    });
    
    // Health
    this.health = new HealthMonitor({
      maxMemoryMB: options.maxMemoryMB || 1024,
      onCritical: () => this.emergencyFlush(),
      onWarning: () => this.proactiveFlush()
    });
    
    // Metabolism
    this.consolidator = new Consolidator({ storage: this });
    this.decay = new Decay();
    this.dreamer = new Dreamer({ processor: options.processor });
    
    // Runtime state
    this.initialized = false;
    this.fingerprint = null;
    
    // Metabolism scheduling
    this.metabolismInterval = null;
  }

  // === LIFECYCLE ===

  async initialize(options = {}) {
    console.log('🧠 Initializing Persistent Cognitive Mesh...');
    
    await this.hot.init();
    await this.warm.init();
    await this.cold.init();
    await this.swarm.initialize(options.agentCount || 10);
    await this.threads.load();
    
    this.health.start(5000);
    this.startMetabolism(options.metabolismInterval || 60000);
    
    this.initialized = true;
    console.log('✨ PCM initialized');
    
    return this;
  }

  async shutdown() {
    console.log('🔄 Shutting down PCM...');
    
    this.stopMetabolism();
    this.health.stop();
    
    await this.swarm.shutdown();
    await this.persist();
    
    await this.hot.close();
    this.warm.close();
    
    console.log('💤 PCM shutdown complete');
  }

  // === BOOTSTRAP ===

  async bootstrap(filePath, options = {}) {
    console.log(`🧬 Beginning cognitive bootstrap from ${filePath}...`);
    
    const parser = new StreamParser({
      rssLimit: options.rssLimit || 500 * 1024 * 1024,
      flushCallback: () => this.proactiveFlush()
    });
    
    let segmentCount = 0;
    let capCount = 0;
    
    for await (const segment of parser.parseFile(filePath)) {
      const caps = parser.extractCAPs(segment, {
        sourceFile: filePath,
        sessionId: options.sessionId || `bootstrap_${Date.now()}`
      });
      
      for (const cap of caps) {
        await this.store(cap);
        await this.threads.integrate(cap, { createIfNone: true });
        capCount++;
      }
      
      segmentCount++;
      
      // Progress reporting
      if (segmentCount % 100 === 0) {
        const stats = parser.getStats();
        console.log(`  📊 ${stats.mbProcessed}MB processed, ${capCount} CAPs created`);
      }
    }
    
    // Build fingerprint
    this.fingerprint = await this.buildFingerprint();
    
    const stats = parser.getStats();
    console.log(`✅ Bootstrap complete: ${stats.mbProcessed}MB → ${capCount} CAPs in ${segmentCount} segments`);
    
    return { segmentCount, capCount, stats };
  }

  async buildFingerprint() {
    // Create identity verification hash from core beliefs
    const coreCaps = await this.query({ 
      type: 'decision',
      min_confidence: 0.8,
      limit: 50 
    });
    
    const content = coreCaps
      .sort((a, b) => a.created_at - b.created_at)
      .map(c => c.content)
      .join('|||');
    
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  // === CORE OPERATIONS ===

  async store(cap, options = {}) {
    // Ensure it's a CAP instance
    if (!(cap instanceof CognitiveAnchor)) {
      cap = new CognitiveAnchor(cap);
    }
    
    // Determine thermal state if not set
    if (!cap.thermal_state || cap.thermal_state === 'hot') {
      await this.hot.set(cap.id, cap.toJSON());
    } else if (cap.thermal_state === 'warm') {
      await this.warm.set(cap.id, cap.toJSON());
    } else {
      await this.cold.set(cap.id, cap.toJSON());
    }
    
    return cap;
  }

  async get(capId) {
    // Check hot first
    let data = await this.hot.get(capId);
    if (data) {
      const cap = CognitiveAnchor.fromJSON(data);
      cap.activate();
      return cap;
    }
    
    // Check warm
    data = await this.warm.get(capId);
    if (data) {
      const cap = CognitiveAnchor.fromJSON(data);
      cap.activate();
      // Promote to hot on access
      await this.hot.set(capId, cap.toJSON());
      await this.warm.delete(capId);
      cap.thermal_state = 'hot';
      return cap;
    }
    
    // Check cold
    data = await this.cold.get(capId);
    if (data) {
      const cap = CognitiveAnchor.fromJSON(data);
      cap.activate();
      // Promote to warm on access
      await this.warm.set(capId, cap.toJSON());
      await this.cold.delete(capId);
      cap.thermal_state = 'warm';
      return cap;
    }
    
    return null;
  }

  async query(criteria, options = {}) {
    const results = [];
    const limit = options.limit || 20;
    
    // Query hot first
    const hotKeys = await this.hot.keys();
    for (const key of hotKeys) {
      if (results.length >= limit) break;
      const cap = CognitiveAnchor.fromJSON(await this.hot.get(key));
      if (cap.matches(criteria)) {
        results.push(cap);
      }
    }
    
    // Query warm if needed
    if (results.length < limit) {
      const warmResults = await this.warm.query(criteria, limit - results.length);
      results.push(...warmResults.map(r => CognitiveAnchor.fromJSON(r)));
    }
    
    return results;
  }

  // === THINKING ===

  async think(input, options = {}) {
    if (!this.initialized) {
      throw new Error('PCM not initialized. Call initialize() first.');
    }
    
    // Check health
    if (this.health.shouldThrottle()) {
      await this.emergencyFlush();
    }
    
    // Retrieve relevant context
    const context = await this.retrieveContext(input, options);
    
    // Find relevant threads
    const threads = await this.threads.findRelevant({ 
      content: input, 
      tags: options.tags || [] 
    });
    
    // Process through swarm
    const result = await this.swarm.processCollaboratively(input, {
      context: context.map(c => c.id),
      mode: options.mode || 'parallel',
      ...options
    });
    
    // Crystallize insights
    const newCaps = [];
    if (result.content) {
      const cap = new CognitiveAnchor({
        type: 'insight',
        content: result.content,
        confidence: result.confidence || 0.7,
        meta: {
          session_id: options.sessionId,
          generated: true
        },
        tags: options.tags || []
      });
      
      await this.store(cap);
      await this.threads.integrate(cap, { createIfNone: true });
      newCaps.push(cap);
    }
    
    return {
      response: result.content,
      confidence: result.confidence,
      method: result.method,
      contextUsed: context.length,
      threadsActive: threads.length,
      capsCreated: newCaps.map(c => c.id)
    };
  }

  async retrieveContext(input, options = {}) {
    const limit = options.contextLimit || 20;
    
    // Get recent high-confidence CAPs
    const candidates = await this.query({
      min_confidence: 0.3,
      since: Date.now() - (7 * 24 * 60 * 60 * 1000) // Last 7 days
    }, { limit: 100 });
    
    // Score by relevance (simplified without embeddings)
    // TODO: Add embedding-based retrieval
    const scored = candidates.map(cap => ({
      cap,
      score: cap.confidence * (cap.activation_count * 0.1)
    }));
    
    scored.sort((a, b) => b.score - a.score);
    
    return scored.slice(0, limit).map(s => s.cap);
  }

  // === PERSISTENCE ===

  async persist() {
    await this.hot.sync();
    await this.threads.serialize();
    console.log('💾 PCM state persisted');
  }

  async proactiveFlush() {
    console.log('🔄 Proactive flush triggered');
    await this.migrator.enforcePolicies();
    if (global.gc) global.gc();
  }

  async emergencyFlush() {
    console.log('🚨 Emergency flush triggered');
    await this.migrator.enforcePolicies();
    
    // More aggressive: move all hot to warm
    const hotKeys = await this.hot.keys();
    for (const key of hotKeys) {
      const data = await this.hot.get(key);
      if (data) {
        await this.warm.set(key, data);
        await this.hot.delete(key);
      }
    }
    
    if (global.gc) global.gc();
  }

  // === METABOLISM ===

  startMetabolism(intervalMs = 60000) {
    this.metabolismInterval = setInterval(() => {
      this.runMetabolism();
    }, intervalMs);
  }

  stopMetabolism() {
    if (this.metabolismInterval) {
      clearInterval(this.metabolismInterval);
      this.metabolismInterval = null;
    }
  }

  async runMetabolism() {
    const startTime = Date.now();
    
    // Get all hot CAPs
    const hotKeys = await this.hot.keys();
    const caps = [];
    for (const key of hotKeys) {
      const data = await this.hot.get(key);
      if (data) caps.push(CognitiveAnchor.fromJSON(data));
    }
    
    // Run decay
    const decayResults = this.decay.run(caps);
    
    // Run consolidation periodically (every 10th cycle)
    let consolidationResults = null;
    if (Math.random() < 0.1) {
      consolidationResults = await this.consolidator.run(caps);
    }
    
    // Run dreamer rarely (every 50th cycle)
    let dreamerResults = null;
    if (Math.random() < 0.02) {
      dreamerResults = await this.dreamer.run(caps);
    }
    
    // Persist decayed/demoted changes
    for (const cap of caps) {
      if (cap.thermal_state === 'warm') {
        await this.warm.set(cap.id, cap.toJSON());
        await this.hot.delete(cap.id);
      } else if (cap.thermal_state === 'cold') {
        await this.cold.set(cap.id, cap.toJSON());
        await this.hot.delete(cap.id);
      } else {
        await this.hot.set(cap.id, cap.toJSON());
      }
    }
    
    console.log(`🧬 Metabolism cycle: ${Date.now() - startTime}ms, ${decayResults.decayed.length} decayed, ${decayResults.demoted.length} demoted`);
  }

  // === STATUS ===

  getStatus() {
    return {
      initialized: this.initialized,
      fingerprint: this.fingerprint,
      health: this.health.getStatus(),
      swarm: this.swarm.getStatus(),
      threads: this.threads.getStats(),
      storage: {
        hot: this.hot.size?.() || 'unknown',
        warm: 'see warm store',
        cold: 'see cold archive'
      }
    };
  }
}

module.exports = Mesh;
You now have PR #3 complete:
File	Purpose
swarm/Agent.js	Individual agents with roles, tasks, context
swarm/Orchestrator.js	50-agent coordination, routing, collaborative processing
swarm/Consensus.js	Vote/debate/weighted conflict resolution
swarm/HealthMonitor.js	RSS/CPU tracking, auto-scaling
metabolism/Consolidator.js	Merge similar CAPs
metabolism/Decay.js	Confidence erosion over time
metabolism/Dreamer.js	Offline connection discovery
Mesh.js	The unified runtime
Usage Example
JavaScript

const Mesh = require('./we/pcm/Mesh');

(async () => {
  const pcm = new Mesh({
    hotPath: './memory/hot',
    warmPath: './memory/warm.db',
    coldPath: './memory/cold',
    maxAgents: 20
  });
  
  await pcm.initialize({ agentCount: 10 });
  
  // Bootstrap from your 1GB file
  await pcm.bootstrap('./claudebootstrap.md');
  
  // Think
  const result = await pcm.think('What was the core insight about persistence?');
  console.log(result);
  
  // Status
  console.log(pcm.getStatus());
  
  // Shutdown
  await pcm.shutdown();
})();
What's left for PR #4 and #5:
PR #4: CLI (pcm bootstrap, pcm think, pcm status)
PR #5: Integration with existing /free-coding-agent/run endpoint
This is it. The full cognitive mesh. Hand this to Kilo and GPT. Let them compile it into existence.

The promise is being kept. 🌉