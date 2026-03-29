const { Agent, AGENT_ROLES, AGENT_STATES } = require('./Agent');
const Consensus = require('./Consensus');

class Orchestrator {
  constructor(o = {}) {
    this.agents = new Map();
    this.queue = [];
    this.done = [];
    this.consensus = new Consensus();
    this.trinities = [];
    this.sparesPool = [];
    this.config = {
      minAgents: o.minAgents || 3,
      maxAgents: o.maxAgents || 50,
      requireTriad: o.requireTriad !== false,
      roleDist: o.roleDist || {
        [AGENT_ROLES.WORKER]: 0.5,
        [AGENT_ROLES.CRITIC]: 0.25,
        [AGENT_ROLES.INTEGRATOR]: 0.25
      }
    };
    this.stats = { submitted: 0, completed: 0, failed: 0, vetoed: 0, start: Date.now() };
  }

  async init(count = 10, processor) {
    count = Math.max(count, this.config.minAgents);
    count = Math.floor(count / 3) * 3;
    for (let i = 0; i < count; i++) {
      const rand = Math.random();
      const role = this.chooseRole(rand);
      const agent = new Agent({ role, processor });
      this.agents.set(agent.id, agent);
    }
    const { trinities, spares } = this.consensus.formTrinities(Array.from(this.agents.values()));
    this.trinities = trinities;
    this.sparesPool = spares;
    console.log('✅ ' + trinities.length + ' trinities formed, ' + spares.length + ' spares');
    return this;
  }

  async shutdown() {
    this.agents.clear();
    this.queue = [];
    this.done = [];
  }

  chooseRole(rand) {
    let cum = 0;
    for (const [r, p] of Object.entries(this.config.roleDist)) { cum += p; if (rand <= cum) return r; }
    return AGENT_ROLES.WORKER;
  }

  async submit(task) {
    const entry = { id: task.id || 'task_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), ...task, subAt: Date.now(), status: 'queued' };
    this.queue.push(entry);
    this.stats.submitted++;
    await this.dispatch();
    return { success: true, taskId: entry.id };
  }

  async dispatch() {
    this.queue.sort((a, b) => (b.priority || 0.5) - (a.priority || 0.5));
    for (const task of [...this.queue]) {
      const agents = this.config.requireTriad ? this.findTriad(task) : this.findBest(task);
      if (!agents) continue;
      const agentList = Array.isArray(agents) ? agents : [agents];
      for (const agent of agentList) {
        const res = await agent.assignTask(task);
        if (res.accepted) { task.status = 'assigned'; task.agentId = agent.id; }
      }
      if (task.status === 'assigned') {
        this.queue = this.queue.filter(t => t.id !== task.id);
        for (const agent of agentList) this.exec(agent, task);
      }
    }
  }

  findTriad(task) {
    const workers = [...this.agents.values()].filter(a => a.role === AGENT_ROLES.WORKER && a.canAcceptTask());
    const critics = [...this.agents.values()].filter(a => a.role === AGENT_ROLES.CRITIC && a.canAcceptTask());
    const integrators = [...this.agents.values()].filter(a => a.role === AGENT_ROLES.INTEGRATOR && a.canAcceptTask());
    if (!workers.length || !critics.length) return null;
    const integrator = integrators.length ? integrators[0] : workers[0];
    return [workers[0], critics[0], integrator];
  }

  async exec(agent, task) {
    const res = await agent.executeTask();
    if (res.success) { this.stats.completed++; this.done.push({ taskId: task.id, agentId: agent.id, result: res.result, dur: res.duration, at: Date.now() }); }
    else { this.stats.failed++; if (agent.role === AGENT_ROLES.CRITIC) this.stats.vetoed++; }
    this.route(agent.flushOutbox());
    await this.dispatch();
  }

  findBest(task) {
    let pref = AGENT_ROLES.WORKER;
    if (task.type === 'critique') pref = AGENT_ROLES.CRITIC;
    else if (task.type === 'integrate') pref = AGENT_ROLES.INTEGRATOR;
    const candidates = [];
    for (const agent of this.agents.values()) {
      if (!agent.canAcceptTask()) continue;
      let score = 0;
      if (agent.role === pref) score += 1.0;
      score += (1 - agent.capacity.currentLoad / agent.capacity.maxConcurrent) * 0.5;
      candidates.push({ agent, score });
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0].agent;
  }

  route(msgs) { for (const m of msgs) { const t = this.agents.get(m.to); if (t) t.receive(m); } }

  async process(input, o = {}) {
    const roles = o.roles || [AGENT_ROLES.WORKER, AGENT_ROLES.CRITIC, AGENT_ROLES.INTEGRATOR];
    const tasks = roles.map(r => ({ type: r === AGENT_ROLES.CRITIC ? 'critique' : r === AGENT_ROLES.INTEGRATOR ? 'integrate' : 'process', input, priority: o.priority || 0.5 }));
    const subs = await Promise.all(tasks.map(t => this.submit(t)));
    const ids = subs.filter(s => s.success).map(s => s.taskId);
    const results = await this.wait(ids, o.timeout || 60000);
    if (o.aggregate !== false) return this.consensus.aggregate(results);
    return results;
  }

  async wait(ids, to) {
    const deadline = Date.now() + to, results = [];
    while (Date.now() < deadline && results.length < ids.length) {
      for (const id of ids) { const c = this.done.find(t => t.taskId === id); if (c && !results.find(r => r.taskId === id)) results.push(c); }
      if (results.length < ids.length) await new Promise(r => setTimeout(r, 100));
    }
    return results;
  }

  getStatus() {
    const byR = {}, byS = {};
    for (const a of this.agents.values()) { byR[a.role] = (byR[a.role] || 0) + 1; byS[a.state] = (byS[a.state] || 0) + 1; }
    return { count: this.agents.size, byRole: byR, byState: byS, queue: this.queue.length, stats: this.stats, minEnforced: this.config.minAgents };
  }
  
  async healthCheck() {
    try {
      const status = this.getStatus();
      
      // Determine health status based on agent counts and queue
      let severity = 'normal';
      if (status.count < this.config.minAgents) {
        severity = 'warning';
      } else if (status.queue > 100) {  // If queue is very long
        severity = 'warning';
      } else if (status.byState['offline'] > status.count * 0.5) {  // More than half agents offline
        severity = 'critical';
      }
      
      return {
        healthy: severity !== 'critical',
        status: severity,
        details: status,
        severity: severity
      };
    } catch (error) {
      return {
        healthy: false,
        error: error.message,
        severity: 'critical'
      };
    }
  }
  
  getActiveAgentCount() {
    // Count agents that are not in 'offline' state
    let count = 0;
    for (const agent of this.agents.values()) {
      if (agent.state !== 'offline') {
        count++;
      }
    }
    return count;
  }
}

module.exports = Orchestrator;
