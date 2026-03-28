# QUICK CHEATSHEET – DEV‑TIME COORDINATION

## Files you must keep up‑to‑date
- `.agents/DISPATCH.md` – who owns what
- `.agents/LOCKS.json` – which directories are locked
- `.agents/<dev‑name>.md` – your current status & requests
- `.agents/CHANGELOG.md` – append‑only log of every change

## Typical workflow for any dev‑agent
1. **Read** DISPATCH → LOCKS → shared/types.js.  
2. **Update** your own `.agents/<dev‑name>.md` with the task you're about to start.  
3. **Edit** files **only** inside your zone.  
4. **If you need** something outside → add a **REQUEST** line in your status file.  
5. **When finished** →  
   - Remove your lock entry (set owner to `null`).  
   - Append a concise entry to `CHANGELOG.md`.  
   - Update your status file to **IDLE**.  

## Quick status check (run in the repo root)
```bash
for agent in dev-*; do
  echo "=== $agent ==="
  grep 'Current Status:' .agents/$agent.md || echo "No status file"
done
```

## Run conflict detection
```bash
./check-conflicts.sh
```

## Remember the naming convention
- **Dev agents** (the AI assistants) → `dev-kimi`, `dev-lingma`, `dev-copilot`, `dev-kilo`  
- **Runtime containers** (the code that will run in Azure) → `agent-kilo`, `agent-lingma`, `agent-copilot`, `agent-claude`, `agent-glm` (as defined in `shared/types.js`).  

Keep the two worlds separate – never mix the prefixes.