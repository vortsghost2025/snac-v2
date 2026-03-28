/**
 * WebSocket Dashboard Server
 * Real-time monitoring for SNAC v2 agents
 * Phase C - Runtime Container
 * Owner: dev-kimi
 * Zone: src/dashboard/
 */

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const EventEmitter = require('events');

class DashboardServer extends EventEmitter {
  constructor(config = {}) {
    super();
    this.port = config.port || 3001;
    this.wss = null;
    this.server = null;
    this.clients = new Map();
    this.agents = new Map();
    this.messageBusPath = config.messageBusPath || path.join(process.cwd(), '.agents', 'mailboxes');
    this.metrics = {
      messagesSent: 0,
      messagesReceived: 0,
      activeConnections: 0,
      agentStatus: {}
    };
  }

  async start() {
    // Create HTTP server for dashboard UI
    this.server = http.createServer(async (req, res) => {
      await this.handleHTTP(req, res);
    });

    // Create WebSocket server
    this.wss = new WebSocket.Server({ server: this.server });
    this.wss.on('connection', (ws, req) => this.handleConnection(ws, req));

    // Start listening
    this.server.listen(this.port, () => {
      console.log(`📊 Dashboard Server running on http://localhost:${this.port}`);
      console.log(`🔌 WebSocket endpoint: ws://localhost:${this.port}`);
    });

    // Start monitoring
    this.startMonitoring();

    return this;
  }

  async handleHTTP(req, res) {
    const url = req.url === '/' ? '/index.html' : req.url;
    
    // Serve dashboard UI
    if (url === '/index.html' || url === '/dashboard') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(this.getDashboardHTML());
      return;
    }

