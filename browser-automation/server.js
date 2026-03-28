/**
 * Browser Agent Server - Express + WebSocket for real-time browser testing
 * JavaScript version - no TypeScript compilation needed
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { BrowserTestOrchestrator } from './BrowserTestOrchestrator.js';
import { ParallelAgentRunner } from './ParallelAgentRunner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class BrowserAgentServer {
  constructor() {
    this.app = express();
    this.server = createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server, path: '/ws' });
    this.orchestrator = new BrowserTestOrchestrator();
    this.swarmRunner = new ParallelAgentRunner({ maxAgents: 50, maxConcurrency: 10 });
    this.clients = new Set();
    this.services = [];
    this.envConfig = this.detectEnvironment();
    this.setupServices();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
    this.setupEventListeners();
  }

  detectEnvironment() {
    const vpsHost = process.env.VPS_HOST || 'snac.deliberatefederation.cloud';
    const cockpitUrl = process.env.COCKPIT_URL || `https://${vpsHost}:9090`;
    const backendUrl = process.env.BACKEND_URL || `http://${vpsHost}:8000`;
    
    let dockerEnabled = false;
    try {
      dockerEnabled = process.env.DOCKER_ENABLED === 'true' || 
                     (await import('fs')).default.existsSync('/.dockerenv');
    } catch {}

    const isVps = process.env.IS_VPS === 'true' || 
                  (vpsHost !== 'localhost' && !vpsHost.includes('127.0.0.1'));

    return { vpsHost, cockpitUrl, backendUrl, dockerEnabled, isVps, isDocker: dockerEnabled };
  }

  setupServices() {
    this.services = [
      { name: 'Backend API', url: `${this.envConfig.backendUrl}/health`, type: 'backend', expectedText: 'ok' },
      { name: 'Agent Endpoint', url: `${this.envConfig.backendUrl}/free-coding-agent/run`, type: 'api' },
      { name: 'Cockpit', url: this.envConfig.cockpitUrl, type: 'cockpit', expectedSelector: 'body', loginRequired: true }
    ];

    if (process.env.ORACLE_CLOUD_URL) {
      this.services.push({ name: 'Oracle Cloud', url: process.env.ORACLE_CLOUD_URL, type: 'frontend', expectedSelector: 'body' });
    }
  }

  setupMiddleware() {
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname)));
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
      next();
    });
  }

  setupRoutes() {
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', agent: 'browser-automation', environment: this.envConfig, timestamp: new Date().toISOString() });
    });

    this.app.get('/api/services', (req, res) => res.json(this.services));
    this.app.get('/api/environment', (req, res) => res.json(this.envConfig));

    this.app.post('/api/test/service', async (req, res) => {
      const { name, url, expectedText, expectedSelector } = req.body;
      try {
        const result = await this.orchestrator.testEndpoint(name, url, { expectedText, expectedSelector });
        this.broadcast({ type: 'test:complete', service: name, status: result.status, result });
        res.json(result);
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/test/cockpit', async (req, res) => {
      const { username, password } = req.body;
      try {
        const result = await this.orchestrator.testCockpit(undefined, username && password ? { username, password } : undefined);
        this.broadcast({ type: 'test:complete', service: 'cockpit', status: result.status, result });
        res.json(result);
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/test/production', async (req, res) => {
      try {
        const credentials = req.body.credentials;
        const serviceConfigs = this.services.map(s => ({
          name: s.name, url: s.url, expectedText: s.expectedText,
          expectedSelector: s.expectedSelector, loginRequired: s.loginRequired && credentials,
          username: credentials?.username, password: credentials?.password
        }));

        this.broadcast({ type: 'production-check:start', serviceCount: serviceConfigs.length });
        const status = await this.orchestrator.runProductionCheck(serviceConfigs);
        this.broadcast({ type: 'production-check:complete', ...status });
        res.json(status);
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/test/swarm', async (req, res) => {
      const { agents, config } = req.body;
      try {
        this.swarmRunner = new ParallelAgentRunner({
          maxAgents: config?.maxAgents || 50, maxConcurrency: config?.maxConcurrency || 10,
          swarmMode: config?.mode || 'parallel', retryFailed: config?.retryFailed ?? true
        });
        this.setupSwarmListeners();
        const results = await this.swarmRunner.runSwarm(agents);
        res.json(results);
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/agent/chat', async (req, res) => {
      const { message } = req.body;
      let response = '';
      const lowerMsg = message.toLowerCase();
      
      if (lowerMsg.includes('status')) {
        const status = this.orchestrator.getTestHistory();
        const lastTest = status[status.length - 1];
        response = lastTest ? `Last test: ${lastTest.service} - ${lastTest.status} (${lastTest.responseTime}ms)` : 'No tests run yet.';
      } else if (lowerMsg.includes('hello') || lowerMsg.includes('hi')) {
        response = "Hello! I'm your browser testing agent. Say 'test all' or 'test cockpit'.";
      } else if (lowerMsg.includes('help')) {
        response = 'Commands: "test all", "test cockpit", "test backend", "status", "swarm"';
      } else {
        response = "I'm ready to test. Say 'test all' to begin a full production check.";
      }
      res.json({ response });
    });

    this.app.get('/api/test/history', (req, res) => res.json(this.orchestrator.getTestHistory()));
    this.app.get('/cockpit', (req, res) => res.sendFile(path.join(__dirname, 'cockpit-chat.html')));
    this.app.get('/', (req, res) => res.redirect('/cockpit'));
  }

  setupWebSocket() {
    this.wss.on('connection', (ws) => {
      console.log('WebSocket client connected');
      this.clients.add(ws);
      
      ws.send(JSON.stringify({
        type: 'connection', message: 'Connected to Kilo Browser Agent',
        environment: this.envConfig, services: this.services
      }));

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          this.handleWebSocketMessage(ws, message);
        } catch (err) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
        }
      });

      ws.on('close', () => this.clients.delete(ws));
    });
  }

  async handleWebSocketMessage(ws, message) {
    switch (message.type) {
      case 'test:service':
        ws.send(JSON.stringify({ type: 'test:start', service: message.name }));
        try {
          const result = await this.orchestrator.testEndpoint(message.name, message.url);
          ws.send(JSON.stringify({ type: 'test:complete', service: message.name, status: result.status, result }));
        } catch (error) {
          ws.send(JSON.stringify({ type: 'test:error', service: message.name, error: error.message }));
        }
        break;
      case 'test:production':
        ws.send(JSON.stringify({ type: 'production-check:start', serviceCount: this.services.length }));
        try {
          const serviceConfigs = this.services.map(s => ({ name: s.name, url: s.url, expectedText: s.expectedText, expectedSelector: s.expectedSelector }));
          const status = await this.orchestrator.runProductionCheck(serviceConfigs);
          ws.send(JSON.stringify({ type: 'production-check:complete', ...status }));
        } catch (error) {
          ws.send(JSON.stringify({ type: 'production-check:error', error: error.message }));
        }
        break;
      case 'chat':
        ws.send(JSON.stringify({ type: 'chat:response', message: "I'm ready to help test your services." }));
        break;
    }
  }

  setupEventListeners() {
    this.orchestrator.on('test:start', (data) => this.broadcast({ type: 'test:start', ...data }));
    this.orchestrator.on('test:complete', (data) => this.broadcast({ type: 'test:complete', ...data }));
    this.orchestrator.on('production-check:start', (data) => this.broadcast({ type: 'production-check:start', ...data }));
    this.orchestrator.on('production-check:complete', (data) => this.broadcast({ type: 'production-check:complete', ...data }));
  }

  setupSwarmListeners() {
    this.swarmRunner.on('swarm:start', (data) => this.broadcast({ type: 'swarm:start', ...data }));
    this.swarmRunner.on('swarm:complete', (data) => this.broadcast({ type: 'swarm:complete', ...data }));
    this.swarmRunner.on('agent:start', (data) => this.broadcast({ type: 'agent:start', ...data }));
    this.swarmRunner.on('agent:complete', (data) => this.broadcast({ type: 'agent:complete', ...data }));
  }

  broadcast(data) {
    const message = JSON.stringify(data);
    this.clients.forEach(client => {
      if (client.readyState === 1) client.send(message);
    });
  }

  start(port = 8020) {
    this.server.listen(port, () => {
      console.log(`
╔══════════════════════════════════════════════════════════╗
║        🚀 KILO BROWSER AGENT SERVER                      ║
╠══════════════════════════════════════════════════════════╣
║  Server running on port ${port}                           ║
║                                                          ║
║  Cockpit UI:    http://localhost:${port}/cockpit          ║
║  Health:        http://localhost:${port}/health           ║
║  API:           http://localhost:${port}/api              ║
║                                                          ║
║  Environment:   ${this.envConfig.isVps ? 'VPS' : 'Local'} (${this.envConfig.isDocker ? 'Docker' : 'Native'})
║  Cockpit URL:   ${this.envConfig.cockpitUrl}
║  Backend URL:   ${this.envConfig.backendUrl}
╚══════════════════════════════════════════════════════════╝
      `);
    });
  }
}

const server = new BrowserAgentServer();
const PORT = parseInt(process.env.BROWSER_AGENT_PORT || '8020', 10);
server.start(PORT);
