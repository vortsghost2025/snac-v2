const { createClient } = require('redis');
const logger = require('../../utils/logger');

class FeedbackCollector {
  constructor() {
    this.redis = null;
    this.channel = 'feedback';
    this._connected = false;
    this._connecting = false;
  }

  async initialize() {
    // Prevent multiple simultaneous connection attempts
    if (this._connecting) {
      return;
    }
    
    // Throttle reconnection attempts (exponential backoff)
    if (this._lastReconnectAttempt) {
      const timeSinceLastAttempt = Date.now() - this._lastReconnectAttempt;
      const backoffDelay = Math.min(30000, Math.pow(2, this._reconnectAttempts) * 1000);
      
      if (timeSinceLastAttempt < backoffDelay) {
        logger.warn(`FeedbackCollector reconnect throttled. Waiting ${Math.ceil((backoffDelay - timeSinceLastAttempt)/1000)}s`);
        return;
      }
    }
    
    if (this._connected) {
      return;
    }
    
    this._connecting = true;
    this._lastReconnectAttempt = Date.now();
    this._reconnectAttempts = (this._reconnectAttempts || 0) + 1;
    
    try {
      // Close existing client if any (prevent leak)
      if (this.redis) {
        try {
          await this.redis.quit();
        } catch (e) {
          // Ignore close errors
        }
        this.redis = null;
      }
      
      this.redis = createClient({ 
        url: process.env.REDIS_URL || 'redis://localhost:6379'
      });
      
      await this.redis.connect();
      this._connected = true;
      this._reconnectAttempts = 0; // Reset on success
      
      await this.redis.subscribe(this.channel, this.handleMessage.bind(this));
      logger.info('Subscribed to feedback channel');
    } catch (err) {
      logger.error({ err }, 'Failed to connect to Redis');
      this._connected = false;
    } finally {
      this._connecting = false;
    }
  }

  async handleMessage(raw) {
    try {
      const msg = JSON.parse(raw);
      await this.store(msg);
    } catch (e) {
      logger.error({ err: e }, 'Failed to process feedback');
    }
  }

  async store({ prompt, response, reward, latency, costUsd, timestamp, agentId }) {
    // Ensure connection is established before storing
    if (!this._connected) {
      await this.initialize();
    }
    
    if (!this._connected) {
      logger.warn('Redis not connected, skipping feedback store');
      return;
    }
    
    // Validate inputs
    if (typeof prompt !== 'string' || prompt.length === 0) {
      logger.warn('Invalid prompt in feedback, skipping');
      return;
    }
    if (typeof reward !== 'number' || !isFinite(reward)) {
      logger.warn('Invalid reward in feedback, skipping');
      return;
    }
    
    // Truncate large prompts to prevent Redis memory exhaustion
    const MAX_PROMPT_LEN = 10000;
    const truncatedPrompt = prompt.length > MAX_PROMPT_LEN 
      ? prompt.substring(0, MAX_PROMPT_LEN) + '...' 
      : prompt;
    
    const entry = JSON.stringify({ 
      prompt: truncatedPrompt, 
      response: typeof response === 'string' ? response.substring(0, MAX_PROMPT_LEN) : response,
      reward, 
      latency, 
      costUsd, 
      timestamp: timestamp || Date.now(),
      agentId: agentId || 'unknown'
    });
    
    try {
      await this.redis.rpush('training:queue', entry);
    } catch (err) {
      logger.error({ err }, 'Failed to store feedback to Redis');
    }
  }
  
  async addFeedback(feedbackData) {
    await this.store(feedbackData);
  }

  async close() {
    try {
      if (this._connected && this.redis) {
        await this.redis.unsubscribe(this.channel);
        await this.redis.quit();
        this._connected = false;
        logger.info('FeedbackCollector Redis connection closed');
      }
    } catch (e) {
      logger.error({ err: e }, 'Error closing FeedbackCollector');
    }
  }
}

// Cleanup on process exit
process.on('beforeExit', async () => {
  // Singleton cleanup handled by the owning module
});

module.exports = FeedbackCollector;
