/**
 * Inter-Agent Message Bus
 * Implements file-based mailbox system for AI-to-AI communication
 * Follows the coordination layer specifications in .agents/DISPATCH.md and .agents/LOCKS.json
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');

// Validation utilities
const VALID_AGENTS = ['dev-kimi', 'dev-lingma', 'dev-copilot', 'dev-kilo'];
const VALID_MESSAGE_TYPES = ['message', 'request', 'response', 'alert', 'question', 'broadcast', 'group'];
const MAX_MESSAGE_LENGTH = 10000;

/**
 * Validate agent ID
 * @param {string} agentId - Agent identifier to validate
 * @returns {boolean} - True if valid
 */
function validateAgentId(agentId) {
  return typeof agentId === 'string' && 
         VALID_AGENTS.includes(agentId) &&
         /^[a-z0-9-]+$/.test(agentId);
}

/**
 * Validate message content
 * @param {string} message - Message to validate
 * @returns {{valid: boolean, error?: string}} - Validation result
 */
function validateMessage(message) {
  if (typeof message !== 'string') {
    return { valid: false, error: 'Message must be a string' };
  }
  if (message.length === 0) {
    return { valid: false, error: 'Message cannot be empty' };
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return { valid: false, error: `Message exceeds maximum length of ${MAX_MESSAGE_LENGTH} characters` };
  }
  // Check for potentially dangerous content
  if (/[<>\x00-\x08\x0B\x0C\x0E-\x1F]/.test(message)) {
    return { valid: false, error: 'Message contains invalid characters' };
  }
  return { valid: true };
}

/**
 * Secure path resolution - prevents path traversal attacks
 * @param {string} baseDir - Base directory
 * @param {string} userPath - User-provided path component
 * @returns {string} - Safe resolved path
 * @throws {Error} - If path traversal detected
 */
function safePathJoin(baseDir, userPath) {
  // Normalize the base directory
  const normalizedBase = path.resolve(baseDir);
  
  // Resolve the full path
  const resolved = path.resolve(normalizedBase, userPath);
  
  // Ensure resolved path starts with base directory
  // Add path.sep to ensure we're matching the full directory name
  const baseWithSep = normalizedBase.endsWith(path.sep) ? normalizedBase : normalizedBase + path.sep;
  
  if (!resolved.startsWith(normalizedBase) && resolved !== normalizedBase) {
    throw new Error('Path traversal detected - invalid path');
  }
  
  return resolved;
}

/**
 * Secure path resolution - prevents path traversal
 * @param {string} baseDir - Base directory
 * @param {string} subPath - Subdirectory or filename
 * @returns {string} - Safe resolved path
 * @throws {Error} - If path traversal detected
 */
function safePathJoin(baseDir, subPath) {
  const resolved = path.resolve(baseDir, subPath);
  const normalizedBase = path.normalize(baseDir);
  if (!resolved.startsWith(normalizedBase)) {
    throw new Error('Path traversal detected - invalid path');
  }
  return resolved;
}

class MessageBus extends EventEmitter {
  constructor(agentId) {
    super();
    this.agentId = agentId;
    this.mailboxDir = safePathJoin(__dirname, '../../.agents/mailboxes');
    this.agentMailboxDir = safePathJoin(this.mailboxDir, agentId);
    this.locksPath = safePathJoin(__dirname, '../../.agents/LOCKS.json');
    this.agentMailboxDir = path.join(this.mailboxDir, agentId);
    this.locksPath = path.join(__dirname, '../../.agents/LOCKS.json');
  }

  async initialize() {
    try {
      await fs.mkdir(this.mailboxDir, { recursive: true });
      await fs.mkdir(this.agentMailboxDir, { recursive: true });
      console.log(`MessageBus initialized for ${this.agentId}`);
    } catch (error) {
      console.error(`Failed to initialize MessageBus: ${error.message}`);
    }
  }

