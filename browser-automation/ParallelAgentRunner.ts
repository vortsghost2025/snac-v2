/**
 * Parallel Agent Runner - Handles 50+ parallel agents with swarm support
 * Manages concurrent browser testing across multiple endpoints
 */

import { BrowserTestOrchestrator, TestResult, ServiceStatus } from './BrowserTestOrchestrator.js';
import { EventEmitter } from 'events';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

export interface AgentConfig {
  id: string;
  name: string;
  targetUrl: string;
  expectedText?: string;
  expectedSelector?: string;
  loginRequired?: boolean;
  username?: string;
  password?: string;
  retryCount?: number;
  timeoutMs?: number;
}

export interface SwarmConfig {
  maxAgents: number;
  maxConcurrency: number;
  retryFailed: boolean;
  swarmMode: 'sequential' | 'parallel' | 'burst';
  burstSize?: number;
}

export interface AgentResult {
  agentId: string;
  agentName: string;
  results: TestResult[];
  completedAt: string;
  executionTime: number;
}

export interface SwarmResults {
  totalAgents: number;
  completed: number;
  failed: number;
  totalExecutionTime: number;
  agents: AgentResult[];
  allPassed: boolean;
  timestamp: string;
}

export class ParallelAgentRunner extends EventEmitter {
  private config: SwarmConfig;
  private activeAgents: Map<string, BrowserTestOrchestrator> = new Map();
  private results: AgentResult[] = [];
  private isRunning: boolean = false;

  constructor(config: Partial<SwarmConfig> = {}) {
    super();
    this.config = {
      maxAgents: config.maxAgents ?? 50,
      maxConcurrency: config.maxConcurrency ?? 10,
      retryFailed: config.retryFailed ?? true,
      swarmMode: config.swarmMode ?? 'parallel',
      burstSize: config.burstSize ?? 20
    };
  }

  /**
   * Run a swarm of agents to test multiple services concurrently
   */
  async runSwarm(agents: AgentConfig[]): Promise<SwarmResults> {
    if (this.isRunning) {
      throw new Error('Swarm already running. Wait for completion or stop current swarm.');
    }

    this.isRunning = true;
    this.results = [];
    this.activeAgents.clear();

    const startTime = Date.now();
    this.emit('swarm:start', { agentCount: agents.length, mode: this.config.swarmMode });

    try {
      let results: AgentResult[] = [];

      switch (this.config.swarmMode) {
        case 'sequential':
          results = await this.runSequential(agents);
          break;
        case 'parallel':
          results = await this.runParallel(agents);
          break;
        case 'burst':
          results = await this.runBurst(agents);
          break;
        default:
          results = await this.runParallel(agents);
      }

      const completed = results.filter(r => r.results.every(res => res.status === 'connected')).length;
      const failed = results.length - completed;

      const swarmResults: SwarmResults = {
        totalAgents: agents.length,
        completed,
        failed,
        totalExecutionTime: Date.now() - startTime,
        agents: results,
        allPassed: failed === 0,
        timestamp: new Date().toISOString()
      };

      this.emit('swarm:complete', swarmResults);
      this.isRunning = false;

      return swarmResults;

    } catch (error) {
      this.isRunning = false;
      this.emit('swarm:error', error);
      throw error;
    }
  }

  /**
   * Run agents sequentially (one at a time)
   * Use this for debugging or when resources are limited
   */
  private async runSequential(agents: AgentConfig[]): Promise<AgentResult[]> {
    const results: AgentResult[] = [];

    for (const agent of agents) {
      this.emit('agent:start', { agentId: agent.id, agentName: agent.name });
      
      const result = await this.runSingleAgent(agent);
      results.push(result);
      
      this.emit('agent:complete', { agentId: agent.id, result });
    }

    return results;
  }

