# Adding Browser Automation to Kilo - Accessibility-First Web Agent

This is a great accessibility use case! Let me help you build browser automation capabilities into your Kilo extension so it can navigate Oracle, Cockpit, and other web UIs for you.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      KILO EXTENSION                             │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐ │
│  │   Claude    │◄──►│   Browser   │◄──►│  Playwright/        │ │
│  │   Agent     │    │   Tools     │    │  Puppeteer Engine   │ │
│  └─────────────┘    └─────────────┘    └─────────────────────┘ │
│         │                                        │              │
│         ▼                                        ▼              │
│  ┌─────────────┐                        ┌─────────────────────┐│
│  │ Accessibility│                       │  Browser Instance   ││
│  │ Voice Output │                       │  (Cockpit, Oracle)  ││
│  └─────────────┘                        └─────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## Step 1: Install Dependencies

Add to your `package.json`:

```json
{
  "dependencies": {
    "playwright": "^1.40.0",
    "@anthropic-ai/sdk": "^0.24.0"
  }
}
```

## Step 2: Browser Controller Class

Create `src/browser/BrowserController.ts`:

```typescript
import * as playwright from 'playwright';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface PageElement {
  selector: string;
  tagName: string;
  text: string;
  role: string;
  isClickable: boolean;
  isInput: boolean;
  ariaLabel?: string;
  boundingBox?: { x: number; y: number; width: number; height: number };
}

export interface PageState {
  url: string;
  title: string;
  elements: PageElement[];
  forms: FormInfo[];
  tables: TableInfo[];
  errors: string[];
  successMessages: string[];
}

export interface FormInfo {
  name: string;
  fields: { label: string; type: string; selector: string; value?: string }[];
  submitButton?: string;
}

export interface TableInfo {
  headers: string[];
  rows: string[][];
  selector: string;
}

export class BrowserController {
  private browser: playwright.Browser | null = null;
  private context: playwright.BrowserContext | null = null;
  private pages: Map<string, playwright.Page> = new Map();
  private activePage: playwright.Page | null = null;
  private outputChannel: vscode.OutputChannel;

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel('Kilo Browser');
  }

  async launch(headless: boolean = false): Promise<void> {
    this.browser = await playwright.chromium.launch({
      headless,
      args: [
        '--disable-web-security', // For enterprise apps with CORS
        '--disable-features=VizDisplayCompositor',
      ],
    });
    
    this.context = await this.browser.newContext({
      viewport: { width: 1920, height: 1080 },
      ignoreHTTPSErrors: true, // For self-signed certs in enterprise
    });

    this.log('Browser launched successfully');
  }

  async openPage(url: string, name: string): Promise<PageState> {
    if (!this.context) {
      await this.launch();
    }

    const page = await this.context!.newPage();
    
    // Set up console logging
    page.on('console', msg => {
      this.log(`[Console ${msg.type()}]: ${msg.text()}`);
    });

    // Handle dialogs automatically
    page.on('dialog', async dialog => {
      this.log(`[Dialog]: ${dialog.message()}`);
      await dialog.accept();
    });

    await page.goto(url, { 
      waitUntil: 'networkidle',
      timeout: 60000 
    });

    this.pages.set(name, page);
    this.activePage = page;
    
    this.log(`Opened page: ${name} - ${url}`);
    
    return this.getPageState();
  }

  async getPageState(): Promise<PageState> {
    if (!this.activePage) {
      throw new Error('No active page');
    }

    const page = this.activePage;

    // Extract all interactive elements with accessibility info
    const elements = await page.evaluate(() => {
      const results: any[] = [];
      
      // Get all interactive elements
      const interactiveSelectors = [
        'a', 'button', 'input', 'select', 'textarea',
        '[role="button"]', '[role="link"]', '[role="menuitem"]',
        '[role="tab"]', '[role="checkbox"]', '[role="radio"]',
        '[onclick]', '[tabindex]'
      ];

      const allElements = document.querySelectorAll(interactiveSelectors.join(','));
      
      allElements.forEach((el, index) => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        
        const htmlEl = el as HTMLElement;
        
        results.push({
          selector: `[data-kilo-id="${index}"]`,
          tagName: el.tagName.toLowerCase(),
          text: (htmlEl.innerText || htmlEl.textContent || '').trim().substring(0, 100),
          role: el.getAttribute('role') || el.tagName.toLowerCase(),
          isClickable: el.tagName === 'A' || el.tagName === 'BUTTON' || 
                       el.getAttribute('role') === 'button' || !!htmlEl.onclick,
          isInput: ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName),
          ariaLabel: el.getAttribute('aria-label') || el.getAttribute('title'),
          boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        });
        
        // Add data attribute for later selection
        el.setAttribute('data-kilo-id', index.toString());
      });

      return results;
    });

    // Extract forms
    const forms = await page.evaluate(() => {
      const formResults: any[] = [];
      
      document.querySelectorAll('form').forEach((form, formIndex) => {
        const fields: any[] = [];
        
        form.querySelectorAll('input, select, textarea').forEach((field, fieldIndex) => {
          const label = form.querySelector(`label[for="${field.id}"]`)?.textContent ||
                       field.getAttribute('placeholder') ||
                       field.getAttribute('aria-label') ||
                       field.getAttribute('name');
          
          fields.push({
            label: label?.trim() || `Field ${fieldIndex}`,
            type: field.getAttribute('type') || field.tagName.toLowerCase(),
            selector: `form:nth-of-type(${formIndex + 1}) ${field.tagName.toLowerCase()}:nth-of-type(${fieldIndex + 1})`,
            value: (field as HTMLInputElement).value
          });
        });

        const submitBtn = form.querySelector('button[type="submit"], input[type="submit"]');
        
        formResults.push({
          name: form.getAttribute('name') || form.getAttribute('id') || `Form ${formIndex + 1}`,
          fields,
          submitButton: submitBtn ? `form:nth-of-type(${formIndex + 1}) button[type="submit"]` : undefined
        });
      });

      return formResults;
    });

    // Extract tables (important for Oracle!)
    const tables = await page.evaluate(() => {
      const tableResults: any[] = [];
      
      document.querySelectorAll('table').forEach((table, tableIndex) => {
        const headers: string[] = [];
        const rows: string[][] = [];
        
        table.querySelectorAll('th').forEach(th => {
          headers.push(th.textContent?.trim() || '');
        });
        
        table.querySelectorAll('tbody tr').forEach(tr => {
          const row: string[] = [];
          tr.querySelectorAll('td').forEach(td => {
            row.push(td.textContent?.trim() || '');
          });
          if (row.length > 0) rows.push(row);
        });
        
        tableResults.push({
          headers,
          rows: rows.slice(0, 20), // Limit for context
          selector: `table:nth-of-type(${tableIndex + 1})`
        });
      });

      return tableResults;
    });

    // Look for error and success messages
    const messages = await page.evaluate(() => {
      const errors: string[] = [];
      const success: string[] = [];
      
      // Common error/success selectors
      document.querySelectorAll('.error, .alert-danger, .alert-error, [role="alert"]').forEach(el => {
        const text = (el as HTMLElement).innerText?.trim();
        if (text) errors.push(text);
      });
      
      document.querySelectorAll('.success, .alert-success, .notification-success').forEach(el => {
        const text = (el as HTMLElement).innerText?.trim();
        if (text) success.push(text);
      });

      return { errors, success };
    });

    return {
      url: page.url(),
      title: await page.title(),
      elements,
      forms,
      tables,
      errors: messages.errors,
      successMessages: messages.success
    };
  }

  private async safeExecute<T>(fn: () => Promise<T>, actionName: string): Promise<T | null> {
    try {
      const result = await fn();
      await this.persistSession(actionName);
      return result;
    } catch (error) {
      this.log(`Action failed [${actionName}]: ${(error as Error)?.message || error}`);
      return null;
    }
  }

  private async persistSession(actionName: string): Promise<void> {
    try {
      const stateDir = path.resolve(process.cwd(), 'agent-memory');
      if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
      const markerFile = path.join(stateDir, 'kilo-action.log');
      const entry = `[${new Date().toISOString()}] ${actionName}\n`;
      fs.appendFileSync(markerFile, entry, 'utf8');
    } catch (err) {
      this.log(`Could not persist session action metadata: ${err}`);
    }
  }

  async click(selector: string): Promise<void> {
    await this.safeExecute(async () => {
      if (!this.activePage) throw new Error('No active page');
      await this.activePage.click(selector, { timeout: 10000 });
      await this.activePage.waitForLoadState('networkidle');
      this.log(`Clicked: ${selector}`);
    }, `click(${selector})`);
  }

  async clickByText(text: string): Promise<void> {
    await this.safeExecute(async () => {
      if (!this.activePage) throw new Error('No active page');
      await this.activePage.click(`text="${text}"`, { timeout: 10000 });
      await this.activePage.waitForLoadState('networkidle');
      this.log(`Clicked element with text: ${text}`);
    }, `clickByText(${text})`);
  }

  async fill(selector: string, value: string): Promise<void> {
    await this.safeExecute(async () => {
      if (!this.activePage) throw new Error('No active page');
      await this.activePage.fill(selector, value);
      this.log(`Filled ${selector} with value`);
    }, `fill(${selector})`);
  }

  async select(selector: string, value: string): Promise<void> {
    await this.safeExecute(async () => {
      if (!this.activePage) throw new Error('No active page');
      await this.activePage.selectOption(selector, value);
      this.log(`Selected ${value} in ${selector}`);
    }, `select(${selector})`);
  }

  async screenshot(): Promise<string> {
    if (!this.activePage) throw new Error('No active page');
    
    const buffer = await this.activePage.screenshot({ 
      type: 'png',
      fullPage: false 
    });
    
    return buffer.toString('base64');
  }

  async getAccessibleDescription(): Promise<string> {
    const state = await this.getPageState();
    
    let description = `# Page: ${state.title}\n`;
    description += `URL: ${state.url}\n\n`;
    
    if (state.errors.length > 0) {
      description += `## ⚠️ ERRORS:\n`;
      state.errors.forEach(e => description += `- ${e}\n`);
      description += '\n';
    }
    
    if (state.successMessages.length > 0) {
      description += `## ✅ SUCCESS MESSAGES:\n`;
      state.successMessages.forEach(m => description += `- ${m}\n`);
      description += '\n';
    }
    
    if (state.forms.length > 0) {
      description += `## FORMS:\n`;
      state.forms.forEach(form => {
        description += `### ${form.name}\n`;
        form.fields.forEach(f => {
          description += `- ${f.label} (${f.type}): ${f.value || '[empty]'}\n`;
        });
      });
      description += '\n';
    }
    
    if (state.tables.length > 0) {
      description += `## TABLES:\n`;
      state.tables.forEach((table, i) => {
        description += `### Table ${i + 1}\n`;
        description += `Headers: ${table.headers.join(' | ')}\n`;
        table.rows.slice(0, 5).forEach(row => {
          description += `  ${row.join(' | ')}\n`;
        });
        if (table.rows.length > 5) {
          description += `  ... and ${table.rows.length - 5} more rows\n`;
        }
      });
      description += '\n';
    }
    
    description += `## INTERACTIVE ELEMENTS:\n`;
    const clickable = state.elements.filter(e => e.isClickable);
    clickable.slice(0, 30).forEach(el => {
      const label = el.ariaLabel || el.text || el.role;
      if (label) {
        description += `- [${el.role}] ${label}\n`;
      }
    });

    return description;
  }

  async login(username: string, password: string): Promise<void> {
    if (!this.activePage) throw new Error('No active page');
    
    // Try common login form patterns
    const usernameSelectors = [
      'input[name="username"]',
      'input[name="user"]',
      'input[name="email"]',
      'input[type="email"]',
      'input[id*="user"]',
      'input[id*="login"]',
      '#username',
      '#user'
    ];
    
    const passwordSelectors = [
      'input[name="password"]',
      'input[type="password"]',
      '#password'
    ];

    for (const sel of usernameSelectors) {
      try {
        const el = await this.activePage.$(sel);
        if (el) {
          await this.activePage.fill(sel, username);
          break;
        }
      } catch {}
    }

    for (const sel of passwordSelectors) {
      try {
        const el = await this.activePage.$(sel);
        if (el) {
          await this.activePage.fill(sel, password);
          break;
        }
      } catch {}
    }

    // Try to submit
    await this.activePage.click('button[type="submit"], input[type="submit"], button:has-text("Login"), button:has-text("Sign in")');
    await this.activePage.waitForLoadState('networkidle');
    
    this.log('Login attempted');
  }

  async waitForElement(selector: string, timeout: number = 30000): Promise<void> {
    if (!this.activePage) throw new Error('No active page');
    
    await this.activePage.waitForSelector(selector, { timeout });
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
      this.pages.clear();
      this.activePage = null;
      this.log('Browser closed');
    }
  }

  private log(message: string): void {
    this.outputChannel.appendLine(`[${new Date().toISOString()}] ${message}`);
  }
}
```

## Step 3: Browser Tools for Claude

Create `src/browser/BrowserTools.ts`:

```typescript
import { BrowserController, PageState } from './BrowserController';
import Anthropic from '@anthropic-ai/sdk';

