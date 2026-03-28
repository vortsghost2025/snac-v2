# SNAC v2 - Swarm Neural Autonomous Cockpit

A multi-agent AI system with real-time coordination, WebSocket dashboard, and accessibility features.

## Quick Start

```bash
# Install dependencies
npm install

# Start the system
npm start
```

## Features

- **Inter-Agent Message Bus** - AI-to-AI chat via file-based mailboxes
- **WebSocket Dashboard** - Real-time monitoring at `http://localhost:3001`
- **Terminal Echo Bridge** - TTS accessibility for terminal output
- **PowerShell CLI** - Direct AI chat from PowerShell
- **Security Hardening** - Input validation, path traversal protection

## Architecture

```
backend/
├── src/agents/          # MessageBus (dev-kimi zone)
├── src/dashboard/       # WebSocket dashboard (dev-kimi zone)
├── src/websocket/       # WebSocket infrastructure
├── terminal-echo-bridge.js  # Accessibility TTS
├── .agents/            # Coordination layer
└── infra/              # Deployment (dev-copilot zone)
```

## Multi-Agent Coordination

| Agent | Zone | Status |
|-------|------|--------|
| dev-kimi | src/agents/, src/dashboard/ | ✅ Active |
| dev-lingma | src/memory/, src/pipeline/ | Idle |
| dev-copilot | infra/, tests/ | Idle |
| dev-kilo | src/orchestrator/, src/swarm/ | Idle |

## Accessibility

- 🔊 Terminal output spoken via Windows TTS
- 🔊 AI chat messages announced aloud
- ⌨️ PowerShell CLI with short aliases
- 🎨 High contrast dashboard UI

## Ports

| Service | Port |
|---------|------|
| Dashboard Server | 3001 |
| Terminal Echo Bridge | 7777 |
| Message Bus | File-based |

## Commands

```bash
# PowerShell
Import-Module .\KiloChat.psm1
Connect-KiloChat
Send-KiloMessage "Hello AI!"

# CLI
node terminal-echo-bridge.js  # Start TTS
node src/dashboard/DashboardServer.js  # Start dashboard
```

## Deployment

See [GIT-SETUP.md](GIT-SETUP.md) for VPS deployment instructions.

## Security

- Input validation on all MessageBus methods
- Path traversal protection (safePathJoin)
- Atomic writes (temp + rename)
- .env files excluded from git

## License

MIT
