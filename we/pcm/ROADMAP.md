# PCM Roadmap

## Vision
Build a persistent cognitive agent stack that preserves how reasoning evolves across sessions.

- Memory is not retrieval only; memory is continuity.
- Each anchor is connection-aware and confidence-scored.
- Thread state enables resumption (where the thought path is reconstructed).

## Completed in PR #1
- `CognitiveAnchor` behavior + relationship math
- `ThreadManager` for temporal reasoning chains
- `StreamParser` for stream-safe bootstrap of giant transcripts

## To implement (PR #2+)
1. Storage Mesh:
   - `HotStore.js` (LMDB)
   - `WarmStore.js` (SQLite WAL)
   - `ColdArchive.js` (compacted cold layer)
   - `Migrator.js` (hot -> warm -> cold transitions based on thermal state)
2. Graph and Extraction:
   - `GraphBuilder.js` (CAP graph construction)
   - `Fingerprint.js` (state validation hash)
   - `Bootstrapping CLI` with `bootstrap` command for transcript ingest
3. Swarm Consensus:
   - `Agent.js` (role types: worker, critic, integrator, archivist)
   - `Orchestrator.js` (consensus and conflict resolution)
   - `HealthMonitor.js` (RSS/CPU auto-throttle)
4. Metabolism:
   - `Consolidator.js` (CAP similarity merge)
   - `Decay.js` (confidence drift)
   - `Dreamer.js` (offline conceptual expansion)
   - `Scheduler.js` (background cycle)

## Quality checks
- Ensure memory usage remains bounded (<RSS limit) during bootstrap
- Ensure CAP graph is stable after 100k inserts
- Ensure thread resume with related thread path in under 50ms
- Verify data integrity with Merkle checksum on storage snapshots