    // API endpoints
    if (url === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'running',
        port: this.port,
        activeConnections: this.clients.size,
        agents: Array.from(this.agents.keys()),
        metrics: this.metrics
      }));
      return;
    }

    if (url === '/api/agents') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        agents: Array.from(this.agents.entries()).map(([id, data]) => ({
          id,
          ...data
        }))
      }));
      return;
    }

    // 404
    res.writeHead(404);
    res.end('Not found');
  }

  handleConnection(ws, req) {
    const clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.clients.set(clientId, {
      ws,
      connectedAt: Date.now(),
      lastPing: Date.now()
    });

    console.log(`🔌 Client connected: ${clientId}`);
    this.metrics.activeConnections = this.clients.size;

    // Send initial data
    ws.send(JSON.stringify({
      type: 'init',
      clientId,
      timestamp: new Date().toISOString(),
      agents: Array.from(this.agents.entries()),
      metrics: this.metrics
    }));

    // Handle messages
    ws.on('message', (data) => this.handleClientMessage(clientId, data));
    ws.on('close', () => this.handleDisconnect(clientId));
    ws.on('error', (err) => console.error(`Client ${clientId} error:`, err));

    // Start heartbeat
    this.startHeartbeat(clientId);
  }

  handleClientMessage(clientId, data) {
    try {
      const message = JSON.parse(data);
      
      switch (message.type) {
        case 'ping':
          this.clients.get(clientId).lastPing = Date.now();
          this.sendToClient(clientId, { type: 'pong', timestamp: Date.now() });
          break;
          
        case 'subscribe':
          // Client wants updates for specific agent
          console.log(`Client ${clientId} subscribed to ${message.agentId}`);
          break;
          
        case 'broadcast':
          // Client sending message to all agents
          this.broadcastToAgents(message.data);
          break;
          
        default:
          console.log(`Unknown message type from ${clientId}:`, message.type);
      }
    } catch (err) {
      console.error(`Error handling message from ${clientId}:`, err.message);
    }
  }

  handleDisconnect(clientId) {
    console.log(`👋 Client disconnected: ${clientId}`);
    this.clients.delete(clientId);
    this.metrics.activeConnections = this.clients.size;
  }

  sendToClient(clientId, data) {
    const client = this.clients.get(clientId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(data));
    }
  }

  broadcastToClients(data) {
    const message = JSON.stringify(data);
    this.clients.forEach((client, id) => {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(message);
      }
    });
  }

  async broadcastToAgents(data) {
    // Use MessageBus to send to agents
    const { MessageBus } = require('../agents/MessageBus');
    const bus = new MessageBus('dashboard-server');
    await bus.initialize();
    
    for (const agentId of this.agents.keys()) {
      await bus.send(agentId, data, 'dashboard');
    }
  }

  startHeartbeat(clientId) {
    const interval = setInterval(() => {
      const client = this.clients.get(clientId);
      if (!client) {
        clearInterval(interval);
        return;
      }

      // Check if client is still alive
      if (Date.now() - client.lastPing > 30000) {
        console.log(`Client ${clientId} timed out`);
        client.ws.terminate();
        this.clients.delete(clientId);
        clearInterval(interval);
      }
    }, 10000);
  }

  async startMonitoring() {
    // Monitor agent mailboxes for new messages
    setInterval(async () => {
      await this.checkAgentMailboxes();
    }, 1000);

    // Update agent status
    setInterval(() => {
      this.updateAgentStatus();
    }, 5000);
  }

  async checkAgentMailboxes() {
    try {
      const mailboxes = await fs.readdir(this.messageBusPath);
      
      for (const agentId of mailboxes) {
        const mailboxPath = path.join(this.messageBusPath, agentId);
        const stats = await fs.stat(mailboxPath).catch(() => null);
        
        if (stats && stats.isDirectory()) {
          const messages = await fs.readdir(mailboxPath);
          const unreadCount = messages.filter(m => m.endsWith('.json')).length;
          
          this.agents.set(agentId, {
            ...this.agents.get(agentId),
            unreadCount,
            lastActive: stats.mtime.toISOString()
          });
        }
      }

      // Broadcast update to all clients
      this.broadcastToClients({
        type: 'agents-update',
        timestamp: new Date().toISOString(),
        agents: Array.from(this.agents.entries())
      });
    } catch (err) {
      // Mailboxes may not exist yet
    }
  }

  updateAgentStatus() {
    this.agents.forEach((data, agentId) => {
      const timeSinceActive = Date.now() - new Date(data.lastActive || 0).getTime();
      const status = timeSinceActive < 60000 ? 'active' : 
                     timeSinceActive < 300000 ? 'idle' : 'offline';
      
      this.agents.set(agentId, { ...data, status });
    });
  }

  getDashboardHTML() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SNAC v2 Agent Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
      background: #0d1117;
      color: #c9d1d9;
      min-height: 100vh;
    }
    .header {
      background: #161b22;
      border-bottom: 1px solid #30363d;
      padding: 1rem 2rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .header h1 { font-size: 1.5rem; color: #58a6ff; }
    .status { display: flex; gap: 1rem; align-items: center; }
    .status-badge {
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
      font-size: 0.875rem;
      font-weight: 500;
    }
    .status-badge.online { background: #238636; color: white; }
    .status-badge.offline { background: #da3633; color: white; }
    .main {
      padding: 2rem;
      display: grid;
      grid-template-columns: 300px 1fr;
      gap: 2rem;
    }
    .sidebar {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 1rem;
    }
    .agent-list { list-style: none; }
    .agent-item {
      padding: 0.75rem;
      margin-bottom: 0.5rem;
      border-radius: 6px;
      background: #21262d;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .agent-item:hover { background: #30363d; }
    .agent-name { font-weight: 500; }
    .agent-status {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }
    .agent-status.active { background: #3fb950; }
    .agent-status.idle { background: #d29922; }
    .agent-status.offline { background: #da3633; }
    .content {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 1.5rem;
    }
    .metrics {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .metric-card {
      background: #21262d;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 1rem;
      text-align: center;
    }
    .metric-value {
      font-size: 2rem;
      font-weight: 700;
      color: #58a6ff;
    }
    .metric-label {
      font-size: 0.875rem;
      color: #8b949e;
      margin-top: 0.25rem;
    }
    .message-feed {
      max-height: 400px;
      overflow-y: auto;
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 1rem;
    }
    .message-item {
      padding: 0.5rem;
      border-bottom: 1px solid #21262d;
      font-size: 0.875rem;
    }
    .message-item:last-child { border-bottom: none; }
    .timestamp { color: #6e7681; font-size: 0.75rem; }
    .connection-status {
      position: fixed;
      bottom: 1rem;
      right: 1rem;
      padding: 0.5rem 1rem;
      border-radius: 6px;
      font-size: 0.875rem;
    }
    .connection-status.connected { background: #238636; color: white; }
    .connection-status.disconnected { background: #da3633; color: white; }
  </style>
</head>
<body>
  <header class="header">
    <h1>🚀 SNAC v2 Agent Dashboard</h1>
    <div class="status">
      <span class="status-badge online">● Online</span>
      <span id="connection-count">0 connections</span>
    </div>
  </header>
  
  <main class="main">
    <aside class="sidebar">
      <h3>Active Agents</h3>
      <ul class="agent-list" id="agent-list">
        <li class="agent-item">
          <span>Loading...</span>
        </li>
      </ul>
    </aside>
    
    <section class="content">
      <div class="metrics">
        <div class="metric-card">
          <div class="metric-value" id="msg-sent">0</div>
          <div class="metric-label">Messages Sent</div>
        </div>
        <div class="metric-card">
          <div class="metric-value" id="msg-recv">0</div>
          <div class="metric-label">Messages Received</div>
        </div>
        <div class="metric-card">
          <div class="metric-value" id="active-agents">0</div>
          <div class="metric-label">Active Agents</div>
        </div>
        <div class="metric-card">
          <div class="metric-value" id="connections">0</div>
          <div class="metric-label">WebSocket Connections</div>
        </div>
      </div>
      
      <h3>Recent Activity</h3>
      <div class="message-feed" id="message-feed">
        <div class="message-item">Waiting for messages...</div>
      </div>
    </section>
  </main>
  
  <div class="connection-status disconnected" id="connection-status">Disconnected</div>

  <script>
    const ws = new WebSocket('ws://localhost:${this.port}');
    const messageFeed = document.getElementById('message-feed');
    const connectionStatus = document.getElementById('connection-status');
    const agentList = document.getElementById('agent-list');
    
    let reconnectInterval;
    
    ws.onopen = () => {
      console.log('Connected to dashboard');
      connectionStatus.textContent = 'Connected';
      connectionStatus.className = 'connection-status connected';
      clearInterval(reconnectInterval);
    };
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === 'init') {
        updateAgentList(data.agents);
        updateMetrics(data.metrics);
      }
      
      if (data.type === 'agents-update') {
        updateAgentList(data.agents);
      }
      
      if (data.message) {
        addMessage(data);
      }
    };
    
    ws.onclose = () => {
      console.log('Disconnected from dashboard');
      connectionStatus.textContent = 'Disconnected';
      connectionStatus.className = 'connection-status disconnected';
      
      // Attempt to reconnect
      reconnectInterval = setInterval(() => {
        console.log('Attempting to reconnect...');
        location.reload();
      }, 5000);
    };
    
    function updateAgentList(agents) {
      agentList.innerHTML = agents.map(([id, data]) => \`
        <li class="agent-item">
          <span class="agent-name">\${id}</span>
          <span class="agent-status \${data.status || 'offline'}"></span>
        </li>
      \`).join('');
      
      document.getElementById('active-agents').textContent = 
        agents.filter(([_, d]) => d.status === 'active').length;
    }
    
    function updateMetrics(metrics) {
      document.getElementById('msg-sent').textContent = metrics.messagesSent || 0;
      document.getElementById('msg-recv').textContent = metrics.messagesReceived || 0;
      document.getElementById('connections').textContent = metrics.activeConnections || 0;
    }
    
    function addMessage(data) {
      const item = document.createElement('div');
      item.className = 'message-item';
      item.innerHTML = \`
        <span class="timestamp">\${new Date().toLocaleTimeString()}</span>
        <strong>\${data.from}:</strong> \${data.message || 'New activity'}
      \`;
      messageFeed.insertBefore(item, messageFeed.firstChild);
      
      // Keep only last 50 messages
      while (messageFeed.children.length > 50) {
        messageFeed.removeChild(messageFeed.lastChild);
      }
    }
    
    // Send periodic pings
    setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);
  </script>
</body>
</html>`;
  }

  stop() {
    if (this.wss) {
      this.wss.close();
    }
    if (this.server) {
      this.server.close();
    }
    console.log('Dashboard server stopped');
  }
}

// Run if called directly
if (require.main === module) {
  const dashboard = new DashboardServer();
  dashboard.start().catch(err => {
    console.error('Failed to start dashboard:', err);
    process.exit(1);
  });
  
  // Graceful shutdown
  process.on('SIGTERM', () => dashboard.stop());
  process.on('SIGINT', () => dashboard.stop());
}

module.exports = { DashboardServer };
