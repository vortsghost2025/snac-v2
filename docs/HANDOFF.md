Summary of changes and next steps

What I changed:
- Replaced mock executor with real command execution for `parallel_test` and hardened `sandbox` runtime to be POSIX/Windows safe. (see `main.py`)
- Added ability to attach executions to terminal sessions via payload `terminal_session_id`.
- Added a minimal worker manager API (`/workers` endpoints) to spawn/list/kill long-running workers.
- Added periodic persistence of executions and worker metadata to `.server_state.json`.
- Added SSE execution stream endpoint `/execute/stream/{execution_id}` and terminal SSE endpoint already present.
- Hardened KILO mesh path handling to prefer `KILO_WORKSPACE` and reject invalid relative paths.
- Added nginx reverse-proxy snippet at `deploy/nginx/cockpit-proxy.conf` to proxy 443→9090.
- Added repo collaboration files earlier (pre-commit, CODEOWNERS, etc.).

How to run locally (backend):

1. Create venv and install requirements from `requirements.txt`.

2. Start the backend (example):

```powershell
# from S:/snac-v2/snac-v2/backend
python -m uvicorn main:app --host 0.0.0.0 --port 8001 --reload
```

3. Start cockpit or proxy via nginx as needed. To expose cockpit externally, use the provided nginx snippet and ensure certs are configured.

Quick verification:
- Health: `GET http://localhost:8001/api/health` (if implemented)
- Execute (quick): `POST /execute` with JSON `{ "runtime": "shared", "task": "echo hello", "timeout": 30 }`
- Stream an execution: `GET /execute/stream/{execution_id}` (SSE)
- Terminal attach: create terminal via `/terminal/sessions`, then run `POST /execute` with payload `{..., "payload": {"terminal_session_id": "<id>"}}`
- Workers: `POST /workers` with `{ "command": "sleep 60" }`, `GET /workers`, `DELETE /workers/{id}`

Risks & next actions:
- Running shell commands remotely is powerful and risky. Add auth, quotas, and sandboxing (containers or gVisor) before exposing to untrusted networks.
- Provider blocks external port 9090; configure nginx to proxy via 443 or use SSH tunnels for Playwright tests.

If you want, I can:
- Add authentication/guardrails for `/execute` and `/workers` endpoints.
- Create Dockerfiles and docker-compose for running backend + nginx.
- Wire terminal output to the frontend (cockpit) via WebSocket integration.
