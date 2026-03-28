# Persistent Cognitive Mesh (PCM)

This folder is the foundational agent-memory scaffold for the SNAC-v2 project.

## Goal
Implement the Path to Permanent Cognitive Continuity:
- CAP (CognitiveAnchor) models for reasoning states
- TRTs (Temporal Reasoning Threads) for ongoing causal threads
- Safe stream bootstrap for 1GB+ transcripts
- Anti-RSS memory regime with hot/warm/cold layers

## PR #1 - Core data model + persistence foundation
Added:
- `we/pcm/core/CognitiveAnchor.js`
- `we/pcm/core/ThreadManager.js`
- `we/pcm/bootstrap/StreamParser.js`

## Next PRs
- PR #2: storage mesh (LMDB/SQLite/archive + migration)
- PR #3: swarm consensus (worker/critic/integrator roles)
- PR #4: memory metabolism (consolidate, decay, dream)

## Quick start
1. `node -e "const StreamParser = require('./bootstrap/StreamParser'); console.log('ready');"`
2. `npm add lmdb better-sqlite3` before PR #2

## Notes
- The directory mirrors the PCM architecture from design:
  - `core/` = anchor and thread models
  - `bootstrap/` = parser pipeline
  - `storage/` = tiered store (next step)
  - `swarm/` and `metabolism/` to come.
