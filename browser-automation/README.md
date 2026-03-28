# Kilo Browser Automation Agent

A browser-based testing agent that **actually opens a browser** to test your services. No fake "connected" status - this agent navigates to your cockpit, backend, and services to verify they really work.

## Features

- **100% Truthful Status Reports** - Actually tests connections by navigating browsers to endpoints
- **Browser Chat Interface** - Chat with your agent from the browser cockpit while it works
- **Parallel Agent Swarm** - Run 50+ agents simultaneously for load testing
- **VPS/Docker Auto-Detection** - Automatically detects Hostinger VPS, Oracle Cloud, Docker environments
- **Production Readiness Checks** - Comprehensive testing with detailed reports
- **Real-Time WebSocket Updates** - Watch tests happen live in the browser
- **Screenshot Capture** - Saves screenshots of failures for debugging

## Quick Start

### 1. Install Dependencies

```bash
cd browser-automation
npm install
npx playwright install
```

### 2. Set Environment (optional)

```bash
# For VPS deployment
export VPS_HOST=snac.deliberatefederation.cloud
export COCKPIT_URL=https://snac.deliberatefederation.cloud:9090
export BACKEND_URL=http://snac.deliberatefederation.cloud:8000

# For local testing
export COCKPIT_URL=https://localhost:9090
export BACKEND_URL=http://localhost:8000
```

### 3. Start the Server

```bash
npm start
```

### 4. Open the Cockpit

Navigate to `http://localhost:8020/cockpit`

## Usage

### Chat Commands

Type in the chat box:
- `"test all"` - Run full production check on all services
- `"test cockpit"` - Test cockpit connection
- `"test backend"` - Test backend API
- `"status"` - Get current system status
- `"swarm"` - Run 50 parallel agents

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Server health check |
| `/api/services` | GET | List configured services |
| `/api/test/service` | POST | Test a single service |
| `/api/test/cockpit` | POST | Test cockpit with login |
| `/api/test/production` | POST | Run production check |
| `/api/test/swarm` | POST | Run parallel agent swarm |
| `/api/agent/chat` | POST | Chat with agent |
| `/cockpit` | GET | Browser interface |

### Example: Test a Service

```bash
curl -X POST http://localhost:8020/api/test/service \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Backend",
    "url": "http://localhost:8000/health",
    "expectedText": "ok"
  }'
```

### Example: Run Swarm Test

```bash
curl -X POST http://localhost:8020/api/test/swarm \
  -H "Content-Type: application/json" \
  -d '{
    "config": {
      "maxAgents": 50,
      "mode": "parallel"
    },
    "agents": [
      {"id": "agent-1", "name": "Agent 1", "targetUrl": "http://localhost:8000"},
      {"id": "agent-2", "name": "Agent 2", "targetUrl": "http://localhost:8000"}
    ]
  }'
```

## Architecture

```
browser-automation/
├── server.js                      # Express + WebSocket server
├── BrowserController.js           # Core Playwright browser control
├── BrowserController.ts           # TypeScript version
├── BrowserTools.js                # High-level browser tools
├── BrowserTools.ts                # TypeScript version
├── BrowserTestOrchestrator.ts   # Real endpoint testing (100% truth)
├── ParallelAgentRunner.ts       # 50+ parallel agent support
├── cockpit-chat.html            # Browser chat interface
└── package.json
```

### Key Components

**BrowserTestOrchestrator** - The testing engine that actually opens browsers:
- `testEndpoint()` - Navigates to URL and verifies it loads
- `testCockpit()` - Tests cockpit with optional login
- `runProductionCheck()` - Tests all services and reports true status
- Generates reports with 100% truthful status

**ParallelAgentRunner** - Handles concurrent testing:
- Supports 50+ parallel agents
- Sequential, parallel, and burst modes
- Retry logic for failed tests
- Distributed across CPU cores for 200+ agents

**Browser Chat Interface** - HTML/CSS/JS cockpit:
- Real-time WebSocket communication
- Service status dashboard
- Chat box for agent commands
- Live test logs
- Production readiness reports

## Docker Deployment

```dockerfile
FROM node:20-slim

RUN apt-get update && apt-get install -y \
    libgtk-3-0 libgbm-dev libnss3 libasound2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install
RUN npx playwright install chromium

COPY . .

ENV BROWSER_AGENT_PORT=8020
EXPOSE 8020

CMD ["npm", "start"]
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VPS_HOST` | `localhost` | Your VPS hostname |
| `COCKPIT_URL` | `https://localhost:9090` | Cockpit URL |
| `BACKEND_URL` | `http://localhost:8000` | Backend API URL |
| `BROWSER_AGENT_PORT` | `8020` | Server port |
| `DOCKER_ENABLED` | `false` | Auto-detected if in Docker |
| `IS_VPS` | `false` | Auto-detected from VPS_HOST |

## How It Works

Unlike simple HTTP ping tests that say "connected" even when services return errors, this agent:

1. **Launches a real browser** (Playwright/Chromium)
2. **Navigates to the URL** (the real test)
3. **Waits for page to load** and checks for errors
4. **Verifies expected content** if specified
5. **Captures screenshots** on failure
6. **Reports actual status** - connected/failed/error

This means you get **100% truthful reports** - if the agent says "connected", the service actually works in a browser.

## Troubleshooting

**Playwright browsers not installed:**
```bash
npx playwright install chromium
```

**Cockpit SSL errors:**
The agent ignores HTTPS errors for testing. In production, ensure valid SSL.

**Connection refused:**
Check that your services are running on the expected ports.

## License

MIT