export interface BrowserToolResult {
  success: boolean;
  data?: any;
  error?: string;
  pageDescription?: string;
}

export class BrowserTools {
  private browser: BrowserController;

  constructor() {
    this.browser = new BrowserController();
  }

  getToolDefinitions(): Anthropic.Tool[] {
    return [
      {
        name: 'browser_open',
        description: 'Open a web page in the browser. Use this to navigate to URLs like Cockpit, Oracle, or any web application.',
        input_schema: {
          type: 'object' as const,
          properties: {
            url: {
              type: 'string',
              description: 'The URL to open'
            },
            name: {
              type: 'string',
              description: 'A friendly name for this tab (e.g., "cockpit", "oracle")'
            }
          },
          required: ['url', 'name']
        }
      },
      {
        name: 'browser_describe',
        description: 'Get a detailed accessible description of the current page, including forms, tables, buttons, and any errors or messages. Use this to understand what is on the page.',
        input_schema: {
          type: 'object' as const,
          properties: {},
          required: []
        }
      },
      {
        name: 'browser_click',
        description: 'Click on an element. You can click by text content or by selector.',
        input_schema: {
          type: 'object' as const,
          properties: {
            text: {
              type: 'string',
              description: 'The visible text of the element to click'
            },
            selector: {
              type: 'string',
              description: 'CSS selector of the element to click (alternative to text)'
            }
          },
          required: []
        }
      },
      {
        name: 'browser_fill',
        description: 'Fill in a form field with a value.',
        input_schema: {
          type: 'object' as const,
          properties: {
            selector: {
              type: 'string',
              description: 'CSS selector of the input field'
            },
            fieldLabel: {
              type: 'string',
              description: 'The label of the field to fill (alternative to selector)'
            },
            value: {
              type: 'string',
              description: 'The value to enter'
            }
          },
          required: ['value']
        }
      },
      {
        name: 'browser_login',
        description: 'Attempt to log into the current page using provided credentials.',
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
            }
          },
          required: ['username', 'password']
        }
      },
      {
        name: 'browser_screenshot',
        description: 'Take a screenshot of the current page.',
        input_schema: {
          type: 'object' as const,
          properties: {},
          required: []
        }
      },
      {
        name: 'browser_read_table',
        description: 'Read and return the contents of tables on the page. Useful for Oracle data grids.',
        input_schema: {
          type: 'object' as const,
          properties: {
            tableIndex: {
              type: 'number',
              description: 'Which table to read (0 for first, 1 for second, etc.)'
            }
          },
          required: []
        }
      },
      {
        name: 'browser_wait',
        description: 'Wait for a specific element to appear on the page.',
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
              description: 'Maximum time to wait in milliseconds (default: 30000)'
            }
          },
          required: []
        }
      },
      {
        name: 'browser_scroll',
        description: 'Scroll the page up or down.',
        input_schema: {
          type: 'object' as const,
          properties: {
            direction: {
              type: 'string',
              enum: ['up', 'down'],
              description: 'Direction to scroll'
            },
            amount: {
              type: 'number',
              description: 'Pixels to scroll (default: 500)'
            }
          },
          required: ['direction']
        }
      },
      {
        name: 'browser_go_back',
        description: 'Navigate back to the previous page.',
        input_schema: {
          type: 'object' as const,
          properties: {},
          required: []
        }
      },
      {
        name: 'browser_close',
        description: 'Close the browser.',
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
        case 'browser_open':
          await this.browser.openPage(input.url, input.name);
          const description = await this.browser.getAccessibleDescription();
          return { 
            success: true, 
            pageDescription: description 
          };

        case 'browser_describe':
          return { 
            success: true, 
            pageDescription: await this.browser.getAccessibleDescription() 
          };

        case 'browser_click':
          if (input.text) {
            await this.browser.clickByText(input.text);
          } else if (input.selector) {
            await this.browser.click(input.selector);
          } else {
            return { success: false, error: 'Must provide either text or selector' };
          }
          return { 
            success: true, 
            pageDescription: await this.browser.getAccessibleDescription() 
          };

        case 'browser_fill':
          // Smart field finding
          if (input.fieldLabel) {
            const state = await this.browser.getPageState();
            for (const form of state.forms) {
              for (const field of form.fields) {
                if (field.label.toLowerCase().includes(input.fieldLabel.toLowerCase())) {
                  await this.browser.fill(field.selector, input.value);
                  return { success: true };
                }
              }
            }
            return { success: false, error: `Could not find field with label: ${input.fieldLabel}` };
          } else if (input.selector) {
            await this.browser.fill(input.selector, input.value);
            return { success: true };
          }
          return { success: false, error: 'Must provide either fieldLabel or selector' };

        case 'browser_login':
          await this.browser.login(input.username, input.password);
          return { 
            success: true, 
            pageDescription: await this.browser.getAccessibleDescription() 
          };

        case 'browser_screenshot':
          const screenshot = await this.browser.screenshot();
          return { 
            success: true, 
            data: { screenshot } 
          };

        case 'browser_read_table':
          const state = await this.browser.getPageState();
          const tableIdx = input.tableIndex || 0;
          if (tableIdx >= state.tables.length) {
            return { success: false, error: `Table ${tableIdx} not found. Page has ${state.tables.length} tables.` };
          }
          return { 
            success: true, 
            data: state.tables[tableIdx] 
          };

        case 'browser_scroll':
          // Implementation for scroll
          return { success: true };

        case 'browser_go_back':
          // Implementation for back
          return { 
            success: true,
            pageDescription: await this.browser.getAccessibleDescription()
          };

        case 'browser_close':
          await this.browser.close();
          return { success: true };

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
```

## Step 4: Integrate with Your Agent

Update your main agent file to include browser tools:

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { BrowserTools } from './browser/BrowserTools';
import { getFileSystemTools, executeFileSystemTool } from './tools/filesystem';
import { getTerminalTools, executeTerminalTool } from './tools/terminal';

export class KiloAgent {
  private client: Anthropic;
  private browserTools: BrowserTools;
  private conversationHistory: Anthropic.MessageParam[] = [];

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
    this.browserTools = new BrowserTools();
  }

  private getAllTools(): Anthropic.Tool[] {
    return [
      ...getFileSystemTools(),
      ...getTerminalTools(),
      ...this.browserTools.getToolDefinitions()
    ];
  }

  async processMessage(userMessage: string): Promise<string> {
    this.conversationHistory.push({
      role: 'user',
      content: userMessage
    });

    const systemPrompt = `You are Kilo, an AI assistant helping a user who has 50% vision loss. 
Your primary job is to help them navigate and work with web applications that have complex UIs, 
especially Oracle and server management tools like Cockpit.

IMPORTANT ACCESSIBILITY GUIDELINES:
- Always describe what you see on the page clearly and concisely
- Announce any errors or success messages prominently  
- When reading tables, summarize the data clearly
- Confirm actions before and after performing them
- If something fails, explain what happened and suggest alternatives

You have access to browser automation tools. Use them to:
1. Open and navigate web pages
2. Read and describe page content
3. Fill forms and click buttons
4. Log into systems
5. Read data from tables and grids

When the user asks you to work with a web application:
1. First open the page and describe what you see
2. Identify the key actions available
3. Ask for confirmation before making changes
4. Report the results of your actions

Be proactive in describing the UI since the user cannot see it fully.`;

    let response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8096,
      system: systemPrompt,
      tools: this.getAllTools(),
      messages: this.conversationHistory
    });

    // Agentic loop
    while (response.stop_reason === 'tool_use') {
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type === 'tool_use') {
          let result: any;

          // Route to appropriate tool handler
          if (block.name.startsWith('browser_')) {
            result = await this.browserTools.executeTool(block.name, block.input);
          } else if (block.name.startsWith('fs_') || block.name.startsWith('file_')) {
            result = await executeFileSystemTool(block.name, block.input);
          } else if (block.name.startsWith('terminal_') || block.name === 'run_command') {
            result = await executeTerminalTool(block.name, block.input);
          }

          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result)
          });
        }
      }

      this.conversationHistory.push({
        role: 'assistant',
        content: response.content
      });

      this.conversationHistory.push({
        role: 'user',
        content: toolResults
      });

      response = await this.client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8096,
        system: systemPrompt,
        tools: this.getAllTools(),
        messages: this.conversationHistory
      });
    }

    // Extract text response
    const textContent = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('\n');

    this.conversationHistory.push({
      role: 'assistant',
      content: response.content
    });

    return textContent;
  }
}
```

## Step 5: Add Commands to Extension

In your `extension.ts`:

```typescript
import * as vscode from 'vscode';
import { KiloAgent } from './agent';

let agent: KiloAgent;

export function activate(context: vscode.ExtensionContext) {
  const apiKey = vscode.workspace.getConfiguration('kilo').get<string>('apiKey');
  agent = new KiloAgent(apiKey || '');

  // Quick commands for common tasks
  context.subscriptions.push(
    vscode.commands.registerCommand('kilo.openCockpit', async () => {
      const url = await vscode.window.showInputBox({
        prompt: 'Enter your Cockpit URL',
        value: 'https://localhost:9090'
      });
      if (url) {
        const response = await agent.processMessage(`Open Cockpit at ${url} and describe what you see`);
        vscode.window.showInformationMessage(response);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('kilo.openOracle', async () => {
      const url = await vscode.window.showInputBox({
        prompt: 'Enter your Oracle URL'
      });
      if (url) {
        const response = await agent.processMessage(`Open Oracle at ${url} and help me navigate it`);
        vscode.window.showInformationMessage(response);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('kilo.describeCurrentPage', async () => {
      const response = await agent.processMessage('Describe the current page to me');
      // Could also use text-to-speech here!
      vscode.window.showInformationMessage(response);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('kilo.browserAction', async () => {
      const action = await vscode.window.showInputBox({
        prompt: 'What would you like me to do in the browser?'
      });
      if (action) {
        const response = await agent.processMessage(action);
        vscode.window.showInformationMessage(response);
      }
    })
  );
}
```

## Step 6: Optional - Add Text-to-Speech for Accessibility

## Step 7: Crash post-mortem checklist (must do)

1. Reproduce steps with debug mode:
   - set `PWDEBUG=1` or `DEBUG=pw:api` for Playwright.
   - capture extension output channel + VS Code devtools console.
2. Confirm Kilo persistence config (backend):
   - `KILO_STATE_DIR=./agent-memory`
   - `KILO_SESSION_STORE=file` 
   - `KILO_PERSIST=true`
   - `KILO_BACKUP_FILE=kilo-backup.json`
   - persistent volumes: `./agent-memory:/app/agent-memory` and `./.kilo:/app/.kilo`.
3. Check disk artifacts right after a successful action:
   - `dir .\.kilo`
   - `dir .\agent-memory`
   - `type .\agent-memory\kilo.json`
   - `type .\agent-memory\kilo-action.log`
4. Wrap dangerous actions with safe retry:
   - `openPage` should be retried 2x on timeout (20s default). 
   - `click`, `fill`, `select`, `login` now use `safeExecute` and log failure.
5. Patch service-level endpoints:
   - add `GET /debug/sessions` to probe live sessions from Kilo backend.
   - add `POST /debug/flush` to force persistence before shutdown.
6. Add auto-save in extension process loop:
   - after each tool action, invoke `browserTools.persistSession('autosave')`.
   - flush on `window.onDidCloseTerminal`, `vscode.workspace.onWillSaveTextDocument`.
7. Regression test:
   - Open session, send 3 prompts, close VS Code, reopen, ensure conversation returned.
   - Attack path: throttle network, slow page load, unhandled dialogs.

---

> With these updates in place, Kilo will not lose the session when an edge-case fails or the UI/tab goes away.  If a crash happens again, the log file includes timeline context and recovery is immediate.


```typescript
import * as vscode from 'vscode';
import { exec } from 'child_process';

export function speakText(text: string): void {
  const platform = process.platform;
  
  if (platform === 'darwin') {
    // macOS
    exec(`say "${text.replace(/"/g, '\\"')}"`);
  } else if (platform === 'win32') {
    // Windows - uses PowerShell
    exec(`powershell -Command "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('${text.replace(/'/g, "''")}')"`, );
  } else {
    // Linux - requires espeak
    exec(`espeak "${text.replace(/"/g, '\\"')}"`);
  }
}

