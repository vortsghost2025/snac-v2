/**
 * SHARED TYPE DEFINITIONS
 * =======================
 * ⚠️ THIS FILE IS A CONTRACT BETWEEN ALL AGENTS
 * ⚠️ DO NOT MODIFY WITHOUT UPDATING .agents/DISPATCH.md
 * ⚠️ ALL AGENTS MUST IMPORT TYPES FROM HERE
 *
 * Owner: SHARED (requires coordination)
 * Last Modified By: human
 * Last Modified: 2024-10-01
 */

// ===========================================
// AGENT MESSAGE PROTOCOL
// ===========================================

/**
 * @typedef {Object} AgentMessage
 * @property {'state'|'command'|'event'|'log'|'request'} type
 * @property {number} timestamp - Unix ms
 * @property {string} source   - agent id
 * @property {string} target   - agent id or 'broadcast'
 * @property {Object} payload
 * @property {number} priority - 1-10
 * @property {number} [ttl]    - milliseconds
 */

/**
 * @typedef {Object} AgentStatus
 * @property {string} agentId
 * @property {'idle'|'working'|'blocked'|'error'} state
 * @property {string} currentTask
 * @property {string[]} filesLocked
 * @property {number} lastHeartbeat
 */

/**
 * @typedef {Object} MemoryLayerEntry
 * @property {string} id
 * @property {number} layer - 1-48
 * @property {string} layerRange - partition key
 * @property {string} agentId
 * @property {Object} data
 * @property {number} timestamp
 * @property {string} checksum - SHA-256
 */

/**
 * @typedef {Object} SwarmTask
 * @property {string} taskId
 * @property {string} assignedAgent
 * @property {'pending'|'active'|'complete'|'failed'} status
 * @property {Object} input
 * @property {Object} [output]
 * @property {number} priority
 * @property {number} createdAt
 * @property {number} [completedAt]
 */

/**
 * @typedef {Object} PipelineResult
 * @property {string} pipelineId
 * @property {string} pipelineType
 * @property {string} agentId
 * @property {'running'|'complete'|'failed'} status
 * @property {number} durationMs
 * @property {Object} metrics
 * @property {number} timestamp
 */

// ===========================================
// SHARED CONSTANTS
// ===========================================

const AGENT_IDS = Object.freeze({
  KILO:    'agent-kilo',
  LINGMA:  'agent-lingma',
  CLAUDE:  'agent-claude',
  GLM:     'agent-glm',
  COPILOT: 'agent-copilot',
  MASTER:  'master-cockpit'
});

const MEMORY_LAYERS = Object.freeze({
  CONSTITUTIONAL: { start: 1,  end: 4 },
  CONSTRAINT:     { start: 5,  end: 8 },
  PHENOTYPE:      { start: 9,  end: 12 },
  DRIFT:          { start: 13, end: 16 },
  RECOVERY:       { start: 17, end: 20 },
  COORDINATION:   { start: 21, end: 24 },
  SWARM:          { start: 25, end: 28 },
  PIPELINE:       { start: 29, end: 32 },
  HEALING:        { start: 33, end: 36 },
  INTEGRITY:      { start: 37, end: 40 },
  CACHE:          { start: 41, end: 44 },
  META:           { start: 45, end: 48 }
});

const PORTS = Object.freeze({
  DASHBOARD:      3001,
  AGENT_KILO:     3002,
  AGENT_LINGMA:   3003,
  AGENT_KIMI:     3004,
  AGENT_COPILOT:  3006,
  SWARM_WORKER:   3007
});

const MESSAGE_TYPES = Object.freeze({
  STATE:   'state',
  COMMAND: 'command',
  EVENT:   'event',
  LOG:     'log',
  REQUEST: 'request'
});

module.exports = { AGENT_IDS, MEMORY_LAYERS, PORTS, MESSAGE_TYPES };