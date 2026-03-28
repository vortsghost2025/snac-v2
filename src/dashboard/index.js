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