const express = require('express');
const redis = require('redis');

const router = express.Router();

const redisClient = redis.createClient({
  url: process.env.REDIS_URL || 'redis://redis:6379'
});

redisClient.on('error', (err) => {
  console.error('Redis Client Error:', err);
});

redisClient.connect().catch(console.error);

router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

router.post('/chat', async (req, res) => {
  try {
    const { from, message } = req.body;
    if (!from || !message) {
      return res.status(400).json({ error: 'Missing from or message' });
    }

    const msg = JSON.stringify({ from, message, timestamp: Date.now() });
    await redisClient.lPush('chat:messages', msg);
    await redisClient.lTrim('chat:messages', 0, 999);

    res.json({ success: true });
  } catch (err) {
    console.error('Error storing message:', err);
    res.status(500).json({ error: 'Failed to store message' });
  }
});

router.get('/chat', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const messages = await redisClient.lRange('chat:messages', 0, limit - 1);
    const parsed = messages.map(m => {
      try {
        return JSON.parse(m);
      } catch {
        return m;
      }
    });
    res.json(parsed);
  } catch (err) {
    console.error('Error fetching messages:', err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

module.exports = router;