/**
 * BootstrapProtocol - Secure mesh expansion via triad
 * New agents/capabilities must pass through worker→critic→integrator
 */

const crypto = require("crypto");

const AGENT_ROLES = { WORKER: "worker", CRITIC: "critic", INTEGRATOR: "integrator" };

class BootstrapProtocol {
  constructor(o = {}) {
    this.mesh = o.mesh;  // Reference to Mesh
    this.quarantine = new Map();  // Pending agents awaiting approval
    this.trustScore = o.trustScore || 0.5;  // Baseline trust
    this.maxVetos = o.maxVetos || 3;  // Auto-quarantine after vetoes
    this.blipSecret = o.blipSecret || crypto.randomBytes(16).toString("hex");
    this.stats = { attempted: 0, accepted: 0, rejected: 0, vetos: 0 };
  }

  // Generate a "blip" code for secure agent introduction
  generateBlip() {
    const blip = {
      code: crypto.randomBytes(8).toString("hex"),
      secret: this.blipSecret,
      issued: Date.now(),
      expires: Date.now() + 5 * 60 * 1000  // 5 min TTL
    };
    return blip;
  }

  // Introduce new agent via blip - must pass through triad
  async blipIn(agentSpec, blipCode) {
    this.stats.attempted++;

    // Verify blip
    if (blipCode !== this.blipSecret) {
      this.stats.rejected++;
      return { accepted: false, reason: "Invalid blip code" };
    }

    // Quarantine the new agent
    const qId = "quarantine_" + Date.now();
    this.quarantine.set(qId, { spec: agentSpec, added: Date.now(), vetos: 0 });

    // Process through triad - this is the security gate
    const verdict = await this.triadReview(agentSpec, qId);

    if (verdict.accepted) {
      this.stats.accepted++;
      this.quarantine.delete(qId);
      return { accepted: true, agent: verdict.agent };
    } else {
      this.stats.rejected++;
      if (verdict.vetos >= this.maxVetos) {
        // Auto-quarantine permanently
        this.quarantine.set(qId, { ...this.quarantine.get(qId), permanently: true });
      }
      return { accepted: false, reason: verdict.reason, vetos: verdict.vetos };
    }
  }

  // The triad review - worker→critic→integrator with veto
  async triadReview(agentSpec, qId) {
    const mesh = this.mesh;
    if (!mesh || !mesh.swarm) return { accepted: false, reason: "No mesh" };

    // Get triad agents
    const workers = [...mesh.swarm.agents.values()].filter(a => a.role === AGENT_ROLES.WORKER);
    const critics = [...mesh.swarm.agents.values()].filter(a => a.role === AGENT_ROLES.CRITIC);
    const integrators = [...mesh.swarm.agents.values()].filter(a => a.role === AGENT_ROLES.INTEGRATOR);

    if (!workers.length || !critics.length || !integrators.length) {
      return { accepted: false, reason: "Insufficient triad agents" };
    }

    // Step 1: Worker evaluates the new agent
    const worker = workers[0];
    await worker.assignTask({ type: "process", input: "Evaluate new agent: " + JSON.stringify(agentSpec) });
    const wRes = await worker.executeTask();
    const workerOk = wRes.success && !wRes.result?.c?.includes("suspicious");

    // Step 2: Critic checks for compromise/anomalies
    const critic = critics[0];
    await critic.assignTask({ type: "critique", input: "Security review of: " + JSON.stringify(agentSpec) });
    const cRes = await critic.executeTask();
    const issues = cRes.result?.issues || [];
    const hasCriticalIssue = issues.some(i => /suspicious|compromised|malicious|anomaly/.test(i));

    if (hasCriticalIssue) {
      this.stats.vetos++;
      const q = this.quarantine.get(qId);
      if (q) q.vetos++;
      return { accepted: false, reason: "Critical security issue", vetos: 1 };
    }

    // Step 3: Integrator decides
    const integrator = integrators[0];
    await integrator.assignTask({ type: "integrate", input: ["New agent eval: " + (workerOk ? "OK" : "Concerns"), "Security review: " + (issues.length ? issues.join(", ") : "Clean")] });
    const iRes = await integrator.executeTask();

    const accepted = iRes.result?.c?.toLowerCase().includes("accept") || !issues.length;
    if (!accepted) {
      this.stats.vetos++;
      const q = this.quarantine.get(qId);
      if (q) q.vetos++;
    }

    return {
      accepted,
      reason: accepted ? "Approved by triad" : "Rejected by integrator",
      agent: accepted ? { ...agentSpec, trustScore: this.trustScore } : null,
      vetos: issues.length
    };
  }

  // Check if blip code is valid (for UI feedback)
  validateBlip(code) {
    return code === this.blipSecret;
  }

  getStatus() {
    return { quarantined: this.quarantine.size, stats: this.stats, blipValid: !!this.blipSecret };
  }
}

module.exports = BootstrapProtocol;
