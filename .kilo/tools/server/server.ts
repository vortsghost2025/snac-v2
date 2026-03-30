import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import Redis from 'redis';
import * as Joi from '@hapi/joi';

// Configuration
const PORT = process.env.PORT || 4000;
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379');
const MESH_TOKEN = process.env.MESH_TOKEN || 'default-token';

// Initialize Express app
const app = express();
const server = createServer(app);

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));
app.use(cors());
app.use(express.json());

// Redis client
const redis = Redis.createClient({
  url: `redis://${REDIS_HOST}:${REDIS_PORT}`
});

redis.on('error', (err) => {
  console.error('Redis Client Error:', err);
});

// WebSocket server for peer-to-peer mesh
const wss = new WebSocketServer({ server });
const peers = new Map();

// WebSocket connection handler
wss.on('connection', (ws, req) => {
  const peerId = req.headers['x-peer-id'] || `peer-${Date.now()}`;
  peers.set(peerId, ws);
  
  console.log(`Peer connected: ${peerId}`);
  
  // Send peer list to new connection
  const peerList = Array.from(peers.keys());
  ws.send(JSON.stringify({
    type: 'peer-list',
    peers: peerList.filter(id => id !== peerId)
  }));
  
  // Notify other peers
  peers.forEach((peer, id) => {
    if (id !== peerId && peer.readyState === 1) {
      peer.send(JSON.stringify({
        type: 'peer-joined',
        peerId: peerId
      }));
    }
  });
  
  // Handle messages
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      
      switch (data.type) {
        case 'peer-message':
          // Relay message to target peer
          const targetPeer = peers.get(data.targetPeerId);
          if (targetPeer && targetPeer.readyState === 1) {
            targetPeer.send(JSON.stringify({
              type: 'peer-message',
              fromPeerId: peerId,
              message: data.message
            }));
          }
          break;
          
        case 'broadcast':
          // Broadcast to all peers
          peers.forEach((peer, id) => {
            if (id !== peerId && peer.readyState === 1) {
              peer.send(JSON.stringify({
                type: 'broadcast',
                fromPeerId: peerId,
                message: data.message
              }));
            }
          });
          break;
          
        case 'health-check':
          ws.send(JSON.stringify({
            type: 'health-response',
            status: 'ok',
            timestamp: new Date().toISOString()
          }));
          break;
      }
    } catch (error) {
      console.error('WebSocket message error:', error);
    }
  });
  
  // Handle disconnection
  ws.on('close', () => {
    peers.delete(peerId);
    console.log(`Peer disconnected: ${peerId}`);
    
    // Notify other peers
    peers.forEach((peer, id) => {
      if (peer.readyState === 1) {
        peer.send(JSON.stringify({
          type: 'peer-left',
          peerId: peerId
        }));
      }
    });
  });
});

// Routes
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    peers: peers.size,
    redis: redis.isOpen ? 'connected' : 'disconnected'
  });
});

app.get('/api/peers', (req, res) => {
  res.json({
    peers: Array.from(peers.keys()),
    count: peers.size
  });
});

app.post('/api/support-request', async (req, res) => {
  const schema = Joi.object({
    message: Joi.string().required(),
    urgency: Joi.string().valid('low', 'medium', 'high').default('medium'),
    category: Joi.string().valid('emotional', 'technical', 'medical', 'general').default('general')
  });
  
  try {
    const { error, value } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }
    
    // Store support request in Redis
    const requestId = `req-${Date.now()}`;
    await redis.setEx(requestId, 3600, JSON.stringify({
      ...value,
      timestamp: new Date().toISOString(),
      status: 'pending'
    }));
    
    // Broadcast to available peer supporters
    const broadcast = {
      type: 'support-request',
      requestId,
      ...value
    };
    
    peers.forEach((peer) => {
      if (peer.readyState === 1) {
        peer.send(JSON.stringify(broadcast));
      }
    });
    
    res.json({
      requestId,
      status: 'submitted',
      message: 'Support request submitted successfully'
    });
  } catch (error) {
    console.error('Support request error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Serve static files
app.use(express.static('public'));

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
server.listen(PORT, () => {
  console.log(`🧠 Mental Health Bridge running on port ${PORT}`);
  console.log(`🔗 WebSocket server ready for peer connections`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(async () => {
    await redis.quit();
    process.exit(0);
  });
});

export default app;
