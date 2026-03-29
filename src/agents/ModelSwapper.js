const axios = require('axios');
const logger = require('../../utils/logger');
const { EventEmitter } = require('events');

class ModelSwapper extends EventEmitter {
  constructor() {
    super();
    this.mlflowUrl = process.env.MLFLOW_URL || 'http://localhost:5000';
    this.currentVersion = null;
    this.pollInterval = 30_000; // 30s
    this.baseModelName = process.env.BASE_MODEL_NAME || 'snac-lora';
    this._pollTimer = null;
    this._running = false;
  }

  startPolling() {
    if (this._running) return;
    this._running = true;
    logger.info('Starting model swap polling...');
    this._poll();
  }

  stopPolling() {
    this._running = false;
    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
    logger.info('Model swap polling stopped');
  }

  async _poll() {
    if (!this._running) return;

    try {
      const resp = await axios.get(`${this.mlflowUrl}/api/2.0/mlflow/registered-models/get`,
        { 
          params: { name: this.baseModelName },
          timeout: 10000
        });
      
      const versions = resp.data.registered_model && resp.data.registered_model.latest_versions;
      if (versions) {
        const latest = versions.find(v => v.current_stage === 'Production');
        
        if (latest && latest.version !== this.currentVersion) {
          logger.info({ 
            version: latest.version, 
            previous: this.currentVersion 
          }, 'New production model version detected');
          
          await this.loadAdapter(latest.source);
          this.currentVersion = latest.version;
          this.emit('swapped', { version: latest.version, source: latest.source });
        }
      }
    } catch (e) {
      if (e.response && e.response.status === 404) {
        logger.warn(`Model ${this.baseModelName} not found in MLflow registry yet`);
      } else {
        logger.error({ err: e, url: this.mlflowUrl }, 'Failed to poll MLflow');
      }
    }
    
    if (this._running) {
      this._pollTimer = setTimeout(() => this._poll(), this.pollInterval);
    }
  }

  async loadAdapter(url) {
    logger.info(`Model adapter would be loaded from: ${url}`);
    
    this.emit('modelChanged', { 
      version: this.currentVersion, 
      adapterUrl: url 
    });
  }
  
  getCurrentVersion() {
    return this.currentVersion;
  }
}

// Create singleton but do NOT start polling at import time
const modelSwapper = new ModelSwapper();

module.exports = modelSwapper;
