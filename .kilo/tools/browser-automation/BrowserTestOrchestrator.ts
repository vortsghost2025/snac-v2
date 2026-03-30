/**
 * Browser Test Orchestrator - Real endpoint verification with browser automation
 * Provides 100% truthful status reports - no fake "connected" when services don't work
 */

import { BrowserController, PageState } from './BrowserController.js';
import { EventEmitter } from 'events';

export interface TestResult {
  service: string;
  url: string;
  status: 'connected' | 'failed' | 'timeout' | 'error';
  responseTime: number;
  actualTest: string;
  details: string;
  screenshot?: string;
  error?: string;
  timestamp: string;
}

export interface ServiceStatus {
  allConnected: boolean;
  services: TestResult[];
  summary: string;
  productionReady: boolean;
  timestamp: string;
}

export interface OrchestratorConfig {
  headless?: boolean;
  timeoutMs?: number;
  screenshotOnFailure?: boolean;
  screenshotOnSuccess?: boolean;
  parallel?: boolean;
  maxConcurrent?: number;
}

export class BrowserTestOrchestrator extends EventEmitter {
  private controller: BrowserController;
  private config: OrchestratorConfig;
  private testHistory: TestResult[] = [];

  constructor(config: OrchestratorConfig = {}) {
    super();
    this.config = {
      headless: config.headless ?? false, // Default to visible for debugging
      timeoutMs: config.timeoutMs ?? 30000,
      screenshotOnFailure: config.screenshotOnFailure ?? true,
      screenshotOnSuccess: config.screenshotOnSuccess ?? false,
      parallel: config.parallel ?? false,
      maxConcurrent: config.maxConcurrent ?? 5
    };
    this.controller = new BrowserController();
  }

  /**
   * Real endpoint test - actually navigates browser to URL and verifies it loads
   * No fake "connected" status - this actually tests the service
   */
  async testEndpoint(
    name: string,
    url: string,
    options: {
      expectedText?: string;
      expectedSelector?: string;
      loginRequired?: boolean;
      username?: string;
      password?: string;
    } = {}
  ): Promise<TestResult> {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();

    this.emit('test:start', { service: name, url });

    try {
      // Step 1: Launch browser if needed
      await this.controller.launch(this.config.headless);

      // Step 2: Actually navigate to the URL (this is the real test)
      this.emit('test:navigating', { service: name, url });
      const pageState = await this.controller.openPage(url, name);

      // Step 3: Verify page loaded correctly
      if (!pageState || pageState.errors.length > 0) {
        const errorMsg = pageState?.errors.join(', ') || 'Page failed to load';
        const result: TestResult = {
          service: name,
          url,
          status: 'error',
          responseTime: Date.now() - startTime,
          actualTest: 'Browser navigation and page load',
          details: `Page loaded but has errors: ${errorMsg}`,
          error: errorMsg,
          timestamp
        };

        if (this.config.screenshotOnFailure) {
          result.screenshot = await this.controller.screenshot();
        }

        this.testHistory.push(result);
        this.emit('test:complete', result);
        return result;
      }

      // Step 4: Check for expected content if specified
      let verificationDetails = `Page loaded successfully. Title: "${pageState.title}"`;

      if (options.expectedText) {
        const textFound = await this.verifyTextOnPage(options.expectedText);
        if (!textFound) {
          const result: TestResult = {
            service: name,
            url,
            status: 'failed',
            responseTime: Date.now() - startTime,
            actualTest: `Verify expected text: "${options.expectedText}"`,
            details: `Page loaded but expected text not found. ${verificationDetails}`,
            error: `Expected text "${options.expectedText}" not found on page`,
            timestamp
          };

          if (this.config.screenshotOnFailure) {
            result.screenshot = await this.controller.screenshot();
          }

          this.testHistory.push(result);
          this.emit('test:complete', result);
          return result;
        }
        verificationDetails += `. Found expected text: "${options.expectedText}"`;
      }

      if (options.expectedSelector) {
        const selectorFound = await this.verifySelectorOnPage(options.expectedSelector);
        if (!selectorFound) {
          const result: TestResult = {
            service: name,
            url,
            status: 'failed',
            responseTime: Date.now() - startTime,
            actualTest: `Verify expected selector: "${options.expectedSelector}"`,
            details: `Page loaded but expected element not found. ${verificationDetails}`,
            error: `Expected selector "${options.expectedSelector}" not found on page`,
            timestamp
          };

          if (this.config.screenshotOnFailure) {
            result.screenshot = await this.controller.screenshot();
          }

          this.testHistory.push(result);
          this.emit('test:complete', result);
          return result;
        }
        verificationDetails += `. Found expected element: "${options.expectedSelector}"`;
      }

      // Step 5: Handle login if required
      if (options.loginRequired && options.username && options.password) {
        this.emit('test:login', { service: name });
        const loginSuccess = await this.controller.login(options.username, options.password);
        if (!loginSuccess) {
          const result: TestResult = {
            service: name,
            url,
            status: 'failed',
            responseTime: Date.now() - startTime,
            actualTest: 'Login with provided credentials',
            details: `Page loaded but login failed. ${verificationDetails}`,
            error: 'Login failed with provided credentials',
            timestamp
          };

          if (this.config.screenshotOnFailure) {
            result.screenshot = await this.controller.screenshot();
          }

          this.testHistory.push(result);
          this.emit('test:complete', result);
          return result;
        }
        verificationDetails += `. Login successful`;
      }

      // SUCCESS - Service is actually working
      const result: TestResult = {
        service: name,
        url,
        status: 'connected',
        responseTime: Date.now() - startTime,
        actualTest: options.loginRequired ? 'Page load + login verification' : 'Browser navigation and content verification',
        details: verificationDetails,
        timestamp
      };

      if (this.config.screenshotOnSuccess) {
        result.screenshot = await this.controller.screenshot();
      }

      this.testHistory.push(result);
      this.emit('test:complete', result);
      return result;

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const result: TestResult = {
        service: name,
        url,
        status: 'error',
        responseTime: Date.now() - startTime,
        actualTest: 'Browser navigation',
        details: `Navigation failed: ${errorMsg}`,
        error: errorMsg,
        timestamp
      };

      if (this.config.screenshotOnFailure) {
        try {
          result.screenshot = await this.controller.screenshot();
        } catch {}
      }

      this.testHistory.push(result);
      this.emit('test:complete', result);
      return result;
    }
  }

