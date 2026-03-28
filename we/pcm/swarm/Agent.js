const crypto = require("crypto");
const CognitiveAnchor = require("../core/CognitiveAnchor");

const AGENT_ROLES = { WORKER: "worker", COORDINATOR: "coordinator", CRITIC: "critic", INTEGRATOR: "integrator", ARCHIVIST: "archivist" };
const AGENT_STATES = { IDLE: "idle", WORKING: "working", WAITING: "waiting", BLOCKED: "blocked", OFFLINE: "offline" };

class Agent {
  constructor(o = {}) {
    this.id = o.id || "agent_" + crypto.randomBytes(4).toString("hex");
    this.name = o.name || "Agent-" + this.id.slice(-4);
    this.role = o.role || AGENT_ROLES.WORKER;
    this.state = AGENT_STATES.IDLE;
    this.currentTask = null;
    this.taskHistory = [];
    this.stats = { tasksCompleted: 0, tasksFailed: 0, totalProcessingTime: 0, avgProcessingTime: 0, lastActive: Date.now(), created: Date.now() };
    this.capacity = { maxConcurrent: o.maxConcurrent || 1, currentLoad: 0, maxMemoryMB: o.maxMemoryMB || 100, priority: o.priority ?? 0.5 };
    this.context = { caps: [], threads: [], maxCaps: o.maxCaps || 20 };
    this.inbox = [];
    this.outbox = [];
    this.processor = o.processor || null;
  }

  canAcceptTask() { return this.state !== AGENT_STATES.OFFLINE && this.state !== AGENT_STATES.BLOCKED && this.capacity.currentLoad < this.capacity.maxConcurrent; }

  async assignTask(task) {
    if (!this.canAcceptTask()) return { accepted: false, reason: "Agent " + this.id + " cannot accept tasks" };
    this.currentTask = { id: task.id || "task_" + Date.now(), type: task.type, input: task.input, context: task.context || [], priority: task.priority ?? 0.5, assignedAt: Date.now(), deadline: task.deadline || null };
    this.state = AGENT_STATES.WORKING;
    this.capacity.currentLoad++;
    return { accepted: true, taskId: this.currentTask.id };
  }

  async executeTask() {
    if (!this.currentTask) return { success: false, error: "No task assigned" };
    const startTime = Date.now();
    try {
      await this.loadContext(this.currentTask.context);
      let result;
      switch (this.role) {
        case AGENT_ROLES.WORKER: result = await this.processAsWorker(); break;
        case AGENT_ROLES.CRITIC: result = await this.processAsCritic(); break;
        case AGENT_ROLES.INTEGRATOR: result = await this.processAsIntegrator(); break;
        case AGENT_ROLES.COORDINATOR: result = await this.processAsCoordinator(); break;
        case AGENT_ROLES.ARCHIVIST: result = await this.processAsArchivist(); break;
        default: result = await this.processAsWorker();
      }
      const duration = Date.now() - startTime;
      this.stats.tasksCompleted++;
      this.stats.totalProcessingTime += duration;
      this.stats.avgProcessingTime = this.stats.totalProcessingTime / this.stats.tasksCompleted;
      this.stats.lastActive = Date.now();
      this.taskHistory.push({ taskId: this.currentTask.id, type: this.currentTask.type, duration, success: true, timestamp: Date.now() });
      if (this.taskHistory.length > 100) this.taskHistory = this.taskHistory.slice(-50);
      this.currentTask = null;
      this.capacity.currentLoad--;
      this.state = AGENT_STATES.IDLE;
      return { success: true, result, duration };
    } catch (error) {
      this.stats.tasksFailed++;
      this.taskHistory.push({ taskId: this.currentTask?.id, error: error.message, success: false, timestamp: Date.now() });
      this.currentTask = null;
      this.capacity.currentLoad--;
      this.state = AGENT_STATES.IDLE;
      return { success: false, error: error.message };
    }
  }

  async processAsWorker() {
    const input = this.currentTask.input;
    if (this.processor) {
      const ctx = this.context.caps.map(c => c.content).join("\n---\n");
      const response = await this.processor.process({ input, context: ctx, role: "worker", instruction: "Process this task." });
      return { type: "observation", content: response, caps: this.extractInsights(response) };
    }
    return { type: "observation", content: "Worker processed: " + (input?.substring?.(0, 100) || JSON.stringify(input)), caps: [] };
  }

  async processAsCritic() {
    const input = this.currentTask.input;
    if (this.processor) {
      const ctx = this.context.caps.map(c => c.content).join("\n---\n");
      const response = await this.processor.process({ input, context: ctx, role: "critic", instruction: "Analyze for weaknesses." });
      return { type: "critique", content: response, issues: this.extractIssues(response), caps: this.extractInsights(response) };
    }
    return { type: "critique", content: "Critic pending", issues: [], caps: [] };
  }

  async processAsIntegrator() {
    const input = this.currentTask.input;
    const sources = Array.isArray(input) ? input : [input];
    if (this.processor) {
      const ctx = this.context.caps.join("\n---\n");
      const response = await this.processor.process({ input: sources.join("\n\n---\n\n"), context: ctx, role: "integrator", instruction: "Synthesize." });
      return { type: "synthesis", content: response, connections: [], caps: this.extractInsights(response) };
    }
    return { type: "synthesis", content: "Integration of " + sources.length + " sources", connections: [], caps: [] };
  }

  async processAsCoordinator() { return { type: "coordination", routing: this.currentTask.input, delegations: [] }; }
  async processAsArchivist() { return { type: "archival", action: this.currentTask.input?.action || "audit", affected: [], caps: [] }; }

  async loadContext(capIds) { this.context.caps = capIds.slice(0, this.context.maxCaps); }
  clearContext() { this.context.caps = []; this.context.threads = []; }

  extractInsights(text) {
    const caps = [];
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 20);
    for (const sentence of sentences.slice(0, 3)) {
      if (/\b(found|discovered|realized|concluded)\b/i.test(sentence)) {
        caps.push(new CognitiveAnchor({ type: "insight", content: sentence.trim(), meta: { agent_id: this.id, extracted: true } }));
      }
    }
    return caps;
  }

  extractIssues(text) { const m = text.match(/\b(problem|issue|concern|risk|weakness|gap)\b[^.]*\./gi); return m ? m.map(x => x.trim()) : []; }
  extractConnections(text) { return []; }

  send(t, m) { this.outbox.push({ from: this.id, to: t, content: m, timestamp: Date.now() }); }
  receive(m) { this.inbox.push(m); }
  processInbox() { const m = [...this.inbox]; this.inbox = []; return m; }
  flushOutbox() { const m = [...this.outbox]; this.outbox = []; return m; }

  getHealth() { return { id: this.id, role: this.role, state: this.state, tasksCompleted: this.stats.tasksCompleted, healthy: this.state !== AGENT_STATES.BLOCKED && this.state !== AGENT_STATES.OFFLINE }; }
  toJSON() { return { id: this.id, name: this.name, role: this.role, state: this.state, stats: this.stats, capacity: this.capacity }; }
}

module.exports = { Agent, AGENT_ROLES, AGENT_STATES };
