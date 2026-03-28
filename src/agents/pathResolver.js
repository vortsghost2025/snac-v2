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
   * @param {string} agentId - The requesting agent ID
   * @param {string} relativePath - The path to resolve
   * @returns {string} The resolved absolute path
   * @throws {Error} If path traversal is detected or zone violation occurs
   */
  resolvePath(agentId, relativePath) {
    // Normalize the requested path
    const requestedPath = path.resolve(relativePath);
    
    // Get the agent's allowed zones
    const allowedZones = this.agentZones[agentId];
    if (!allowedZones) {
      throw new Error(`Unknown agent ID: ${agentId}`);
    }

    // Check if the requested path is within any of the agent's allowed zones
    for (const zone of allowedZones) {
      const zonePath = path.resolve(zone);
      
      // Ensure the requested path starts with the zone path
      if (requestedPath.startsWith(zonePath + path.sep) || requestedPath === zonePath) {
        return requestedPath;
      }
    }

    // If we get here, the path is outside the agent's allowed zones
    throw new Error(`EPERM: Agent ${agentId} attempted to access path outside allowed zones: ${relativePath}`);
  }

  /**
   * Validate that a path doesn't contain dangerous patterns
   * @param {string} inputPath - The path to validate
   * @returns {boolean} True if path is safe
   */
  isValidPath(inputPath) {
    // Check for null bytes
    if (inputPath.includes('\0')) {
      return false;
    }

    // Check for encoded path traversal attempts
    const decodedPath = decodeURIComponent(inputPath);
    if (decodedPath.includes('../') || decodedPath.includes('..\\')) {
      return false;
    }

    // Additional checks can be added here
    return true;
  }

  /**
   * Get allowed zones for an agent
   * @param {string} agentId - The agent ID
   * @returns {string[]} Array of allowed zones
   */
  getAllowedZones(agentId) {
    return this.agentZones[agentId] || [];
  }

  /**
   * Check if a path is within an agent's zone
   * @param {string} agentId - The agent ID
   * @param {string} requestedPath - The path to check
   * @returns {boolean} True if path is allowed
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