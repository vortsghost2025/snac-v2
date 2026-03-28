const { createClient } = require('redis');
const logger = require('../utils/logger');

class FeedbackCollector {
  constructor() {
    this.redis = createClient({ 
      url: process.env.REDIS_URL || 'redis://localhost:6379'
    });
    this.channel = 'feedback';
    this.redis.connect().then(() => {
      this.redis.subscribe(this.channel, this.handleMessage.bind(this));
      logger.info('Subscribed to feedback channel');
    }).catch(err => {
      logger.error({ err }, 'Failed to connect to Redis');
    });
  }

  async handleMessage(raw) {
    try {
      const msg = JSON.parse(raw);
      // Expected shape: { prompt, response, reward, latency, costUsd, timestamp, agentId }
      await this.store(msg);
    } catch (e) {
      logger.error({ err: e }, 'Failed to process feedback');
    }
  }

  async store({ prompt, response, reward, latency, costUsd, timestamp, agentId }) {
    // Append to a Redis list – the trainer will pop batches
    const entry = JSON.stringify({ 
      prompt, 
      response, 
      reward, 
      latency, 
      costUsd, 
      timestamp: timestamp || Date.now(),
      agentId: agentId || 'unknown'
    });
    await this.redis.rpush('training:queue', entry);
    logger.debug({ 
      promptLen: prompt.length, 
      reward,
      agentId 
    }, 'Queued training sample');
  }
  
  // Method to manually add feedback from API calls
  async addFeedback(feedbackData) {
    await this.store(feedbackData);
  }
}

module.exports = FeedbackCollector;