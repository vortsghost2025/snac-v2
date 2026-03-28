const axios = require('axios');
const logger = require('../utils/logger');
const { EventEmitter } = require('events');

class ModelSwapper extends EventEmitter {
  constructor() {
    super();
    this.mlflowUrl = process.env.MLFLOW_URL || 'http://localhost:5000';
    this.currentVersion = null;
    this.pollInterval = 30_000; // 30s
    this.baseModelName = process.env.BASE_MODEL_NAME || 'snac-lora';
    this.startPolling();
  }

  async startPolling() {
    logger.info('Starting model swap polling...');
    
    while (true) {
      try {
        // Get the latest registered model version
        const resp = await axios.get(`${this.mlflowUrl}/api/2.0/mlflow/registered-models/get`,
          { 
            params: { name: this.baseModelName },
            timeout: 10000  // 10 second timeout
          });
        
        const latest = resp.data.registered_model.latest_versions.find(v => v.current_stage === 'Production');
        
        if (latest && latest.version !== this.currentVersion) {
          logger.info({ 
            version: latest.version, 
            previous: this.currentVersion 
          }, 'New production model version detected');
          
          await this.loadAdapter(latest.source);
          this.currentVersion = latest.version;
          this.emit('swapped', { version: latest.version, source: latest.source });
        }
      } catch (e) {
        if (e.response && e.response.status === 404) {
          logger.warn(`Model ${this.baseModelName} not found in MLflow registry yet`);
        } else {
          logger.error({ err: e, url: this.mlflowUrl }, 'Failed to poll MLflow');
        }
      }
      
      await new Promise(r => setTimeout(r, this.pollInterval));
    }
  }

  async loadAdapter(url) {
    // In a real implementation, this would load the LoRA adapter into the LlamaBridge
    // For now, we'll just log that the swap happened
    logger.info(`Model adapter would be loaded from: ${url}`);
    
    // Emit an event that other components can listen for
    this.emit('modelChanged', { 
      version: this.currentVersion, 
      adapterUrl: url 
    });
  }
  
  getCurrentVersion() {
    return this.currentVersion;
  }
}

// Create a singleton instance
const modelSwapper = new ModelSwapper();

module.exports = modelSwapper;