  /**
   * Run agents in parallel with controlled concurrency
   * Best for 50+ agents testing different services
   */
  private async runParallel(agents: AgentConfig[]): Promise<AgentResult[]> {
    const results: AgentResult[] = [];
    const chunks = this.chunkArray(agents, this.config.maxConcurrency);

    for (const chunk of chunks) {
      this.emit('batch:start', { size: chunk.length });
      
      // Run chunk in parallel
      const batchResults = await Promise.all(
        chunk.map(agent => {
          this.emit('agent:start', { agentId: agent.id, agentName: agent.name });
          return this.runSingleAgent(agent);
        })
      );

      results.push(...batchResults);
      
      batchResults.forEach((result, idx) => {
        this.emit('agent:complete', { agentId: chunk[idx].id, result });
      });
      
      this.emit('batch:complete', { size: chunk.length });

      // Small delay between batches to prevent overwhelming
      await this.delay(100);
    }

    return results;
  }

  /**
   * Run agents in burst mode (all at once)
   * Use this for stress testing only
   */
  private async runBurst(agents: AgentConfig[]): Promise<AgentResult[]> {
    const burstSize = this.config.burstSize || 20;
    const chunks = this.chunkArray(agents, burstSize);
    const results: AgentResult[] = [];

    for (const chunk of chunks) {
      this.emit('burst:start', { size: chunk.length });

      const promises = chunk.map(agent => {
        this.emit('agent:start', { agentId: agent.id, agentName: agent.name });
        return this.runSingleAgent(agent).then(result => {
          this.emit('agent:complete', { agentId: agent.id, result });
          return result;
        });
      });

      const batchResults = await Promise.all(promises);
      results.push(...batchResults);

      this.emit('burst:complete', { size: chunk.length });
    }

    return results;
  }

  /**
   * Run a single agent with retry logic
   */
  private async runSingleAgent(config: AgentConfig): Promise<AgentResult> {
    const startTime = Date.now();
    const orchestrator = new BrowserTestOrchestrator({
      headless: true,
      timeoutMs: config.timeoutMs || 30000,
      screenshotOnFailure: true,
      screenshotOnSuccess: false
    });

    this.activeAgents.set(config.id, orchestrator);

    try {
      let result: TestResult;
      let attempts = 0;
      const maxAttempts = (config.retryCount ?? 0) + 1;

      do {
        attempts++;
        
        result = await orchestrator.testEndpoint(config.targetUrl, config.targetUrl, {
          expectedText: config.expectedText,
          expectedSelector: config.expectedSelector,
          loginRequired: config.loginRequired,
          username: config.username,
          password: config.password
        });

        if (result.status === 'connected' || attempts >= maxAttempts) {
          break;
        }

        // Wait before retry
        await this.delay(1000 * attempts);
        
      } while (attempts < maxAttempts);

      await orchestrator.close();
      this.activeAgents.delete(config.id);

      return {
        agentId: config.id,
        agentName: config.name,
        results: [result],
        completedAt: new Date().toISOString(),
        executionTime: Date.now() - startTime
      };

    } catch (error) {
      await orchestrator.close().catch(() => {});
      this.activeAgents.delete(config.id);

      const errorResult: TestResult = {
        service: config.name,
        url: config.targetUrl,
        status: 'error',
        responseTime: Date.now() - startTime,
        actualTest: 'Agent execution',
        details: `Agent failed: ${error instanceof Error ? error.message : String(error)}`,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      };

      return {
        agentId: config.id,
        agentName: config.name,
        results: [errorResult],
        completedAt: new Date().toISOString(),
        executionTime: Date.now() - startTime
      };
    }
  }

  /**
   * Stop all running agents
   */
  async stopAll(): Promise<void> {
    this.emit('swarm:stopping', { activeAgents: this.activeAgents.size });
    
    const stopPromises = Array.from(this.activeAgents.values()).map(async (agent) => {
      try {
        await agent.close();
      } catch (err) {
        // Ignore cleanup errors
      }
    });

    await Promise.all(stopPromises);
    this.activeAgents.clear();
    this.isRunning = false;
    
    this.emit('swarm:stopped');
  }

  /**
   * Get current swarm status
   */
  getStatus(): {
    isRunning: boolean;
    activeAgents: number;
    completedResults: number;
  } {
    return {
      isRunning: this.isRunning,
      activeAgents: this.activeAgents.size,
      completedResults: this.results.length
    };
  }

