const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.KILO_GATEWAY_PORT || 3002;

const agents = new Map();

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', agents: agents.size, uptime: process.uptime() }));
    return;
  }

  if (req.method === 'GET' && req.url === '/api/agents') {
    const list = [];
    for (const [name, info] of agents) {
      list.push({
        name,
        connectedAt: info.connectedAt,
        lastSeen: info.lastSeen,
        state: info.state || 'idle'
      });
    }
    res.writeHead(200);
    res.end(JSON.stringify(list));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'not found' }));
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  let agentName = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      ws.send(JSON.stringify({ type: 'error', error: 'invalid json' }));
      return;
    }

    if (msg.type === 'register') {
      agentName = msg.agentId || msg.name;
      if (!agentName) {
        ws.send(JSON.stringify({ type: 'error', error: 'missing agentId' }));
        return;
      }
      agents.set(agentName, {
        ws,
        connectedAt: Date.now(),
        lastSeen: Date.now(),
        state: 'idle'
      });
      ws.send(JSON.stringify({ type: 'registered', agentId: agentName }));
      broadcast({ type: 'event', event: 'agent_connected', agentId: agentName }, ws);
      return;
    }

    if (!agentName) {
      ws.send(JSON.stringify({ type: 'error', error: 'register first' }));
      return;
    }

    agents.get(agentName).lastSeen = Date.now();
    if (msg.state) {
      agents.get(agentName).state = msg.state;
    }

    const target = msg.target || msg.to;
    if (target && target !== 'broadcast') {
      const dest = agents.get(target);
      if (dest && dest.ws.readyState === 1) {
        dest.ws.send(JSON.stringify({ ...msg, source: agentName }));
      } else {
        ws.send(JSON.stringify({ type: 'error', error: 'target not found', target }));
      }
      return;
    }

    broadcast({ ...msg, source: agentName }, ws);
  });

  ws.on('close', () => {
    if (agentName) {
      agents.delete(agentName);
      broadcast({ type: 'event', event: 'agent_disconnected', agentId: agentName });
    }
  });
});

function broadcast(msg, exclude) {
  const data = JSON.stringify(msg);
  for (const [, info] of agents) {
    if (info.ws !== exclude && info.ws.readyState === 1) {
      info.ws.send(data);
    }
  }
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Kilo Gateway listening on port ${PORT}`);
});
