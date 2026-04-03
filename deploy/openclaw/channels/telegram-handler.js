const WebSocket = require('ws');
const fs = require('fs');
const yaml = require('js-yaml');

const configPath = process.env.TELEGRAM_CONFIG_PATH || './deploy/openclaw/channels/telegram.yaml';
let config;

try {
  const configFile = fs.readFileSync(configPath, 'utf8');
  config = yaml.load(configFile);
} catch (err) {
  console.error('Failed to load config:', err.message);
  config = {
    rate_limit: { max_requests: 10, window_ms: 60000 },
    gateway: { url: 'ws://localhost:8080/gateway', timeout: 30000 },
    message: { max_query_length: 1000, show_confidence: true }
  };
}

const rateLimitMap = new Map();

function checkRateLimit(userId) {
  const now = Date.now();
  const userLimits = rateLimitMap.get(userId);
  
  if (!userLimits) {
    rateLimitMap.set(userId, { count: 1, resetTime: now + config.rate_limit.window_ms });
    return true;
  }
  
  if (now > userLimits.resetTime) {
    rateLimitMap.set(userId, { count: 1, resetTime: now + config.rate_limit.window_ms });
    return true;
  }
  
  if (userLimits.count >= config.rate_limit.max_requests) {
    return false;
  }
  
  userLimits.count++;
  return true;
}

let gatewayWs = null;

function connectGateway() {
  return new Promise((resolve, reject) => {
    gatewayWs = new WebSocket(config.gateway.url);
    
    gatewayWs.on('open', () => {
      console.log('Connected to Trust Network gateway');
      resolve();
    });
    
    gatewayWs.on('error', (err) => {
      console.error('Gateway connection error:', err.message);
      reject(err);
    });
    
    gatewayWs.on('close', () => {
      console.log('Gateway disconnected, reconnecting...');
      setTimeout(() => connectGateway().catch(() => {}), 5000);
    });
  });
}

function queryTrustNetwork(query) {
  return new Promise((resolve, reject) => {
    if (!gatewayWs || gatewayWs.readyState !== WebSocket.OPEN) {
      return reject(new Error('Gateway not connected'));
    }
    
    const requestId = Date.now().toString(36) + Math.random().toString(36).substr(2);
    const timeout = setTimeout(() => reject(new Error('Request timeout')), config.gateway.timeout);
    
    const handler = (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.requestId === requestId) {
          clearTimeout(timeout);
          gatewayWs.removeListener('message', handler);
          resolve(msg);
        }
      } catch (e) {}
    };
    
    gatewayWs.on('message', handler);
    gatewayWs.send(JSON.stringify({ type: 'query', requestId, query }));
  });
}

async function handleCommand(bot, chatId, command, args) {
  switch (command) {
    case '/start':
    case '/help':
      await sendMessage(bot, chatId, 
        `*OpenClaw Telegram Bot*\n\n` +
        `Available commands:\n` +
        `/ask <question> - Ask a question to the Trust Network\n` +
        `/status - Show system health status\n` +
        `/agents - List available agents\n` +
        `/help - Show this help message`
      );
      break;
      
    case '/status':
      const status = await getSystemStatus();
      await sendMessage(bot, chatId, 
        `*System Status*\n\n` +
        `Gateway: ${status.gateway ? '✅ Connected' : '❌ Disconnected'}\n` +
        `Uptime: ${status.uptime}\n` +
        `Active Agents: ${status.agents}`
      );
      break;
      
    case '/agents':
      const agents = await getAgents();
      const agentList = agents.map(a => `• ${a.name} (${a.status})`).join('\n');
      await sendMessage(bot, chatId, `*Available Agents*\n\n${agentList || 'No agents available'}`);
      break;
      
    case '/ask':
      const query = args.join(' ').trim();
      if (!query) {
        await sendMessage(bot, chatId, 'Please provide a question. Usage: /ask <your question>');
        return;
      }
      
      if (query.length > config.message.max_query_length) {
        await sendMessage(bot, chatId, `Query too long. Max ${config.message.max_query_length} characters.`);
        return;
      }
      
      await sendMessage(bot, chatId, '🔄 Processing your query...');
      
      try {
        const result = await queryTrustNetwork(query);
        let response = `*Answer*\n\n${result.answer}`;
        
        if (config.message.show_confidence && result.confidence) {
          response += `\n\nConfidence: ${(result.confidence * 100).toFixed(1)}%`;
        }
        
        await sendMessage(bot, chatId, response);
      } catch (err) {
        await sendMessage(bot, chatId, `Error: ${err.message}. Please try again later.`);
      }
      break;
  }
}

async function sendMessage(bot, chatId, text) {
  const url = `https://api.telegram.org/bot${config.bot_token}/sendMessage`;
  const body = {
    chat_id: chatId,
    text: text,
    parse_mode: 'Markdown'
  };
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  
  if (!response.ok) {
    const error = await response.text();
    console.error('Telegram API error:', error);
  }
}

async function getSystemStatus() {
  return {
    gateway: gatewayWs && gatewayWs.readyState === WebSocket.OPEN,
    uptime: process.uptime ? formatUptime(process.uptime()) : 'N/A',
    agents: 'N/A'
  };
}

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

async function getAgents() {
  return [
    { name: 'Sage', status: 'active' },
    { name: 'Kilo', status: 'active' }
  ];
}

async function handleMessage(bot, msg) {
  const chatId = msg.chat?.id;
  const userId = msg.from?.id?.toString();
  const text = msg.text;
  
  if (!chatId || !text) return;
  
  if (!checkRateLimit(userId)) {
    await sendMessage(bot, chatId, '⚠️ Rate limit exceeded. Please wait a moment before sending more commands.');
    return;
  }
  
  if (text.startsWith('/')) {
    const parts = text.split(' ');
    const command = parts[0];
    const args = parts.slice(1);
    await handleCommand(bot, chatId, command, args);
  } else {
    await sendMessage(bot, chatId, 'Send /help for available commands.');
  }
}

async function startPolling() {
  let offset = 0;
  
  while (true) {
    try {
      const url = `https://api.telegram.org/bot${config.bot_token}/getUpdates?timeout=60&offset=${offset}`;
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.ok && data.result) {
        for (const update of data.result) {
          if (update.message) {
            await handleMessage({ token: config.bot_token }, update.message);
            offset = update.update_id + 1;
          }
        }
      }
    } catch (err) {
      console.error('Polling error:', err.message);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

async function setupWebhook(app) {
  const express = require('express');
  const app = express();
  app.use(express.json());
  
  app.post('/webhook', async (req, res) => {
    const { message } = req.body;
    if (message) {
      await handleMessage({ token: config.bot_token }, message);
    }
    res.send('OK');
  });
  
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Webhook server running on port ${port}`));
}

async function main() {
  if (!config.bot_token) {
    console.error('TELEGRAM_BOT_TOKEN not set');
    process.exit(1);
  }
  
  console.log('Starting Telegram handler...');
  
  try {
    await connectGateway();
  } catch (err) {
    console.log('Gateway connection failed, running without Trust Network');
  }
  
  if (config.mode === 'webhook') {
    await setupWebhook();
  } else {
    await startPolling();
  }
}

main().catch(console.error);

module.exports = { handleMessage, checkRateLimit, queryTrustNetwork };