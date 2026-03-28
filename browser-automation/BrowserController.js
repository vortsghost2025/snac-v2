const { chromium } = require('playwright');

class BrowserController {
    constructor(config = {}) {
        this.config = {
            headless: true,
            timeoutMs: 15000,
            ...config,
        };
        this.browser = null;
        this.context = null;
        this.page = null;
    }

    async launch() {
        if (this.browser) return;
        this.browser = await chromium.launch({ headless: !!this.config.headless });
        this.context = await this.browser.newContext({ viewport: { width: 1280, height: 800 } });
        this.page = await this.context.newPage();
        this.page.setDefaultTimeout(this.config.timeoutMs);
    }

    async close() {
        if (this.page) await this.page.close().catch(() => undefined);
        if (this.context) await this.context.close().catch(() => undefined);
        if (this.browser) await this.browser.close().catch(() => undefined);
        this.page = null;
        this.context = null;
        this.browser = null;
    }

    async goto(url) {
        if (!this.page) throw new Error('Browser page not initialized');
        await this.page.goto(url, { waitUntil: 'networkidle' });
        return this.page.title();
    }

    async click(selector) {
        if (!this.page) throw new Error('Browser page not initialized');
        await this.page.click(selector, { timeout: this.config.timeoutMs });
    }

    async type(selector, value) {
        if (!this.page) throw new Error('Browser page not initialized');
        await this.page.fill(selector, value, { timeout: this.config.timeoutMs });
    }

    async evaluate(script) {
        if (!this.page) throw new Error('Browser page not initialized');
        return this.page.evaluate(script);
    }

    async screenshot() {
        if (!this.page) throw new Error('Browser page not initialized');
        return this.page.screenshot({ type: 'png' });
    }
}

module.exports = BrowserController;
