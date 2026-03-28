# Planning Document 6: Cockpit UI Panel

## Overview

Production-ready cockpit snippet – a drop-in `pages/index.tsx` for Next.js/Tailwind UI that connects to SNAC v2 backend via WebSockets.

## Key Features

1. **Real-time agent reasoning display** - Plan, steps, result
2. **Tool execution trace** - Shows tool name, input, output
3. **Live logs panel** - WebSocket message flow
4. **Task input** - Send tasks to agent with prefixes (QUERY:, CALC:)

## Components

### cockpit/pages/index.tsx

React component with:
- WebSocket connection management
- Agent state display (plan, step, result)
- Tool calls visualization
- Live logs
- Task input form

### backend/main.py additions

WebSocket endpoint for real-time updates:
```python
from fastapi import WebSocket, WebSocketDisconnect
# ConnectionManager class
# /ws/chat endpoint
```

## Required Setup

1. Create types file at `cockpit/src/types/index.ts`
2. Add WebSocket endpoint to backend
3. Update cockpit package.json if using TypeScript

## Validation

```bash
docker compose up -d
# Open https://localhost
# Send task: "QUERY: What is 2+2? Then CALC: 5 * 10"
# Watch plan appear, step counter increment, tool calls show
```
