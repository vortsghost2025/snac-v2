/**
 * Browser Agent Server - Express + WebSocket server for real-time browser testing
 * Serves the cockpit chat interface and handles agent commands
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { BrowserTestOrchestrator, ServiceStatus } from './BrowserTestOrchestrator.js';
import { ParallelAgentRunner, AgentConfig, SwarmResults } from './ParallelAgentRunner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Types
interface ServiceConfig {
  name: string;
  url: string;
  type: 'cockpit' | 'backend' | 'api' | 'frontend';
  expectedText?: string;
  expectedSelector?: string;
  loginRequired?: boolean;
}

interface EnvironmentConfig {
  vpsHost: string;
  cockpitUrl: string;
  backendUrl: string;
  dockerEnabled: boolean;
  isVps: boolean;
  isDocker: boolean;
}

class BrowserAgentServer {
  private app: express.Application;
  private server: ReturnType<typeof createServer>;
  private wss: WebSocketServer;
  private orchestrator: BrowserTestOrchestrator;
  private swarmRunner: ParallelAgentRunner;
  private clients: Set<WebSocket> = new Set();
  private services: ServiceConfig[] = [];
  private envConfig: EnvironmentConfig;

  constructor() {
    this.app = express();
    this.server = createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server, path: '/ws' });
    this.orchestrator = new BrowserTestOrchestrator();
    this.swarmRunner = new ParallelAgentRunner({ maxAgents: 50, maxConcurrency: 10 });
    this.envConfig = this.detectEnvironment();
    this.setupServices();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
    this.setupEventListeners();
  }

  /**
   * Detect environment - VPS, Docker, local
   */
  private detectEnvironment(): EnvironmentConfig {
    const vpsHost = process.env.VPS_HOST || 'snac.deliberatefederation.cloud';
    const cockpitUrl = process.env.COCKPIT_URL || `https://${vpsHost}:9090`;
    const backendUrl = process.env.BACKEND_URL || `http://${vpsHost}:8000`;
    
    // Check if running in Docker
    const dockerEnabled = process.env.DOCKER_ENABLED === 'true' || 
                         require('fs').existsSync('/.dockerenv') ||
                         require('fs').readFileSync('/proc/1/cgroup', 'utf8').includes('docker');

    // Check if running on VPS (vs local)
    const isVps = process.env.IS_VPS === 'true' || 
                  vpsHost !== 'localhost' && !vpsHost.includes('127.0.0.1');

    return {
      vpsHost,
      cockpitUrl,
      backendUrl,
      dockerEnabled,
      isVps,
      isDocker: dockerEnabled
    };
  }

  /**
   * Setup default services based on environment
   */
  private setupServices(): void {
    this.services = [
      {
        name: 'Backend API',
        url: `${this.envConfig.backendUrl}/health`,
        type: 'backend',
        expectedText: 'ok'
      },
      {
        name: 'Agent Endpoint',
        url: `${this.envConfig.backendUrl}/free-coding-agent/run`,
        type: 'api'
      },
      {
        name: 'Cockpit',
        url: this.envConfig.cockpitUrl,
        type: 'cockpit',
        expectedSelector: 'body',
        loginRequired: true
      }
    ];

    // Add Oracle Cloud if configured
    if (process.env.ORACLE_CLOUD_URL) {
      this.services.push({
        name: 'Oracle Cloud',
        url: process.env.ORACLE_CLOUD_URL,
        type: 'frontend',
        expectedSelector: 'body'
      });
    }

    // Add Hostinger VPS services if detected
    if (this.envConfig.isVps) {
      this.services.push({
        name: 'Hostinger VPS',
        url: `http://${this.envConfig.vpsHost}:80`,
        type: 'frontend',
        expectedSelector: 'body'
      });
    }
  }

  private setupMiddleware(): void {
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname)));
    
    // CORS for external access
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
      next();
    });
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        agent: 'browser-automation',
        environment: this.envConfig,
        timestamp: new Date().toISOString()
      });
    });

    // Get service list
    this.app.get('/api/services', (req, res) => {
      res.json(this.services);
    });

    // Get environment info
    this.app.get('/api/environment', (req, res) => {
      res.json(this.envConfig);
    });

    // Test a single service
    this.app.post('/api/test/service', async (req, res) => {
      const { name, url, expectedText, expectedSelector } = req.body;
      
      try {
        const result = await this.orchestrator.testEndpoint(name, url, {
          expectedText,
          expectedSelector
        });
        
        // Broadcast to all connected clients
        this.broadcast({
          type: 'test:complete',
          service: name,
          status: result.status,
          result
        });
        
        res.json(result);
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });

    // Test cockpit specifically
    this.app.post('/api/test/cockpit', async (req, res) => {
      const { username, password } = req.body;
      
      try {
        const result = await this.orchestrator.testCockpit(undefined, 
          username && password ? { username, password } : undefined
        );
        
        this.broadcast({
          type: 'test:complete',
          service: 'cockpit',
          status: result.status,
          result
        });
        
        res.json(result);
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });

    // Run production check on all services
    this.app.post('/api/test/production', async (req, res) => {
      try {
        const credentials = req.body.credentials;
        
        const serviceConfigs = this.services.map(s => ({
          name: s.name,
          url: s.url,
          expectedText: s.expectedText,
          expectedSelector: s.expectedSelector,
          loginRequired: s.loginRequired && credentials,
          username: credentials?.username,
          password: credentials?.password
        }));

        this.broadcast({
          type: 'production-check:start',
          serviceCount: serviceConfigs.length
        });

        const status = await this.orchestrator.runProductionCheck(serviceConfigs);
        
        this.broadcast({
          type: 'production-check:complete',
          ...status
        });
        
        res.json(status);
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });

    // Run swarm test
    this.app.post('/api/test/swarm', async (req, res) => {
      const { agents, config } = req.body;
      
      try {
        this.swarmRunner = new ParallelAgentRunner({
          maxAgents: config?.maxAgents || 50,
          maxConcurrency: config?.maxConcurrency || 10,
          swarmMode: config?.mode || 'parallel',
          retryFailed: config?.retryFailed ?? true
        });

        this.setupSwarmListeners();

        const results = await this.swarmRunner.runSwarm(agents);
        res.json(results);
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });

    // Agent chat endpoint
    this.app.post('/api/agent/chat', async (req, res) => {
      const { message } = req.body;
      
      // Simple command processing
      let response = '';
      const lowerMsg = message.toLowerCase();
      
      if (lowerMsg.includes('status')) {
        const status = this.orchestrator.getTestHistory();
        const lastTest = status[status.length - 1];
        response = lastTest 
          ? `Last test: ${lastTest.service} - ${lastTest.status} (${lastTest.responseTime}ms)`
          : 'No tests run yet. Run a test first.';
      } else if (lowerMsg.includes('hello') || lowerMsg.includes('hi')) {
        response = 'Hello! I\'m your browser testing agent. I can test your cockpit, backend, and all services. Just ask me to "test all" or "test cockpit".';
      } else if (lowerMsg.includes('help')) {
        response = 'Available commands:\n- "test all" - Run production check\n- "test cockpit" - Test cockpit connection\n- "test backend" - Test backend API\n- "status" - Get last test status\n- "swarm" - Run 50 parallel agents';
      } else {
        response = 'I understand. I\'m ready to test when you are. Say "test all" to begin a full production check, or ask me to test specific services.';
      }
      
      res.json({ response });
    });

    // Get test history
    this.app.get('/api/test/history', (req, res) => {
      res.json(this.orchestrator.getTestHistory());
    });

    // Serve the cockpit HTML
    this.app.get('/cockpit', (req, res) => {
      res.sendFile(path.join(__dirname, 'cockpit-chat.html'));
    });

    // Default route - redirect to cockpit
    this.app.get('/', (req, res) => {
      res.redirect('/cockpit');
    });
  }

  private setupWebSocket(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      console.log('WebSocket client connected');
      this.clients.add(ws);

      // Send initial status
      ws.send(JSON.stringify({
        type: 'connection',
        message: 'Connected to Kilo Browser Agent',
        environment: this.envConfig,
        services: this.services
      }));

      ws.on('message', (data: string) => {
        try {
          const message = JSON.parse(data);
          this.handleWebSocketMessage(ws, message);
        } catch (err) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Invalid message format'
          }));
        }
      });

      ws.on('close', () => {
        console.log('WebSocket client disconnected');
        this.clients.delete(ws);
      });
    });
  }

  private handleWebSocketMessage(ws: WebSocket, message: any): void {
    switch (message.type) {
      case 'test:service':
        this.handleTestService(ws, message);
        break;
      case 'test:production':
        this.handleProductionCheck(ws, message);
        break;
      case 'test:swarm':
        this.handleSwarmTest(ws, message);
        break;
      case 'chat':
        this.handleChat(ws, message);
        break;
      default:
        ws.send(JSON.stringify({
          type: 'error',
          message: `Unknown message type: ${message.type}`
        }));
    }
  }

  private async handleTestService(ws: WebSocket, message: any): Promise<void> {
    const { name, url } = message;
    
    ws.send(JSON.stringify({ type: 'test:start', service: name }));
    
    try {
      const result = await this.orchestrator.testEndpoint(name, url);
      ws.send(JSON.stringify({
        type: 'test:complete',
        service: name,
        status: result.status,
        result
      }));
    } catch (error) {
      ws.send(JSON.stringify({
        type: 'test:error',
        service: name,
        error: error instanceof Error ? error.message : String(error)
      }));
    }
  }

  private async handleProductionCheck(ws: WebSocket, message: any): Promise<void> {
    ws.send(JSON.stringify({
      type: 'production-check:start',
      serviceCount: this.services.length
    }));

    try {
      const serviceConfigs = this.services.map(s => ({
        name: s.name,
        url: s.url,
        expectedText: s.expectedText,
        expectedSelector: s.expectedSelector
      }));

      const status = await this.orchestrator.runProductionCheck(serviceConfigs);
      
      ws.send(JSON.stringify({
        type: 'production-check:complete',
        ...status
      }));
    } catch (error) {
      ws.send(JSON.stringify({
        type: 'production-check:error',
        error: error instanceof Error ? error.message : String(error)
      }));
    }
  }

  private async handleSwarmTest(ws: WebSocket, message: any): Promise<void> {
    const { count = 50, targetUrl } = message;
    
    ws.send(JSON.stringify({
      type: 'swarm:start',
      agentCount: count
    }));

    try {
      // Create agent configs
      const agents: AgentConfig[] = Array.from({ length: count }, (_, i) => ({
        id: `swarm-agent-${i + 1}`,
        name: `Swarm Agent ${i + 1}`,
        targetUrl: targetUrl || this.envConfig.backendUrl,
        expectedText: 'ok',
        timeoutMs: 30000,
        retryCount: 1
      }));

      this.setupSwarmListeners();
      const results = await this.swarmRunner.runSwarm(agents);
      
      ws.send(JSON.stringify({
        type: 'swarm:complete',
        ...results
      }));
    } catch (error) {
      ws.send(JSON.stringify({
        type: 'swarm:error',
        error: error instanceof Error ? error.message : String(error)
      }));
    }
  }

  private async handleChat(ws: WebSocket, message: any): Promise<void> {
    const { text } = message;
    
    // Process chat message and respond
    let response = '';
    const lowerText = text.toLowerCase();
    
    if (lowerText.includes('test')) {
      response = 'I can run tests for you. Use the buttons below or say "test all" to check everything.';
    } else {
      response = 'I\'m here to help test your services. What would you like me to check?';
    }
    
    ws.send(JSON.stringify({
      type: 'chat:response',
      message: response
    }));
  }

  private setupEventListeners(): void {
    // Forward orchestrator events to WebSocket clients
    this.orchestrator.on('test:start', (data) => {
      this.broadcast({ type: 'test:start', ...data });
    });

    this.orchestrator.on('test:complete', (data) => {
      this.broadcast({ type: 'test:complete', ...data });
    });

    this.orchestrator.on('production-check:start', (data) => {
      this.broadcast({ type: 'production-check:start', ...data });
    });

    this.orchestrator.on('production-check:complete', (data) => {
      this.broadcast({ type: 'production-check:complete', ...data });
    });
  }

  private setupSwarmListeners(): void {
    this.swarmRunner.on('swarm:start', (data) => {
      this.broadcast({ type: 'swarm:start', ...data });
    });

    this.swarmRunner.on('swarm:complete', (data) => {
      this.broadcast({ type: 'swarm:complete', ...data });
    });

    this.swarmRunner.on('agent:start', (data) => {
      this.broadcast({ type: 'agent:start', ...data });
    });

    this.swarmRunner.on('agent:complete', (data) => {
      this.broadcast({ type: 'agent:complete', ...data });
    });
  }

  private broadcast(data: any): void {
    const message = JSON.stringify(data);
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  start(port: number = 8020): void {
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

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.wss.close();
      this.server.close(() => {
        console.log('Server stopped');
        resolve();
      });
    });
  }
}

// Start the server
const server = new BrowserAgentServer();
const PORT = parseInt(process.env.BROWSER_AGENT_PORT || '8020', 10);
server.start(PORT);

export { BrowserAgentServer };