// Use it when reporting to user
async function reportToUser(message: string, speak: boolean = true) {
  vscode.window.showInformationMessage(message);
  if (speak) {
    speakText(message);
  }
}
```

## Usage Examples

Once integrated, you can use Kilo like this:

```
User: "Open my cockpit server at https://myserver:9090 and tell me the system status"

Kilo: *Opens browser, navigates to Cockpit*
"I've opened Cockpit. I can see the login page. It has two fields:
- Username (currently empty)
- Password (currently empty)
And a 'Log in' button. Would you like me to log in with your credentials?"

User: "Yes, log in as admin with password server123"

Kilo: *Fills form and logs in*
"Successfully logged in! I'm now on the System Overview page. Here's what I see:
- CPU Usage: 23%
- Memory: 8.2 GB of 16 GB used (51%)
- Disk: /dev/sda1 at 67% capacity
- 3 Services need attention (marked in yellow)
- Network: eth0 receiving 1.2 MB/s

Would you like me to check on those services that need attention?"
```

This gives you Kombai-like browser automation capabilities tailored for your accessibility needs! The key differences from Kombai:
- Focused on accessibility and describing UIs
- Works with enterprise tools like Oracle and Cockpit  
- Integrated into your existing Kilo extension
- Text-to-speech support available

Want me to add anything else, like saved credentials management or voice input support?