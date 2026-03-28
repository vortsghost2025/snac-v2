const BrowserController = require('./BrowserController');

class BrowserTools {
    constructor(controller) {
        this.controller = controller;
    }

    async browseUrl(url) {
        await this.controller.launch();
        const title = await this.controller.goto(url);
        const screenshot = await this.controller.screenshot();
        return { title, screenshotBase64: screenshot.toString('base64') };
    }

    async checkAccessibility(url) {
        await this.controller.launch();
        await this.controller.goto(url);

        const accessibilityReport = await this.controller.evaluate(() => {
            const result = [];
            document.querySelectorAll('a, button, input, textarea, select').forEach(el => {
                const role = el.getAttribute('role') || el.tagName.toLowerCase();
                const name = el.getAttribute('aria-label') || el.textContent?.trim() || null;
                result.push({ role, name, hasName: !!name });
            });
            return result;
        });

        return { accessibilityReport };
    }
}

module.exports = BrowserTools;
