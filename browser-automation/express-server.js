const express = require('express');
const bodyParser = require('body-parser');
const BrowserController = require('./BrowserController');
const BrowserTools = require('./BrowserTools');
const Mesh = require('../we/pcm/Mesh');

const app = express();
app.use(bodyParser.json({ limit: '5mb' }));

const controller = new BrowserController({ headless: true, timeoutMs: 18000 });
const tools = new BrowserTools(controller);

// PCM mesh setup (PR #5 endpoint integration)
const mesh = new Mesh({
    maxAgents: parseInt(process.env.PCM_AGENTS || '10', 10),
    blipSecret: process.env.PCM_BLIP_SECRET || 'default-secret',
    processor: null,
    hotPath: process.env.PCM_HOT || './we/pcm/storage/hot',
    warmPath: process.env.PCM_WARM || './we/pcm/storage/warm',
    coldPath: process.env.PCM_COLD || './we/pcm/storage/cold'
});
mesh.init({ agentCount: parseInt(process.env.PCM_AGENTS || '10', 10) }).catch(err => console.error('Mesh init error:', err));

app.post('/free-coding-agent/browser', async (req, res) => {
    const task = req.body?.task || req.body?.prompt;
    if (!task) {
        return res.status(400).json({ success: false, error: 'task/prompt required' });
    }

    const urlMatch = task.match(/https?:\/\/[^\s]+/);
    if (!urlMatch) {
        return res.status(400).json({ success: false, error: 'No URL found in task for browser automation' });
    }

    try {
        const url = urlMatch[0];
        const result = await tools.browseUrl(url);
        res.json({ success: true, url, title: result.title, screenshot: result.screenshotBase64 });
    } catch (err) {
        res.status(500).json({ success: false, error: err?.message || String(err) });
    } finally {
        await controller.close().catch(() => undefined);
    }
});

app.get('/free-coding-agent/browser/health', (req, res) => {
    res.json({ success: true, message: 'Browser automation route is up' });
});

// PR #5: Free coding agent endpoint wiring
app.post('/free-coding-agent/run', async (req, res) => {
    const input = req.body?.input || req.body?.prompt;
    if (!input) return res.status(400).json({ success: false, error: 'input/prompt required' });

    try {
        const result = await mesh.think(input, { mode: 'triad', useTriad: true });
        res.json({ success: true, result });
    } catch (err) {
        res.status(500).json({ success: false, error: err?.message || String(err) });
    }
});

app.get('/free-coding-agent/watchdog', (req, res) => {
    try {
        const status = mesh.getStatus();
        const watchdog = mesh.getPhase9Status();
        res.json({ success: true, status, watchdog });
    } catch (err) {
        res.status(500).json({ success: false, error: err?.message || String(err) });
    }
});

const port = process.env.PORT || 8011;
app.listen(port, () => {
    console.log(`Browser automation server listening at http://localhost:${port}`);
});
