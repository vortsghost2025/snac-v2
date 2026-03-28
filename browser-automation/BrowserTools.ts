import { BrowserController, PageState } from './BrowserController';
import Anthropic from '@anthropic-ai/sdk';

export interface BrowserToolResult {
  success: boolean;
  data?: any;
  error?: string;
  pageDescription?: string;
  screenshotPath?: string;
}

interface EndpointStatus {
  cockpit: { url: string; status: string; responseTime: number } | null;
  backend: { url: string; status: string; responseTime: number } | null;
  api: { url: string; status: string; responseTime: number } | null;
  workingUrls: string[];
}

export class BrowserTools {
  private browser: BrowserController;
  private endpointConfig: {
    COCKPIT_URL: string;
    BACKEND_URL: string;
    API_BASE: string;
    VPS_HOST: string;
    DISCOVERY_TIMEOUT: number;
  };
  private cachedEndpoints: EndpointStatus | null = null;

  constructor() {
    this.browser = new BrowserController();
    this.endpointConfig = {
      COCKPIT_URL: process.env.COCKPIT_URL || 'https://localhost:9090',
      BACKEND_URL: process.env.BACKEND_URL || 'http://localhost:8000',
      API_BASE: process.env.API_BASE || 'http://localhost:8000/api',
      VPS_HOST: process.env.VPS_HOST || 'localhost',
      DISCOVERY_TIMEOUT: 5000,
    };
  }

  /**
   * DISCOVER ENDPOINTS - Find working service URLs
   */
  async discoverEndpoints(): Promise<EndpointStatus> {
    // Return cached results if recent (within 5 minutes)
    if (this.cachedEndpoints && this.isCacheRecent()) {
      return this.cachedEndpoints;
    }

    const results: EndpointStatus = {
      cockpit: null,
      backend: null,
      api: null,
      workingUrls: []
    };

    // Primary URLs from environment
    const primaryUrls = [
      this.endpointConfig.COCKPIT_URL,
      this.endpointConfig.BACKEND_URL,
      `${this.endpointConfig.BACKEND_URL}/healthz`,
      `${this.endpointConfig.COCKPIT_URL}/health`
    ];

    // Fallback URLs for common scenarios
    const fallbackUrls = [
      `https://${this.endpointConfig.VPS_HOST}:9090`,  // Cockpit HTTPS
      `http://${this.endpointConfig.VPS_HOST}:9090`,   // Cockpit HTTP
      `http://localhost:9090`,                         // Local Cockpit
      `https://localhost:9090`,                        // Local Cockpit HTTPS
      `http://${this.endpointConfig.VPS_HOST}:8000`,   // Backend
      `http://localhost:8000`,                         // Local Backend
      `http://127.0.0.1:8000`,                         // 127.0.0.1 Backend
    ];

    const allUrls = [...new Set([...primaryUrls, ...fallbackUrls])];

    // Test each URL
    for (const url of allUrls) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.endpointConfig.DISCOVERY_TIMEOUT);

