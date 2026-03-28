/**
 * Prometheus Metrics Setup for SNAC v2
 * Provides monitoring and observability for the agent system
 */

const client = require('prom-client');
const express = require('express');

// Create a Registry which registers the metrics
const register = new client.Registry();

// Add default metrics (CPU, memory, etc.)
require('prom-client').collectDefaultMetrics({
  register,
  prefix: 'snac_',
});

// Define custom metrics
const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.1, 0.5, 1, 2, 5, 10] // 0.1s, 0.5s, 1s, 2s, 5s, 10s
});

const httpRequestTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code']
});

const agentProcessingTime = new client.Histogram({
  name: 'agent_processing_duration_seconds',
  help: 'Duration of agent processing in seconds',
  labelNames: ['agent_type', 'model_used'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60]
});

const agentErrorsTotal = new client.Counter({
  name: 'agent_errors_total',
  help: 'Total number of agent errors',
  labelNames: ['agent_type', 'error_type']
});

const activeAgents = new client.Gauge({
  name: 'active_agents_count',
  help: 'Number of currently active agents'
});

const agentConfidenceScore = new client.Summary({
  name: 'agent_confidence_score',
  help: 'Summary of agent confidence scores',
  percentiles: [0.5, 0.9, 0.95, 0.99]
});

// Register the metrics
register.registerMetric(httpRequestDuration);
register.registerMetric(httpRequestTotal);
register.registerMetric(agentProcessingTime);
register.registerMetric(agentErrorsTotal);
register.registerMetric(activeAgents);
register.registerMetric(agentConfidenceScore);

// Middleware to track request metrics
const metricsMiddleware = (req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000; // Convert to seconds
    
    // Track request count
    httpRequestTotal.inc({
      method: req.method,
      route: req.route?.path || req.path,
      status_code: res.statusCode
    });
    
    // Track request duration
    httpRequestDuration.observe(
      { 
        method: req.method, 
        route: req.route?.path || req.path, 
        status_code: res.statusCode 
      }, 
      duration
    );
  });
  
  next();
};

// Function to track agent processing metrics
const trackAgentProcessing = (agentType, modelUsed, duration, confidence) => {
  agentProcessingTime.observe(
    { agent_type: agentType, model_used: modelUsed },
    duration
  );
  
  if (confidence !== undefined) {
    agentConfidenceScore.observe(confidence);
  }
};

// Function to track agent errors
const trackAgentError = (agentType, errorType) => {
  agentErrorsTotal.inc({
    agent_type: agentType,
    error_type: errorType
  });
};

// Function to update active agent count
const updateActiveAgents = (count) => {
  activeAgents.set(count);
};

// Create an Express app to serve metrics
const createMetricsApp = () => {
  const app = express();
  
  app.get('/metrics', async (req, res) => {
    try {
      res.set('Content-Type', register.contentType);
      res.end(await register.metrics());
    } catch (ex) {
      res.status(500).end(ex);
    }
  });
  
  return app;
};

module.exports = {
  metricsMiddleware,
  trackAgentProcessing,
  trackAgentError,
  updateActiveAgents,
  createMetricsApp,
  register
};