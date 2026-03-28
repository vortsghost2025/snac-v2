# Planning Document 7: Cockpit UI Panel v2

## Overview

Production-ready cockpit snippet - refined version with enhanced observability features.

## Key Features

1. **State-Synchronized UI** - 1:1 mapping to LangGraph AgentState
2. **Tool Call Timeline** - Reverse chronological order (latest first)
3. **Memory Trace Visibility** - Scrollable view of state.memory
4. **VPS-Optimized** - Native WebSocket, logs capped at 100 entries
5. **Matches Architecture** - Works with QUERY:/CALC: prefixes

## Components

### cockpit/pages/index.tsx

Complete React component with:
- WebSocket connection with auto-reconnect
- Agent state display (plan, step, result)
- Tool execution timeline (reverse chronological)
- Memory trace viewer
- Live system logs
- Task input bar

### Types

```typescript
type AgentStateUpdate = {
  plan: string[];
  current_step: number;
  result: string;
  memory: string[];
  tool_calls: Array<{
    tool: string;
    input: string;
    output: string;
  }>;
  status?: string;
};
```

## Validation

```bash
docker compose up -d
# Open https://localhost
# Send task: "QUERY: What is 2+2? Then CALC: 50 / 2"
# Watch plan appear, step counter increment, tool calls show
```
