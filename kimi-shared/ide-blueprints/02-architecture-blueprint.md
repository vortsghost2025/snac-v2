# Planning Document 2: Complete Architecture Blueprint

## 1. Architecture Diagram (Mermaid.js)

```mermaid
graph TD
    A[User/Browser] -->|HTTPS/WSS| B[Nginx Reverse Proxy]
    B --> C{API Gateway<br/>(Node.js/Express)}
    C --> D[Orchestration Layer<br/>(AutoGen/CrewAI)]
    D --> E[Agent Runtime<br/>(LangGraph + LlamaIndex)]
    E --> F[Tool Layer<br/>(Custom/API/DB Tools)]
    F --> G[(Postgres)<br/>State + Long-Term Memory]
    F --> H[(Qdrant)<br/>Vector Store (RAG)]
    F --> I[(Redis)<br/>Queues + Cache]
    E --> J[Ollama<br/>Local LLM<br/>(Optional)]
    D --> K[n8n<br/>Workflow Automation]
    K --> L[External Systems<br/>(Slack/Email/Webhooks)]
    B --> M[Cockpit UI<br/>(Next.js + Tailwind)]
    M -->|WebSocket| N[Live Agent Logs<br/>(via API)]
    M -->|REST| O[Workflow Controls<br/>(via API)]
    style A fill:#f9f,stroke:#333
    style B fill:#bbf,stroke:#333
    style C fill:#cfc,stroke:#333
    style D fill:#fc9,stroke:#333
    style E fill:#ffc,stroke:#333    
    style F fill:#c9f,stroke:#333
    style G fill:#9cf,stroke:#333
    style H fill:#9fc,stroke:#333
    style I fill:#f9c,stroke:#333
    style J fill:#fcc,stroke:#333
    style K fill:#cf9,stroke:#333
    style L fill:#f99,stroke:#333
    style M fill:#9f9,stroke:#333
    style N fill:#99f,stroke:#333
    style O fill:#ff9,stroke:#333
```

---

## 2. Step-by-Step Build Order (Critical Path)

Each step must be **verified working** before proceeding. Test with `curl`/`Postman` + Docker logs.

| Phase | Step | Action | Validation Test | Time Estimate |
|-------|------|--------|-----------------|---------------|
| **PHASE 1** | 1.1 | Provision $5 DO/VPS (Ubuntu 22.04) | `ssh root@ip` → `lsb_release -a` shows 22.04 | 15 min |
| | 1.2 | Install Docker + Docker Compose | `docker run hello-world` → Success | 10 min |
| | 1.3 | Setup Nginx (reverse proxy) | `curl http://localhost` → Nginx welcome page | 20 min |
| | 1.4 | Install Node.js LTS + Python 3.11 | `node -v` → v20.x; `python3 --version` → 3.11.x | 10 min |
| | 1.5 | Deploy **Postgres** (docker-compose) | `docker compose up -d db` → `psql -h localhost -U postgres` connects | 25 min |
| | 1.6 | Deploy **Redis** (docker-compose) | `docker compose up -d redis` → `redis-cli ping` → `PONG` | 10 min |
| | 1.7 | Deploy **Qdrant** (docker-compose) | `curl http://localhost:6333/collections` → `{"result":{}}` | 15 min |
| | 1.8 | Deploy **Ollama** (optional, *only if GPU*) | `ollama run llama3` → Model downloads/runs (skip if no GPU) | 30 min |
| **PHASE 2** | 2.1 | Create agent API skeleton (Node/Express) | `POST /health` → `{"status":"ok"}` | 45 min |
| | 2.2 | Integrate LangGraph basic agent (no memory) | `POST /agent/run` → Returns static response | 2 hrs |
| | 2.3 | Add LlamaIndex for doc ingestion (local txt) | `POST /ingest` → Doc appears in Qdrant | 1.5 hrs |
| | 2.4 | Connect agent to Qdrant (RAG query) | `POST /agent/query` → Returns context from doc | 1 hr |
| **PHASE 3** | 3.1 | Add AutoGen planner + worker agent | `POST /orchestrate/task` → Planner delegates to worker | 2 hrs |
| | 3.2 | Implement checkpointing (LangGraph) | Kill/restart container → Agent resumes state | 45 min |
| **PHASE 4** | 4.1 | Wire Postgres for long-term memory (chat history) | Agent remembers convo after restart | 1 hr |
| | 4.2 | Add Redis for task queues (n8n trigger) | n8n workflow starts on Redis key expiry | 45 min |
| **PHASE 5** | 5.1 | Build first tool: HTTP GET (e.g., weather API) | Agent calls tool → Returns live data | 1 hr |
| | 5.2 | Build DB tool (Postgres query via SQL) | Agent runs `SELECT * FROM users` → Returns data | 45 min |
| **PHASE 6** | 6.1 | Deploy n8n (docker-compose) | `http://localhost:5678` loads login | 20 min |
| | 6.2 | Create n8n workflow: Trigger → Agent API → Slack msg | Slack receives message on workflow start | 1.5 hrs |
| **PHASE 7** | 7.1 | Build Next.js cockpit (basic layout) | `http://localhost:3000` loads UI | 1 hr |
| | 7.2 | Add WebSocket for live agent logs | UI shows real-time `agent/thought` stream | 45 min |
| | 7.3 | Add REST endpoint to start/stop workflows | UI button triggers n8n workflow | 1 hr |
| **PHASE 8-10** | 8.1+ | Add integrations *only when needed* (Slack/Email) | Test in staging first | As needed |

