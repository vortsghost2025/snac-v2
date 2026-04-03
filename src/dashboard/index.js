/**
 * WebSocket Dashboard for SNAC v2
 * Real-time monitoring interface for agent activities
 */

const WebSocket = require('ws');
const express = require('express');
const path = require('path');
const http = require('http');

class DashboardServer {
  constructor(port = 3001) {
    this.port = port;
    this.clients = new Set();
    this.app = express();
    this.server = http.createServer(this.app);
    this.wss = new WebSocket.Server({ server: this.server });
    
    this.setupRoutes();
    this.setupWebSocketHandlers();
  }

  setupRoutes() {
    // Serve dashboard UI
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'dashboard.html'));
    });

    // API endpoint for dashboard data
    this.app.get('/api/status', (req, res) => {
      res.json(this.getSystemStatus());
    });

    // Chat API - send message to an agent
    this.app.post('/api/chat', async (req, res) => {
      try {
        const { agent, message } = req.body;
        
        if (!agent || !message) {
          return res.status(400).json({ 
            success: false, 
            error: 'Missing agent or message' 
          });
        }

        const validAgents = ['dev-kimi', 'dev-lingma', 'dev-copilot', 'dev-kilo'];
        if (!validAgents.includes(agent)) {
          return res.status(400).json({ 
            success: false, 
            error: `Invalid agent. Valid agents: ${validAgents.join(', ')}` 
          });
        }

        // Send message to agent via MessageBus
        const result = await this.sendToAgent(agent, message);
        res.json(result);
      } catch (err) {
        console.error('Chat error:', err);
        res.status(500).json({ 
          success: false, 
          error: 'Failed to send message' 
        });
      }
    });

    // Get inbox messages
    this.app.get('/api/chat/inbox', async (req, res) => {
      try {
        const messages = await this.getInbox();
        res.json({ success: true, messages });
      } catch (err) {
        res.status(500).json({ 
          success: false, 
          error: 'Failed to get inbox' 
        });
      }
    });

    // Get agent status
    this.app.get('/api/agents', (req, res) => {
      res.json(this.getSystemStatus().agents);
    });
  }

  async sendToAgent(agentId, message) {
    try {
      const MessageBus = require('../agents/MessageBus');
      const messageBus = new MessageBus('dashboard');
      await messageBus.initialize();
      
      // Send message and wait for response
      const result = await messageBus.send(agentId, message, 'question');
      
      if (result.success) {
        // Wait briefly and check for response in inbox
        await new Promise(resolve => setTimeout(resolve, 500));
        const inbox = await this.checkForResponse(agentId, result.messageId);
        
        return {
          success: true,
          messageId: result.messageId,
          response: inbox || `Message sent to ${agentId}. They will respond shortly.`
        };
      } else {
        return { success: false, error: result.error };
      }
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async checkForResponse(targetAgent, originalMessageId) {
    // Check if target agent has responded
    const fs = require('fs');
    const mailboxDir = path.join(__dirname, '../../.agents/mailboxes');
    const agentDir = path.join(mailboxDir, 'dashboard');
    
    try {
      if (fs.existsSync(agentDir)) {
        const files = fs.readdirSync(agentDir).filter(f => f.endsWith('.json'));
        
        for (const file of files) {
          const content = fs.readFileSync(path.join(agentDir, file), 'utf8');
          const msg = JSON.parse(content);
          
          if (msg.from === targetAgent && msg.timestamp > Date.now() - 10000) {
            return msg.message || msg.response || `Response from ${targetAgent}`;
          }
        }
      }
    } catch (err) {
      console.error('Error checking response:', err);
    }
    
    return null;
  }

  async getInbox() {
    const fs = require('fs');
    const mailboxDir = path.join(__dirname, '../../.agents/mailboxes');
    const agentDir = path.join(mailboxDir, 'dashboard');
    
    try {
      if (fs.existsSync(agentDir)) {
        const files = fs.readdirSync(agentDir).filter(f => f.endsWith('.json'));
        const messages = [];
        
        for (const file of files) {
          const content = fs.readFileSync(path.join(agentDir, file), 'utf8');
          messages.push(JSON.parse(content));
        }
        
        return messages.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      }
    } catch (err) {
      console.error('Error reading inbox:', err);
    }
    
    return [];
  }

  setupWebSocketHandlers() {
    this.wss.on('connection', (ws, req) => {
      this.clients.add(ws);
      console.log(`Dashboard client connected: ${req.socket.remoteAddress}`);

      // Send initial status
      ws.send(JSON.stringify({
        type: 'INITIAL_STATUS',
        data: this.getSystemStatus()
      }));

      ws.on('close', () => {
        this.clients.delete(ws);
        console.log('Dashboard client disconnected');
      });

      ws.on('error', (err) => {
        console.error('WebSocket error:', err);
        this.clients.delete(ws);
      });
    });
  }

  getSystemStatus() {
    // This would connect to the actual mesh system to get real status
    return {
      timestamp: new Date().toISOString(),
      agents: [
        { id: 'dev-kimi', status: 'READY FOR NEXT PHASE', lastSeen: '2024-10-01T17:20:00Z', zone: 'agents, websocket, dashboard' },
        { id: 'dev-lingma', status: 'IDLE', lastSeen: '2024-10-01T16:35:00Z', zone: 'memory, pipeline, healing' },
        { id: 'dev-copilot', status: 'IDLE', lastSeen: '2024-10-01T16:00:00Z', zone: 'infra, tests, benchmarks' },
        { id: 'dev-kilo', status: 'IDLE', lastSeen: '2024-10-01T16:15:00Z', zone: 'orchestrator, swarm' }
      ],
      system: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        activeConnections: this.wss.clients.size
      },
      coordination: {
        locks: this.getLockStatus(),
        messages: this.getMessageStats()
      }
    };
  }

  getLockStatus() {
    // Read lock status from the coordination system
    try {
      const fs = require('fs');
      const locksPath = path.join(__dirname, '../../.agents/LOCKS.json');
      if (fs.existsSync(locksPath)) {
        const locks = JSON.parse(fs.readFileSync(locksPath, 'utf8'));
        return locks;
      }
    } catch (e) {
      console.error('Error reading locks:', e);
    }
    return { locks: {} };
  }

  getMessageStats() {
    // Get message statistics from the message bus
    try {
      const fs = require('fs');
      const mailboxDir = path.join(__dirname, '../../.agents/mailboxes');
      if (fs.existsSync(mailboxDir)) {
        const agents = ['dev-kimi', 'dev-lingma', 'dev-copilot', 'dev-kilo'];
        const stats = {};
        
        for (const agent of agents) {
          const agentDir = path.join(mailboxDir, agent);
          if (fs.existsSync(agentDir)) {
            const files = fs.readdirSync(agentDir).filter(f => f.endsWith('.json'));
            stats[agent] = { messageCount: files.length };
          }
        }
        
        return stats;
      }
    } catch (e) {
      console.error('Error reading message stats:', e);
    }
    return {};
  }

  broadcast(data) {
    const json = JSON.stringify(data);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(json);
      }
    }
  }

  start() {
    this.server.listen(this.port, () => {
      console.log(`Dashboard server running on http://localhost:${this.port}`);
    });
  }

  stop() {
    this.server.close();
    this.wss.close();
  }
}

// Auto-start if run directly
if (require.main === module) {
  const dashboard = new DashboardServer();
  dashboard.start();
  
  // Broadcast status updates periodically
  setInterval(() => {
    dashboard.broadcast({
      type: 'STATUS_UPDATE',
      data: dashboard.getSystemStatus()
    });
  }, 5000);
}

module.exports = DashboardServer;