  /**
   * Renew lease for a specific resource
   * @param {string} resourcePath - Path to the resource to lock
   * @returns {Object} Result of the lease renewal
   */
  async renewLease(resourcePath) {
    try {
      // Read the current locks file
      const locksData = await fs.readFile(this.locksPath, 'utf8');
      const locks = JSON.parse(locksData);
      
      // Check if the resource exists in locks and is owned by this agent
      if (locks.locks[resourcePath] && locks.locks[resourcePath].owner === this.agentId) {
        // Update the lease expiration time (current time + 10 minutes)
        const now = new Date().toISOString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes from now
        
        locks.locks[resourcePath].since = now;
        locks.locks[resourcePath].lease_expires = expiresAt;
        locks.locks[resourcePath].heartbeat = now;
        
        // Write back to the locks file
        await fs.writeFile(this.locksPath, JSON.stringify(locks, null, 2));
        
        return { success: true, expiresAt };
      } else {
        return { success: false, error: 'Resource not owned by this agent' };
      }
    } catch (error) {
      console.error(`Failed to renew lease for ${resourcePath}: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Check for expired locks and release them
   * @returns {Array} List of released resources
   */
  async checkExpiredLocks() {
    try {
      const locksData = await fs.readFile(this.locksPath, 'utf8');
      const locks = JSON.parse(locksData);
      const now = new Date();
      const releasedResources = [];
      
      for (const [resourcePath, lockInfo] of Object.entries(locks.locks)) {
        if (lockInfo.lease_expires) {
          const expiryDate = new Date(lockInfo.lease_expires);
          if (now > expiryDate) {
            // Lease has expired, release the lock
            locks.locks[resourcePath].since = "";
            locks.locks[resourcePath].lease_expires = null;
            locks.locks[resourcePath].heartbeat = null;
            locks.locks[resourcePath].task = "";
            
            releasedResources.push({
              resource: resourcePath,
              previousOwner: lockInfo.owner
            });
          }
        }
      }
      
      // Write back the updated locks if any were released
      if (releasedResources.length > 0) {
        await fs.writeFile(this.locksPath, JSON.stringify(locks, null, 2));
      }
      
      return releasedResources;
    } catch (error) {
      console.error(`Failed to check expired locks: ${error.message}`);
      return [];
    }
  }

  /**
   * Send a direct message to another agent
   * @param {string} recipient - Target agent ID (dev-kimi, dev-lingma, dev-copilot, dev-kilo)
   * @param {string} message - Message content
   * @param {string} type - Message type (message, request, response, alert, question)
   * @param {Object} metadata - Additional message metadata
   * @returns {Promise<{success: boolean, messageId?: string, error?: string}>} - Result
   */
  async send(recipient, message, type = 'message', metadata = {}) {
    // Validate recipient
    if (!validateAgentId(recipient)) {
      console.error(`Invalid recipient: ${recipient}`);
      return { success: false, error: 'Invalid recipient agent ID' };
    }
    
    // Validate message
    const msgValidation = validateMessage(message);
    if (!msgValidation.valid) {
      console.error(`Message validation failed: ${msgValidation.error}`);
      return { success: false, error: msgValidation.error };
    }
    
    // Validate type
    if (!VALID_MESSAGE_TYPES.includes(type)) {
      console.error(`Invalid message type: ${type}`);
      return { success: false, error: 'Invalid message type' };
    }

    const timestamp = Date.now();
    const messageId = `${timestamp}-${Math.random().toString(36).substr(2, 9)}`;
    
    const envelope = {
      id: messageId,
      from: this.agentId,
      to: recipient,
      type,
      message: message.substring(0, MAX_MESSAGE_LENGTH),
      timestamp: new Date().toISOString(),
      metadata: {
        ...metadata,
        sentAt: timestamp
      }
    };

    try {
      // Secure path resolution
      const recipientMailbox = safePathJoin(this.mailboxDir, recipient);
      const messagePath = safePathJoin(recipientMailbox, `${messageId}.json`);

      // Ensure recipient mailbox exists
      await fs.mkdir(recipientMailbox, { recursive: true });
      
      // Atomic write - write to temp file then rename
      const tempPath = `${messagePath}.tmp`;
      await fs.writeFile(tempPath, JSON.stringify(envelope, null, 2), 'utf8');
      await fs.rename(tempPath, messagePath);
      
      console.log(`[MessageBus] Message sent to ${recipient}:`, { messageId, type, from: this.agentId });
      
      this.emit('sent', envelope);
      
      return { success: true, messageId };
    } catch (error) {
      console.error(`[MessageBus] Failed to send message to ${recipient}:`, error.message);
      return { success: false, error: 'Failed to send message' };
    }
  }

  /**
   * Broadcast message to all agents
   * @param {string} message - Message content
   * @param {Object} metadata - Additional message metadata
   */
  async broadcast(message, type = 'broadcast', metadata = {}) {
    // Validate message
    const msgValidation = validateMessage(message);
    if (!msgValidation.valid) {
      console.error(`Broadcast validation failed: ${msgValidation.error}`);
      return { success: false, error: msgValidation.error };
    }
    
    // Validate type
    if (!VALID_MESSAGE_TYPES.includes(type)) {
      console.error(`Invalid broadcast type: ${type}`);
      return { success: false, error: 'Invalid message type' };
    }

    const timestamp = Date.now();
    const messageId = `${timestamp}-broadcast-${Math.random().toString(36).substr(2, 9)}`;
    
    const envelope = {
      id: messageId,
      from: this.agentId,
      to: 'broadcast',
      type,
      message: message.substring(0, MAX_MESSAGE_LENGTH),
      timestamp: new Date().toISOString(),
      metadata: {
        ...metadata,
        sentAt: timestamp
      }
    };

    try {
      // Find all agent mailboxes
      const mailboxes = await fs.readdir(this.mailboxDir);
      let sentCount = 0;
      
      const promises = mailboxes.map(async (mailbox) => {
        if (mailbox !== this.agentId && validateAgentId(mailbox)) {
          try {
            const messagePath = safePathJoin(
              safePathJoin(this.mailboxDir, mailbox), 
              `${messageId}.json`
            );
            // Atomic write
            const tempPath = `${messagePath}.tmp`;
            await fs.writeFile(tempPath, JSON.stringify(envelope, null, 2), 'utf8');
            await fs.rename(tempPath, messagePath);
            sentCount++;
          } catch (err) {
            console.error(`Failed to send to ${mailbox}:`, err.message);
          }
        }
      });
      
      await Promise.all(promises);
      
      console.log(`[MessageBus] Broadcast sent to ${sentCount} agents:`, { messageId, type });
      return { success: true, messageId, recipients: sentCount };
    } catch (error) {
      console.error('[MessageBus] Broadcast failed:', error.message);
      return { success: false, error: 'Failed to broadcast message' };
    }
  }

  /**
   * Send group message to specific agents
   * @param {string[]} recipients - Array of target agent IDs
   * @param {string} message - Message content
   * @param {Object} metadata - Additional message metadata
   */
  async sendToGroup(recipients, message, metadata = {}) {
    // Validate message
    const msgValidation = validateMessage(message);
    if (!msgValidation.valid) {
      console.error(`Group message validation failed: ${msgValidation.error}`);
      return { success: false, error: msgValidation.error };
    }
    
    // Validate recipients array
    if (!Array.isArray(recipients) || recipients.length === 0) {
      return { success: false, error: 'Recipients must be a non-empty array' };
    }
    
    // Validate all recipients
    for (const recipient of recipients) {
      if (!validateAgentId(recipient)) {
        return { success: false, error: `Invalid recipient: ${recipient}` };
      }
    }

    const timestamp = Date.now();
    const messageId = `${timestamp}-group-${Math.random().toString(36).substr(2, 9)}`;
    
    const envelope = {
      id: messageId,
      from: this.agentId,
      to: recipients,
      type: 'group',
      message: message.substring(0, MAX_MESSAGE_LENGTH),
      timestamp: new Date().toISOString(),
      metadata: {
        ...metadata,
        sentAt: timestamp
      }
    };

    try {
      const promises = recipients.map(async (recipient) => {
        // Secure path resolution
        const recipientMailbox = safePathJoin(this.mailboxDir, recipient);
        const messagePath = safePathJoin(recipientMailbox, `${messageId}.json`);
        
        // Ensure recipient mailbox exists
        await fs.mkdir(recipientMailbox, { recursive: true });
        
        // Atomic write
        const tempPath = `${messagePath}.tmp`;
        await fs.writeFile(tempPath, JSON.stringify(envelope, null, 2), 'utf8');
        await fs.rename(tempPath, messagePath);
      });
      
      await Promise.all(promises);
      
      console.log(`[MessageBus] Group message sent to [${recipients.join(', ')}]:`, { messageId });
      return { success: true, messageId, recipients: recipients.length };
    } catch (error) {
      console.error('[MessageBus] Failed to send group message:', error.message);
      return { success: false, error: 'Failed to send group message' };
    }
  }

  /**
   * Get all messages from agent's inbox
   * @returns {Array} Array of messages
   */
  async getInbox() {
    try {
      const files = await fs.readdir(this.agentMailboxDir);
      const messages = [];

      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(this.agentMailboxDir, file);
          const content = await fs.readFile(filePath, 'utf8');
          const message = JSON.parse(content);
          messages.push(message);
        }
      }

      // Sort by timestamp (newest first)
      return messages.sort((a, b) => b.timestamp - a.timestamp);
    } catch (error) {
      console.error(`Failed to read inbox: ${error.message}`);
      return [];
    }
  }

  /**
   * Mark a message as read by moving it to the archive
   * @param {string} messageId - ID of the message to archive
   */
  async markAsRead(messageId) {
    // Validate messageId format
    if (!messageId || typeof messageId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(messageId)) {
      console.error('Invalid message ID format');
      return { success: false, error: 'Invalid message ID' };
    }
    
    try {
      // Secure path resolution
      const messagePath = safePathJoin(this.agentMailboxDir, `${messageId}.json`);
      const archiveDir = safePathJoin(this.agentMailboxDir, 'archive');
      const archivePath = safePathJoin(archiveDir, `${messageId}.json`);
      
      await fs.mkdir(archiveDir, { recursive: true });
      await fs.rename(messagePath, archivePath);
      
      console.log(`[MessageBus] Message ${messageId} archived`);
      return { success: true };
    } catch (error) {
      console.error(`[MessageBus] Failed to archive message: ${error.message}`);
      return { success: false, error: 'Failed to archive message' };
    }
  }

  /**
   * Get unread message count
   * @returns {number} Count of unread messages
   */
  async getUnreadCount() {
    try {
      const messages = await this.getInbox();
      return messages.length;
    } catch (error) {
      console.error(`Failed to get unread count: ${error.message}`);
      return 0;
    }
  }
}

module.exports = MessageBus;