  /**
   * Generate swarm report
   */
  generateSwarmReport(results: SwarmResults): string {
    let report = `# 🐝 SWARM TEST REPORT\n\n`;
    report += `**Mode:** ${this.config.swarmMode.toUpperCase()}\n`;
    report += `**Total Agents:** ${results.totalAgents}\n`;
    report += `**Passed:** ${results.completed}\n`;
    report += `**Failed:** ${results.failed}\n`;
    report += `**Total Time:** ${results.totalExecutionTime}ms\n`;
    report += `**All Passed:** ${results.allPassed ? '✅ YES' : '❌ NO'}\n\n`;
    report += `---\n\n`;

    report += `## Agent Details\n\n`;
    
    for (const agent of results.agents) {
      const result = agent.results[0];
      const icon = result.status === 'connected' ? '✅' :
                   result.status === 'failed' ? '❌' : '💥';
      
      report += `### ${icon} ${agent.agentName} (${agent.agentId})\n`;
      report += `- **Status:** ${result.status}\n`;
      report += `- **URL:** ${result.url}\n`;
      report += `- **Response Time:** ${result.responseTime}ms\n`;
      report += `- **Execution Time:** ${agent.executionTime}ms\n`;
      
      if (result.error) {
        report += `- **Error:** ${result.error}\n`;
      }
      
      report += `\n`;
    }

    return report;
  }

  /**
   * Create agent configurations for common scenarios
   */
  static createServiceAgents(
    services: Array<{ name: string; url: string; type?: string }>,
    options: { 
      withLogin?: boolean; 
      credentials?: { username: string; password: string };
      timeoutMs?: number;
    } = {}
  ): AgentConfig[] {
    return services.map((service, index) => ({
      id: `agent-${index + 1}`,
      name: service.name,
      targetUrl: service.url,
      expectedText: service.type === 'api' ? 'ok' : undefined,
      expectedSelector: service.type === 'cockpit' ? 'body' : undefined,
      loginRequired: options.withLogin && service.type === 'cockpit',
      username: options.credentials?.username,
      password: options.credentials?.password,
      timeoutMs: options.timeoutMs || 30000,
      retryCount: 2
    }));
  }

  // Private helpers

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Worker thread runner for CPU-intensive parallel execution
 * Used when running 200+ agents to distribute across CPU cores
 */
export class WorkerAgentRunner extends EventEmitter {
  private workers: Worker[] = [];
  private results: AgentResult[] = [];
  private pendingAgents: number = 0;

  async runDistributed(agents: AgentConfig[]): Promise<SwarmResults> {
    const cpuCount = os.cpus().length;
    const workersNeeded = Math.min(cpuCount, Math.ceil(agents.length / 10));
    
    this.emit('distributed:start', { 
      agents: agents.length, 
      workers: workersNeeded,
      cpus: cpuCount 
    });

    const startTime = Date.now();
    const chunks = this.chunkArray(agents, Math.ceil(agents.length / workersNeeded));

    // Create workers
    const workerPromises = chunks.map((chunk, index) => 
      this.createWorker(chunk, index)
    );

    const workerResults = await Promise.all(workerPromises);
    const allResults = workerResults.flat();

    const completed = allResults.filter(r => r.results.every(res => res.status === 'connected')).length;
    
    const swarmResults: SwarmResults = {
      totalAgents: agents.length,
      completed,
      failed: allResults.length - completed,
      totalExecutionTime: Date.now() - startTime,
      agents: allResults,
      allPassed: completed === allResults.length,
      timestamp: new Date().toISOString()
    };

    this.emit('distributed:complete', swarmResults);
    return swarmResults;
  }

  private createWorker(agentChunk: AgentConfig[], workerId: number): Promise<AgentResult[]> {
    return new Promise((resolve, reject) => {
      // Note: In production, this would spawn actual worker threads
      // For now, we simulate with direct execution
      const runner = new ParallelAgentRunner({
        maxConcurrency: 5,
        swarmMode: 'parallel'
      });

      runner.runSwarm(agentChunk).then(results => {
        resolve(results.agents);
      }).catch(reject);
    });
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