> 💡 **Critical Validation Habit**: After *every* step, run:  
> `docker compose logs -f --tail=20 [service-name]`  
> *If logs show errors, STOP and fix before moving on.*

---

## 3. Folder Structure (Monorepo)

All code lives in `/opt/agent-system` on your VPS. Avoids "spaghetti across servers".

```bash
/opt/agent-system/
├── .env                  # NEVER commit this! (Use .env.example)
├── docker-compose.yml    # SINGLE source of truth for all services
├── nginx/                # Nginx conf (sites-enabled/default)
│   └── conf.d/
├── services/             # Each service = independent deployable unit
│   ├── api-gateway/      # Node.js/Express (REST + WebSocket)
│   │   ├── src/
│   │   ├── Dockerfile
│   │   └── package.json
│   ├── orchestrator/     # AutoGen/CrewAI (Python)
│   │   ├── agents/
│   │   │   ├── planner.py
│   │   │   └── worker.py
│   │   ├── tools/        # Custom tools (HTTP, DB, etc.)
│   │   ├── Dockerfile
│   │   └── requirements.txt
│   ├── cockpit/          # Next.js/Tailwind UI
│   │   ├── pages/
│   │   ├── components/
│   │   ├── Dockerfile
│   │   └── package.json
│   └── n8n/              # n8n (official image + custom nodes)
│       ├── custom_nodes/ # Your n8n tools (e.g., "Agent Trigger")
│       └── docker-compose.override.yml
├── infra/                # Shared configs
│   ├── postgres/         # Init scripts, backups
│   ├── qdrant/           # Collection schemas
│   └── redis/            # Config templates
├── docs/                 # Architecture decisions, runbooks
└── scripts/              # Dev/utils (db migrate, log tail, etc.)
```

**Why this works**:  
- ✅ **No coupling**: Change `orchestrator` without touching `cockpit`.  
- ✅ **Single source of truth**: `docker-compose.yml` defines *everything*.  
- ✅ **Secrets safe**: `.env` ignored by git; use `docker-compose --env-file`.  
- ✅ **Easy debugging**: `docker compose logs -f api-gateway` isolates issues.  

---

## 4. Component Map (Data Flow & Dependencies)

| Component | Responsibility | Talks To | Protocol | Critical Dependency |
|-----------|----------------|----------|----------|---------------------|
| **Nginx** | TLS termination, load balancing | API Gateway, Cockpit | HTTP/HTTPS | None (foundation) |
| **API Gateway** | Auth, rate limiting, routing | Orchestrator, Cockpit | HTTP/WebSocket | Node.js, Express |
| **Orchestrator** (AutoGen) | Task planning, agent routing | Agent Runtime, n8n | HTTP (REST) | LangGraph, LlamaIndex |
| **Agent Runtime** (LangGraph) | State management, reasoning | Tools, LLMs, Memory | Python API | LangGraph, LlamaIndex |
| **Tools Layer** | External actions (APIs, DB, FS) | Postgres, Qdrant, Redis, HTTP APIs | SQL, REST, Redis | Psycopg2, Qdrant-client, Redis-py |
| **Postgres** | Long-term memory, state snapshots | Agent Runtime, Tools | SQL | None (ACID DB) |
| **Qdrant** | Vector similarity search (RAG) | Agent Runtime (via LlamaIndex) | HTTP/gRPC | None (vector DB) |
| **Redis** | Task queues, caching, session store | Orchestrator, n8n, API Gateway | RESQ Protocol | None (in-memory) |
| **n8n** | Workflow automation, triggers | Orchestrator, External Systems | HTTP/WebSocket | None (self-hosted) |
| **Cockpit UI** | Monitoring, manual triggers | API Gateway (WS/REST) | WebSocket, REST | Next.js, Tailwind |
| **Ollama** (Optional) | Local LLM inference | Agent Runtime | HTTP | GPU (if used) or CPU (slow) |

> ⚠️ **Key Insight**: The **Orchestrator** is the *only* component that talks to *both* the **Agent Runtime** (for reasoning) and **n8n** (for workflows). This keeps concerns separated – no agent directly calls Slack; it goes Orchestrator → n8n → Slack.

