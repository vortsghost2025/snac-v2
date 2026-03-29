/**
 * Secure Path Resolver for Agent Zones
 * Prevents directory traversal attacks and enforces zone isolation
 */

const path = require('path');

class PathResolver {
  constructor() {
    // Define allowed agent zones based on DISPATCH.md
    this.agentZones = {
      'dev-kimi': ['src/agents', 'src/websocket', 'src/dashboard'],
      'dev-lingma': ['src/memory', 'src/pipeline', 'src/healing'],
      'dev-copilot': ['infra', 'tests', 'benchmarks'],
      'dev-kilo': ['src/orchestrator', 'src/swarm']
    };
  }

  /**
   * Resolve a path within an agent's allowed zones
   */
  resolvePath(agentId, relativePath) {
    // Normalize the requested path — resolve relative to a known base
    const basePath = path.resolve(__dirname, '../..');
    const requestedPath = path.resolve(basePath, relativePath);
    
    // Get the agent's allowed zones
    const allowedZones = this.agentZones[agentId];
    if (!allowedZones) {
      throw new Error(`Unknown agent ID: ${agentId}`);
    }

    // Check if the requested path is within any of the agent's allowed zones
    for (const zone of allowedZones) {
      const zonePath = path.resolve(basePath, zone);
      const zoneWithSep = zonePath.endsWith(path.sep) ? zonePath : zonePath + path.sep;
      
      if (requestedPath.startsWith(zoneWithSep) || requestedPath === zonePath) {
        return requestedPath;
      }
    }

    throw new Error(`EPERM: Agent ${agentId} attempted to access path outside allowed zones: ${relativePath}`);
  }

  /**
   * Validate that a path doesn't contain dangerous patterns.
   * Handles double-encoding attacks.
   */
  isValidPath(inputPath) {
    if (typeof inputPath !== 'string') return false;
    
    // Check for null bytes
    if (inputPath.includes('\0')) {
      return false;
    }

    // Decode URI encoding iteratively to catch double-encoding
    let decoded = inputPath;
    let prevDecoded = null;
    while (decoded !== prevDecoded) {
      prevDecoded = decoded;
      try {
        decoded = decodeURIComponent(decoded);
      } catch (e) {
        // Invalid encoding
        return false;
      }
    }
    
    if (decoded.includes('../') || decoded.includes('..\\')) {
      return false;
    }

    return true;
  }

  /**
   * Get allowed zones for an agent
   */
  getAllowedZones(agentId) {
    return this.agentZones[agentId] || [];
  }

  /**
   * Check if a path is within an agent's zone
   */
  isInAgentZone(agentId, requestedPath) {
    try {
      this.resolvePath(agentId, requestedPath);
      return true;
    } catch (e) {
      return false;
    }
  }
}

module.exports = PathResolver;
