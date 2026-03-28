# Cockpit Architecture Guidelines

This document is the single source of truth for cockpit architecture and implementation.
It brings together the ideas from the master index, design docs, and critical security rules.

## 1. Principles

- Single fullstack app (Next.js backend + API + UI) in `S:\workspace\cockpit`.
- Strong contracts between layers; avoid placeholder glue.
- Every feature route has a test and a security rule.
- The topology is: `UI -> API -> services -> runtime -> agents`.
- Context / memory is persistent in `context/`; use it for stateful agent history.
- Safety in `safety/` is mandatory for every command.

## 2. Repo structure

- `server.js` main server / bootstrap + websocket
- `agents/` agent definitions and integration adapters
- `services/` core behavior (executor, pipeline, task tracker)
- `context/` persistent state, history, workspace snapshots
- `clients/` AI provider wrappers (Claude, Gemini, local)
- `runtime/` orchestration loops, scheduling, agent sentiment
- `safety/` validation and sanitization wrappers
- `ui/` Next.js frontend with API routes, shared types, components

## 3. Core feature pipeline

1. UI submit command: `/ui/src/app/cockpit` (react component)
2. API route receives call: `/ui/src/app/api/agents/execute/route.ts`
3. Validation/safety: `safety/validateAgentCommand.js`
4. Core call: `services/agentExecutor.js`
5. Runnable action via `runtime/agentQueue.js`
6. Result stored via `context/resultStore.js`
7. UI polls websockets or refreshes API for status

## 4. Security and hardening

- Inputs: validate with `zod` in all API routes.
- no raw command string concatenation; use explicit command enums.
- sanitize env variables in `context`/`state` before any dumps.
- timeout wrapper `withTimeout()` for all model calls (60s default).
- require key-based access in remote command adapters.
- parse exit codes from agent stdout/stderr; never hardcode 0.

## 5. “5 papers” (technical conceptual layers)

1. Rosetta Stone: unified API schema + type mapping for agent / UI / runtime.
2. [Placeholders for future paper 02]
3. [Placeholders for future paper 03]
4. Drift Identity: agent state fingerprinting + drift detection control loop.
5. We Framework: collaboratively endorsed governance and contract pattern (agents + humans + safety / RL). 

## 6. Action items (immediate)

- Add endpoint `POST /api/agents/execute` in Next.js app.
- Add service `agentExecutor.execute(command)` in `services/`.
- Add runtime queue worker in `runtime/` and record in `context/`.
- Add UI “execute command” panel and results viewer.
- Add tests:
  - `tests/api/agent-execute.test.ts`
  - `tests/services/agentExecutor.test.ts`

## 7. Validation checklist

- [ ] `COCKPIT_MASTER_INDEX.md` includes all mapped files.
- [ ] `CRITICAL_FIXES.md` list is fully implemented.
- [ ] Raw command injection mitigations present.
- [ ] No CORS/exposed secrets in runtime.
- [ ] API coverage > 80% for critical flows.

## 8. Naming and ownership

- Module owners: working team keeps this doc updated.
- `COCKPIT_ARCHITECTURE_GUIDELINES.md` must be reviewed with every PR that changes pipeline.
- “Kilo / SNAC / UI integration points” should be listed in this doc at top.
