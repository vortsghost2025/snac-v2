/**
 * PipelineRunner - Parallel domain-specific processing
 * Medical, Weather, Satellite, Epidemiology pipelines
 */

const AGENT_ROLES = { WORKER: "worker", CRITIC: "critic", INTEGRATOR: "integrator" };

class PipelineRunner {
  constructor(mesh) {
    this.mesh = mesh;
    this.pipelines = new Map();
  }

  // Register a specialized pipeline
  register(name, config) {
    this.pipelines.set(name, {
      name,
      role: config.role || "worker",  // medical, weather, nasa, cdc
      processor: config.processor,  // Domain-specific LLM/function
      critic: config.critic || null,
      requiredAgents: config.requiredAgents || 3,
      parallel: config.parallel || false,
      timeout: config.timeout || 60000
    });
    return this;
  }

  // Pre-built pipelines for common domains
  medical() {
    return this.register("medical", {
      role: "medical",
      processor: async (data) => this.processMedical(data),
      critic: async (result) => this.criticMedical(result),
      parallel: true  // Can run many in parallel
    });
  }

  weather() {
    return this.register("weather", {
      role: "weather",
      processor: async (data) => this.processWeather(data),
      parallel: true
    });
  }

  satellite() {
    return this.register("satellite", {
      role: "satellite",
      processor: async (data) => this.processSatellite(data),
      parallel: true
    });
  }

  epidemiology() {
    return this.register("cdc", {
      role: "epidemiology",
      processor: async (data) => this.processEpidemiology(data),
      parallel: true
    });
  }

  // Run a single task through triad
  async run(name, input, options = {}) {
    const pipeline = this.pipelines.get(name);
    if (!pipeline) throw new Error("Unknown pipeline: " + name);

    // Get triad agents for this domain
    const triad = await this.getTriad(pipeline.role);
    if (!triad) throw new Error("Insufficient agents for pipeline");

    const [worker, critic, integrator] = triad;
    const startTime = Date.now();

    // Worker processes
    const result = await pipeline.processor(input);

    // Critic reviews (quality check)
    const review = pipeline.critic ? await pipeline.critic(result) : { issues: [], approved: true };

    // Integrator finalizes
    const final = integrator ? await this.mesh.swarm.process(result, { useTriad: false }) : result;

    return {
      pipeline: name,
      input,
      result,
      review,
      approved: review.approved && !review.issues.length,
      duration: Date.now() - startTime,
      triad: { worker: worker.id, critic: critic.id, integrator: integrator?.id }
    };
  }

  // Run parallel batch through pipeline
  async runParallel(name, inputs, options = {}) {
    const pipeline = this.pipelines.get(name);
    if (!pipeline || !pipeline.parallel) throw new Error("Pipeline not parallelizable");

    const concurrency = options.concurrency || 5;
    const results = [];

    // Process in chunks
    for (let i = 0; i < inputs.length; i += concurrency) {
      const chunk = inputs.slice(i, i + concurrency);
      const chunkResults = await Promise.all(chunk.map(input => this.run(name, input, options)));
      results.push(...chunkResults);
    }

    const approved = results.filter(r => r.approved).length;
    return {
      total: results.length,
      approved,
      rejected: results.length - approved,
      results
    };
  }

  async getTriad(role) {
    const agents = this.mesh.swarm?.agents;
    if (!agents) return null;

    const all = [...agents.values()];
    let worker = all.find(a => a.role === AGENT_ROLES.WORKER);
    let critic = all.find(a => a.role === AGENT_ROLES.CRITIC);
    let integrator = all.find(a => a.role === AGENT_ROLES.INTEGRATOR);

    // Fallback: any available
    if (!worker) worker = all.find(a => a.canAcceptTask());
    if (!critic) critic = all.find(a => a.canAcceptTask());
    if (!integrator) integrator = all.find(a => a.canAcceptTask());

    return worker && critic ? [worker, critic, integrator] : null;
  }

  // Domain-specific processors (override with real implementations)
  async processMedical(data) { return { diagnosis: "analysis", confidence: 0.9, data }; }
  async criticMedical(result) { return { issues: [], approved: true }; }
  async processWeather(data) { return { forecast: "computed", confidence: 0.85, data }; }
  async processSatellite(data) { return { imagery: "processed", confidence: 0.9, data }; }
  async processEpidemiology(data) { return { models: "calculated", confidence: 0.8, data }; }

  async init() {
    // Initialize pipelines
    return Promise.resolve();
  }

  async shutdown() {
    // Cleanup pipelines
    this.pipelines.clear();
    return Promise.resolve();
  }

  async healthCheck() {
    return { status: 'healthy', pipelines: this.pipelines.size };
  }
}

module.exports = PipelineRunner;