---

## 5. Realistic Timeline (Part-Time Dev - 10 hrs/week)

Based on actual build times from similar projects (not optimistic estimates).

| Phase | Milestone | Time | Risk if Rushed |
|-------|-----------|------|----------------|
| **PHASE 1** | Server foundation (DBs, proxy, runtime) | **1.5 days** | 🔥 *Foundation cracks later = total rewrite* |
| **PHASE 2-3** | Basic agent + orchestration (hello-world task) | **3 days** | 💥 Agents hallucinate/no memory = unusable |
| **PHASE 4** | Persistent memory + RAG (doc QA working) | **2 days** | 🧠 Forgetting context = "goldfish agent" |
| **PHASE 5** | First 2 useful tools (HTTP + DB) | **1.5 days** | 🛠️ Agents can't act = just a chatbot |
| **PHASE 6** | n8n workflow triggering agent | **1 day** | ⚙️ No automation = manual agent babysitting |
| **PHASE 7** | Cockpit with live logs + basic controls | **2 days** | 👀 Flying blind = debugging hell |
| **PHASE 8-10** | Production polish (safety, scaling prep) | **Ongoing** | 🛡️ Skipping = security/data leaks |

**Total to MVP**: **~11 days** (solid, testable, extensible base)  
**Total to "Production-Ready"**: **3-4 weeks** (with safety guards, monitoring, docs)

> 📌 **Reality Check**: If you try to build Phases 1-7 in <1 week, you *will* accumulate technical debt that slows you down later. **Speed comes from correctness, not rushing.**

---

## 6. Critical Improvement Suggestions

### ✅ DO THIS NOW (Phase 1)
- **Add structured logging *immediately***:  
  Use `pino` (Node) + `loguru` (Python) with JSON output → ship to **Loki** (add to `docker-compose`).  
  *Why*: Grepping `docker logs` for agent thoughts is impossible at scale.  

- **Set up health checks**:  
  Add `/health` endpoints to *every* service → Nginx only routes to healthy instances.  
  *Why*: Prevents cascading failures when Ollama/Qdrant hiccups.  

- **Pin exact versions**:  
  In `requirements.txt`/`package.json`, use `==` (not `^`).  
  *Why*: LangGraph 0.0.350 breaks with 0.0.351 – you *will* get bitten.  

### ⚠️ AVOID THESE TRAPS
- **"Free LLM" illusion**: Ollama on $5 VPS CPU is **too slow for production** (tokens/sec ≈ 1-2).  
  → **Fix**: Start with **OpenAI API** (set budget limit $5/month in dashboard) → swap to local *only* when you have GPU.  

- **Over-engineering the orchestrator**: Don't try to build AutoGen + CrewAI + Semantic Kernel at once.  
  → **Fix**: Pick **ONE** (AutoGen for flexibility) → get 1 agent working → *then* add complexity.  

- **Ignoring token costs**: LlamaIndex + Qdrant queries burn tokens fast.  
  → **Fix**: Add **token counters** in your agent middleware → log cost per request → set alerts.  

- **No rollback plan**: If a docker-compose update breaks things, you're down.  
  → **Fix**: Use `docker compose pull` → `docker compose up -d` → if broken, `docker compose up -d --scale api-gateway=0` (scale to 0) → revert image tag.  

### 💡 PRO TIPS FOR LONG-TERM SUCCESS
1. **Treat agents like microservices**:  
   - Each agent type = its own Python package (in `services/orchestrator/agents/`).  
   - Version them separately (`agent-researcher@v1.2.0`).  

2. **Automate the boring stuff**:  
   - Add `scripts/db-migrate.sh` (runs Alembic for Postgres).  
   - Add `scripts/log-tail.sh` (shows live agent thoughts + tool calls).  

3. **Security from day 1**:  
   - Run containers as non-root (`USER 1001:1001` in Dockerfiles).  
   - Use Docker secrets for API keys (not `.env` in production).  

4. **Monitor what matters**:  
   - Track: `agent_success_rate`, `avg_tool_call_latency`, `token_cost_per_hour`.  
   - Ignore: CPU usage (unless >80% for 5+ mins – then scale).  

---

## Final Verdict

Your plan is **90% there** – the phased approach is *exactly* how you avoid multi-server chaos. **My suggestions above target the 10% that sinks projects**:

> **Foundation first → Verify relentlessly → Start small (1 agent, 1 tool) → Add complexity only when the current layer feels *boring*.**

If you follow the build order *exactly* as laid out (validating each step), you'll have a **working agent system in <2 weeks** that you can actually extend without rewriting. The moment you skip validation to "move faster," you've already lost.

**Start here today**:  
1. Spin up your $5 VPS  
2. Run `docker compose up -d postgres redis qdrant`  
3. Test connections (as in Phase 1 steps)  
4. *Then* write your first agent.  