  /**
   * Test cockpit specifically - navigates to cockpit and verifies it's working
   */
  async testCockpit(url?: string, credentials?: { username: string; password: string }): Promise<TestResult> {
    const cockpitUrl = url || process.env.COCKPIT_URL || 'https://localhost:9090';

    return this.testEndpoint('cockpit', cockpitUrl, {
      expectedSelector: 'body', // Cockpit should at least have a body
      loginRequired: !!credentials,
      username: credentials?.username,
      password: credentials?.password
    });
  }

  /**
   * Test backend API - navigates to health endpoint and verifies response
   */
  async testBackend(url?: string): Promise<TestResult> {
    const backendUrl = url || process.env.BACKEND_URL || 'http://localhost:8000';
    const healthUrl = `${backendUrl}/health`;

    return this.testEndpoint('backend', healthUrl, {
      expectedText: 'ok'
    });
  }

  /**
   * Run full production readiness check
   * Tests all critical services and reports true status
   */
  async runProductionCheck(services: Array<{
    name: string;
    url: string;
    expectedText?: string;
    expectedSelector?: string;
    loginRequired?: boolean;
    username?: string;
    password?: string;
  }>): Promise<ServiceStatus> {
    this.emit('production-check:start', { serviceCount: services.length });

    const results: TestResult[] = [];

    if (this.config.parallel) {
      // Run tests in parallel with concurrency limit
      const batches = this.chunkArray(services, this.config.maxConcurrent || 5);
      for (const batch of batches) {
        const batchResults = await Promise.all(
          batch.map(s => this.testEndpoint(s.name, s.url, {
            expectedText: s.expectedText,
            expectedSelector: s.expectedSelector,
            loginRequired: s.loginRequired,
            username: s.username,
            password: s.password
          }))
        );
        results.push(...batchResults);
      }
    } else {
      // Run tests sequentially
      for (const service of services) {
        const result = await this.testEndpoint(service.name, service.url, {
          expectedText: service.expectedText,
          expectedSelector: service.expectedSelector,
          loginRequired: service.loginRequired,
          username: service.username,
          password: service.password
        });
        results.push(result);
      }
    }

    const allConnected = results.every(r => r.status === 'connected');
    const failedServices = results.filter(r => r.status !== 'connected');

    const summary = allConnected
      ? `✅ All ${results.length} services are PRODUCTION READY`
      : `❌ ${failedServices.length}/${results.length} services failed. NOT production ready.`;

    const status: ServiceStatus = {
      allConnected,
      services: results,
      summary,
      productionReady: allConnected,
      timestamp: new Date().toISOString()
    };

    this.emit('production-check:complete', status);
    return status;
  }

  /**
   * Generate detailed status report
   */
  generateReport(status: ServiceStatus): string {
    let report = `# 🔍 PRODUCTION READINESS REPORT\n\n`;
    report += `**Generated:** ${status.timestamp}\n`;
    report += `**Overall Status:** ${status.productionReady ? '✅ PRODUCTION READY' : '❌ NOT READY'}\n\n`;
    report += `---\n\n`;

    report += `## Service Status Summary\n\n`;

    for (const service of status.services) {
      const icon = service.status === 'connected' ? '✅' :
                   service.status === 'failed' ? '❌' :
                   service.status === 'timeout' ? '⏱️' : '💥';

      report += `### ${icon} ${service.service}\n`;
      report += `- **URL:** ${service.url}\n`;
      report += `- **Status:** ${service.status.toUpperCase()}\n`;
      report += `- **Response Time:** ${service.responseTime}ms\n`;
      report += `- **Test Performed:** ${service.actualTest}\n`;
      report += `- **Details:** ${service.details}\n`;

      if (service.error) {
        report += `- **Error:** ${service.error}\n`;
      }

      if (service.screenshot) {
        report += `- **Screenshot:** ${service.screenshot}\n`;
      }

      report += `\n`;
    }

    report += `---\n\n`;
    report += `## Summary\n\n`;
    report += `${status.summary}\n\n`;

    if (!status.productionReady) {
      report += `### ⚠️ Required Actions:\n`;
      const failed = status.services.filter(s => s.status !== 'connected');
      failed.forEach(s => {
        report += `- Fix ${s.service}: ${s.error || 'Connection failed'}\n`;
      });
    }

    return report;
  }

  /**
   * Get test history
   */
  getTestHistory(): TestResult[] {
    return [...this.testHistory];
  }

  /**
   * Clear test history
   */
  clearHistory(): void {
    this.testHistory = [];
  }

  /**
   * Close browser and cleanup
   */
  async close(): Promise<void> {
    await this.controller.close();
  }

  // Private helpers

  private async verifyTextOnPage(text: string): Promise<boolean> {
    try {
      await this.controller.waitForText(text, 5000);
      return true;
    } catch {
      return false;
    }
  }

  private async verifySelectorOnPage(selector: string): Promise<boolean> {
    try {
      await this.controller.waitForSelector(selector, 5000);
      return true;
    } catch {
      return false;
    }
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
