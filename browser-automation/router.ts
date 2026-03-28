import express from 'express';
import { BrowserController } from './BrowserController';
import { BrowserTools } from './BrowserTools';

const router = express.Router();

const controller = new BrowserController({ headless: true });
const tools = new BrowserTools(controller);

router.post('/free-coding-agent/browser', async (req, res) => {
    const task = req.body?.task || req.body?.prompt;
    if (!task) {
        return res.status(400).json({ success: false, error: 'task/prompt required' });
    }

    try {
        // minimal agent flow for demonstration: URL extraction / check
        const urlMatch = task.match(/https?:\/\/[^\s]+/);
        if (!urlMatch) {
            return res.status(400).json({ success: false, error: 'No URL found in task for browser automation' });
        }

        const url = urlMatch[0];
        const result = await tools.browseUrl(url);
        res.json({ success: true, extra: { url, title: result.title }, screenshot: result.screenshotBase64 });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message || String(err) });
    } finally {
        await controller.close().catch(() => undefined);
    }
});

export default router;
