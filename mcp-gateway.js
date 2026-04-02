const express = require('express');
const { createClient } = require('redis');

const chatRouter = express.Router();

const redisUrl = process.env.REDIS_URL || 'redis://redis:6379';

let redisClient = null;

async function getRedisClient() {
  if (!redisClient) {
    redisClient = createClient({ url: redisUrl });
    redisClient.on('error', (err) => console.error('Redis Client Error:', err));
    await redisClient.connect();
  }
  return redisClient;
}

chatRouter.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

chatRouter.post('/chat', async (req, res) => {
  try {
    const { from, message } = req.body;
    if (!from || !message) {
      return res.status(400).json({ error: 'Missing from or message' });
    }

    const client = await getRedisClient();
    const chatMessage = JSON.stringify({
      from,
      message,
      timestamp: Date.now()
    });

    await client.lPush('chat:messages', chatMessage);
    await client.lTrim('chat:messages', 0, 999);

    res.json({ success: true });
  } catch (err) {
    console.error('Error posting chat:', err);
    res.status(500).json({ error: 'Failed to post message' });
  }
});

chatRouter.get('/chat', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    
    const client = await getRedisClient();
    const messages = await client.lRange('chat:messages', 0, limit - 1);
    
    const parsed = messages.map(m => {
      try {
        return JSON.parse(m);
      } catch {
        return { raw: m };
      }
    });
    
    res.json({ messages: parsed });
  } catch (err) {
    console.error('Error getting chat:', err);
    res.status(500).json({ error: 'Failed to get messages' });
  }
});

module.exports = chatRouter;
