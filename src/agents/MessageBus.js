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

function validateAgentId(agentId) {
  return typeof agentId === 'string' && 
         VALID_AGENTS.includes(agentId) &&
         /^[a-z0-9-]+$/.test(agentId);
}

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
  if (/[<>\x00-\x08\x0B\x0C\x0E-\x1F]/.test(message)) {
    return { valid: false, error: 'Message contains invalid characters' };
  }
  return { valid: true };
}

/**
 * Secure path resolution - prevents path traversal attacks
 */
function safePathJoin(baseDir, subPath) {
  const normalizedBase = path.normalize(path.resolve(baseDir));
  const resolved = path.resolve(normalizedBase, subPath);
  const baseWithSep = normalizedBase.endsWith(path.sep) ? normalizedBase : normalizedBase + path.sep;
  
  if (!resolved.startsWith(baseWithSep) && resolved !== normalizedBase) {
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

  async renewLease(resourcePath) {
    const lockfile = require('proper-lockfile');
    try {
      // Acquire exclusive lock on LOCKS.json
      const release = await lockfile.lock(this.locksPath, { retries: 3 });
      
      try {
        const locksData = await fs.readFile(this.locksPath, 'utf8');
        const locks = JSON.parse(locksData);
        
        if (locks.locks && locks.locks[resourcePath] && locks.locks[resourcePath].owner === this.agentId) {
          const now = new Date().toISOString();
          const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
          
          locks.locks[resourcePath].since = now;
          locks.locks[resourcePath].lease_expires = expiresAt;
          locks.locks[resourcePath].heartbeat = now;
          
          // Atomic write with temp file + rename
          const tempPath = `${this.locksPath}.tmp`;
          await fs.writeFile(tempPath, JSON.stringify(locks, null, 2));
          await fs.rename(tempPath, this.locksPath);
          
          return { success: true, expiresAt };
        } else {
          return { success: false, error: 'Resource not owned by this agent' };
        }
      } finally {
        await release();
      }
    } catch (error) {
      console.error(`Failed to renew lease for ${resourcePath}: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  async checkExpiredLocks() {
    const lockfile = require('proper-lockfile');
    try {
      // Acquire exclusive lock on LOCKS.json
      const release = await lockfile.lock(this.locksPath, { retries: 3 });
      
      try {
        const locksData = await fs.readFile(this.locksPath, 'utf8');
        const locks = JSON.parse(locksData);
        const now = new Date();
        const releasedResources = [];
        
        if (!locks.locks) return releasedResources;
        
        for (const [resourcePath, lockInfo] of Object.entries(locks.locks)) {
          if (lockInfo.lease_expires) {
            const expiryDate = new Date(lockInfo.lease_expires);
            if (now > expiryDate) {
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
        
        if (releasedResources.length > 0) {
          // Atomic write with temp file + rename
          const tempPath = `${this.locksPath}.tmp`;
          await fs.writeFile(tempPath, JSON.stringify(locks, null, 2));
          await fs.rename(tempPath, this.locksPath);
        }
        
        return releasedResources;
      } finally {
        await release();
      }
    } catch (error) {
      console.error(`Failed to check expired locks: ${error.message}`);
      return [];
    }
  }

  async send(recipient, message, type = 'message', metadata = {}) {
    if (!validateAgentId(recipient)) {
      return { success: false, error: 'Invalid recipient agent ID' };
    }
    
    const msgValidation = validateMessage(message);
    if (!msgValidation.valid) {
      return { success: false, error: msgValidation.error };
    }
    
    if (!VALID_MESSAGE_TYPES.includes(type)) {
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
      const recipientMailbox = safePathJoin(this.mailboxDir, recipient);
      const messagePath = safePathJoin(recipientMailbox, `${messageId}.json`);

      await fs.mkdir(recipientMailbox, { recursive: true });
      
      const tempPath = `${messagePath}.tmp`;
      await fs.writeFile(tempPath, JSON.stringify(envelope, null, 2), 'utf8');
      await fs.rename(tempPath, messagePath);
      
      this.emit('sent', envelope);
      
      return { success: true, messageId };
    } catch (error) {
      console.error(`[MessageBus] Failed to send message to ${recipient}:`, error.message);
      return { success: false, error: 'Failed to send message' };
    }
  }

  async broadcast(message, type = 'broadcast', metadata = {}) {
    const msgValidation = validateMessage(message);
    if (!msgValidation.valid) {
      return { success: false, error: msgValidation.error };
    }
    
    if (!VALID_MESSAGE_TYPES.includes(type)) {
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
      const mailboxes = await fs.readdir(this.mailboxDir);
      let sentCount = 0;
      
      const promises = mailboxes.map(async (mailbox) => {
        if (mailbox !== this.agentId && validateAgentId(mailbox)) {
          try {
            const messagePath = safePathJoin(
              safePathJoin(this.mailboxDir, mailbox), 
              `${messageId}.json`
            );
            const tempPath = `${messagePath}.tmp`;
            await fs.writeFile(tempPath, JSON.stringify(envelope, null, 2), 'utf8');
            await fs.rename(tempPath, messagePath);
            sentCount++;
          } catch (err) {
            console.error(`Failed to send to ${mailbox}:`, err.message);
          }
        }
      });
      
      await Promise.allSettled(promises);
      
      return { success: true, messageId, recipients: sentCount };
    } catch (error) {
      console.error('[MessageBus] Broadcast failed:', error.message);
      return { success: false, error: 'Failed to broadcast message' };
    }
  }

  async sendToGroup(recipients, message, metadata = {}) {
    const msgValidation = validateMessage(message);
    if (!msgValidation.valid) {
      return { success: false, error: msgValidation.error };
    }
    
    if (!Array.isArray(recipients) || recipients.length === 0) {
      return { success: false, error: 'Recipients must be a non-empty array' };
    }
    
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
        const recipientMailbox = safePathJoin(this.mailboxDir, recipient);
        const messagePath = safePathJoin(recipientMailbox, `${messageId}.json`);
        
        await fs.mkdir(recipientMailbox, { recursive: true });
        
        const tempPath = `${messagePath}.tmp`;
        await fs.writeFile(tempPath, JSON.stringify(envelope, null, 2), 'utf8');
        await fs.rename(tempPath, messagePath);
      });
      
      await Promise.allSettled(promises);
      
      return { success: true, messageId, recipients: recipients.length };
    } catch (error) {
      console.error('[MessageBus] Failed to send group message:', error.message);
      return { success: false, error: 'Failed to send group message' };
    }
  }

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

      // Sort by timestamp (newest first) — parse ISO strings to Date for comparison
      return messages.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    } catch (error) {
      console.error(`Failed to read inbox: ${error.message}`);
      return [];
    }
  }

  async markAsRead(messageId) {
    if (!messageId || typeof messageId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(messageId)) {
      return { success: false, error: 'Invalid message ID' };
    }
    
    try {
      const messagePath = safePathJoin(this.agentMailboxDir, `${messageId}.json`);
      const archiveDir = safePathJoin(this.agentMailboxDir, 'archive');
      const archivePath = safePathJoin(archiveDir, `${messageId}.json`);
      
      await fs.mkdir(archiveDir, { recursive: true });
      await fs.rename(messagePath, archivePath);
      
      return { success: true };
    } catch (error) {
      return { success: false, error: 'Failed to archive message' };
    }
  }

  async getUnreadCount() {
    try {
      const messages = await this.getInbox();
      return messages.length;
    } catch (error) {
      return 0;
    }
  }
}

module.exports = MessageBus;
