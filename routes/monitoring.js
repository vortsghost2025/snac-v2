const express = require('express');
const router = express.Router();

const AGENT_NAMES = [
  'dev-kimi', 'dev-lingma', 'dev-copilot', 'dev-kilo', 'dev-should',
  'dev-kimimax', 'dev-kimi-local', 'dev-sonnet', 'dev-opus', 'dev-haiku',
  'dev-claude', 'dev-gpt4', 'dev-gpt35', 'dev-llama', 'dev-mistral',
  'dev-gemma', 'dev-phi', 'dev-mixtral', 'dev-qwen', 'dev-yi', 'dev-command'
];

const SERVICE_NAMES = ['PostgreSQL', 'Qdrant', 'Redis', 'Backend', 'Frontend'];

let agentStates = new Map();
let serviceStates = new Map();
let lastUpdate = Date.now();

function initializeStates() {
  AGENT_NAMES.forEach(name => {
    agentStates.set(name, {
      id: name,
      status: 'IDLE',
      lastSeen: new Date().toISOString(),
      zone: getAgentZone(name)
    });
  });

  SERVICE_NAMES.forEach(name => {
    serviceStates.set(name, {
      name: name,
      status: 'UNKNOWN',
      lastCheck: new Date().toISOString(),
      responseTime: 0
    });
  });
}

function getAgentZone(agentName) {
  const zones = {
    'dev-kimi': 'agents, websocket, dashboard',
    'dev-lingma': 'memory, pipeline, healing',
    'dev-copilot': 'infra, tests, benchmarks',
    'dev-kilo': 'orchestrator, swarm',
    'dev-should': 'validation, testing',
    'dev-kimimax': 'large-models, reasoning',
    'dev-kimi-local': 'local-models, edge',
    'dev-sonnet': 'balanced, production',
    'dev-opus': 'reasoning, complex-tasks',
    'dev-haiku': 'fast, lightweight',
    'dev-claude': 'claude-api, external',
    'dev-gpt4': 'openai-gpt4, external',
    'dev-gpt35': 'openai-gpt35, external',
    'dev-llama': 'meta-llama, local',
    'dev-mistral': 'mistral-ai, external',
    'dev-gemma': 'google-gemma, local',
    'dev-phi': 'microsoft-phi, local',
    'dev-mixtral': 'mistral-mixtral, local',
    'dev-qwen': 'alibaba-qwen, local',
    'dev-yi': 'yi-ai, local',
    'dev-command': 'command-r, external'
  };
  return zones[agentName] || 'general';
}

function simulateUpdates() {
  AGENT_NAMES.forEach(name => {
    const agent = agentStates.get(name);
    if (agent) {
      const statuses = ['IDLE', 'ACTIVE', 'PROCESSING', 'READY'];
      const randomStatus = Math.random() > 0.7 ? statuses[Math.floor(Math.random() * statuses.length)] : 'IDLE';
      agent.status = randomStatus;
      agent.lastSeen = new Date().toISOString();
    }
  });

  SERVICE_NAMES.forEach(name => {
    const service = serviceStates.get(name);
    if (service) {
      const statuses = ['HEALTHY', 'DEGRADED', 'DOWN', 'UNKNOWN'];
      const weights = [0.85, 0.1, 0.03, 0.02];
      const rand = Math.random();
      let cumulative = 0;
      let newStatus = 'HEALTHY';
      for (let i = 0; i < statuses.length; i++) {
        cumulative += weights[i];
        if (rand < cumulative) {
          newStatus = statuses[i];
          break;
        }
      }
      service.status = newStatus;
      service.lastCheck = new Date().toISOString();
      service.responseTime = Math.floor(Math.random() * 100) + 10;
    }
  });

  lastUpdate = Date.now();
}

initializeStates();

setInterval(simulateUpdates, 5000);

router.get('/agents', (req, res) => {
  const agents = Array.from(agentStates.values());
  res.json({
    success: true,
    count: agents.length,
    timestamp: new Date().toISOString(),
    agents: agents
  });
});

router.get('/agents/:id', (req, res) => {
  const agentId = req.params.id;
  const agent = agentStates.get(agentId);
  
  if (!agent) {
    return res.status(404).json({
      success: false,
      error: 'Agent not found'
    });
  }
  
  res.json({
    success: true,
    agent: agent
  });
});

router.get('/services', (req, res) => {
  const services = Array.from(serviceStates.values());
  res.json({
    success: true,
    count: services.length,
    timestamp: new Date().toISOString(),
    services: services
  });
});

router.get('/services/:name', (req, res) => {
  const serviceName = req.params.name;
  const service = serviceStates.get(serviceName);
  
  if (!service) {
    return res.status(404).json({
      success: false,
      error: 'Service not found'
    });
  }
  
  res.json({
    success: true,
    service: service
  });
});

router.get('/status', (req, res) => {
  const healthyCount = Array.from(serviceStates.values()).filter(s => s.status === 'HEALTHY').length;
  const totalServices = serviceStates.size;
  const activeAgents = Array.from(agentStates.values()).filter(a => a.status !== 'IDLE').length;
  
  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    summary: {
      totalAgents: AGENT_NAMES.length,
      activeAgents: activeAgents,
      totalServices: totalServices,
      healthyServices: healthyCount,
      overallHealth: healthyCount === totalServices ? 'healthy' : healthyCount >= totalServices * 0.8 ? 'degraded' : 'critical'
    },
    agents: Array.from(agentStates.values()),
    services: Array.from(serviceStates.values())
  });
});

module.exports = router;