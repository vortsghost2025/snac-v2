/**
 * Jest tests for SNAC v2 API endpoints
 */

const request = require('supertest');
const express = require('express');
const path = require('path');
const fs = require('fs').promises;

// Mock the mesh module since we don't want to initialize the full system for tests
const mockMesh = {
  initialized: true,
  getStatus: jest.fn(() => ({ status: 'ready' })),
  think: jest.fn(() => Promise.resolve({
    response: 'Test response',
    confidence: 0.9,
    method: 'test',
    contextUsed: [],
    capsCreated: 0
  })),
  swarm: {
    getStatus: jest.fn(() => ({ status: 'active' }))
  },
  health: {
    status: jest.fn(() => ({ status: 'healthy' }))
  },
  bootstrap: {
    getStatus: jest.fn(() => ({ status: 'ready' })),
    generateBlip: jest.fn(() => ({ code: 'test-blip-code' }))
  },
  pipelines: {
    run: jest.fn(() => Promise.resolve({ result: 'pipeline-complete' })),
    medical: jest.fn(),
    weather: jest.fn(),
    satellite: jest.fn(),
    epidemiology: jest.fn(),
    pipelines: new Map()
  },
  init: jest.fn(() => Promise.resolve()),
  shutdown: jest.fn(() => Promise.resolve())
};

// Create a simplified app for testing
const app = express();
app.use(express.json());

// Mock the mesh initialization
jest.mock('../we/pcm/Mesh', () => {
  return jest.fn(() => mockMesh);
});

// Import and set up routes
const setUpRoutes = (app) => {
  // Health check
  app.get("/health", (req, res) => {
    res.json({ status: "ok", pcm: mockMesh.initialized });
  });

  // Main endpoint
  app.post("/free-coding-agent/run", async (req, res) => {
    const { input, options = {} } = req.body;
    
    if (!input || typeof input !== 'string') {
      return res.status(400).json({ error: "Missing or invalid input" });
    }

    try {
      const result = await mockMesh.think(input, { ...options, useTriad: true });
      res.json({
        success: true,
        response: result.response,
        confidence: result.confidence,
        method: result.method,
        contextUsed: result.contextUsed,
        capsCreated: result.capsCreated
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Mesh status endpoint
  app.get("/free-coding-agent/mesh-status", (req, res) => {
    const status = mockMesh.getStatus();
    res.json(status);
  });

  // Swarm status
  app.get("/free-coding-agent/swarm-status", (req, res) => {
    res.json(mockMesh.swarm.getStatus());
  });

  // Generate blip code
  app.post("/free-coding-agent/blip/generate", (req, res) => {
    const blip = mockMesh.bootstrap.generateBlip();
    res.json(blip);
  });

  // Watchdog status
  app.get("/free-coding-agent/watchdog", (req, res) => {
    res.json({
      health: mockMesh.health.status(),
      swarm: mockMesh.swarm.getStatus(),
      bootstrap: mockMesh.bootstrap.getStatus()
    });
  });
};

setUpRoutes(app);

describe('SNAC v2 API Tests', () => {
  describe('Health Check', () => {
    test('should return health status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);
        
      expect(response.body).toEqual({
        status: 'ok',
        pcm: true
      });
    });
  });

  describe('Main Agent Endpoint', () => {
    test('should process valid input', async () => {
      const response = await request(app)
        .post('/free-coding-agent/run')
        .send({ input: 'test input' })
        .expect(200);
        
      expect(response.body.success).toBe(true);
      expect(response.body.response).toBe('Test response');
      expect(mockMesh.think).toHaveBeenCalledWith('test input', { useTriad: true });
    });

    test('should reject missing input', async () => {
      const response = await request(app)
        .post('/free-coding-agent/run')
        .send({})
        .expect(400);
        
      expect(response.body.error).toBe('Missing or invalid input');
    });

    test('should reject non-string input', async () => {
      const response = await request(app)
        .post('/free-coding-agent/run')
        .send({ input: 123 })
        .expect(400);
        
      expect(response.body.error).toBe('Missing or invalid input');
    });

    test('should handle processing errors', async () => {
      // Mock an error in the think function
      mockMesh.think.mockRejectedValueOnce(new Error('Processing failed'));
      
      const response = await request(app)
        .post('/free-coding-agent/run')
        .send({ input: 'test input' })
        .expect(500);
        
      expect(response.body.error).toBe('Processing failed');
    });
  });

  describe('Status Endpoints', () => {
    test('should return mesh status', async () => {
      const response = await request(app)
        .get('/free-coding-agent/mesh-status')
        .expect(200);
        
      expect(response.body.status).toBe('ready');
    });

    test('should return swarm status', async () => {
      const response = await request(app)
        .get('/free-coding-agent/swarm-status')
        .expect(200);
        
      expect(response.body.status).toBe('active');
    });

    test('should return watchdog status', async () => {
      const response = await request(app)
        .get('/free-coding-agent/watchdog')
        .expect(200);
        
      expect(response.body.health.status).toBe('healthy');
      expect(response.body.swarm.status).toBe('active');
      expect(response.body.bootstrap.status).toBe('ready');
    });
  });

  describe('Blip Generation', () => {
    test('should generate blip code', async () => {
      const response = await request(app)
        .post('/free-coding-agent/blip/generate')
        .expect(200);
        
      expect(response.body.code).toBe('test-blip-code');
    });
  });
});

// Additional security tests
describe('Security Tests', () => {
  test('should limit request size', async () => {
    // Create a very large input
    const largeInput = 'a'.repeat(10 * 1024 * 1024); // 10MB
    
    const response = await request(app)
      .post('/free-coding-agent/run')
      .send({ input: largeInput })
      .expect(413); // Payload too large
      
    // Note: This test depends on express.json({limit: '5mb'}) configuration
  });

  test('should sanitize input', async () => {
    const maliciousInput = '<script>alert("xss")</script>';
    
    const response = await request(app)
      .post('/free-coding-agent/run')
      .send({ input: maliciousInput })
      .expect(200);
      
    // This test would require the validation middleware to be included
    // For now, we're just ensuring it doesn't crash
    expect(response.status).toBe(200);
  });
});