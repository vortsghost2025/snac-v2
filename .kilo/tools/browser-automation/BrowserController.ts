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
  private sessionDir: string;

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel('Kilo Browser');
    this.sessionDir = path.join(process.cwd(), 'agent-memory');
    if (!fs.existsSync(this.sessionDir)) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
    }
  }

   async launch(headless: boolean = false): Promise<void> {
     try {
       this.browser = await playwright.webkit.launch({
         headless,
         args: [
           '--disable-web-security',
           '--disable-features=VizDisplayCompositor',
           '--no-sandbox',
           '--disable-setuid-sandbox'
         ],
       });

      this.context = await this.browser.newContext({
        viewport: { width: 1920, height: 1080 },
        ignoreHTTPSErrors: true,
        javaScriptEnabled: true,
      });

      this.log('Browser launched successfully');
    } catch (error) {
      this.log(`Browser launch failed: ${error}`);
      throw error;
    }
  }

  async openPage(url: string, name: string): Promise<PageState> {
    if (!this.context) {
      await this.launch();
    }

    try {
      const page = await this.context.newPage();

      // Enhanced console logging
      page.on('console', msg => {
        this.log(`[Console ${msg.type()}]: ${msg.text()}`);
      });

      // Handle dialogs automatically
      page.on('dialog', async dialog => {
        this.log(`[Dialog]: ${dialog.message()}`);
        await dialog.accept();
      });

      // Handle page errors
      page.on('pageerror', error => {
        this.log(`[Page Error]: ${error.message}`);
      });

      // Handle request failures
      page.on('requestfailed', request => {
        if (request.failure()?.errorText.includes('net::ERR_CONNECTION_REFUSED')) {
          this.log(`[Connection Failed]: ${request.url()}`);
        }
      });

      await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: 60000
      });

      this.pages.set(name, page);
      this.activePage = page;

      this.log(`Opened page: ${name} - ${url}`);

      // Save session state
      await this.persistSession('openPage');

      return await this.getPageState();
    } catch (error) {
      this.log(`Failed to open page: ${error}`);
      throw error;
    }
  }

  async getPageState(): Promise<PageState> {
    if (!this.activePage) {
      throw new Error('No active page');
    }

    const page = this.activePage;

    // Extract all interactive elements with accessibility info
    const elements = await page.evaluate(() => {
      const results: any[] = [];

      const interactiveSelectors = [
        'a', 'button', 'input', 'select', 'textarea',
        '[role="button"]', '[role="link"]', '[role="menuitem"]',
        '[role="tab"]', '[role="checkbox"]', '[role="radio"]',
        '[onclick]', '[tabindex]:not([tabindex="-1"])', '[aria-hidden="false"]'
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
                      el.getAttribute('role') === 'button' || !!htmlEl.onclick ||
                      el.tagName === 'INPUT' || el.tagName === 'SELECT',
          isInput: ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName),
          ariaLabel: el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') ||
                    el.getAttribute('title') || el.getAttribute('placeholder'),
          boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        });

        el.setAttribute('data-kilo-id', index.toString());
      });

      return results;
    });

    // Extract forms with better field detection
    const forms = await page.evaluate(() => {
      const formResults: any[] = [];

      document.querySelectorAll('form').forEach((form, formIndex) => {
        const fields: any[] = [];

        form.querySelectorAll('input, select, textarea').forEach((field, fieldIndex) => {
          const label = form.querySelector(`label[for="${field.id}"]`)?.textContent ||
                        document.querySelector(`label:has(> input#${field.id})`)?.textContent ||
                        field.getAttribute('placeholder') ||
                        field.getAttribute('aria-label') ||
                        field.getAttribute('name') ||
                        `Field ${fieldIndex + 1}`;

          fields.push({
            label: label?.trim() || `Field ${fieldIndex + 1}`,
            type: field.getAttribute('type') || field.tagName.toLowerCase(),
            selector: `form:nth-of-type(${formIndex + 1}) ${field.tagName.toLowerCase()}:nth-of-type(${fieldIndex + 1})`,
            value: (field as HTMLInputElement).value,
            required: field.hasAttribute('required'),
            disabled: field.hasAttribute('disabled')
          });
        });

        const submitBtn = form.querySelector('button[type="submit"], input[type="submit"], [role="button"][type="submit"]');

        formResults.push({
          name: form.getAttribute('name') || form.getAttribute('id') || `Form ${formIndex + 1}`,
          fields,
          submitButton: submitBtn ? `form:nth-of-type(${formIndex + 1}) button[type="submit"], form:nth-of-type(${formIndex + 1}) input[type="submit"]` : undefined
        });
      });

      return formResults;
    });

    // Extract tables with better structure detection
    const tables = await page.evaluate(() => {
      const tableResults: any[] = [];

      document.querySelectorAll('table').forEach((table, tableIndex) => {
        const headers: string[] = [];
        const rows: string[][] = [];

        // Try to find headers in thead or first tr
        const thead = table.querySelector('thead');
        if (thead) {
          thead.querySelectorAll('th').forEach(th => {
            headers.push(th.textContent?.trim() || '');
          });
        } else {
          // Fallback to first row
          const firstRow = table.querySelector('tr');
          if (firstRow) {
            firstRow.querySelectorAll('th, td').forEach(cell => {
              headers.push(cell.textContent?.trim() || '');
            });
          }
        }

        // Get data rows
        table.querySelectorAll('tbody tr').forEach(tr => {
          const row: string[] = [];
          tr.querySelectorAll('td').forEach(td => {
            row.push(td.textContent?.trim() || '');
          });
          if (row.length > 0) rows.push(row);
        });

        if (headers.length > 0 || rows.length > 0) {
          tableResults.push({
            headers,
            rows: rows.slice(0, 20), // Limit for context
            selector: `table:nth-of-type(${tableIndex + 1})`,
            rowCount: rows.length,
            colCount: headers.length > 0 ? headers.length : (rows[0]?.length || 0)
          });
        }
      });

      return tableResults;
    });

    // Look for error and success messages with better detection
    const messages = await page.evaluate(() => {
      const errors: string[] = [];
      const success: string[] = [];

      // Common error/success selectors for enterprise apps
      const errorSelectors = [
        '.error', '.alert-danger', '.alert-error', '[role="alert"][aria-live="assertive"]',
        '.has-error', '.is-invalid', '.text-danger', '.error-message',
        '.ui-state-error', '.p-error', '.invalid-feedback'
      ];

      const successSelectors = [
        '.success', '.alert-success', '.alert-info', '[role="status"]',
        '.notification-success', '.toast-success', '.ui-state-highlight',
        '.text-success', '.valid-feedback'
      ];

      errorSelectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => {
          const text = (el as HTMLElement).innerText?.trim();
          if (text && !errors.includes(text)) {
            errors.push(text);
          }
        });
      });

      successSelectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => {
          const text = (el as HTMLElement).innerText?.trim();
          if (text && !success.includes(text)) {
            success.push(text);
          }
        });
      });

      // Also check for page-level messages
      if (document.body.innerText.includes('error') && !errors.some(e => e.toLowerCase().includes('error'))) {
        const bodyText = document.body.innerText;
        if (bodyText.length < 500) { // Only if it's a short message
          errors.push(bodyText);
        }
      }

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
      await this.persistSession(`error_${actionName}`);
      return null;
    }
  }

  private async persistSession(actionName: string): Promise<void> {
    try {
      const markerFile = path.join(this.sessionDir, 'kilo-action.log');
      const entry = `[${new Date().toISOString()}] ${actionName}\n`;
      fs.appendFileSync(markerFile, entry, 'utf8');

      // Also save current page state periodically
      if (['openPage', 'click', 'fill', 'login'].includes(actionName)) {
        const state = await this.getPageState();
        const stateFile = path.join(this.sessionDir, 'kilo-page-state.json');
        fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
      }
    } catch (err) {
      this.log(`Could not persist session action metadata: ${err}`);
    }
  }

  async click(selector: string, options?: { text?: string }): Promise<boolean> {
    return this.safeExecute(async () => {
      if (!this.activePage) throw new Error('No active page');

      try {
        if (options?.text) {
          await this.activePage.click(`text="${options.text}"`, { timeout: 10000 });
        } else {
          await this.activePage.click(selector, { timeout: 10000 });
        }

        await this.activePage.waitForLoadState('networkidle');
        this.log(`Clicked: ${options?.text || selector}`);
        return true;
      } catch (error) {
        this.log(`Click failed for ${selector}: ${error}`);
        throw error;
      }
    }, `click(${options?.text || selector})`) || false;
  }

  async fill(selector: string, value: string): Promise<boolean> {
    return this.safeExecute(async () => {
      if (!this.activePage) throw new Error('No active page');

      try {
        await this.activePage.fill(selector, value);
        this.log(`Filled ${selector} with value`);
        return true;
      } catch (error) {
        this.log(`Fill failed for ${selector}: ${error}`);
        throw error;
      }
    }, `fill(${selector})`) || false;
  }

  async selectOption(selector: string, value: string): Promise<boolean> {
    return this.safeExecute(async () => {
      if (!this.activePage) throw new Error('No active page');

      try {
        await this.activePage.selectOption(selector, value);
        this.log(`Selected ${value} in ${selector}`);
        return true;
      } catch (error) {
        this.log(`Select failed for ${selector}: ${error}`);
        throw error;
      }
    }, `select(${selector})`) || false;
  }

  async login(username: string, password: string): Promise<boolean> {
    return this.safeExecute(async () => {
      if (!this.activePage) throw new Error('No active page');

      // Try common login form patterns for enterprise apps
      const usernameSelectors = [
        'input[name="username"]',
        'input[name="user"]',
        'input[name="email"]',
        'input[type="email"]',
        'input[id*="user"]',
        'input[id*="login"]',
        '#username',
        '#user',
        '[aria-label*="username"]',
        '[aria-label*="user"]'
      ];

      const passwordSelectors = [
        'input[name="password"]',
        'input[type="password"]',
        '#password',
        '[aria-label*="password"]'
      ];

      let usernameFilled = false;
      let passwordFilled = false;

      // Try to find and fill username
      for (const sel of usernameSelectors) {
        try {
          const el = await this.activePage.$(sel);
          if (el) {
            await this.activePage.fill(sel, username);
            usernameFilled = true;
            break;
          }
        } catch {}
      }

      // Try to find and fill password
      for (const sel of passwordSelectors) {
        try {
          const el = await this.activePage.$(sel);
          if (el) {
            await this.activePage.fill(sel, password);
            passwordFilled = true;
            break;
          }
        } catch {}
      }

      if (!usernameFilled || !passwordFilled) {
        throw new Error('Could not find username or password fields');
      }

      // Try to submit - multiple patterns for enterprise apps
      const submitSelectors = [
        'button[type="submit"]',
        'input[type="submit"]',
        'button:has-text("Login")',
        'button:has-text("Sign in")',
        'button:has-text("Log in")',
        '[role="button"][aria-label*="login"]',
        '[aria-label*="sign in"]'
      ];

      for (const sel of submitSelectors) {
        try {
          await this.activePage.click(sel, { timeout: 5000 });
          await this.activePage.waitForLoadState('networkidle');
          this.log('Login submitted successfully');
          return true;
        } catch {}
      }

      // If no submit button found, try pressing Enter
      await this.activePage.keyboard.press('Enter');
      await this.activePage.waitForLoadState('networkidle');

      this.log('Login attempted with Enter key');
      return true;
    }, 'login') || false;
  }

  async waitForSelector(selector: string, timeout: number = 30000): Promise<boolean> {
    return this.safeExecute(async () => {
      if (!this.activePage) throw new Error('No active page');

      await this.activePage.waitForSelector(selector, { timeout });
      this.log(`Waited for selector: ${selector}`);
      return true;
    }, `waitForSelector(${selector})`) || false;
  }

  async waitForText(text: string, timeout: number = 30000): Promise<boolean> {
    return this.safeExecute(async () => {
      if (!this.activePage) throw new Error('No active page');

      await this.activePage.waitForFunction(
        (text) => document.body.textContent?.includes(text),
        { timeout },
        text
      );
      this.log(`Waited for text: ${text}`);
      return true;
    }, `waitForText(${text})`) || false;
  }

  async screenshot(): Promise<string> {
    if (!this.activePage) throw new Error('No active page');

    const buffer = await this.activePage.screenshot({
      type: 'png',
      fullPage: true
    });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = path.join(this.sessionDir, `screenshot-${timestamp}.png`);
    fs.writeFileSync(filePath, buffer);

    this.log(`Screenshot saved to ${filePath}`);
    return filePath;
  }

  async getAccessibleDescription(): Promise<string> {
    const state = await this.getPageState();

    let description = `# Page: ${state.title}\n`;
    description += `URL: ${state.url}\n\n`;

    if (state.errors.length > 0) {
      description += `## ⚠️ ERRORS:\n`;
      state.errors.forEach((e, i) => description += `${i + 1}. ${e}\n`);
      description += '\n';
    }

    if (state.successMessages.length > 0) {
      description += `## ✅ SUCCESS MESSAGES:\n`;
      state.successMessages.forEach((m, i) => description += `${m}\n`);
      description += '\n';
    }

    if (state.forms.length > 0) {
      description += `## FORMS:\n`;
      state.forms.forEach((form, formIdx) => {
        description += `### ${formIdx + 1}. ${form.name}\n`;
        form.fields.forEach((f, fieldIdx) => {
          const value = f.value ? ` (value: ${f.value})` : '';
          description += `${formIdx + 1}.${fieldIdx + 1}. ${f.label} (${f.type})${value}\n`;
        });
        if (form.submitButton) {
          description += `   Submit: ${form.submitButton}\n`;
        }
      });
      description += '\n';
    }

    if (state.tables.length > 0) {
      description += `## TABLES:\n`;
      state.tables.forEach((table, tableIdx) => {
        description += `### Table ${tableIdx + 1} (${table.rowCount} rows × ${table.colCount} cols)\n`;
        if (table.headers.length > 0) {
          description += `Headers: ${table.headers.join(' | ')}\n`;
        }
        table.rows.slice(0, 5).forEach((row, rowIdx) => {
          description += `  Row ${rowIdx + 1}: ${row.join(' | ')}\n`;
        });
        if (table.rows.length > 5) {
          description += `  ... and ${table.rows.length - 5} more rows\n`;
        }
        description += `\n`;
      });
    }

    description += `## INTERACTIVE ELEMENTS (Top 30):\n`;
    const clickable = state.elements.filter(e => e.isClickable);
    clickable.slice(0, 30).forEach((el, idx) => {
      const label = el.ariaLabel || el.text || el.role;
      if (label) {
        description += `${idx + 1}. [${el.role}] ${label}\n`;
      }
    });

    return description;
  }

  async close(): Promise<void> {
    await this.safeExecute(async () => {
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
        this.context = null;
        this.pages.clear();
        this.activePage = null;
        this.log('Browser closed');
      }
    }, 'closeBrowser');
  }

  private log(message: string): void {
    const timestamp = new Date().toISOString();
    this.outputChannel.appendLine(`[${timestamp}] ${message}`);
    console.log(`[Kilo Browser] ${message}`);
  }

  // Debug method to check session state
  async checkSession(): Promise<{ active: boolean; pageCount: number; lastAction: string }> {
    return {
      active: !!this.activePage,
      pageCount: this.pages.size,
      lastAction: fs.existsSync(path.join(this.sessionDir, 'kilo-action.log')) ?
        fs.readFileSync(path.join(this.sessionDir, 'kilo-action.log'), 'utf8').split('\n').slice(-2)[0] :
        'No actions recorded'
    };
  }
}