        const response = await fetch(url, {
          method: 'GET',
          signal: controller.signal,
          headers: {
            'Accept': 'text/html,application/json,*/*',
            'User-Agent': 'Kilo-Agent-Discovery/1.0'
          }
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const responseTime = Date.now();
          results.workingUrls.push(url);

          // Classify the working URL
          if (url.includes(':9090') || url.includes('cockpit')) {
            results.cockpit = { url, status: 'reachable', responseTime };
          } else if (url.includes('/health') || url.includes('/healthz')) {
            results.backend = { url: url.replace('/healthz', '').replace('/health', ''), status: 'reachable', responseTime };
          } else if (url.includes('/api') || url.includes(':8000')) {
            results.api = { url, status: 'reachable', responseTime };
          }
        }
      } catch (error) {
        // URL not reachable, continue testing others
      }
    }

    // Cache results
    this.cachedEndpoints = results;
    this.cacheTimestamp = Date.now();

    return results;
  }

  private isCacheRecent(): boolean {
    return this.cacheTimestamp && (Date.now() - this.cacheTimestamp) < 300000; // 5 minutes
  }

  private cacheTimestamp: number | null = null;

  /**
   * GET ENDPOINT STATUS - Check and report service availability
   */
  async getEndpointStatus(): Promise<BrowserToolResult> {
    try {
      const discovery = await this.discoverEndpoints();

      let statusReport = '# 🔍 KILO SERVICE DISCOVERY REPORT\n\n';

      statusReport += `## VPS Host: ${this.endpointConfig.VPS_HOST}\n\n`;

      if (discovery.cockpit) {
        statusReport += `✅ **Cockpit**: ${discovery.cockpit.url} (${discovery.cockpit.status})\n`;
      } else {
        statusReport += `❌ **Cockpit**: Not found\n`;
      }

      if (discovery.backend) {
        statusReport += `✅ **Backend**: ${discovery.backend.url} (${discovery.backend.status})\n`;
      } else {
        statusReport += `❌ **Backend**: Not found\n`;
      }

      if (discovery.api) {
        statusReport += `✅ **API**: ${discovery.api.url} (${discovery.api.status})\n`;
      } else {
        statusReport += `❌ **API**: Not found\n`;
      }

      statusReport += `\n## Working URLs Found: ${discovery.workingUrls.length}\n`;
      discovery.workingUrls.forEach(url => {
        statusReport += `- ${url}\n`;
      });

      return {
        success: true,
        data: discovery,
        pageDescription: statusReport
      };

    } catch (error) {
      return {
        success: false,
        error: `Endpoint discovery failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  getToolDefinitions(): Anthropic.Tool[] {
    return [
      {
        name: 'browser_discover_endpoints',
        description: 'Discover and check the status of Kilo services (Cockpit, Backend, API). Use this to find working service URLs before navigation. Always run this before opening Cockpit or other services.',
        input_schema: {
          type: 'object' as const,
          properties: {},
          required: []
        }
      },
      {
        name: 'browser_open',
        description: 'Open a web page in the browser. Use this to navigate to URLs like Cockpit, Oracle, or any web application. Always describe what you see on the page. For Cockpit, run browser_discover_endpoints first to find the working URL.',
        input_schema: {
          type: 'object' as const,
          properties: {
            url: {
              type: 'string',
              description: 'The URL to open (e.g., "https://localhost:9090", "https://oracle.example.com"). If opening Cockpit, this will be auto-discovered if not provided.'
            },
            name: {
              type: 'string',
              description: 'A friendly name for this tab (e.g., "cockpit", "oracle-login", "system-status"). Special handling for "cockpit" - will auto-discover URL.'
            },
            headless: {
              type: 'boolean',
              description: 'Whether to run browser in headless mode (default: false for debugging)',
              default: false
            },
            auto_discover: {
              type: 'boolean',
              description: 'Whether to auto-discover endpoints for known services (default: true)',
              default: true
            }
          },
          required: ['name']
        }
      },
      {
        name: 'browser_describe',
        description: 'Get a detailed accessible description of the current page, including forms, tables, buttons, and any errors or messages. Use this to understand what is on the page before taking action.',
        input_schema: {
          type: 'object' as const,
          properties: {},
          required: []
        }
      },
      {
        name: 'browser_click',
        description: 'Click on an element. You can click by text content or by selector. Always describe what happened after clicking.',
        input_schema: {
          type: 'object' as const,
          properties: {
            text: {
              type: 'string',
              description: 'The visible text of the element to click (e.g., "Log in", "Submit", "Dashboard")'
            },
            selector: {
              type: 'string',
              description: 'CSS selector of the element to click (alternative to text)'
            },
            waitForNavigation: {
              type: 'boolean',
              description: 'Whether to wait for page navigation after click (default: true)',
              default: true
            }
          },
          required: []
        }
      },
      {
        name: 'browser_fill',
        description: 'Fill in a form field with a value. Try to find the field by label first, then by selector.',
        input_schema: {
          type: 'object' as const,
          properties: {
            selector: {
              type: 'string',
              description: 'CSS selector of the input field'
            },
            fieldLabel: {
              type: 'string',
              description: 'The label of the field to fill (e.g., "Username", "Password", "Email") - this is preferred over selector'
            },
            value: {
              type: 'string',
              description: 'The value to enter'
            },
            clearFirst: {
              type: 'boolean',
              description: 'Whether to clear the field before filling (default: true)',
              default: true
            }
          },
          required: ['value']
        }
      },
      {
        name: 'browser_login',
        description: 'Attempt to log into the current page using provided credentials. Handles common enterprise login patterns.',
        input_schema: {
          type: 'object' as const,
          properties: {
            username: {
              type: 'string',
              description: 'Username or email'
            },
            password: {
              type: 'string',
              description: 'Password'
            },
            usernameField: {
              type: 'string',
              description: 'Optional: CSS selector for username field if auto-detection fails'
            },
            passwordField: {
              type: 'string',
              description: 'Optional: CSS selector for password field if auto-detection fails'
            }
          },
          required: ['username', 'password']
        }
      },
      {
        name: 'browser_screenshot',
        description: 'Take a screenshot of the current page and save it to disk. Use this when you need to show the user what you see or debug issues.',
        input_schema: {
          type: 'object' as const,
          properties: {
            fullPage: {
              type: 'boolean',
              description: 'Whether to capture the full page (default: true)',
              default: true
            }
          },
          required: []
        }
      },
      {
        name: 'browser_read_table',
        description: 'Read and return the contents of tables on the page. Useful for Oracle data grids and other tabular data. Always describe the table contents.',
        input_schema: {
          type: 'object' as const,
          properties: {
            tableIndex: {
              type: 'number',
              description: 'Which table to read (0 for first, 1 for second, etc.)',
              default: 0
            },
            maxRows: {
              type: 'number',
              description: 'Maximum number of rows to return (default: 20)',
              default: 20
            }
          },
          required: []
        }
      },
      {
        name: 'browser_wait',
        description: 'Wait for a specific element or text to appear on the page. Use this before clicking or filling to ensure the page is ready.',
        input_schema: {
          type: 'object' as const,
          properties: {
            selector: {
              type: 'string',
              description: 'CSS selector to wait for'
            },
            text: {
              type: 'string',
              description: 'Text to wait for (alternative to selector)'
            },
            timeout: {
              type: 'number',
              description: 'Maximum time to wait in milliseconds (default: 30000)',
              default: 30000
            }
          },
          required: []
        }
      },
      {
        name: 'browser_scroll',
        description: 'Scroll the page up or down to reveal more content.',
        input_schema: {
          type: 'object' as const,
          properties: {
            direction: {
              type: 'string',
              enum: ['up', 'down', 'top', 'bottom'],
              description: 'Direction to scroll'
            },
            amount: {
              type: 'number',
              description: 'Pixels to scroll (default: 500 for up/down, scrolls to top/bottom for top/bottom)'
            }
          },
          required: ['direction']
        }
      },
      {
        name: 'browser_go_back',
        description: 'Navigate back to the previous page in browser history.',
        input_schema: {
          type: 'object' as const,
          properties: {},
          required: []
        }
      },
      {
        name: 'browser_refresh',
        description: 'Refresh the current page.',
        input_schema: {
          type: 'object' as const,
          properties: {},
          required: []
        }
      },
      {
        name: 'browser_close',
        description: 'Close the browser and clean up resources.',
        input_schema: {
          type: 'object' as const,
          properties: {},
          required: []
        }
      },
      {
        name: 'browser_session_status',
        description: 'Check the current browser session status and last actions. Use this to debug issues.',
        input_schema: {
          type: 'object' as const,
          properties: {},
          required: []
        }
      }
    ];
  }

  async executeTool(name: string, input: any): Promise<BrowserToolResult> {
    try {
      switch (name) {
        case 'browser_discover_endpoints':
          return await this.getEndpointStatus();

        case 'browser_open':
          let targetUrl = input.url;

          // Auto-discover URL for known services if not provided
          if (input.auto_discover !== false && (!targetUrl || input.name === 'cockpit')) {
            const discovery = await this.discoverEndpoints();

            if (input.name === 'cockpit' && discovery.cockpit) {
              targetUrl = discovery.cockpit.url;
            } else if (!targetUrl && discovery.backend) {
              targetUrl = discovery.backend.url;
            }
          }

          // Fallback to environment config if still no URL
          if (!targetUrl) {
            if (input.name === 'cockpit') {
              targetUrl = this.endpointConfig.COCKPIT_URL;
            } else {
              return {
                success: false,
                error: `No URL provided and could not auto-discover endpoint for "${input.name}"`
              };
            }
          }

          const pageState = await this.browser.openPage(targetUrl, input.name);
          const description = await this.browser.getAccessibleDescription();
          return {
            success: true,
            pageDescription: description,
            data: pageState
          };

        case 'browser_describe':
          return {
            success: true,
            pageDescription: await this.browser.getAccessibleDescription()
          };

        case 'browser_click':
          const clickResult = await this.browser.click(
            input.selector,
            { text: input.text }
          );
          if (clickResult) {
            return {
              success: true,
              pageDescription: await this.browser.getAccessibleDescription()
            };
          }
          return { success: false, error: 'Click failed' };

        case 'browser_fill':
          let selector = input.selector;
          if (input.fieldLabel) {
            // Smart field finding
            const state = await this.browser.getPageState();
            for (const form of state.forms) {
              for (const field of form.fields) {
                if (field.label.toLowerCase().includes(input.fieldLabel.toLowerCase())) {
                  selector = field.selector;
                  break;
                }
              }
              if (selector) break;
            }
            if (!selector) {
              return { success: false, error: `Could not find field with label: ${input.fieldLabel}` };
            }
          }

          const fillResult = await this.browser.fill(selector, input.value);
          if (fillResult) {
            return {
              success: true,
              pageDescription: await this.browser.getAccessibleDescription()
            };
          }
          return { success: false, error: 'Fill failed' };

        case 'browser_login':
          const loginResult = await this.browser.login(
            input.username,
            input.password
          );
          if (loginResult) {
            return {
              success: true,
              pageDescription: await this.browser.getAccessibleDescription()
            };
          }
          return { success: false, error: 'Login failed' };

        case 'browser_screenshot':
          const screenshotPath = await this.browser.screenshot();
          return {
            success: true,
            screenshotPath,
            pageDescription: await this.browser.getAccessibleDescription()
          };

        case 'browser_read_table':
          const state = await this.browser.getPageState();
          const tableIdx = input.tableIndex || 0;
          if (tableIdx >= state.tables.length) {
            return {
              success: false,
              error: `Table ${tableIdx} not found. Page has ${state.tables.length} tables.`
            };
          }
          return {
            success: true,
            data: state.tables[tableIdx]
          };

        case 'browser_wait':
          if (input.selector) {
            const waitResult = await this.browser.waitForSelector(input.selector, input.timeout);
            if (waitResult) {
              return {
                success: true,
                pageDescription: await this.browser.getAccessibleDescription()
              };
            }
          } else if (input.text) {
            const waitResult = await this.browser.waitForText(input.text, input.timeout);
            if (waitResult) {
              return {
                success: true,
                pageDescription: await this.browser.getAccessibleDescription()
              };
            }
          }
          return { success: false, error: 'Wait failed - neither selector nor text provided' };

        case 'browser_scroll':
          if (!this.browser.activePage) return { success: false, error: 'No active page' };

          if (input.direction === 'up') {
            await this.browser.activePage.evaluate(() => window.scrollBy(0, -500));
          } else if (input.direction === 'down') {
            await this.browser.activePage.evaluate(() => window.scrollBy(0, 500));
          } else if (input.direction === 'top') {
            await this.browser.activePage.evaluate(() => window.scrollTo(0, 0));
          } else if (input.direction === 'bottom') {
            await this.browser.activePage.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          }
          return {
            success: true,
            pageDescription: await this.browser.getAccessibleDescription()
          };

        case 'browser_go_back':
          if (!this.browser.activePage) return { success: false, error: 'No active page' };
          await this.browser.activePage.goBack();
          return {
            success: true,
            pageDescription: await this.browser.getAccessibleDescription()
          };

        case 'browser_refresh':
          if (!this.browser.activePage) return { success: false, error: 'No active page' };
          await this.browser.activePage.reload();
          return {
            success: true,
            pageDescription: await this.browser.getAccessibleDescription()
          };

        case 'browser_close':
          await this.browser.close();
          return { success: true };

        case 'browser_session_status':
          const status = await this.browser.checkSession();
          return {
            success: true,
            data: status
          };

        default:
          return { success: false, error: `Unknown tool: ${name}` };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}
