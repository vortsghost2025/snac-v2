"""
SNAC-v2 Backend API
Agent runtime with RAG, memory timeline, and orchestration.
"""

import os
import re
import time
import json
import asyncio
import ast
import math
import hashlib
import uuid
import subprocess
import threading
from datetime import datetime
from typing import Optional, List, Dict, Any, Annotated
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, BackgroundTasks, Depends, Header, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator
import httpx
from openai import AsyncOpenAI
import redis.asyncio as aioredis
from qdrant_client import AsyncQdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct

# Accessibility - Text to Speech for vision impaired users
class AccessibilityAnnouncer:
    """Announces terminal output via TTS for accessibility."""
    
    def __init__(self):
        self.enabled = True
        self.speech_queue = []
        self.is_speaking = False
        self.lock = threading.Lock()
        self.last_announcement = ""
        
    def speak(self, text: str, priority: str = "normal"):
        """Queue text for speech announcement."""
        if not self.enabled or not text:
            return
            
        # Avoid repeating the same announcement
        if text == self.last_announcement:
            return
        self.last_announcement = text
        
        # Truncate long output for speech
        if len(text) > 200:
            text = text[:200] + "... [truncated]"
            
        with self.lock:
            if priority == "high":
                self.speech_queue.insert(0, text)
            else:
                self.speech_queue.append(text)
                
        if not self.is_speaking:
            threading.Thread(target=self._process_queue, daemon=True).start()
    
    def _process_queue(self):
        """Process speech queue."""
        self.is_speaking = True
        while True:
            with self.lock:
                if not self.speech_queue:
                    break
                text = self.speech_queue.pop(0)
            
            try:
                # Use PowerShell TTS on Windows, say on macOS, espeak on Linux
                if os.name == 'nt':
                    # Windows PowerShell TTS
                    ps_cmd = f'Add-Type -AssemblyName System.Speech; $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer; $synth.Speak("{text.replace(chr(34), chr(39))}");'
                    subprocess.run(['powershell.exe', '-Command', ps_cmd], timeout=10, capture_output=True)
                elif os.uname().sysname == 'Darwin':
                    subprocess.run(['say', text], timeout=10, capture_output=True)
                else:
                    # Try espeak for Linux
                    subprocess.run(['espeak', text], timeout=10, capture_output=True)
            except Exception:
                pass  # Silent fail - don't break terminal functionality
                
        self.is_speaking = False
        
    def stop(self):
        """Stop all speech."""
        with self.lock:
            self.speech_queue.clear()
        self.is_speaking = False

# Global accessibility announcer
accessibility = AccessibilityAnnouncer()

# Agent state storage (in production, use Redis/Postgres)
agent_sessions: Dict[str, Dict[str, Any]] = {}
_fallback_session_last_seen: Dict[str, float] = {}
memory_timeline: List[Dict[str, Any]] = []
token_usage: Dict[str, float] = {"total": 0.0, "by_session": {}}
thought_memory: List[Dict[str, Any]] = []
shared_knowledge_memory: List[Dict[str, Any]] = []
memory_injection_runtime: Dict[str, Dict[str, Any]] = {}
swarm_events: List[Dict[str, Any]] = []
swarm_config: Dict[str, Any] = {
    "min_workers": 2,
    "max_workers": 12,
    "max_tokens_per_min": 80000,
    "max_cpu_percent": 80.0,
    "idle_timeout_seconds": 120,
}
swarm_state: Dict[str, Any] = {
    "active_workers": {},
    "last_scale_down_at": 0.0,
}
worker_runtime_tasks: Dict[str, asyncio.Task] = {}
worker_runtime_locks: Dict[str, asyncio.Lock] = {}
swarm_task_results: List[Dict[str, Any]] = []
swarm_intelligence_stats: Dict[str, Dict[str, Any]] = {}
swarm_token_events: List[Dict[str, Any]] = []

# ============== EVENT CONTRACT REGISTRY ==============

_EVENT_CONTRACTS = {
    "v1": {
        "swarm.task.created": {
            "required_fields": ["task_id", "task_type", "worker_type", "runtime"],
            "optional_fields": ["priority", "payload", "workflow_id"],
        },
        "swarm.worker.started": {
            "required_fields": ["worker_id", "worker_type"],
            "optional_fields": ["runtime", "task_id"],
        },
        "swarm.worker.finished": {
            "required_fields": ["worker_id", "status", "duration_seconds"],
            "optional_fields": ["result", "error", "task_id"],
        },
        "swarm.guardrail.triggered": {
            "required_fields": ["guardrail_type", "severity", "message"],
            "optional_fields": ["task_id", "worker_id"],
        },
        "timeline.event.appended": {
            "required_fields": ["event_type", "timestamp"],
            "optional_fields": ["session_id", "data"],
        },
        "terminal.session.output": {
            "required_fields": ["session_id", "data"],
            "optional_fields": ["event_type"],
        },
        "agent.plan.created": {
            "required_fields": ["plan_id", "goal", "dag", "task_count"],
            "optional_fields": ["estimated_duration", "constraints"],
        },
        "agent.task.completed": {
            "required_fields": ["task_id", "task_type", "result", "duration_seconds"],
            "optional_fields": ["worker_id", "workflow_id"],
        },
        "agent.research.complete": {
            "required_fields": ["request_id", "query", "confidence"],
            "optional_fields": ["evidence_count", "citations"],
        },
        "agent.build.complete": {
            "required_fields": ["artifact_id", "file_count"],
            "optional_fields": ["test_count", "language"],
        },
        "agent.review.gate": {
            "required_fields": [
                "review_id",
                "artifact_ids",
                "decision",
                "findings_count",
            ],
            "optional_fields": ["block_promotion", "severity_summary"],
        },
        "agent.deploy.complete": {
            "required_fields": ["deploy_id", "artifact_ids", "status"],
            "optional_fields": ["endpoint_count", "verification_results"],
        },
    },
}

_event_contract_version = "v1"


def _validate_event_contract(
    event_type: str, payload: Dict[str, Any]
) -> tuple[bool, List[str]]:
    """Validate event payload against contract schema."""
    global _event_contract_version

    contracts = _EVENT_CONTRACTS.get(_event_contract_version, _EVENT_CONTRACTS["v1"])
    contract = contracts.get(event_type)

    if not contract:
        return False, [f"No contract defined for event_type: {event_type}"]

    errors = []
    required = contract.get("required_fields", [])

    for field in required:
        if field not in payload:
            errors.append(f"Missing required field: {field}")

    return len(errors) == 0, errors


# ============== CONFIGURATION ==============
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "qwen/qwen2.5-0.5b-instruct")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://openrouter.ai/api/v1")
QDRANT_HOST = os.getenv("QDRANT_HOST", "qdrant")
QDRANT_PORT = int(os.getenv("QDRANT_PORT", "6333"))
REDIS_HOST = os.getenv("REDIS_HOST", "redis")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
# Cost per output token in USD; default 0 (unset — avoids misleading charges when key is missing)
_OPENAI_COST_PER_TOKEN = float(os.getenv("OPENAI_COST_PER_TOKEN", "0"))
OPENAI_EMBEDDING_MODEL = os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small")
QDRANT_COLLECTION = os.getenv("QDRANT_COLLECTION", "documents")
# In-memory fallback limits
_MEMORY_FALLBACK_SESSION_TTL = int(
    os.getenv("MEMORY_FALLBACK_SESSION_TTL_SECONDS", "86400")
)
_MEMORY_FALLBACK_MAX_SESSIONS = int(os.getenv("MEMORY_FALLBACK_MAX_SESSIONS", "500"))
_MEMORY_FALLBACK_MAX_TIMELINE = int(
    os.getenv("MEMORY_FALLBACK_MAX_TIMELINE_EVENTS", "10000")
)
_MEMORY_FALLBACK_MAX_THOUGHTS = int(os.getenv("MEMORY_FALLBACK_MAX_THOUGHTS", "5000"))
_MEMORY_FALLBACK_MAX_SHARED_KNOWLEDGE = int(
    os.getenv("MEMORY_FALLBACK_MAX_SHARED_KNOWLEDGE", "5000")
)
_MEMORY_FALLBACK_MAX_SWARM_EVENTS = int(
    os.getenv("MEMORY_FALLBACK_MAX_SWARM_EVENTS", "5000")
)
_MEMORY_INJECTION_MAX_ITEMS = int(os.getenv("MEMORY_INJECTION_MAX_ITEMS", "100"))
_MAX_TASK_STEPS = int(os.getenv("MAX_TASK_STEPS", "20"))
_MEMORY_SHARE_MAX_TARGET_MODELS = int(os.getenv("MEMORY_SHARE_MAX_TARGET_MODELS", "5"))
_CONTROL_PLANE_TOKEN = os.getenv("SNAC_OPERATOR_TOKEN", "")
_ENFORCE_CONTROL_PLANE_TOKEN = os.getenv("ENFORCE_OPERATOR_TOKEN", "false").lower() in {
    "1",
    "true",
    "yes",
}
_RUNTIME_POLICY_SANDBOX_ALLOW_COMMAND_TASKS = os.getenv(
    "RUNTIME_POLICY_SANDBOX_ALLOW_COMMAND_TASKS", "false"
).lower() in {"1", "true", "yes"}
_RUNTIME_POLICY_SANDBOX_ALLOW_EXTERNAL_HTTP = os.getenv(
    "RUNTIME_POLICY_SANDBOX_ALLOW_EXTERNAL_HTTP", "false"
).lower() in {"1", "true", "yes"}
_RUNTIME_POLICY_SANDBOX_ALLOW_CLOUD_ROUTING = os.getenv(
    "RUNTIME_POLICY_SANDBOX_ALLOW_CLOUD_ROUTING", "false"
).lower() in {"1", "true", "yes"}
_RUNTIME_POLICY_PARALLEL_TEST_MIN_REPLICAS = int(
    os.getenv("RUNTIME_POLICY_PARALLEL_TEST_MIN_REPLICAS", "2")
)
_RUNTIME_POLICY_PARALLEL_TEST_MAX_REPLICAS = int(
    os.getenv("RUNTIME_POLICY_PARALLEL_TEST_MAX_REPLICAS", "5")
)
_SWARM_RESULT_MAX_ITEMS = int(os.getenv("SWARM_RESULT_MAX_ITEMS", "2000"))
_SWARM_WORKER_IDLE_SLEEP_SECONDS = float(
    os.getenv("SWARM_WORKER_IDLE_SLEEP_SECONDS", "1.0")
)
_USE_REDIS_STREAMS = os.getenv("USE_REDIS_STREAMS", "true").lower() in {
    "1",
    "true",
    "yes",
}
_SWARM_INTELLIGENCE_MAX_ITEMS = int(os.getenv("SWARM_INTELLIGENCE_MAX_ITEMS", "2000"))

# ============== COMMAND POLICY ENGINE ==============

_COMMAND_RISK_CLASSES = {
    "safe": {
        "description": "No approval required",
        "examples": ["read", "list", "get", "search", "view"],
    },
    "guarded": {
        "description": "Approval required for production",
        "examples": ["create", "update", "modify", "build", "test"],
    },
    "dangerous": {
        "description": "Explicit human approval required",
        "examples": ["delete", "deploy", "restart", "stop", "terminate"],
    },
    "blocked": {
        "description": "Never executable from cockpit",
        "examples": ["rm -rf", "del /f", "drop table", "format"],
    },
}

_BLOCKED_PATTERNS = [
    r"\brm\s+-rf\b",
    r"\bdel\s+/[sqf]\b",
    r"\bdrop\s+database\b",
    r"\bdrop\s+table\b",
    r"\btruncate\b",
    r"\bshutdown\b",
    r"\breboot\b",
    r"\bhalt\b",
]
_BLOCKED_REGEX = [re.compile(p, re.IGNORECASE) for p in _BLOCKED_PATTERNS]
_command_policy_audit_log: List[Dict[str, Any]] = []


def _classify_command_risk(command: str) -> tuple[str, List[str]]:
    command_lower = command.lower()
    violations, risk_class = [], "safe"
    for pattern in _BLOCKED_REGEX:
        if pattern.search(command):
            violations.append(f"Blocked: {pattern.pattern}")
            risk_class = "blocked"
    if risk_class != "blocked":
        for kw in ["delete", "drop", "truncate", "shutdown", "reboot", "halt"]:
            if kw in command_lower:
                risk_class = "dangerous" if "force" in command_lower else "guarded"
                break
    return risk_class, violations


def _log_command_audit(
    command: str,
    risk_class: str,
    approved: bool,
    source: str,
    details: Optional[Dict[str, Any]] = None,
):
    import uuid

    entry = {
        "audit_id": str(uuid.uuid4()),
        "timestamp": datetime.utcnow().isoformat(),
        "command": command[:500],
        "risk_class": risk_class,
        "approved": approved,
        "source": source,
        "details": details or {},
    }
    _command_policy_audit_log.append(entry)
    if len(_command_policy_audit_log) > 1000:
        _command_policy_audit_log[:] = _command_policy_audit_log[-1000:]


_SWARM_QUEUE_KEY_PREFIX = "swarm:queue"
_SWARM_EVENTS_KEY = "swarm:events"
_SWARM_CONFIG_KEY = "swarm:config"
_SWARM_WORKERS_ACTIVE_KEY = "swarm:workers:active"
_MEMORY_SHARED_KNOWLEDGE_KEY = "memory:shared_knowledge"
_SWARM_RESULTS_KEY = "swarm:results"
_SWARM_EVENTS_STREAM_KEY = "swarm:events:stream"
_SWARM_RESULTS_STREAM_KEY = "swarm:results:stream"
_SWARM_INTELLIGENCE_KEY = "swarm:intelligence:stats"
_SWARM_TOKEN_EVENTS_KEY = "swarm:token_events"
_SWARM_CHECKPOINTS_KEY_PREFIX = "swarm:checkpoint"
_SWARM_STREAM_CONSUMER_GROUP = "swarm-workers"
_SWARM_STREAM_MAX_LEN = 50000

_RUNTIME_MODES = {"shared", "sandbox", "parallel_test"}
_ROUTING_PREFERENCES = {"auto", "local_preferred", "cloud_preferred"}
_SWARM_WORKER_TYPES = {
    "research_worker",
    "analysis_worker",
    "builder_worker",
    "review_worker",
    "automation_worker",
    "idea_worker",
}

# Terminal session storage
terminal_sessions: Dict[str, Dict[str, Any]] = {}

# Execution tracking
executions: Dict[str, Dict[str, Any]] = {}

# Worker class definitions
_WORKER_CLASSES = {
    "research_worker": {
        "description": "Handles research tasks, data gathering, and information synthesis",
        "capabilities": ["search", "fetch", "analyze", "summarize"],
        "default_timeout": 300,
    },
    "analysis_worker": {
        "description": "Performs data analysis, computations, and statistical processing",
        "capabilities": ["compute", "analyze", "transform", "validate"],
        "default_timeout": 600,
    },
    "builder_worker": {
        "description": "Handles code generation, file creation, and build tasks",
        "capabilities": ["build", "create", "modify", "compile"],
        "default_timeout": 900,
    },
    "review_worker": {
        "description": "Performs code review, quality checks, and validation",
        "capabilities": ["review", "validate", "audit", "test"],
        "default_timeout": 300,
    },
    "automation_worker": {
        "description": "Handles automation scripts, workflows, and scheduled tasks",
        "capabilities": ["execute", "schedule", "orchestrate", "monitor"],
        "default_timeout": 600,
    },
    "idea_worker": {
        "description": "Handles creative tasks, brainstorming, and idea generation",
        "capabilities": ["generate", "ideate", "concept", "explore"],
        "default_timeout": 120,
    },
}

# OpenAI async client (None when key is absent)
_openai_client: Optional[AsyncOpenAI] = (
    AsyncOpenAI(
        api_key=OPENAI_API_KEY,
        base_url=OPENAI_BASE_URL,
    )
    if OPENAI_API_KEY
    else None
)
# Redis and Qdrant clients are initialized in lifespan
_redis: Optional[aioredis.Redis] = None
_qdrant: Optional[AsyncQdrantClient] = None

_SECRET_PATTERN = re.compile(
    r"(sk-[A-Za-z0-9\-_]{10,}|[Aa][Pp][Ii][-_]?[Kk][Ee][Yy]\s*[:=]\s*\S+)",
    re.IGNORECASE,
)

_RUNTIME_RISKY_TASK_PATTERN = re.compile(
    r"(?:\brm\s+-rf\b|\bdel\s+/f\b|\bpowershell\b|\bbash\b|\bcmd\.exe\b|\bssh\b|\bdocker\s+exec\b)",
    re.IGNORECASE,
)


_EXECUTION_CLEANUP_AFTER_SECONDS = int(
    os.getenv("EXECUTION_CLEANUP_AFTER_SECONDS", "3600")
)
_MAX_COMPLETED_EXECUTIONS = int(os.getenv("MAX_COMPLETED_EXECUTIONS", "500"))


def _cleanup_old_executions() -> int:
    """Remove old completed/failed executions to prevent memory leak."""
    global executions
    if not executions:
        return 0

    import time

    current_time = time.time()
    removed = 0

    # Find completed executions older than threshold
    to_remove = []
    for exec_id, exec_data in executions.items():
        if exec_data.get("status") in ("completed", "failed", "timeout"):
            completed_at = exec_data.get("completed_at")
            if completed_at:
                try:
                    from datetime import datetime

                    dt = datetime.fromisoformat(completed_at.replace("Z", "+00:00"))
                    age = current_time - dt.timestamp()
                    if age > _EXECUTION_CLEANUP_AFTER_SECONDS:
                        to_remove.append(exec_id)
                except Exception:
                    pass

    # Also enforce max count
    completed_count = sum(
        1
        for e in executions.values()
        if e.get("status") in ("completed", "failed", "timeout")
    )
    excess = completed_count - _MAX_COMPLETED_EXECUTIONS

    if excess > 0:
        # Remove oldest completed executions
        sorted_completed = sorted(
            [
                (eid, e.get("completed_at", ""))
                for eid, e in executions.items()
                if e.get("status") in ("completed", "failed", "timeout")
            ],
            key=lambda x: x[1],
        )
        for exec_id, _ in sorted_completed[:excess]:
            if exec_id not in to_remove:
                to_remove.append(exec_id)

    for exec_id in to_remove:
        executions.pop(exec_id, None)
        removed += 1

    return removed


def _redact_secrets(value: str) -> str:
    """Replace apparent secrets/keys before writing to logs."""
    return _SECRET_PATTERN.sub("[REDACTED]", value)


def _stream_pack(data: Dict[str, Any]) -> Dict[str, str]:
    """Serialize event payload for Redis Streams field map."""
    packed: Dict[str, str] = {}
    for key, value in data.items():
        if isinstance(value, (dict, list)):
            packed[key] = json.dumps(value)
        elif value is None:
            packed[key] = ""
        else:
            packed[key] = str(value)
    return packed


def _stream_unpack(fields: Dict[str, str]) -> Dict[str, Any]:
    """Deserialize Redis Streams field map into API event shape."""
    payload_raw = fields.get("payload", "{}") or "{}"
    try:
        payload = json.loads(payload_raw)
    except json.JSONDecodeError:
        payload = {"raw": payload_raw}

    return {
        "event_id": fields.get("event_id", ""),
        "event_type": fields.get("event_type", fields.get("type", "")),
        "event_version": fields.get("event_version", "v1"),
        "type": fields.get("type", fields.get("event_type", "")),
        "timestamp": fields.get("timestamp", ""),
        "source": fields.get("source", "system"),
        "workflow_id": fields.get("workflow_id") or None,
        "task_id": fields.get("task_id") or None,
        "agent_type": fields.get("agent_type") or None,
        "priority": fields.get("priority") or None,
        "runtime": fields.get("runtime") or None,
        "payload": payload,
        "trace_id": fields.get("trace_id", ""),
    }


async def _require_control_plane_token(
    x_operator_token: Optional[str] = Header(default=None, alias="X-Operator-Token"),
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
) -> None:
    """Guard mutating control-plane APIs when operator token enforcement is enabled."""
    if not _ENFORCE_CONTROL_PLANE_TOKEN:
        return

    if not _CONTROL_PLANE_TOKEN:
        raise HTTPException(
            status_code=503,
            detail="operator token enforcement enabled but SNAC_OPERATOR_TOKEN missing",
        )

    token = (x_operator_token or "").strip()
    if not token and authorization:
        auth = authorization.strip()
        if auth.lower().startswith("bearer "):
            token = auth[7:].strip()

    if token != _CONTROL_PLANE_TOKEN:
        raise HTTPException(status_code=401, detail="invalid operator token")


async def _runtime_policy_guardrail(
    *,
    workflow_id: str,
    task_id: str,
    trace_id: str,
    runtime: str,
    reason: str,
    details: Dict[str, Any],
) -> None:
    await _swarm_emit_event(
        "swarm.guardrail.triggered",
        workflow_id=workflow_id,
        task_id=task_id,
        trace_id=trace_id,
        runtime=runtime,
        source="policy",
        payload={
            "reason": reason,
            **details,
        },
    )


async def _enforce_runtime_policy(
    *,
    request: "SwarmTaskRequest",
    workflow_id: str,
    task_id: str,
    trace_id: str,
) -> Dict[str, Any]:
    payload = dict(request.payload or {})
    task_text = request.task

    if request.runtime == "sandbox":
        if (
            request.routing == "cloud_preferred"
            and not _RUNTIME_POLICY_SANDBOX_ALLOW_CLOUD_ROUTING
        ):
            await _runtime_policy_guardrail(
                workflow_id=workflow_id,
                task_id=task_id,
                trace_id=trace_id,
                runtime=request.runtime,
                reason="sandbox_cloud_routing_blocked",
                details={"routing": request.routing},
            )
            raise HTTPException(
                status_code=403,
                detail="sandbox runtime blocks cloud_preferred routing by policy",
            )

        command_like = bool(_RUNTIME_RISKY_TASK_PATTERN.search(task_text)) or any(
            key in payload
            for key in ["command", "shell", "powershell", "bash", "ssh", "docker"]
        )
        if command_like and not _RUNTIME_POLICY_SANDBOX_ALLOW_COMMAND_TASKS:
            await _runtime_policy_guardrail(
                workflow_id=workflow_id,
                task_id=task_id,
                trace_id=trace_id,
                runtime=request.runtime,
                reason="sandbox_command_blocked",
                details={"task_preview": task_text[:120]},
            )
            raise HTTPException(
                status_code=403,
                detail="sandbox runtime blocks command-like tasks by policy",
            )

        has_external_http = (
            "http://" in task_text.lower()
            or "https://" in task_text.lower()
            or any(key in payload for key in ["url", "endpoint", "webhook"])
        )
        if has_external_http and not _RUNTIME_POLICY_SANDBOX_ALLOW_EXTERNAL_HTTP:
            await _runtime_policy_guardrail(
                workflow_id=workflow_id,
                task_id=task_id,
                trace_id=trace_id,
                runtime=request.runtime,
                reason="sandbox_external_http_blocked",
                details={"task_preview": task_text[:120]},
            )
            raise HTTPException(
                status_code=403, detail="sandbox runtime blocks external HTTP by policy"
            )

    if request.runtime == "parallel_test":
        replicas = payload.get("replicas", 3)
        try:
            replicas = int(replicas)
        except (TypeError, ValueError):
            await _runtime_policy_guardrail(
                workflow_id=workflow_id,
                task_id=task_id,
                trace_id=trace_id,
                runtime=request.runtime,
                reason="parallel_test_invalid_replicas",
                details={"replicas": str(payload.get("replicas"))},
            )
            raise HTTPException(
                status_code=400, detail="parallel_test replicas must be an integer"
            )

        if (
            replicas < _RUNTIME_POLICY_PARALLEL_TEST_MIN_REPLICAS
            or replicas > _RUNTIME_POLICY_PARALLEL_TEST_MAX_REPLICAS
        ):
            await _runtime_policy_guardrail(
                workflow_id=workflow_id,
                task_id=task_id,
                trace_id=trace_id,
                runtime=request.runtime,
                reason="parallel_test_replicas_out_of_range",
                details={
                    "replicas": replicas,
                    "min": _RUNTIME_POLICY_PARALLEL_TEST_MIN_REPLICAS,
                    "max": _RUNTIME_POLICY_PARALLEL_TEST_MAX_REPLICAS,
                },
            )
            raise HTTPException(
                status_code=400,
                detail=(
                    "parallel_test replicas must be between "
                    f"{_RUNTIME_POLICY_PARALLEL_TEST_MIN_REPLICAS} and {_RUNTIME_POLICY_PARALLEL_TEST_MAX_REPLICAS}"
                ),
            )

        payload["replicas"] = replicas

    return payload


def _prune_memory_fallback_state() -> None:
    """Evict expired and excess sessions from the in-memory fallback dicts."""
    now = time.time()
    expired = [
        sid
        for sid, ts in _fallback_session_last_seen.items()
        if now - ts > _MEMORY_FALLBACK_SESSION_TTL
    ]
    for sid in expired:
        agent_sessions.pop(sid, None)
        token_usage["by_session"].pop(sid, None)
        _fallback_session_last_seen.pop(sid, None)

    # Hard cap: evict oldest by last-seen if still over limit
    while len(agent_sessions) > _MEMORY_FALLBACK_MAX_SESSIONS:
        oldest = min(
            _fallback_session_last_seen,
            key=_fallback_session_last_seen.get,
            default=None,
        )
        if oldest is None:
            break
        agent_sessions.pop(oldest, None)
        token_usage["by_session"].pop(oldest, None)
        _fallback_session_last_seen.pop(oldest, None)

    # Cap timeline ring buffer
    if len(memory_timeline) > _MEMORY_FALLBACK_MAX_TIMELINE:
        del memory_timeline[: len(memory_timeline) - _MEMORY_FALLBACK_MAX_TIMELINE]

    # Cap thought cache ring buffer
    if len(thought_memory) > _MEMORY_FALLBACK_MAX_THOUGHTS:
        del thought_memory[: len(thought_memory) - _MEMORY_FALLBACK_MAX_THOUGHTS]

    # Cap shared knowledge ring buffer
    if len(shared_knowledge_memory) > _MEMORY_FALLBACK_MAX_SHARED_KNOWLEDGE:
        del shared_knowledge_memory[
            : len(shared_knowledge_memory) - _MEMORY_FALLBACK_MAX_SHARED_KNOWLEDGE
        ]

    # Cap swarm event buffer
    if len(swarm_events) > _MEMORY_FALLBACK_MAX_SWARM_EVENTS:
        del swarm_events[: len(swarm_events) - _MEMORY_FALLBACK_MAX_SWARM_EVENTS]


def _get_allowed_origins() -> List[str]:
    """Resolve allowed CORS origins from env for safer production defaults."""
    raw = os.getenv("CORS_ALLOW_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    global _redis, _qdrant
    print("SNAC-v2 Backend starting up...")
    print(f"OpenAI API: {'configured' if OPENAI_API_KEY else 'MISSING'}")

    try:
        _redis = aioredis.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)
        await _redis.ping()
        print(f"Redis: connected at {REDIS_HOST}:{REDIS_PORT}")
    except Exception as e:
        print(
            f"Redis: unavailable ({_redact_secrets(str(e))}) - using in-memory fallback"
        )
        _redis = None

    try:
        _qdrant = AsyncQdrantClient(
            host=QDRANT_HOST, port=QDRANT_PORT, check_compatibility=False
        )
        collections = await _qdrant.get_collections()
        names = [c.name for c in collections.collections]
        if QDRANT_COLLECTION not in names:
            await _qdrant.create_collection(
                collection_name=QDRANT_COLLECTION,
                vectors_config=VectorParams(size=1536, distance=Distance.COSINE),
            )
            print(f"Qdrant: created collection '{QDRANT_COLLECTION}'")
        else:
            print(f"Qdrant: collection '{QDRANT_COLLECTION}' ready")
    except Exception as e:
        print(f"Qdrant: unavailable ({_redact_secrets(str(e))}) - RAG disabled")
        _qdrant = None

    if _redis:
        for stream_key in (_SWARM_EVENTS_STREAM_KEY, _SWARM_RESULTS_STREAM_KEY):
            try:
                await _redis.xgroup_create(
                    stream_key, _SWARM_STREAM_CONSUMER_GROUP, id="0", mkstream=True
                )
            except Exception:
                pass  # group already exists or stream creation no-op
        await _swarm_recover_pending_checkpoints()
        print("Swarm: consumer groups ready, checkpoint recovery complete")

    yield

    for worker_id, task in list(worker_runtime_tasks.items()):
        task.cancel()
    if worker_runtime_tasks:
        pending_workers = list(worker_runtime_tasks.keys())
        pending_tasks = [
            worker_runtime_tasks[w]
            for w in pending_workers
            if w in worker_runtime_tasks
        ]
        shutdown_results = await asyncio.gather(*pending_tasks, return_exceptions=True)
        for worker_id, result in zip(pending_workers, shutdown_results):
            if isinstance(result, Exception) and not isinstance(
                result, asyncio.CancelledError
            ):
                print(
                    f"Worker task '{worker_id}' shutdown error: {_redact_secrets(str(result))}"
                )
        worker_runtime_tasks.clear()
        worker_runtime_locks.clear()

    if _redis:
        await _redis.aclose()
    if _qdrant:
        await _qdrant.close()
    print("SNAC-v2 Backend shutting down...")


app = FastAPI(
    title="SNAC-v2 Agent API",
    description="Agent runtime with RAG and memory timeline",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=_get_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============== MODELS ==============


class HealthResponse(BaseModel):
    status: str
    timestamp: str
    service: str
    services: Dict[str, str]


class IngestRequest(BaseModel):
    content: Annotated[str, Field(min_length=1, max_length=50000)]
    metadata: Optional[Dict[str, Any]] = None

    @field_validator("content")
    @classmethod
    def content_not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("content must not be blank")
        return v


class IngestResponse(BaseModel):
    success: bool
    chunks: int
    document_id: str


class ThoughtIngestRequest(BaseModel):
    content: Annotated[str, Field(min_length=1, max_length=20000)]

    @field_validator("content")
    @classmethod
    def content_not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("content must not be blank")
        return v


class ThoughtIngestResponse(BaseModel):
    success: bool
    thought_id: str
    summary: str
    category: str
    confidence: float
    keywords: List[str]
    linked_thought_ids: List[str]


class AgentRunRequest(BaseModel):
    task: Annotated[str, Field(min_length=1, max_length=8000)]
    session_id: Optional[Annotated[str, Field(pattern=r"^[A-Za-z0-9._:\-]+$")]] = None

    @field_validator("task")
    @classmethod
    def task_step_count(cls, v: str) -> str:
        step_count = len(v.split(" Then "))
        if step_count > _MAX_TASK_STEPS:
            raise ValueError(f"task exceeds max step count ({_MAX_TASK_STEPS})")
        return v


class AgentRunResponse(BaseModel):
    session_id: str
    result: str
    steps: List[Dict[str, Any]]
    tokens_used: int
    cost: float


class FreeCodingAgentRequest(BaseModel):
    task: Annotated[str, Field(min_length=1, max_length=10000)]
    provider: str = "ollama"
    model: str = "free-coding-agent"
    working_dir: Optional[str] = None
    no_approval: bool = False


class FreeCodingAgentResponse(BaseModel):
    success: bool
    result: Optional[str] = None
    error: Optional[str] = None
    tool_calls: Optional[List[Dict[str, Any]]] = None
    session_id: str


class FreeCodingAgentToolsResponse(BaseModel):
    basic_tools: List[str]
    mcp_tools: List[str]
    total: int


class TimelineResponse(BaseModel):
    events: List[Dict[str, Any]]


class TokenUsageResponse(BaseModel):
    total: float
    by_session: Dict[str, float]


class SwarmTaskRequest(BaseModel):
    task: Annotated[str, Field(min_length=1, max_length=8000)]
    agent_type: Annotated[str, Field(min_length=1, max_length=64)]
    priority: str = "normal"
    payload: Optional[Dict[str, Any]] = None
    workflow_id: Optional[str] = None
    complexity: str = "medium"
    runtime: str = "shared"
    routing: str = "auto"

    @field_validator("priority")
    @classmethod
    def validate_priority(cls, v: str) -> str:
        v2 = v.lower().strip()
        if v2 not in {"high", "normal", "low"}:
            raise ValueError("priority must be one of: high, normal, low")
        return v2

    @field_validator("complexity")
    @classmethod
    def validate_complexity(cls, v: str) -> str:
        v2 = v.lower().strip()
        if v2 not in {"low", "medium", "high"}:
            raise ValueError("complexity must be one of: low, medium, high")
        return v2

    @field_validator("runtime")
    @classmethod
    def validate_runtime(cls, v: str) -> str:
        v2 = v.lower().strip()
        if v2 not in _RUNTIME_MODES:
            raise ValueError("runtime must be one of: shared, sandbox, parallel_test")
        return v2

    @field_validator("routing")
    @classmethod
    def validate_routing(cls, v: str) -> str:
        v2 = v.lower().strip()
        if v2 not in _ROUTING_PREFERENCES:
            raise ValueError(
                "routing must be one of: auto, local_preferred, cloud_preferred"
            )
        return v2


class SwarmTaskResponse(BaseModel):
    success: bool
    task_id: str
    queue: str
    event_id: str
    runtime: str


class SwarmConfigResponse(BaseModel):
    min_workers: int
    max_workers: int
    max_tokens_per_min: int
    max_cpu_percent: float
    idle_timeout_seconds: int


class SwarmConfigUpdateRequest(BaseModel):
    min_workers: Optional[int] = None
    max_workers: Optional[int] = None
    max_tokens_per_min: Optional[int] = None
    max_cpu_percent: Optional[float] = None
    idle_timeout_seconds: Optional[int] = None


class SwarmStatusResponse(BaseModel):
    queue_depth: Dict[str, int]
    queue_depth_total: int
    active_workers: int
    desired_workers: int
    guardrails: Dict[str, Any]
    config: SwarmConfigResponse


class SwarmEventItem(BaseModel):
    event_id: str
    event_type: Optional[str] = None
    event_version: str = "v1"
    type: str
    timestamp: str
    source: str = "system"
    workflow_id: Optional[str] = None
    task_id: Optional[str] = None
    agent_type: Optional[str] = None
    priority: Optional[str] = None
    runtime: Optional[str] = None
    payload: Dict[str, Any]
    trace_id: str


class SwarmEventsResponse(BaseModel):
    events: List[SwarmEventItem]


class SwarmScalerTickResponse(BaseModel):
    desired_workers: int
    active_workers: int
    queue_depth_total: int
    frozen_scale_up: bool
    reason: Optional[str] = None


class SwarmWorkerSpawnRequest(BaseModel):
    worker_type: str
    runtime: str = "shared"
    count: int = 1

    @field_validator("worker_type")
    @classmethod
    def validate_worker_type(cls, v: str) -> str:
        v2 = v.lower().strip()
        if v2 not in _SWARM_WORKER_TYPES:
            raise ValueError("unsupported worker_type")
        return v2

    @field_validator("runtime")
    @classmethod
    def validate_worker_runtime(cls, v: str) -> str:
        v2 = v.lower().strip()
        if v2 not in _RUNTIME_MODES:
            raise ValueError("runtime must be one of: shared, sandbox, parallel_test")
        return v2

    @field_validator("count")
    @classmethod
    def validate_worker_count(cls, v: int) -> int:
        if v < 1 or v > 20:
            raise ValueError("count must be between 1 and 20")
        return v


class SwarmWorkerRetireRequest(BaseModel):
    worker_id: str


class SwarmWorkerInfo(BaseModel):
    worker_id: str
    worker_type: str
    runtime: str
    status: str
    started_at: str
    lease_only: bool = True


class SwarmWorkersResponse(BaseModel):
    workers: List[SwarmWorkerInfo]


class SwarmTaskResultItem(BaseModel):
    worker_id: str
    worker_type: str
    runtime: str
    task_id: str
    workflow_id: str
    priority: str
    status: str
    task_preview: str
    result_preview: str
    duration_ms: int
    completed_at: str


class SwarmTaskResultsResponse(BaseModel):
    results: List[SwarmTaskResultItem]


class SwarmGraphNode(BaseModel):
    id: str
    type: str  # worker | queue | result
    label: str
    status: str
    runtime: Optional[str] = None
    worker_type: Optional[str] = None
    count: Optional[int] = None


class SwarmGraphEdge(BaseModel):
    source: str
    target: str
    label: str


class SwarmGraphSnapshotResponse(BaseModel):
    nodes: List[SwarmGraphNode]
    edges: List[SwarmGraphEdge]
    active_workers: int
    tasks_running: int
    queue_depth: int
    recent_event_types: List[str]
    snapshot_at: str


class SwarmIntelligenceSummaryResponse(BaseModel):
    total_tasks: int
    succeeded: int
    failed: int
    task_success_rate: float
    avg_duration_ms: float
    best_worker_id: Optional[str]
    best_worker_type: Optional[str]
    slowest_task_preview: Optional[str]
    busiest_runtime: Optional[str]
    recommended_strategy: str
    summary_window: str


class SwarmCheckpointWriteRequest(BaseModel):
    task_id: Annotated[str, Field(min_length=1, max_length=128)]
    worker_id: Annotated[str, Field(min_length=1, max_length=128)]
    progress: Annotated[int, Field(ge=0)]
    total: Annotated[int, Field(ge=1)]
    state: Optional[Dict[str, Any]] = None


class SwarmCheckpointResponse(BaseModel):
    task_id: str
    worker_id: str
    progress: int
    total: int
    percent: float
    state: Dict[str, Any]
    updated_at: str


class MemoryLearnRequest(BaseModel):
    source_model: Annotated[str, Field(min_length=1, max_length=80)]
    topic: Annotated[str, Field(min_length=1, max_length=140)]
    details: Annotated[str, Field(min_length=1, max_length=20000)]
    impact_level: str = "low"
    confidence: float = 0.7
    tags: Optional[List[str]] = None

    @field_validator("impact_level")
    @classmethod
    def validate_impact_level(cls, v: str) -> str:
        v2 = v.lower().strip()
        if v2 not in {"low", "medium", "high"}:
            raise ValueError("impact_level must be one of: low, medium, high")
        return v2

    @field_validator("confidence")
    @classmethod
    def validate_confidence(cls, v: float) -> float:
        if v < 0 or v > 1:
            raise ValueError("confidence must be between 0 and 1")
        return v


class MemoryFeedItem(BaseModel):
    id: str
    source_model: str
    topic: str
    details: str
    impact_level: str
    confidence: float
    tags: List[str]
    created_at: str


class MemoryLearnResponse(BaseModel):
    success: bool
    item: MemoryFeedItem


class MemoryFeedResponse(BaseModel):
    items: List[MemoryFeedItem]


class MemoryShareRequest(BaseModel):
    entry_id: Annotated[str, Field(min_length=1, max_length=128)]
    source_model: Annotated[str, Field(min_length=1, max_length=80)]
    target_models: List[Annotated[str, Field(min_length=1, max_length=80)]]
    note: Optional[Annotated[str, Field(min_length=1, max_length=500)]] = None

    @field_validator("target_models")
    @classmethod
    def validate_target_models(cls, v: List[str]) -> List[str]:
        deduped: List[str] = []
        seen = set()
        for item in v:
            value = item.strip()
            if not value:
                continue
            lowered = value.lower()
            if lowered in seen:
                continue
            seen.add(lowered)
            deduped.append(value)

        if not deduped:
            raise ValueError("target_models must not be empty")
        if len(deduped) > _MEMORY_SHARE_MAX_TARGET_MODELS:
            raise ValueError(f"target_models max is {_MEMORY_SHARE_MAX_TARGET_MODELS}")
        return deduped


class MemoryShareResponse(BaseModel):
    success: bool
    shared_from_id: str
    created_item_ids: List[str]


# Allowed shells for terminal sessions
_ALLOWED_SHELLS = {
    "/bin/bash",
    "/bin/sh",
    "/usr/bin/bash",
    "/usr/bin/sh",
    "/bin/zsh",
    "/usr/bin/zsh",
    "bash",
    "sh",
    "zsh",
    "cmd",
    "cmd.exe",
    "powershell",
    "powershell.exe",
    "pwsh",
    "pwsh.exe",
    "C:\\Windows\\System32\\cmd.exe",
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
}


def _validate_shell(shell: str) -> str:
    """Validate shell command to prevent command injection."""
    # Check if shell is in allowlist
    if shell in _ALLOWED_SHELLS:
        return shell
    # Also accept if it's a direct path match
    shell_lower = shell.lower()
    for allowed in _ALLOWED_SHELLS:
        if shell_lower == allowed.lower():
            return allowed
    # Reject if not in allowlist
    raise HTTPException(
        status_code=400,
        detail=f"Shell '{shell}' not allowed. Use: {', '.join(sorted(_ALLOWED_SHELLS))}",
    )


class TerminalSessionCreateRequest(BaseModel):
    shell: str = "/bin/bash"
    cwd: Optional[str] = None
    env: Optional[Dict[str, str]] = None
    timeout: int = 3600


class TerminalSessionResponse(BaseModel):
    session_id: str
    status: str
    created_at: str
    shell: str
    cwd: Optional[str]
    pid: Optional[int]


class TerminalInputRequest(BaseModel):
    input: Annotated[str, Field(max_length=10000)]


class TerminalOutputEvent(BaseModel):
    session_id: str
    event_type: str
    data: str
    timestamp: str


# ============== CORE-5 AGENT MODELS ==============

# Agent-specific request/response models


class PlannerCreatePlanRequest(BaseModel):
    goal: Annotated[str, Field(min_length=1, max_length=4000)]
    context: Optional[Dict[str, Any]] = None
    constraints: Optional[List[str]] = None
    routing: str = "auto"


class PlannerCreatePlanResponse(BaseModel):
    plan_id: str
    dag: Dict[str, Any]
    tasks: List[Dict[str, Any]]
    estimated_duration: int


class PlannerTaskStatusResponse(BaseModel):
    plan_id: str
    status: str
    progress: Dict[str, int]
    current_phase: str
    elapsed_seconds: int


class ResearcherGatherRequest(BaseModel):
    query: Annotated[str, Field(min_length=1, max_length=2000)]
    sources: List[str] = ["web", "docs", "memory"]
    max_items: int = 10


class ResearcherGatherResponse(BaseModel):
    request_id: str
    evidence: List[Dict[str, Any]]
    confidence: float
    citations: List[str]


class BuilderCreateArtifactRequest(BaseModel):
    spec: Dict[str, Any]
    runtime: str = "shared"
    language: Optional[str] = None


class BuilderCreateArtifactResponse(BaseModel):
    artifact_id: str
    files: List[Dict[str, Any]]
    test_files: List[Dict[str, Any]]
    metadata: Dict[str, Any]


class ReviewerValidateRequest(BaseModel):
    artifact_ids: List[str]
    gate_type: str = "standard"
    review_focus: List[str] = ["quality", "security", "cost"]


class ReviewerValidateResponse(BaseModel):
    review_id: str
    decision: str
    findings: List[Dict[str, Any]]
    required_fixes: List[Dict[str, Any]]
    severity_summary: Dict[str, int]


class OperatorDeployRequest(BaseModel):
    artifact_ids: List[str]
    runtime: str = "sandbox"
    verify: bool = True


class OperatorDeployResponse(BaseModel):
    deploy_id: str
    status: str
    endpoints: List[str]
    verification_results: Dict[str, Any]


class AgentCycleStatusResponse(BaseModel):
    cycle_id: str
    status: str
    phase: str
    completed_agents: List[str]
    pending_agents: List[str]
    outcomes: Dict[str, Any]


# Core-5 agent storage
core5_plans: Dict[str, Dict[str, Any]] = {}
core5_research_results: Dict[str, Dict[str, Any]] = {}
core5_artifacts: Dict[str, Dict[str, Any]] = {}
core5_reviews: Dict[str, Dict[str, Any]] = {}
core5_deployments: Dict[str, Dict[str, Any]] = {}
core5_cycles: Dict[str, Dict[str, Any]] = {}


# ============== CORE-5 CONFIGURATION ==============

CORE5_ENABLED = os.getenv("CORE5_ENABLED", "true").lower() in {"1", "true"}
CORE5_MAX_PLAN_TASKS = int(os.getenv("CORE5_MAX_PLAN_TASKS", "50"))
CORE5_DEFAULT_GATES = os.getenv("CORE5_DEFAULT_GATES", "quality,security,cost")
CORE5_AUTO_DEPLOY = os.getenv("CORE5_AUTO_DEPLOY", "false").lower() in {"1", "true"}


class ExecutionRequest(BaseModel):
    task: Annotated[str, Field(min_length=1, max_length=8000)]
    runtime: str = "shared"
    worker_type: Optional[str] = None
    payload: Optional[Dict[str, Any]] = None
    timeout: Annotated[int, Field(gt=0, le=3600)] = 300


class ExecutionResponse(BaseModel):
    execution_id: str
    status: str
    created_at: str
    runtime: str
    task_id: Optional[str]


class ExecutionStatusResponse(BaseModel):
    execution_id: str
    status: str
    runtime: str
    worker_type: Optional[str]
    progress: int
    total: int
    result: Optional[str]
    error: Optional[str]
    started_at: str
    completed_at: Optional[str]


class WorkerClassInfo(BaseModel):
    worker_type: str
    description: str
    capabilities: List[str]
    default_timeout: int


class WorkerLifecycleResponse(BaseModel):
    worker_id: str
    worker_type: str
    status: str
    lifecycle: str
    runtime: str
    created_at: str
    claimed_at: Optional[str]
    progress_at: Optional[str]
    completed_at: Optional[str]


class WorkflowHpoTerm(BaseModel):
    id: Annotated[str, Field(min_length=3, max_length=32)]
    label: Annotated[str, Field(min_length=1, max_length=200)]
    confidence: float = Field(ge=0.0, le=1.0)


class WorkflowTopCandidate(BaseModel):
    chr: Annotated[str, Field(min_length=1, max_length=32)]
    pos: int = Field(ge=1)
    ref: Annotated[str, Field(min_length=1, max_length=64)]
    alt: Annotated[str, Field(min_length=1, max_length=64)]
    quality: float = Field(ge=0.0)
    depth: int = Field(ge=0)
    pathogenicityScore: float = Field(ge=0.0, le=1.0)
    phenotypeRelevance: float = Field(ge=0.0, le=1.0)
    combinedScore: float = Field(ge=0.0, le=1.0)


class WorkflowDiagnosis(BaseModel):
    topCandidate: WorkflowTopCandidate
    candidateGenes: List[Annotated[str, Field(min_length=1, max_length=64)]]
    hpoTerms: List[WorkflowHpoTerm]
    interpretation: Annotated[str, Field(min_length=1, max_length=20000)]


class MedicalWorkflowLearnRequest(BaseModel):
    workflowId: Annotated[str, Field(min_length=1, max_length=120)]
    patientId: Optional[Annotated[str, Field(min_length=1, max_length=120)]] = None
    diagnosis: WorkflowDiagnosis
    confidence: float = Field(ge=0.0, le=1.0)
    duration: int = Field(ge=0)
    source_model: Annotated[str, Field(min_length=1, max_length=80)] = (
        "genomics-platform"
    )


class MedicalWorkflowLearnResponse(BaseModel):
    success: bool
    workflow_id: str
    patient_ref: str
    item: MemoryFeedItem


class MemoryInjectPreviewRequest(BaseModel):
    session_id: Optional[Annotated[str, Field(pattern=r"^[A-Za-z0-9._:\-]+$")]] = None
    agent_type: Optional[Annotated[str, Field(min_length=1, max_length=64)]] = None
    domain: Optional[Annotated[str, Field(min_length=1, max_length=64)]] = None
    layers: Optional[List[Annotated[str, Field(min_length=1, max_length=64)]]] = None
    impact_levels: Optional[List[str]] = None
    min_confidence: float = 0.0
    query: Optional[Annotated[str, Field(min_length=1, max_length=200)]] = None
    max_items: int = 10

    @field_validator("min_confidence")
    @classmethod
    def validate_min_confidence(cls, v: float) -> float:
        if v < 0 or v > 1:
            raise ValueError("min_confidence must be between 0 and 1")
        return v

    @field_validator("impact_levels")
    @classmethod
    def validate_impact_levels(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        if v is None:
            return v
        normalized = [item.lower().strip() for item in v if item and item.strip()]
        allowed = {"low", "medium", "high"}
        invalid = [item for item in normalized if item not in allowed]
        if invalid:
            raise ValueError("impact_levels must only include: low, medium, high")
        return normalized

    @field_validator("max_items")
    @classmethod
    def validate_max_items(cls, v: int) -> int:
        if v < 1 or v > _MEMORY_INJECTION_MAX_ITEMS:
            raise ValueError(
                f"max_items must be between 1 and {_MEMORY_INJECTION_MAX_ITEMS}"
            )
        return v


class MemoryInjectCandidate(BaseModel):
    item: MemoryFeedItem
    score: float
    reasons: List[str]


class MemoryInjectPreviewResponse(BaseModel):
    success: bool
    session_id: str
    filters: Dict[str, Any]
    candidates: List[MemoryInjectCandidate]


class MemoryInjectApplyRequest(BaseModel):
    session_id: Annotated[str, Field(pattern=r"^[A-Za-z0-9._:\-]+$")]
    selected_item_ids: Optional[
        List[Annotated[str, Field(min_length=1, max_length=128)]]
    ] = None
    agent_type: Optional[Annotated[str, Field(min_length=1, max_length=64)]] = None
    domain: Optional[Annotated[str, Field(min_length=1, max_length=64)]] = None
    layers: Optional[List[Annotated[str, Field(min_length=1, max_length=64)]]] = None
    impact_levels: Optional[List[str]] = None
    min_confidence: float = 0.0
    query: Optional[Annotated[str, Field(min_length=1, max_length=200)]] = None
    max_items: int = 10

    @field_validator("min_confidence")
    @classmethod
    def validate_apply_min_confidence(cls, v: float) -> float:
        if v < 0 or v > 1:
            raise ValueError("min_confidence must be between 0 and 1")
        return v

    @field_validator("impact_levels")
    @classmethod
    def validate_apply_impact_levels(
        cls, v: Optional[List[str]]
    ) -> Optional[List[str]]:
        if v is None:
            return v
        normalized = [item.lower().strip() for item in v if item and item.strip()]
        allowed = {"low", "medium", "high"}
        invalid = [item for item in normalized if item not in allowed]
        if invalid:
            raise ValueError("impact_levels must only include: low, medium, high")
        return normalized

    @field_validator("max_items")
    @classmethod
    def validate_apply_max_items(cls, v: int) -> int:
        if v < 1 or v > _MEMORY_INJECTION_MAX_ITEMS:
            raise ValueError(
                f"max_items must be between 1 and {_MEMORY_INJECTION_MAX_ITEMS}"
            )
        return v


class MemoryInjectApplyResponse(BaseModel):
    success: bool
    session_id: str
    applied_count: int
    applied_item_ids: List[str]
    injected_at: str


# ============== HEALTH ENDPOINTS ==============


def _health_payload() -> HealthResponse:
    return HealthResponse(
        status="ok",
        timestamp=datetime.utcnow().isoformat(),
        service="snac-backend",
        services={
            "openai": "configured" if OPENAI_API_KEY else "missing",
            "qdrant": f"{QDRANT_HOST}:{QDRANT_PORT}",
            "redis": f"{REDIS_HOST}:{REDIS_PORT}",
        },
    )


@app.get("/", response_model=HealthResponse)
async def root():
    """Health check endpoint."""
    return _health_payload()


@app.get("/health", response_model=HealthResponse)
async def health():
    """Alternate health check with consistent payload."""
    return _health_payload()


@app.get("/api/health", response_model=HealthResponse)
async def api_health():
    """Health endpoint that remains valid when API is reverse-proxied under /api."""
    return _health_payload()


@app.get("/status", response_model=HealthResponse)
async def status():
    """Simple text-friendly status endpoint for scripts and monitors."""
    return _health_payload()


# ============== INGEST ENDPOINT ==============


@app.post("/ingest", response_model=IngestResponse)
async def ingest_document(request: IngestRequest, background_tasks: BackgroundTasks):
    """
    Ingest document into the RAG system.
    Chunks content, generates embeddings (requires OpenAI key), and stores in Qdrant.
    """
    import uuid

    if _qdrant is None or _openai_client is None:
        raise HTTPException(
            status_code=503, detail="RAG unavailable: Qdrant or OpenAI not configured"
        )

    document_id = str(uuid.uuid4())
    chunk_size = 500
    chunks = [
        request.content[i : i + chunk_size]
        for i in range(0, len(request.content), chunk_size)
    ]

    failed_chunks: List[int] = []
    for idx, chunk in enumerate(chunks):
        try:
            embedding = await _embed(chunk)
            await _qdrant.upsert(
                collection_name=QDRANT_COLLECTION,
                points=[
                    PointStruct(
                        id=str(uuid.uuid4()),
                        vector=embedding,
                        payload={
                            "text": chunk,
                            "doc_id": document_id,
                            "chunk_index": idx,
                            **(request.metadata or {}),
                        },
                    )
                ],
            )
        except Exception as e:
            print(f"Qdrant upsert error chunk {idx}: {_redact_secrets(str(e))}")
            failed_chunks.append(idx)

    if failed_chunks:
        raise HTTPException(
            status_code=502,
            detail=f"Partial ingest failure: {len(failed_chunks)}/{len(chunks)} chunks failed "
            f"(indices: {failed_chunks})",
        )

    await _timeline_append(
        {
            "type": "ingest",
            "document_id": document_id,
            "chunks": len(chunks),
            "timestamp": datetime.utcnow().isoformat(),
            "metadata": request.metadata or {},
        }
    )

    return IngestResponse(success=True, chunks=len(chunks), document_id=document_id)


@app.post("/ingest-thought", response_model=ThoughtIngestResponse)
async def ingest_thought(request: ThoughtIngestRequest):
    """Ingest a raw thought and auto-structure it into summary, category, and links."""
    import uuid

    thought_id = str(uuid.uuid4())
    content = request.content.strip()
    keywords = _extract_keywords(content)
    category, confidence = _classify_thought(content, keywords)
    summary = _summarize_thought(content)

    existing = await _thought_recent(limit=300)
    linked_thought_ids = _find_related_thought_ids(keywords, existing)

    thought_entry = {
        "id": thought_id,
        "content": content,
        "summary": summary,
        "category": category,
        "confidence": confidence,
        "keywords": keywords,
        "linked_thought_ids": linked_thought_ids,
        "created_at": datetime.utcnow().isoformat(),
    }
    await _thought_add(thought_entry)

    await _timeline_append(
        {
            "type": "thought_ingest",
            "thought_id": thought_id,
            "summary": summary,
            "category": category,
            "linked_count": len(linked_thought_ids),
            "timestamp": datetime.utcnow().isoformat(),
        }
    )

    return ThoughtIngestResponse(
        success=True,
        thought_id=thought_id,
        summary=summary,
        category=category,
        confidence=confidence,
        keywords=keywords,
        linked_thought_ids=linked_thought_ids,
    )


@app.post("/thoughts/ingest", response_model=ThoughtIngestResponse)
async def ingest_thought_alias(request: ThoughtIngestRequest):
    """Alias endpoint for thought ingestion used by roadmap and cockpit modules."""
    return await ingest_thought(request)


# ============== THOUGHT PIPELINE ENHANCEMENTS ==============


@app.get("/thoughts/ranked")
async def get_ranked_thoughts(limit: int = 50, category: Optional[str] = None):
    """Get thoughts ranked by relevance and recency."""
    import time

    thought_list = thought_memory[-500:] if thought_memory else []
    if category:
        thought_list = [t for t in thought_list if t.get("category") == category]

    ranked = []
    now = time.time()
    for t in thought_list:
        created = t.get("created_at", "")
        try:
            dt = datetime.fromisoformat(created.replace("Z", "+00:00"))
            age_hours = (now - dt.timestamp()) / 3600
        except Exception:
            age_hours = 24

        recency_score = max(0, 1 - (age_hours / 168))  # Decay over 1 week
        confidence = t.get("confidence", 0.5)
        keyword_count = len(t.get("keywords", []))

        rank_score = (recency_score * 0.3) + (confidence * 0.4) + (keyword_count * 0.1)

        ranked.append({**t, "rank_score": rank_score})

    ranked.sort(key=lambda x: x["rank_score"], reverse=True)
    return {"thoughts": ranked[:limit], "count": min(len(ranked), limit)}


@app.get("/thoughts/clusters")
async def get_thought_clusters(min_cluster_size: int = 3):
    """Get thought clusters based on keyword similarity."""
    thought_list = thought_memory[-500:] if thought_memory else []

    clusters = []
    assigned = set()

    for i, thought in enumerate(thought_list):
        if thought["id"] in assigned:
            continue

        cluster_keywords = set(thought.get("keywords", []))
        cluster_thoughts = [thought]
        assigned.add(thought["id"])

        for j, other in enumerate(thought_list[i + 1 :], i + 1):
            if other["id"] in assigned:
                continue

            other_keywords = set(other.get("keywords", []))
            overlap = len(cluster_keywords & other_keywords)

            if overlap >= min_cluster_size:
                cluster_thoughts.append(other)
                assigned.add(other["id"])
                cluster_keywords.update(other_keywords)

        if len(cluster_thoughts) >= min_cluster_size:
            clusters.append(
                {
                    "cluster_id": f"cluster-{len(clusters)}",
                    "size": len(cluster_thoughts),
                    "keywords": list(cluster_keywords)[:10],
                    "thoughts": [
                        {"id": t["id"], "summary": t.get("summary", "")[:100]}
                        for t in cluster_thoughts
                    ],
                }
            )

    return {"clusters": clusters, "count": len(clusters)}


@app.post("/thoughts/to-project")
async def thoughts_to_project(thought_ids: List[str], project_name: str):
    """Convert selected thoughts into a project/task DAG."""
    import uuid

    project_id = str(uuid.uuid4())
    selected = [t for t in thought_memory if t.get("id") in thought_ids]

    if not selected:
        raise HTTPException(status_code=400, detail="No valid thought IDs provided")

    # Create project structure
    project = {
        "project_id": project_id,
        "name": project_name,
        "thoughts": selected,
        "tasks": [],
        "created_at": datetime.utcnow().isoformat(),
    }

    # Auto-generate tasks from thought categories
    categories = set(t.get("category", "general") for t in selected)

    task_templates = {
        "feature": "Implement feature from thoughts",
        "bug": "Fix issue identified in thoughts",
        "research": "Research topic from thoughts",
        "idea": "Explore and validate idea",
        "general": "Process related thoughts",
    }

    for cat in categories:
        task = {
            "id": f"{project_id}-task-{len(project['tasks'])}",
            "type": "build" if cat == "feature" else "research",
            "name": task_templates.get(cat, task_templates["general"]),
            "source_thoughts": [t["id"] for t in selected if t.get("category") == cat],
            "depends_on": [],
        }
        project["tasks"].append(task)

    # Emit event for planner integration
    await _swarm_emit_event(
        event_type="thought.project.created",
        payload={
            "project_id": project_id,
            "name": project_name,
            "thought_count": len(selected),
            "task_count": len(project["tasks"]),
        },
    )

    return {
        "project_id": project_id,
        "name": project_name,
        "thoughts": [
            {"id": t["id"], "summary": t.get("summary", "")[:100]} for t in selected
        ],
        "tasks": project["tasks"],
        "task_count": len(project["tasks"]),
    }


# ============== SWARM ENDPOINTS ==============


@app.post("/swarm/task", response_model=SwarmTaskResponse)
async def swarm_enqueue_task(request: SwarmTaskRequest):
    import uuid

    task_id = str(uuid.uuid4())
    workflow_id = request.workflow_id or str(uuid.uuid4())
    trace_id = str(uuid.uuid4())
    payload = await _enforce_runtime_policy(
        request=request,
        workflow_id=workflow_id,
        task_id=task_id,
        trace_id=trace_id,
    )

    task_entry = {
        "task_id": task_id,
        "workflow_id": workflow_id,
        "task": request.task,
        "agent_type": request.agent_type,
        "priority": request.priority,
        "payload": payload,
        "complexity": request.complexity,
        "runtime": request.runtime,
        "routing": request.routing,
        "status": "queued",
        "created_at": datetime.utcnow().isoformat(),
    }
    await _swarm_enqueue_task(task_entry, request.priority)

    event = await _swarm_emit_event(
        "swarm.task.created",
        workflow_id=workflow_id,
        task_id=task_id,
        agent_type=request.agent_type,
        priority=request.priority,
        payload={
            "complexity": request.complexity,
            "routing": request.routing,
            "replicas": payload.get("replicas"),
            "task_preview": request.task[:120],
        },
        runtime=request.runtime,
        trace_id=trace_id,
        source="planner",
    )

    await _timeline_append(
        {
            "type": "swarm_task_created",
            "task_id": task_id,
            "agent_type": request.agent_type,
            "priority": request.priority,
            "timestamp": datetime.utcnow().isoformat(),
        }
    )

    return SwarmTaskResponse(
        success=True,
        task_id=task_id,
        queue=request.priority,
        event_id=event["event_id"],
        runtime=request.runtime,
    )


@app.get("/swarm/status", response_model=SwarmStatusResponse)
async def swarm_status():
    data = await _swarm_calculate_desired_workers()
    return SwarmStatusResponse(
        queue_depth=data["queue_depth"],
        queue_depth_total=data["queue_depth_total"],
        active_workers=data["active_workers"],
        desired_workers=data["desired_workers"],
        guardrails=data["guardrails"],
        config=SwarmConfigResponse(**data["config"]),
    )


@app.post("/swarm/scaler/tick", response_model=SwarmScalerTickResponse)
async def swarm_scaler_tick():
    data = await _swarm_calculate_desired_workers()

    await _swarm_emit_event(
        "swarm.scaler.decision",
        payload={
            "queue_depth_total": data["queue_depth_total"],
            "active_workers": data["active_workers"],
            "desired_workers": data["desired_workers"],
            "frozen_scale_up": data["frozen_scale_up"],
            "reason": data["reason"],
        },
        source="operator",
    )

    await _timeline_append(
        {
            "type": "swarm_scaler_decision",
            "queue_depth_total": data["queue_depth_total"],
            "desired_workers": data["desired_workers"],
            "active_workers": data["active_workers"],
            "timestamp": datetime.utcnow().isoformat(),
        }
    )

    return SwarmScalerTickResponse(
        desired_workers=data["desired_workers"],
        active_workers=data["active_workers"],
        queue_depth_total=data["queue_depth_total"],
        frozen_scale_up=data["frozen_scale_up"],
        reason=data["reason"],
    )


@app.get("/swarm/events/recent", response_model=SwarmEventsResponse)
async def swarm_events_recent(limit: int = 50):
    limit = max(1, min(limit, 500))
    events = await _swarm_recent_events(limit=limit)
    return SwarmEventsResponse(events=[SwarmEventItem(**e) for e in events])


# ============== EVENT CONTRACT REGISTRY ENDPOINTS ==============


@app.get("/events/contracts")
async def get_event_contracts():
    """Get all event contract schemas."""
    return {
        "version": _event_contract_version,
        "contracts": _EVENT_CONTRACTS.get(_event_contract_version, {}),
    }


@app.get("/events/contracts/{event_type}")
async def get_event_contract(event_type: str):
    """Get specific event contract schema."""
    contracts = _EVENT_CONTRACTS.get(_event_contract_version, {})
    contract = contracts.get(event_type)
    if not contract:
        raise HTTPException(
            status_code=404, detail=f"No contract found for event_type: {event_type}"
        )
    return {
        "event_type": event_type,
        "version": _event_contract_version,
        **contract,
    }


@app.post("/events/validate")
async def validate_event(event: Dict[str, Any]):
    """Validate an event against its contract."""
    event_type = event.get("event_type") or event.get("type")
    if not event_type:
        raise HTTPException(status_code=400, detail="event_type is required")

    payload = event.get("payload", {})
    is_valid, errors = _validate_event_contract(event_type, payload)

    return {
        "event_type": event_type,
        "valid": is_valid,
        "errors": errors,
        "version": _event_contract_version,
    }


@app.get("/events/contract-topics")
async def get_contract_topics():
    """Get all available event topics."""
    contracts = _EVENT_CONTRACTS.get(_event_contract_version, {})
    return {
        "topics": list(contracts.keys()),
        "count": len(contracts),
    }


# ============== COMMAND POLICY ENDPOINTS ==============


@app.get("/policy/commands/classes")
async def get_command_risk_classes():
    """Get command risk classification classes."""
    return {"classes": _COMMAND_RISK_CLASSES}


@app.post("/policy/commands/classify")
async def classify_command(request: Dict[str, str]):
    """Classify a command into risk category."""
    command = request.get("command", "")
    if not command:
        raise HTTPException(status_code=400, detail="command is required")

    risk_class, violations = _classify_command_risk(command)

    _log_command_audit(
        command=command,
        risk_class=risk_class,
        approved=risk_class not in ["blocked", "dangerous"],
        source="api",
    )

    return {
        "command": command,
        "risk_class": risk_class,
        "violations": violations,
        "requires_approval": risk_class in ["guarded", "dangerous"],
        "blocked": risk_class == "blocked",
    }


@app.get("/policy/audit/log")
async def get_audit_log(limit: int = 50):
    """Get command audit log."""
    limit = max(1, min(limit, 500))
    return {
        "audit_log": _command_policy_audit_log[-limit:],
        "count": len(_command_policy_audit_log[-limit:]),
    }


@app.post("/policy/commands/approve")
async def approve_command(request: Dict[str, str]):
    """Manually approve a guarded/dangerous command."""
    command = request.get("command", "")
    reason = request.get("reason", "Manual approval")

    if not command:
        raise HTTPException(status_code=400, detail="command is required")

    _log_command_audit(
        command=command,
        risk_class="approved",
        approved=True,
        source="manual_approval",
        details={"reason": reason},
    )

    return {"success": True, "command": command, "approved": True}


@app.post("/swarm/config", response_model=SwarmConfigResponse)
async def swarm_update_config(
    request: SwarmConfigUpdateRequest, _: None = Depends(_require_control_plane_token)
):
    current = await _swarm_get_config()
    update_data = request.model_dump(exclude_none=True)
    merged = {**current, **update_data}

    if merged["min_workers"] < 0 or merged["max_workers"] < 1:
        raise HTTPException(status_code=400, detail="invalid worker limits")
    if merged["min_workers"] > merged["max_workers"]:
        raise HTTPException(
            status_code=400, detail="min_workers cannot exceed max_workers"
        )
    if merged["max_tokens_per_min"] < 1:
        raise HTTPException(status_code=400, detail="max_tokens_per_min must be >= 1")
    if merged["max_cpu_percent"] <= 0 or merged["max_cpu_percent"] > 100:
        raise HTTPException(
            status_code=400, detail="max_cpu_percent must be in (0, 100]"
        )
    if merged["idle_timeout_seconds"] < 1:
        raise HTTPException(status_code=400, detail="idle_timeout_seconds must be >= 1")

    await _swarm_set_config(merged)
    await _swarm_emit_event("swarm.config.updated", payload=merged, source="operator")
    return SwarmConfigResponse(**merged)


@app.post("/swarm/workers/spawn", response_model=SwarmWorkersResponse)
async def swarm_spawn_workers(
    request: SwarmWorkerSpawnRequest, _: None = Depends(_require_control_plane_token)
):
    import uuid

    config = await _swarm_get_config()
    active = await _swarm_active_workers_count()
    available = max(config["max_workers"] - active, 0)
    if available <= 0:
        raise HTTPException(status_code=409, detail="max_workers limit reached")
    if request.count > available:
        raise HTTPException(
            status_code=400,
            detail=f"requested count exceeds available worker slots ({available})",
        )

    workers: List[Dict[str, Any]] = []
    for _ in range(request.count):
        worker = {
            "worker_id": str(uuid.uuid4()),
            "worker_type": request.worker_type,
            "runtime": request.runtime,
            "status": "running",
            "started_at": datetime.utcnow().isoformat(),
            "lease_only": False,
        }
        await _swarm_worker_register(worker)
        await _swarm_start_worker_runtime(worker)
        workers.append(worker)
        await _swarm_emit_event(
            "swarm.worker.spawned",
            payload={
                "worker_id": worker["worker_id"],
                "worker_type": request.worker_type,
            },
            runtime=request.runtime,
            source="operator",
        )

    return SwarmWorkersResponse(workers=[SwarmWorkerInfo(**w) for w in workers])


@app.post("/swarm/workers/retire", response_model=SwarmWorkersResponse)
async def swarm_retire_worker(
    request: SwarmWorkerRetireRequest, _: None = Depends(_require_control_plane_token)
):
    runtime_task = worker_runtime_tasks.pop(request.worker_id, None)
    if runtime_task:
        runtime_task.cancel()
    retired = await _swarm_worker_retire(request.worker_id)
    if not retired:
        raise HTTPException(status_code=404, detail="worker not found")
    retired["status"] = "retired"

    await _swarm_emit_event(
        "swarm.worker.stopped",
        payload={
            "worker_id": retired["worker_id"],
            "worker_type": retired["worker_type"],
        },
        runtime=retired.get("runtime"),
        source="operator",
    )

    await _swarm_emit_event(
        "swarm.worker.retired",
        payload={
            "worker_id": retired["worker_id"],
            "worker_type": retired["worker_type"],
        },
        runtime=retired.get("runtime"),
        source="operator",
    )
    return SwarmWorkersResponse(workers=[SwarmWorkerInfo(**retired)])


@app.get("/swarm/workers", response_model=SwarmWorkersResponse)
async def swarm_workers_list(_: None = Depends(_require_control_plane_token)):
    workers = await _swarm_workers_list()
    return SwarmWorkersResponse(workers=[SwarmWorkerInfo(**w) for w in workers])


@app.get("/swarm/results/recent", response_model=SwarmTaskResultsResponse)
async def swarm_results_recent(
    limit: int = 50, _: None = Depends(_require_control_plane_token)
):
    limit = max(1, min(limit, 500))
    results = await _swarm_recent_results(limit=limit)
    return SwarmTaskResultsResponse(results=[SwarmTaskResultItem(**r) for r in results])


@app.get("/swarm/graph/snapshot", response_model=SwarmGraphSnapshotResponse)
async def swarm_graph_snapshot():
    workers = await _swarm_workers_list()
    queue_depth = await _swarm_queue_depth()
    recent_events = await _swarm_recent_events(limit=30)

    nodes: List[SwarmGraphNode] = []
    edges: List[SwarmGraphEdge] = []

    queue_total = queue_depth["high"] + queue_depth["normal"] + queue_depth["low"]
    nodes.append(
        SwarmGraphNode(
            id="queue",
            type="queue",
            label="Task Queue",
            status="active",
            count=queue_total,
        )
    )

    running_count = 0
    for worker in workers:
        wid = worker["worker_id"]
        wtype = worker.get("worker_type", "worker")
        wstatus = worker.get("status", "idle")
        runtime = worker.get("runtime", "shared")
        nodes.append(
            SwarmGraphNode(
                id=wid,
                type="worker",
                label=f"{wtype}\n{wid[:8]}",
                status=wstatus,
                runtime=runtime,
                worker_type=wtype,
            )
        )
        edges.append(SwarmGraphEdge(source="queue", target=wid, label="claims"))
        if wstatus == "running":
            running_count += 1

    recent_event_types = list(
        dict.fromkeys(
            e.get("event_type") or e.get("type", "")
            for e in reversed(recent_events)
            if e.get("event_type") or e.get("type")
        )
    )[:10]

    return SwarmGraphSnapshotResponse(
        nodes=nodes,
        edges=edges,
        active_workers=len(workers),
        tasks_running=running_count,
        queue_depth=queue_total,
        recent_event_types=recent_event_types,
        snapshot_at=datetime.utcnow().isoformat(),
    )


@app.get("/swarm/intelligence/summary", response_model=SwarmIntelligenceSummaryResponse)
async def swarm_intelligence_summary():
    stats: Dict[str, Any] = {}
    if _redis:
        try:
            raw = await _redis.hgetall(_SWARM_INTELLIGENCE_KEY)
            for wid, val in raw.items():
                try:
                    stats[wid] = json.loads(val)
                except json.JSONDecodeError:
                    pass
        except Exception:
            pass
    if not stats:
        stats = {
            k: v
            for k, v in swarm_intelligence_stats.items()
            if isinstance(v, dict) and "total" in v
        }

    total = sum(s.get("total", 0) for s in stats.values())
    succeeded = sum(s.get("succeeded", 0) for s in stats.values())
    failed = sum(s.get("failed", 0) for s in stats.values())
    success_rate = round(succeeded / total, 4) if total > 0 else 0.0

    total_duration = sum(s.get("total_duration_ms", 0) for s in stats.values())
    avg_duration = round(total_duration / total, 1) if total > 0 else 0.0

    best_worker = max(
        stats.values(),
        key=lambda s: s.get("succeeded", 0) / max(s.get("total", 1), 1),
        default=None,
    )

    slowest_worker = max(
        stats.values(), key=lambda s: s.get("max_duration_ms", 0), default=None
    )
    slowest_task = slowest_worker.get("slowest_task", "") if slowest_worker else ""

    runtime_counts: Dict[str, int] = {}
    for s in stats.values():
        rt = str(s.get("runtime") or "shared")
        runtime_counts[rt] = runtime_counts.get(rt, 0) + s.get("total", 0)
    busiest_runtime = (
        max(runtime_counts, key=runtime_counts.get) if runtime_counts else None
    )

    if total == 0:
        strategy = "no_data"
    elif success_rate < 0.5:
        strategy = "reduce_parallelism"
    elif avg_duration > 5000:
        strategy = "parallelize"
    elif total > 100 and success_rate > 0.9:
        strategy = "scale_out"
    else:
        strategy = "maintain"

    return SwarmIntelligenceSummaryResponse(
        total_tasks=total,
        succeeded=succeeded,
        failed=failed,
        task_success_rate=success_rate,
        avg_duration_ms=avg_duration,
        best_worker_id=best_worker.get("worker_id") if best_worker else None,
        best_worker_type=best_worker.get("worker_type") if best_worker else None,
        slowest_task_preview=slowest_task or None,
        busiest_runtime=busiest_runtime,
        recommended_strategy=strategy,
        summary_window="all_time",
    )


@app.post("/swarm/task/checkpoint", response_model=SwarmCheckpointResponse)
async def swarm_task_checkpoint_write(
    request: SwarmCheckpointWriteRequest,
    _: None = Depends(_require_control_plane_token),
):
    await _swarm_checkpoint_write(
        task_id=request.task_id,
        worker_id=request.worker_id,
        progress=request.progress,
        total=request.total,
        state=request.state,
    )
    percent = round(request.progress / request.total * 100, 1)
    return SwarmCheckpointResponse(
        task_id=request.task_id,
        worker_id=request.worker_id,
        progress=request.progress,
        total=request.total,
        percent=percent,
        state=request.state or {},
        updated_at=datetime.utcnow().isoformat(),
    )


@app.get("/swarm/task/checkpoint/{task_id}", response_model=SwarmCheckpointResponse)
async def swarm_task_checkpoint_read(
    task_id: str, _: None = Depends(_require_control_plane_token)
):
    cp = await _swarm_checkpoint_read(task_id)
    if not cp:
        raise HTTPException(status_code=404, detail="checkpoint not found")
    total = max(cp.get("total", 1), 1)
    progress = cp.get("progress", 0)
    return SwarmCheckpointResponse(
        task_id=cp["task_id"],
        worker_id=cp["worker_id"],
        progress=progress,
        total=total,
        percent=round(progress / total * 100, 1),
        state=cp.get("state") or {},
        updated_at=cp.get("updated_at", ""),
    )


@app.post("/memory/learn", response_model=MemoryLearnResponse)
async def memory_learn(request: MemoryLearnRequest):
    import uuid

    item = {
        "id": str(uuid.uuid4()),
        "source_model": request.source_model.strip(),
        "topic": request.topic.strip(),
        "details": request.details.strip(),
        "impact_level": request.impact_level,
        "confidence": request.confidence,
        "tags": request.tags or [],
        "created_at": datetime.utcnow().isoformat(),
    }
    await _memory_knowledge_add(item)

    await _timeline_append(
        {
            "type": "memory_learn",
            "memory_id": item["id"],
            "source_model": item["source_model"],
            "topic": item["topic"],
            "impact_level": item["impact_level"],
            "timestamp": datetime.utcnow().isoformat(),
        }
    )

    return MemoryLearnResponse(success=True, item=MemoryFeedItem(**item))


@app.get("/memory/feed", response_model=MemoryFeedResponse)
async def memory_feed(limit: int = 50):
    limit = max(1, min(limit, 500))
    items = await _memory_knowledge_recent(limit=limit)
    return MemoryFeedResponse(items=[MemoryFeedItem(**i) for i in items])


@app.post("/memory/share", response_model=MemoryShareResponse)
async def memory_share(
    request: MemoryShareRequest, _: None = Depends(_require_control_plane_token)
):
    import uuid

    source = await _memory_find_entry(request.entry_id)
    if not source:
        raise HTTPException(status_code=404, detail="memory entry not found")

    source_model = str(source.get("source_model") or "unknown").strip()
    if request.source_model.strip().lower() != source_model.lower():
        raise HTTPException(
            status_code=400, detail="source_model does not match entry source"
        )

    created_ids: List[str] = []
    for target_model in request.target_models:
        item = {
            "id": str(uuid.uuid4()),
            "source_model": target_model.strip(),
            "topic": str(source.get("topic") or "shared-memory").strip(),
            "details": str(source.get("details") or "").strip(),
            "impact_level": str(source.get("impact_level") or "low").strip().lower(),
            "confidence": float(source.get("confidence") or 0.5),
            "tags": list(source.get("tags") or [])
            + [
                f"shared_from:{source_model.lower()}",
                f"shared_entry:{request.entry_id}",
                "cross_model_shared",
            ],
            "created_at": datetime.utcnow().isoformat(),
        }
        if request.note:
            item["details"] = (
                item["details"] + "\n\nShare note: " + request.note.strip()
            ).strip()

        await _memory_knowledge_add(item)
        created_ids.append(item["id"])

    await _timeline_append(
        {
            "type": "memory_share",
            "shared_from_id": request.entry_id,
            "source_model": source_model,
            "target_models": request.target_models,
            "created_count": len(created_ids),
            "timestamp": datetime.utcnow().isoformat(),
        }
    )

    return MemoryShareResponse(
        success=True, shared_from_id=request.entry_id, created_item_ids=created_ids
    )


@app.post("/memory/workflow/learn", response_model=MedicalWorkflowLearnResponse)
async def memory_workflow_learn(request: MedicalWorkflowLearnRequest):
    import uuid

    patient_ref = _anonymize_identifier(request.patientId or "unknown")
    top = request.diagnosis.topCandidate
    lead_gene = (
        request.diagnosis.candidateGenes[0]
        if request.diagnosis.candidateGenes
        else "unknown"
    )
    hpo_labels = ", ".join([term.label for term in request.diagnosis.hpoTerms[:5]])

    impact_level = "low"
    if request.confidence >= 0.85:
        impact_level = "high"
    elif request.confidence >= 0.7:
        impact_level = "medium"

    details = (
        f"workflow_id: {request.workflowId}\n"
        f"patient_ref: {patient_ref}\n"
        f"duration_ms: {request.duration}\n"
        f"confidence: {request.confidence:.3f}\n"
        f"top_candidate: {top.chr}:{top.pos} {top.ref}>{top.alt}\n"
        f"combined_score: {top.combinedScore:.4f}\n"
        f"lead_gene: {lead_gene}\n"
        f"candidate_genes: {', '.join(request.diagnosis.candidateGenes[:10])}\n"
        f"hpo_terms: {hpo_labels}\n"
        f"interpretation: {request.diagnosis.interpretation.strip()}"
    )

    item = {
        "id": str(uuid.uuid4()),
        "source_model": request.source_model.strip(),
        "topic": f"Rare disease diagnostic {request.workflowId}",
        "details": details,
        "impact_level": impact_level,
        "confidence": request.confidence,
        "tags": [
            "medical",
            "workflow",
            "rare-disease",
            "diagnostic",
            f"gene:{lead_gene.lower()}",
        ],
        "created_at": datetime.utcnow().isoformat(),
    }
    await _memory_knowledge_add(item)

    await _timeline_append(
        {
            "type": "memory_workflow_learn",
            "memory_id": item["id"],
            "workflow_id": request.workflowId,
            "patient_ref": patient_ref,
            "confidence": request.confidence,
            "duration_ms": request.duration,
            "timestamp": datetime.utcnow().isoformat(),
        }
    )

    return MedicalWorkflowLearnResponse(
        success=True,
        workflow_id=request.workflowId,
        patient_ref=patient_ref,
        item=MemoryFeedItem(**item),
    )


@app.post("/memory/inject/preview", response_model=MemoryInjectPreviewResponse)
async def memory_inject_preview(request: MemoryInjectPreviewRequest):
    session_id = request.session_id or "global"
    candidates = await _memory_build_injection_candidates(
        session_id=session_id,
        agent_type=request.agent_type,
        domain=request.domain,
        layers=request.layers,
        impact_levels=request.impact_levels,
        min_confidence=request.min_confidence,
        query=request.query,
        max_items=request.max_items,
    )
    return MemoryInjectPreviewResponse(
        success=True,
        session_id=session_id,
        filters={
            "agent_type": request.agent_type,
            "domain": request.domain,
            "layers": request.layers or [],
            "impact_levels": request.impact_levels or [],
            "min_confidence": request.min_confidence,
            "query": request.query,
            "max_items": request.max_items,
        },
        candidates=[MemoryInjectCandidate(**item) for item in candidates],
    )


@app.post("/memory/inject/apply", response_model=MemoryInjectApplyResponse)
async def memory_inject_apply(request: MemoryInjectApplyRequest):
    recent_items = await _memory_knowledge_recent(
        limit=max(_MEMORY_INJECTION_MAX_ITEMS * 5, 200)
    )
    recent_by_id = {
        str(item.get("id")): item for item in recent_items if item.get("id")
    }

    selected: List[Dict[str, Any]] = []
    if request.selected_item_ids:
        for item_id in request.selected_item_ids:
            item = recent_by_id.get(item_id)
            if item:
                selected.append(item)
    else:
        candidates = await _memory_build_injection_candidates(
            session_id=request.session_id,
            agent_type=request.agent_type,
            domain=request.domain,
            layers=request.layers,
            impact_levels=request.impact_levels,
            min_confidence=request.min_confidence,
            query=request.query,
            max_items=request.max_items,
        )
        selected = [candidate["item"].model_dump() for candidate in candidates]

    selected = selected[: request.max_items]
    injected_at = datetime.utcnow().isoformat()

    memory_injection_runtime[request.session_id] = {
        "session_id": request.session_id,
        "agent_type": request.agent_type,
        "domain": request.domain,
        "layers": request.layers or [],
        "impact_levels": request.impact_levels or [],
        "min_confidence": request.min_confidence,
        "query": request.query,
        "max_items": request.max_items,
        "items": selected,
        "item_ids": [str(item.get("id")) for item in selected if item.get("id")],
        "injected_at": injected_at,
    }

    await _timeline_append(
        {
            "type": "memory_injection_apply",
            "session_id": request.session_id,
            "applied_count": len(selected),
            "item_ids": [str(item.get("id")) for item in selected if item.get("id")][
                :10
            ],
            "domain": request.domain,
            "agent_type": request.agent_type,
            "timestamp": datetime.utcnow().isoformat(),
        }
    )

    return MemoryInjectApplyResponse(
        success=True,
        session_id=request.session_id,
        applied_count=len(selected),
        applied_item_ids=[str(item.get("id")) for item in selected if item.get("id")],
        injected_at=injected_at,
    )


# ============== STORAGE HELPERS (Redis-backed with in-memory fallback) ==============


async def _session_exists(session_id: str) -> bool:
    if _redis:
        return bool(await _redis.exists(f"session:{session_id}"))
    return session_id in agent_sessions


async def _session_get(session_id: str) -> Optional[Dict]:
    if _redis:
        data = await _redis.get(f"session:{session_id}")
        return json.loads(data) if data else None
    return agent_sessions.get(session_id)


async def _session_set(session_id: str, data: Dict) -> None:
    if _redis:
        await _redis.set(f"session:{session_id}", json.dumps(data), ex=86400)
    else:
        agent_sessions[session_id] = data
        _fallback_session_last_seen[session_id] = time.time()
        _prune_memory_fallback_state()


async def _session_delete(session_id: str) -> None:
    if _redis:
        await _redis.delete(f"session:{session_id}")
        await _redis.hdel("token_usage", f"session:{session_id}")
    else:
        agent_sessions.pop(session_id, None)
        token_usage["by_session"].pop(session_id, None)
        _fallback_session_last_seen.pop(session_id, None)


async def _timeline_append(event: Dict) -> None:
    if _redis:
        await _redis.rpush("timeline", json.dumps(event))
        size = await _redis.llen("timeline")
        if size > _MEMORY_FALLBACK_MAX_TIMELINE:
            await _redis.ltrim("timeline", size - _MEMORY_FALLBACK_MAX_TIMELINE, -1)
    else:
        memory_timeline.append(event)
        _prune_memory_fallback_state()


async def _timeline_get(limit: int = 50) -> List[Dict]:
    if _redis:
        items = await _redis.lrange("timeline", -limit, -1)
        return [json.loads(i) for i in items]
    return memory_timeline[-limit:]


async def _timeline_get_session(session_id: str) -> List[Dict]:
    # Scans full timeline; replace with per-session key for high-volume use
    if _redis:
        items = await _redis.lrange("timeline", 0, -1)
        decoded = [json.loads(i) for i in items]
        return [e for e in decoded if e.get("session_id") == session_id]
    return [e for e in memory_timeline if e.get("session_id") == session_id]


async def _token_incr(session_id: str, cost: float) -> None:
    if _redis:
        await _redis.hincrbyfloat("token_usage", "total", cost)
        await _redis.hincrbyfloat("token_usage", f"session:{session_id}", cost)
    else:
        token_usage["total"] += cost
        token_usage["by_session"][session_id] = (
            token_usage["by_session"].get(session_id, 0.0) + cost
        )
        _prune_memory_fallback_state()


async def _swarm_record_token_usage(tokens: int) -> None:
    if tokens <= 0:
        return

    now = time.time()
    item = {"ts": now, "tokens": int(tokens), "nonce": str(uuid.uuid4())}

    if _redis:
        await _redis.zadd(_SWARM_TOKEN_EVENTS_KEY, {json.dumps(item): now})
        await _redis.zremrangebyscore(_SWARM_TOKEN_EVENTS_KEY, 0, now - 3600)
    else:
        swarm_token_events.append(item)
        cutoff = now - 3600
        if len(swarm_token_events) > 1:
            swarm_token_events[:] = [
                e for e in swarm_token_events if float(e.get("ts", 0.0)) >= cutoff
            ]


async def _swarm_tokens_last_minute() -> int:
    now = time.time()
    window_start = now - 60

    if _redis:
        items = await _redis.zrangebyscore(_SWARM_TOKEN_EVENTS_KEY, window_start, now)
        total = 0
        for raw in items:
            try:
                payload = json.loads(raw)
                total += int(payload.get("tokens", 0))
            except (json.JSONDecodeError, TypeError, ValueError):
                continue
        return total

    return sum(
        int(e.get("tokens", 0))
        for e in swarm_token_events
        if float(e.get("ts", 0.0)) >= window_start
    )


def _swarm_cpu_percent_estimate() -> float:
    """Estimate host CPU load percentage from 1m load average when available."""
    try:
        import psutil  # type: ignore

        return float(psutil.cpu_percent(interval=0.0))
    except Exception:
        pass

    try:
        load_1m = os.getloadavg()[0]
        cpu_count = max(os.cpu_count() or 1, 1)
        return round(min(100.0, (load_1m / cpu_count) * 100.0), 2)
    except (AttributeError, OSError):
        return 0.0


async def _token_get() -> Dict[str, Any]:
    if _redis:
        raw = await _redis.hgetall("token_usage")
        return {
            "total": float(raw.get("total", 0)),
            "by_session": {
                k.replace("session:", ""): float(v)
                for k, v in raw.items()
                if k.startswith("session:")
            },
        }
    return token_usage


async def _thought_add(thought: Dict[str, Any]) -> None:
    if _redis:
        await _redis.rpush("thoughts", json.dumps(thought))
        await _redis.ltrim("thoughts", -_MEMORY_FALLBACK_MAX_THOUGHTS, -1)
    else:
        thought_memory.append(thought)
        _prune_memory_fallback_state()


async def _thought_recent(limit: int = 250) -> List[Dict[str, Any]]:
    if _redis:
        items = await _redis.lrange("thoughts", -limit, -1)
        return [json.loads(i) for i in items]
    return thought_memory[-limit:]


async def _memory_knowledge_add(entry: Dict[str, Any]) -> None:
    if _redis:
        await _redis.rpush(_MEMORY_SHARED_KNOWLEDGE_KEY, json.dumps(entry))
        await _redis.ltrim(
            _MEMORY_SHARED_KNOWLEDGE_KEY, -_MEMORY_FALLBACK_MAX_SHARED_KNOWLEDGE, -1
        )
    else:
        shared_knowledge_memory.append(entry)
        _prune_memory_fallback_state()


async def _memory_knowledge_recent(limit: int = 50) -> List[Dict[str, Any]]:
    if _redis:
        items = await _redis.lrange(_MEMORY_SHARED_KNOWLEDGE_KEY, -limit, -1)
        return [json.loads(i) for i in items]
    return shared_knowledge_memory[-limit:]


async def _memory_find_entry(entry_id: str) -> Optional[Dict[str, Any]]:
    items = await _memory_knowledge_recent(
        limit=max(_MEMORY_FALLBACK_MAX_SHARED_KNOWLEDGE, 500)
    )
    for item in reversed(items):
        if str(item.get("id")) == entry_id:
            return item
    return None


def _memory_item_tags(item: Dict[str, Any]) -> List[str]:
    return [
        str(tag).strip().lower() for tag in (item.get("tags") or []) if str(tag).strip()
    ]


def _memory_filter_tag_match(
    tags: List[str], needle: str, prefix: Optional[str] = None
) -> bool:
    value = needle.strip().lower()
    if not value:
        return False
    if value in tags:
        return True
    if prefix and f"{prefix}:{value}" in tags:
        return True
    return False


def _memory_matches_layers(tags: List[str], layers: Optional[List[str]]) -> bool:
    if not layers:
        return True
    normalized = [layer.strip().lower() for layer in layers if layer and layer.strip()]
    if not normalized:
        return True
    return any(_memory_filter_tag_match(tags, layer, "layer") for layer in normalized)


async def _memory_build_injection_candidates(
    *,
    session_id: str,
    agent_type: Optional[str],
    domain: Optional[str],
    layers: Optional[List[str]],
    impact_levels: Optional[List[str]],
    min_confidence: float,
    query: Optional[str],
    max_items: int,
) -> List[Dict[str, Any]]:
    items = await _memory_knowledge_recent(
        limit=max(_MEMORY_INJECTION_MAX_ITEMS * 5, 200)
    )
    impact_set = set(impact_levels or [])
    query_norm = (query or "").strip().lower()

    scored: List[Dict[str, Any]] = []
    for raw in reversed(items):
        topic = str(raw.get("topic") or "")
        details = str(raw.get("details") or "")
        impact = str(raw.get("impact_level") or "low").lower().strip()
        confidence = float(raw.get("confidence") or 0.0)
        tags = _memory_item_tags(raw)
        blob = (topic + "\n" + details).lower()

        if impact_set and impact not in impact_set:
            continue
        if confidence < min_confidence:
            continue
        if domain and not (
            _memory_filter_tag_match(tags, domain, "domain")
            or domain.lower().strip() in blob
        ):
            continue
        if agent_type and not (
            _memory_filter_tag_match(tags, agent_type, "agent")
            or agent_type.lower().strip() in blob
        ):
            continue
        if not _memory_matches_layers(tags, layers):
            continue
        if query_norm and query_norm not in blob:
            continue

        score = confidence * 0.7
        score += {"low": 0.08, "medium": 0.16, "high": 0.24}.get(impact, 0.05)
        reasons: List[str] = [f"confidence={confidence:.2f}", f"impact={impact}"]

        if query_norm:
            if query_norm in topic.lower():
                score += 0.2
                reasons.append("topic_query_match")
            elif query_norm in details.lower():
                score += 0.1
                reasons.append("details_query_match")

        if domain and _memory_filter_tag_match(tags, domain, "domain"):
            score += 0.06
            reasons.append("domain_tag_match")

        if agent_type and _memory_filter_tag_match(tags, agent_type, "agent"):
            score += 0.06
            reasons.append("agent_tag_match")

        if layers:
            score += 0.03
            reasons.append("layer_match")

        scored.append(
            {
                "item": MemoryFeedItem(**raw),
                "score": round(score, 4),
                "reasons": reasons,
            }
        )

    scored.sort(key=lambda entry: entry["score"], reverse=True)
    return scored[:max_items]


def _extract_keywords(text: str, limit: int = 8) -> List[str]:
    stopwords = {
        "the",
        "and",
        "for",
        "that",
        "with",
        "this",
        "from",
        "then",
        "into",
        "have",
        "your",
        "about",
        "when",
        "where",
        "what",
        "will",
        "just",
        "idea",
        "thought",
        "link",
        "might",
    }
    words = re.findall(r"[a-zA-Z][a-zA-Z0-9_-]{2,}", text.lower())
    freq: Dict[str, int] = {}
    for w in words:
        if w in stopwords:
            continue
        freq[w] = freq.get(w, 0) + 1
    ordered = sorted(freq.items(), key=lambda kv: (-kv[1], kv[0]))
    return [w for w, _ in ordered[:limit]]


def _anonymize_identifier(value: str) -> str:
    digest = hashlib.sha256(value.encode("utf-8")).hexdigest()
    return f"anon-{digest[:12]}"


def _classify_thought(content: str, keywords: List[str]) -> tuple[str, float]:
    text = (content + " " + " ".join(keywords)).lower()
    rulebook = {
        "AI_SYSTEMS": ["agent", "agents", "llm", "ai", "prompt", "model", "reasoning"],
        "AUTOMATION": [
            "workflow",
            "n8n",
            "pipeline",
            "automation",
            "orchestrator",
            "trigger",
        ],
        "INFRASTRUCTURE": [
            "docker",
            "nginx",
            "redis",
            "postgres",
            "qdrant",
            "deploy",
            "vps",
        ],
        "RESEARCH": [
            "paper",
            "arxiv",
            "study",
            "experiment",
            "benchmark",
            "hypothesis",
        ],
        "BUSINESS": ["customer", "pricing", "revenue", "market", "sales", "offer"],
        "CRYPTO": ["crypto", "wallet", "token", "blockchain", "defi", "chain"],
    }

    best_category = "AI_SYSTEMS"
    best_hits = 0
    for category, needles in rulebook.items():
        hits = sum(1 for needle in needles if needle in text)
        if hits > best_hits:
            best_hits = hits
            best_category = category

    confidence = min(0.99, 0.55 + (best_hits * 0.1))
    return best_category, round(confidence, 2)


def _summarize_thought(content: str, max_len: int = 180) -> str:
    compact = re.sub(r"\s+", " ", content.strip())
    if len(compact) <= max_len:
        return compact
    return compact[: max_len - 1].rstrip() + "..."


def _overlap_score(a: List[str], b: List[str]) -> int:
    return len(set(a) & set(b))


def _find_related_thought_ids(
    current_keywords: List[str], existing: List[Dict[str, Any]], limit: int = 5
) -> List[str]:
    scored: List[tuple[int, str]] = []
    for thought in existing:
        tid = thought.get("id")
        kws = thought.get("keywords") or []
        if not tid:
            continue
        score = _overlap_score(current_keywords, kws)
        if score > 0:
            scored.append((score, str(tid)))
    scored.sort(key=lambda s: (-s[0], s[1]))
    return [tid for _, tid in scored[:limit]]


def _swarm_queue_key(priority: str) -> str:
    return f"{_SWARM_QUEUE_KEY_PREFIX}:{priority}"


async def _swarm_get_config() -> Dict[str, Any]:
    if _redis:
        raw = await _redis.hgetall(_SWARM_CONFIG_KEY)
        if not raw:
            return dict(swarm_config)
        return {
            "min_workers": int(raw.get("min_workers", swarm_config["min_workers"])),
            "max_workers": int(raw.get("max_workers", swarm_config["max_workers"])),
            "max_tokens_per_min": int(
                raw.get("max_tokens_per_min", swarm_config["max_tokens_per_min"])
            ),
            "max_cpu_percent": float(
                raw.get("max_cpu_percent", swarm_config["max_cpu_percent"])
            ),
            "idle_timeout_seconds": int(
                raw.get("idle_timeout_seconds", swarm_config["idle_timeout_seconds"])
            ),
        }
    return dict(swarm_config)


async def _swarm_set_config(config: Dict[str, Any]) -> None:
    if _redis:
        await _redis.hset(
            _SWARM_CONFIG_KEY,
            mapping={
                "min_workers": str(config["min_workers"]),
                "max_workers": str(config["max_workers"]),
                "max_tokens_per_min": str(config["max_tokens_per_min"]),
                "max_cpu_percent": str(config["max_cpu_percent"]),
                "idle_timeout_seconds": str(config["idle_timeout_seconds"]),
            },
        )
    else:
        swarm_config.update(config)


async def _swarm_emit_event(
    event_type: str,
    *,
    payload: Optional[Dict[str, Any]] = None,
    workflow_id: Optional[str] = None,
    task_id: Optional[str] = None,
    agent_type: Optional[str] = None,
    priority: Optional[str] = None,
    runtime: Optional[str] = None,
    trace_id: Optional[str] = None,
    source: str = "system",
) -> Dict[str, Any]:
    import uuid

    event = {
        "event_id": str(uuid.uuid4()),
        "event_type": event_type,
        "event_version": "v1",
        "type": event_type,
        "timestamp": datetime.utcnow().isoformat(),
        "source": source,
        "workflow_id": workflow_id,
        "task_id": task_id,
        "agent_type": agent_type,
        "priority": priority,
        "runtime": runtime,
        "payload": payload or {},
        "trace_id": trace_id or str(uuid.uuid4()),
    }

    if _redis:
        await _redis.rpush(_SWARM_EVENTS_KEY, json.dumps(event))
        await _redis.ltrim(_SWARM_EVENTS_KEY, -_MEMORY_FALLBACK_MAX_SWARM_EVENTS, -1)
        if _USE_REDIS_STREAMS:
            try:
                await _redis.xadd(
                    _SWARM_EVENTS_STREAM_KEY,
                    _stream_pack(event),
                    maxlen=_SWARM_STREAM_MAX_LEN,
                    approximate=True,
                )
            except Exception:
                pass  # stream write is best-effort; list write above is source-of-truth
    else:
        swarm_events.append(event)
        _prune_memory_fallback_state()
    return event


async def _swarm_recent_events(limit: int = 50) -> List[Dict[str, Any]]:
    if _redis:
        items = await _redis.lrange(_SWARM_EVENTS_KEY, -limit, -1)
        return [json.loads(i) for i in items]
    return swarm_events[-limit:]


async def _swarm_queue_depth() -> Dict[str, int]:
    if _redis:
        high = await _redis.llen(_swarm_queue_key("high"))
        normal = await _redis.llen(_swarm_queue_key("normal"))
        low = await _redis.llen(_swarm_queue_key("low"))
        return {"high": int(high), "normal": int(normal), "low": int(low)}
    return {
        "high": len(swarm_state.get("queue_high", [])),
        "normal": len(swarm_state.get("queue_normal", [])),
        "low": len(swarm_state.get("queue_low", [])),
    }


async def _swarm_active_workers_count() -> int:
    if _redis:
        raw = await _redis.hgetall(_SWARM_WORKERS_ACTIVE_KEY)
        workers = [json.loads(v) for v in raw.values()]
        return sum(1 for worker in workers if worker.get("status") == "running")
    workers = swarm_state.get("active_workers", {})
    return sum(1 for worker in workers.values() if worker.get("status") == "running")


async def _swarm_worker_register(worker: Dict[str, Any]) -> None:
    if _redis:
        await _redis.hset(
            _SWARM_WORKERS_ACTIVE_KEY, worker["worker_id"], json.dumps(worker)
        )
    else:
        swarm_state.setdefault("active_workers", {})[worker["worker_id"]] = worker


async def _swarm_worker_get(worker_id: str) -> Optional[Dict[str, Any]]:
    if _redis:
        raw = await _redis.hget(_SWARM_WORKERS_ACTIVE_KEY, worker_id)
        return json.loads(raw) if raw else None
    return swarm_state.setdefault("active_workers", {}).get(worker_id)


async def _swarm_worker_update(
    worker_id: str, updates: Dict[str, Any]
) -> Optional[Dict[str, Any]]:
    worker = await _swarm_worker_get(worker_id)
    if not worker:
        return None
    worker.update(updates)
    await _swarm_worker_register(worker)
    return worker


async def _swarm_start_worker_runtime(worker: Dict[str, Any]) -> None:
    worker_id = worker["worker_id"]
    lock = worker_runtime_locks.setdefault(worker_id, asyncio.Lock())
    async with lock:
        existing = worker_runtime_tasks.get(worker_id)
        if existing and not existing.done():
            return

        await _swarm_worker_update(
            worker_id,
            {
                "status": "running",
                "lease_only": False,
                "started_at": datetime.utcnow().isoformat(),
            },
        )

        await _swarm_emit_event(
            "swarm.worker.started",
            runtime=worker.get("runtime"),
            source="operator",
            payload={"worker_id": worker_id, "worker_type": worker.get("worker_type")},
        )

        task = asyncio.create_task(_swarm_worker_loop(worker_id))

        def _cleanup_worker_task(done_task: asyncio.Task) -> None:
            if worker_runtime_tasks.get(worker_id) is done_task:
                worker_runtime_tasks.pop(worker_id, None)

        task.add_done_callback(_cleanup_worker_task)
        worker_runtime_tasks[worker_id] = task


async def _swarm_worker_retire(worker_id: str) -> Optional[Dict[str, Any]]:
    worker_runtime_locks.pop(worker_id, None)
    if _redis:
        raw = await _redis.hget(_SWARM_WORKERS_ACTIVE_KEY, worker_id)
        if not raw:
            return None
        await _redis.hdel(_SWARM_WORKERS_ACTIVE_KEY, worker_id)
        return json.loads(raw)
    workers = swarm_state.setdefault("active_workers", {})
    return workers.pop(worker_id, None)


async def _swarm_workers_list() -> List[Dict[str, Any]]:
    if _redis:
        raw = await _redis.hgetall(_SWARM_WORKERS_ACTIVE_KEY)
        return [json.loads(v) for v in raw.values()]
    return list(swarm_state.setdefault("active_workers", {}).values())


async def _swarm_claim_next_task() -> Optional[Dict[str, Any]]:
    priorities = ["high", "normal", "low"]
    if _redis:
        for priority in priorities:
            item = await _redis.lpop(_swarm_queue_key(priority))
            if item:
                return json.loads(item)
        return None

    for priority in priorities:
        key = f"queue_{priority}"
        queue = swarm_state.get(key, [])
        if queue:
            return queue.pop(0)
    return None


async def _swarm_enqueue_task(task_entry: Dict[str, Any], priority: str) -> None:
    if _redis:
        await _redis.rpush(_swarm_queue_key(priority), json.dumps(task_entry))
    else:
        key = f"queue_{priority}"
        if key not in swarm_state:
            swarm_state[key] = []
        swarm_state[key].append(task_entry)


async def _swarm_store_result(result: Dict[str, Any]) -> None:
    if _redis:
        await _redis.rpush(_SWARM_RESULTS_KEY, json.dumps(result))
        await _redis.ltrim(_SWARM_RESULTS_KEY, -_SWARM_RESULT_MAX_ITEMS, -1)
        if _USE_REDIS_STREAMS:
            try:
                await _redis.xadd(
                    _SWARM_RESULTS_STREAM_KEY,
                    _stream_pack(result),
                    maxlen=_SWARM_STREAM_MAX_LEN,
                    approximate=True,
                )
            except Exception:
                pass
    else:
        swarm_task_results.append(result)
        if len(swarm_task_results) > _SWARM_RESULT_MAX_ITEMS:
            del swarm_task_results[: len(swarm_task_results) - _SWARM_RESULT_MAX_ITEMS]


async def _swarm_recent_results(limit: int = 50) -> List[Dict[str, Any]]:
    if _redis:
        items = await _redis.lrange(_SWARM_RESULTS_KEY, -limit, -1)
        return [json.loads(i) for i in items]
    return swarm_task_results[-limit:]


async def _swarm_checkpoint_write(
    task_id: str,
    worker_id: str,
    progress: int,
    total: int,
    state: Optional[Dict[str, Any]] = None,
) -> None:
    key = f"{_SWARM_CHECKPOINTS_KEY_PREFIX}:{task_id}"
    payload = {
        "task_id": task_id,
        "worker_id": worker_id,
        "progress": progress,
        "total": total,
        "state": json.dumps(state or {}),
        "updated_at": datetime.utcnow().isoformat(),
    }
    if _redis:
        await _redis.hset(key, mapping={k: str(v) for k, v in payload.items()})
        await _redis.expire(key, 86400 * 3)  # 3-day TTL
    else:
        swarm_intelligence_stats.setdefault("checkpoints", {})[task_id] = payload


async def _swarm_checkpoint_read(task_id: str) -> Optional[Dict[str, Any]]:
    key = f"{_SWARM_CHECKPOINTS_KEY_PREFIX}:{task_id}"
    if _redis:
        raw = await _redis.hgetall(key)
        if not raw:
            return None
        state_raw = raw.get("state", "{}")
        try:
            state = json.loads(state_raw)
        except json.JSONDecodeError:
            state = {}
        return {
            "task_id": raw.get("task_id", task_id),
            "worker_id": raw.get("worker_id", ""),
            "progress": int(raw.get("progress", 0)),
            "total": int(raw.get("total", 1)),
            "state": state,
            "updated_at": raw.get("updated_at", ""),
        }
    checkpoints = swarm_intelligence_stats.get("checkpoints", {})
    return checkpoints.get(task_id)


async def _swarm_recover_pending_checkpoints() -> None:
    """Re-enqueue any tasks with incomplete checkpoints not yet completed."""
    if not _redis:
        return
    try:
        keys = await _redis.keys(f"{_SWARM_CHECKPOINTS_KEY_PREFIX}:*")
        for key in keys:
            raw = await _redis.hgetall(key)
            if not raw:
                continue
            progress = int(raw.get("progress", 0))
            total = int(raw.get("total", 1))
            if progress >= total:
                continue  # already complete
            task_id = raw.get("task_id")
            worker_id = raw.get("worker_id", "")
            if not task_id:
                continue
            state_raw = raw.get("state", "{}")
            try:
                state = json.loads(state_raw)
            except json.JSONDecodeError:
                state = {}
            recovery_entry = {
                "task_id": task_id,
                "task": state.get("task", f"recovered:{task_id}"),
                "agent_type": state.get("agent_type", "research_worker"),
                "priority": "high",
                "workflow_id": state.get("workflow_id", ""),
                "trace_id": state.get("trace_id"),
                "complexity": state.get("complexity", "medium"),
                "routing": state.get("routing", "auto"),
                "runtime": state.get("runtime", "shared"),
                "recovered": True,
                "recovered_from_worker": worker_id,
                "recovered_progress": progress,
                "recovered_total": total,
            }
            await _swarm_enqueue_task(recovery_entry, "high")
            print(
                f"Crash recovery: re-enqueued task {task_id} from checkpoint ({progress}/{total})"
            )
    except Exception as e:
        print(f"Crash recovery scan failed: {_redact_secrets(str(e))}")


async def _swarm_intelligence_record(result: Dict[str, Any]) -> None:
    """Update rolling intelligence stats from a completed or failed task result."""
    worker_id = str(result.get("worker_id") or "")
    worker_type = str(result.get("worker_type") or "worker")
    runtime = str(result.get("runtime") or "shared")
    status = str(result.get("status") or "success")
    duration_ms = int(result.get("duration_ms") or 0)
    task_preview = str(result.get("task_preview") or "")[:120]

    entry = swarm_intelligence_stats.setdefault(
        worker_id,
        {
            "worker_id": worker_id,
            "worker_type": worker_type,
            "runtime": runtime,
            "total": 0,
            "succeeded": 0,
            "failed": 0,
            "total_duration_ms": 0,
            "max_duration_ms": 0,
            "slowest_task": "",
        },
    )
    entry["total"] += 1
    entry["total_duration_ms"] += duration_ms
    if status == "success":
        entry["succeeded"] += 1
    else:
        entry["failed"] += 1
    if duration_ms > entry["max_duration_ms"]:
        entry["max_duration_ms"] = duration_ms
        entry["slowest_task"] = task_preview

    if _redis:
        try:
            await _redis.hset(_SWARM_INTELLIGENCE_KEY, worker_id, json.dumps(entry))
        except Exception:
            pass


async def _swarm_execute_worker_task(
    worker: Dict[str, Any], task_entry: Dict[str, Any]
) -> Dict[str, Any]:
    started = time.time()
    complexity = str(task_entry.get("complexity") or "medium").lower()
    delay = {"low": 0.1, "medium": 0.25, "high": 0.4}.get(complexity, 0.2)
    await asyncio.sleep(delay)

    task_preview = str(task_entry.get("task") or "")[:120]
    worker_type = worker.get("worker_type", "worker")
    result_preview = f"[{worker_type}] processed: {task_preview}"
    duration_ms = int((time.time() - started) * 1000)

    return {
        "worker_id": worker["worker_id"],
        "worker_type": worker_type,
        "runtime": worker.get("runtime", "shared"),
        "task_id": str(task_entry.get("task_id") or ""),
        "workflow_id": str(task_entry.get("workflow_id") or ""),
        "priority": str(task_entry.get("priority") or "normal"),
        "status": "success",
        "task_preview": task_preview,
        "result_preview": result_preview,
        "duration_ms": duration_ms,
        "completed_at": datetime.utcnow().isoformat(),
    }


async def _swarm_worker_loop(worker_id: str) -> None:
    while True:
        worker = await _swarm_worker_get(worker_id)
        if not worker:
            return

        task_entry = await _swarm_claim_next_task()
        if not task_entry:
            await asyncio.sleep(_SWARM_WORKER_IDLE_SLEEP_SECONDS)
            continue

        task_id = str(task_entry.get("task_id") or "")
        workflow_id = str(task_entry.get("workflow_id") or "")
        trace_id = str(task_entry.get("trace_id") or "") or None
        await _swarm_emit_event(
            "swarm.task.started",
            workflow_id=workflow_id,
            task_id=task_id,
            agent_type=worker.get("worker_type"),
            priority=task_entry.get("priority"),
            runtime=worker.get("runtime"),
            trace_id=trace_id,
            source=worker.get("worker_type", "worker"),
            payload={"worker_id": worker_id},
        )

        try:
            result = await _swarm_execute_worker_task(worker, task_entry)
            await _swarm_store_result(result)
            await _swarm_intelligence_record(result)
            await _swarm_emit_event(
                "swarm.task.completed",
                workflow_id=workflow_id,
                task_id=task_id,
                agent_type=worker.get("worker_type"),
                priority=task_entry.get("priority"),
                runtime=worker.get("runtime"),
                trace_id=trace_id,
                source=worker.get("worker_type", "worker"),
                payload={
                    "worker_id": worker_id,
                    "status": result["status"],
                    "duration_ms": result["duration_ms"],
                },
            )
        except Exception as ex:
            _fail_result = {
                "worker_id": worker_id,
                "worker_type": worker.get("worker_type", "worker"),
                "runtime": worker.get("runtime", "shared"),
                "task_id": task_id,
                "workflow_id": workflow_id,
                "priority": str(task_entry.get("priority") or "normal"),
                "status": "failed",
                "task_preview": str(task_entry.get("task") or "")[:120],
                "result_preview": f"error: {_redact_secrets(str(ex))[:200]}",
                "duration_ms": 0,
                "completed_at": datetime.utcnow().isoformat(),
            }
            await _swarm_intelligence_record(_fail_result)
            await _swarm_emit_event(
                "swarm.task.failed",
                workflow_id=workflow_id,
                task_id=task_id,
                agent_type=worker.get("worker_type"),
                priority=task_entry.get("priority"),
                runtime=worker.get("runtime"),
                trace_id=trace_id,
                source=worker.get("worker_type", "worker"),
                payload={"worker_id": worker_id, "error": _redact_secrets(str(ex))},
            )


async def _swarm_calculate_desired_workers() -> Dict[str, Any]:
    config = await _swarm_get_config()
    queue_depth = await _swarm_queue_depth()
    queue_depth_total = queue_depth["high"] + queue_depth["normal"] + queue_depth["low"]
    active_workers = await _swarm_active_workers_count()

    desired = int(math.ceil(queue_depth_total / 2.0))
    desired = max(config["min_workers"], min(config["max_workers"], desired))

    frozen = False
    reason = None
    cpu_percent = _swarm_cpu_percent_estimate()
    tokens_per_min = await _swarm_tokens_last_minute()

    if cpu_percent > config["max_cpu_percent"]:
        frozen = True
        reason = "cpu_limit"
    elif tokens_per_min > config["max_tokens_per_min"]:
        frozen = True
        reason = "token_limit"

    if frozen and desired > active_workers:
        desired = active_workers

    return {
        "queue_depth": queue_depth,
        "queue_depth_total": queue_depth_total,
        "active_workers": active_workers,
        "desired_workers": desired,
        "frozen_scale_up": frozen,
        "reason": reason,
        "guardrails": {
            "cpu_percent": cpu_percent,
            "tokens_per_min": tokens_per_min,
            "frozen_scale_up": frozen,
            "reason": reason,
        },
        "config": config,
    }


async def _embed(text: str) -> List[float]:
    """Generate text embedding via OpenAI. Caller must ensure _openai_client is not None."""
    response = await _openai_client.embeddings.create(
        model=OPENAI_EMBEDDING_MODEL,
        input=text,
    )
    return response.data[0].embedding


# ============== AGENT RUN ENDPOINT ==============


@app.post("/agent/run", response_model=AgentRunResponse)
async def run_agent(request: AgentRunRequest):
    """
    Run agent task with memory and RAG.

    Supports compound tasks like:
    - "QUERY: What is the capital of Japan? Then CALC: 25 * 4"
    - "QUERY: What is 2+2? Then CALC: result * 3"
    """
    import uuid

    session_id = request.session_id or str(uuid.uuid4())

    if not await _session_exists(session_id):
        await _session_set(session_id, {"history": [], "context": {}})

    session = await _session_get(session_id)
    steps = []

    task_parts = _parse_task(request.task)

    await _timeline_append(
        {
            "type": "agent_start",
            "session_id": session_id,
            "task": request.task,
            "timestamp": datetime.utcnow().isoformat(),
        }
    )

    for i, part in enumerate(task_parts):
        step_result = await _execute_step(part, session, session_id, step_num=i)
        steps.append(step_result)

        session["context"]["last_result"] = step_result["result"]
        session["history"].append(
            {
                "step": part["type"],
                "input": part["query"],
                "result": step_result["result"],
            }
        )
        await _session_set(session_id, session)

        await _timeline_append(
            {
                "type": "agent_step",
                "session_id": session_id,
                "step": part["type"],
                "result": step_result["result"],
                "timestamp": datetime.utcnow().isoformat(),
            }
        )

    tokens_used = sum(s.get("tokens", 0) for s in steps)
    cost = tokens_used * _OPENAI_COST_PER_TOKEN
    await _swarm_record_token_usage(tokens_used)
    await _token_incr(session_id, cost)

    await _timeline_append(
        {
            "type": "agent_complete",
            "session_id": session_id,
            "result": steps[-1]["result"] if steps else "",
            "tokens": tokens_used,
            "cost": cost,
            "timestamp": datetime.utcnow().isoformat(),
        }
    )

    return AgentRunResponse(
        session_id=session_id,
        result=steps[-1]["result"] if steps else "",
        steps=steps,
        tokens_used=tokens_used,
        cost=cost,
    )


# ============== FREE CODING AGENT ENDPOINT ==============


@app.post("/free-coding-agent/run", response_model=FreeCodingAgentResponse)
async def run_free_coding_agent(request: FreeCodingAgentRequest):
    """
    Run the Free Coding Agent with Cline's MCP tools.

    This agent has access to:
    - Basic tools: file operations, commands, code search, git
    - MCP tools: GitHub, filesystem, brave-search, playwright, postgres, context7
    """
    import uuid
    import subprocess
    import json

    session_id = str(uuid.uuid4())

    try:
        working_dir = request.working_dir or os.getcwd()

        # Build the command to run the free coding agent
        agent_dir = os.path.join(os.path.dirname(__file__), "free-coding-agent")
        cli_path = os.path.join(agent_dir, "bin", "cli.js")

        if not os.path.exists(cli_path):
            return FreeCodingAgentResponse(
                success=False,
                error="Free coding agent CLI not found",
                session_id=session_id,
            )

        # Prepare the task as JSON
        task_data = json.dumps(
            {
                "task": request.task,
                "provider": request.provider,
                "model": request.model,
                "working_dir": working_dir,
                "no_approval": request.no_approval,
            }
        )

        # Run the agent
        process = await asyncio.create_subprocess_exec(
            "node",
            cli_path,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=agent_dir,
        )

        stdout, stderr = await process.communicate(input=task_data.encode())

        if process.returncode != 0:
            return FreeCodingAgentResponse(
                success=False,
                error=f"Agent execution failed: {stderr.decode()}",
                session_id=session_id,
            )

        try:
            result = json.loads(stdout.decode())
            return FreeCodingAgentResponse(
                success=True,
                result=result.get("result", ""),
                tool_calls=result.get("tool_calls", []),
                session_id=session_id,
            )
        except json.JSONDecodeError:
            return FreeCodingAgentResponse(
                success=True, result=stdout.decode(), session_id=session_id
            )

    except Exception as e:
        return FreeCodingAgentResponse(
            success=False,
            error=f"Error running free coding agent: {str(e)}",
            session_id=session_id,
        )


@app.get("/free-coding-agent/tools", response_model=FreeCodingAgentToolsResponse)
async def list_free_coding_agent_tools():
    """
    List all available tools for the Free Coding Agent.
    """
    basic_tools = [
        "read_file",
        "write_to_file",
        "replace_in_file",
        "append_to_file",
        "delete_file",
        "list_files",
        "search_files",
        "file_exists",
        "get_file_info",
        "execute_command",
        "search_code",
        "grep_files",
        "git_status",
        "git_diff",
        "git_log",
        "git_commit",
        "github_create_issue",
        "github_search_repos",
        "brave_search",
        "brave_webpage",
        "playwright_navigate",
        "playwright_screenshot",
        "playwright_click",
        "playwright_fill",
        "postgres_query",
        "context7_search",
        "context7_store",
        "ask_followup_question",
    ]

    # MCP tools are loaded dynamically
    mcp_tools = [
        # GitHub MCP tools
        "github:create_issue",
        "github:search_repositories",
        "github:get_file",
        "github:create_pr",
        # Filesystem MCP tools
        "filesystem:read_file",
        "filesystem:write_file",
        "filesystem:list_directory",
        "filesystem:get_file_info",
        # Brave Search MCP tools
        "brave-search:search",
        "brave-search:fetch",
        # Playwright MCP tools
        "playwright:navigate",
        "playwright:click",
        "playwright:fill",
        "playwright:screenshot",
        "playwright:select",
        "playwright:press",
        "playwright:evaluate",
        # PostgreSQL MCP tools
        "postgres:query",
        "postgres:execute",
        # Context7 MCP tools
        "context7:search",
        "context7:store",
        "context7:delete",
    ]

    return FreeCodingAgentToolsResponse(
        basic_tools=basic_tools,
        mcp_tools=mcp_tools,
        total=len(basic_tools) + len(mcp_tools),
    )


def _parse_task(task: str) -> List[Dict[str, str]]:
    """Parse compound task into steps."""
    parts = task.split(" Then ")
    steps = []

    for part in parts:
        part = part.strip()
        if part.startswith("QUERY:"):
            steps.append({"type": "query", "query": part[6:].strip()})
        elif part.startswith("CALC:"):
            steps.append({"type": "calc", "query": part[5:].strip()})
        else:
            # Default to query
            steps.append({"type": "query", "query": part})

    return steps


async def _execute_step(
    step: Dict[str, str], session: Dict[str, Any], session_id: str, step_num: int
) -> Dict[str, Any]:
    """Execute a single agent step."""

    tokens = 0
    if step["type"] == "query":
        result, tokens = await _execute_query(step["query"], session)
    elif step["type"] == "calc":
        result = await _execute_calc(step["query"], session)
    else:
        result = f"Unknown step type: {step['type']}"

    return {
        "step": step_num + 1,
        "type": step["type"],
        "input": step["query"],
        "result": result,
        "tokens": tokens,
    }


async def _execute_query(query: str, session: Dict[str, Any]) -> tuple[str, int]:
    """Execute a natural language query using OpenAI. Returns (response_text, total_tokens)."""

    if _openai_client is None:
        return (f"[MOCK] Query: {query} - Set OPENAI_API_KEY to enable real queries", 0)

    messages: list[dict] = []

    # Inject relevant document context from Qdrant when available
    if _qdrant:
        try:
            query_vec = await _embed(query)
            hits = await _qdrant.search(
                collection_name=QDRANT_COLLECTION,
                query_vector=query_vec,
                limit=3,
            )
            rag_chunks = [h.payload.get("text", "") for h in hits if h.payload]
            if rag_chunks:
                messages.append(
                    {
                        "role": "system",
                        "content": "Relevant documents:\n" + "\n---\n".join(rag_chunks),
                    }
                )
        except Exception as e:
            print(f"Qdrant search error: {_redact_secrets(str(e))}")

    # Inject recent session history
    if session.get("history"):
        context_lines = "\n".join(
            f"- {h['step']}: {h['result']}" for h in session["history"][-3:]
        )
        messages.append(
            {"role": "system", "content": f"Previous results:\n{context_lines}"}
        )
    messages.append({"role": "user", "content": query})

    try:
        response = await _openai_client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=messages,
        )
        text = response.choices[0].message.content or ""
        tokens = response.usage.total_tokens if response.usage else 0
        return (text, tokens)
    except Exception as e:
        error_msg = str(e)
        # Return the actual error message instead of hiding it behind generic text
        # This helps users understand why their query failed
        print(f"OpenAI query error: {_redact_secrets(error_msg)}")
        return (f"Error: {error_msg}", 0)


async def _execute_calc(calc: str, session: Dict[str, Any]) -> str:
    """Execute a calculation."""

    # Handle "result" references
    calc_expr = calc
    if "result" in calc:
        last_result = session.get("context", {}).get("last_result", "")
        # Try to extract numeric value
        nums = re.findall(r"-?\d+\.?\d*", str(last_result))
        if nums:
            calc_expr = calc.replace("result", nums[-1])

    try:
        # Parse as AST and evaluate only numeric arithmetic nodes.
        expr = ast.parse(calc_expr, mode="eval")
        result = _safe_eval_ast(expr)
        return str(result)
    except Exception as e:
        return f"Error: {str(e)}"


def _safe_eval_ast(node: ast.AST) -> float:
    if isinstance(node, ast.Expression):
        return _safe_eval_ast(node.body)
    if isinstance(node, ast.Num):
        return float(node.n)
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return float(node.value)
    if isinstance(node, ast.BinOp):
        left = _safe_eval_ast(node.left)
        right = _safe_eval_ast(node.right)
        if isinstance(node.op, ast.Add):
            return left + right
        if isinstance(node.op, ast.Sub):
            return left - right
        if isinstance(node.op, ast.Mult):
            return left * right
        if isinstance(node.op, ast.Div):
            return left / right
        if isinstance(node.op, ast.Mod):
            return left % right
        raise ValueError("Unsupported operator")
    if isinstance(node, ast.UnaryOp):
        value = _safe_eval_ast(node.operand)
        if isinstance(node.op, ast.UAdd):
            return +value
        if isinstance(node.op, ast.USub):
            return -value
        raise ValueError("Unsupported unary operator")
    raise ValueError("Only basic arithmetic expressions are allowed")


# ============== MEMORY TIMELINE ==============


@app.get("/memory/timeline", response_model=TimelineResponse)
async def get_timeline(limit: int = 50):
    """Get memory timeline events."""
    return TimelineResponse(events=await _timeline_get(limit))


@app.get("/memory/timeline/{session_id}")
async def get_session_timeline(session_id: str):
    """Get timeline for specific session."""
    events = await _timeline_get_session(session_id)
    return {"session_id": session_id, "events": events}


# ============== PERSISTENCE AND RETENTION POLICY ==============


@app.get("/memory/retention/policy")
async def get_retention_policy():
    """Get current retention policy settings."""
    return {
        "session_ttl_seconds": _MEMORY_FALLBACK_SESSION_TTL,
        "max_sessions": _MEMORY_FALLBACK_MAX_SESSIONS,
        "max_timeline_events": _MEMORY_FALLBACK_MAX_TIMELINE,
        "max_thoughts": _MEMORY_FALLBACK_MAX_THOUGHTS,
        "max_shared_knowledge": _MEMORY_FALLBACK_MAX_SHARED_KNOWLEDGE,
        "max_swarm_events": _MEMORY_FALLBACK_MAX_SWARM_EVENTS,
        "execution_cleanup_seconds": _EXECUTION_CLEANUP_AFTER_SECONDS,
        "max_completed_executions": _MAX_COMPLETED_EXECUTIONS,
    }


@app.get("/memory/retention/stats")
async def get_retention_stats():
    """Get current storage statistics."""
    return {
        "sessions": len(agent_sessions),
        "timeline_events": len(memory_timeline),
        "thoughts": len(thought_memory),
        "shared_knowledge": len(shared_knowledge_memory),
        "swarm_events": len(swarm_events),
        "executions": len(executions),
    }


# ============== TOKEN USAGE ==============


@app.get("/tokens/usage", response_model=TokenUsageResponse)
async def get_token_usage():
    """Get token usage statistics."""
    data = await _token_get()
    return TokenUsageResponse(total=data["total"], by_session=data["by_session"])


# ============== SESSION MANAGEMENT ==============


@app.get("/session/{session_id}")
async def get_session(session_id: str):
    """Get session state."""
    session = await _session_get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@app.delete("/session/{session_id}")
async def delete_session(session_id: str):
    """Delete session and free resources."""
    await _session_delete(session_id)
    return {"success": True}


# ============== TERMINAL SESSION MANAGEMENT ==============


async def _terminal_session_kill(session_id: str) -> None:
    """Kill a terminal session process."""
    session = terminal_sessions.get(session_id)
    if not session:
        return

    proc = session.get("process")
    if proc and proc.poll() is None:
        try:
            proc.terminate()
            await asyncio.wait_for(proc.wait(), timeout=5.0)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()

    session["status"] = "killed"
    session["ended_at"] = datetime.utcnow().isoformat()


@app.post("/terminal/sessions", response_model=TerminalSessionResponse)
async def create_terminal_session(request: TerminalSessionCreateRequest):
    """Create a new terminal session with a shell process."""
    import uuid

    session_id = str(uuid.uuid4())
    shell = _validate_shell(request.shell)

    env = os.environ.copy()
    if request.env:
        env.update(request.env)

    cwd = request.cwd or os.getcwd()

    try:
        proc = await asyncio.create_subprocess_shell(
            shell,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=cwd,
            env=env,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to create shell: {str(e)}")

    session = {
        "session_id": session_id,
        "status": "active",
        "created_at": datetime.utcnow().isoformat(),
        "shell": shell,
        "cwd": cwd,
        "pid": proc.pid,
        "process": proc,
        "output_buffer": [],
    }
    terminal_sessions[session_id] = session

    await _timeline_append(
        {
            "type": "terminal_session_created",
            "session_id": session_id,
            "shell": shell,
            "pid": proc.pid,
            "timestamp": datetime.utcnow().isoformat(),
        }
    )

    return TerminalSessionResponse(
        session_id=session_id,
        status="active",
        created_at=session["created_at"],
        shell=shell,
        cwd=cwd,
        pid=proc.pid,
    )


@app.get("/terminal/sessions/{session_id}", response_model=TerminalSessionResponse)
async def get_terminal_session(session_id: str):
    """Get terminal session info."""
    session = terminal_sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Terminal session not found")

    proc = session.get("process")
    if proc and proc.poll() is not None:
        session["status"] = "ended"
        session["ended_at"] = datetime.utcnow().isoformat()

    return TerminalSessionResponse(
        session_id=session_id,
        status=session.get("status", "unknown"),
        created_at=session["created_at"],
        shell=session["shell"],
        cwd=session.get("cwd"),
        pid=session.get("pid"),
    )


@app.delete("/terminal/sessions/{session_id}")
async def delete_terminal_session(session_id: str):
    """Kill and delete a terminal session."""
    session = terminal_sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Terminal session not found")

    await _terminal_session_kill(session_id)
    terminal_sessions.pop(session_id, None)

    await _timeline_append(
        {
            "type": "terminal_session_deleted",
            "session_id": session_id,
            "timestamp": datetime.utcnow().isoformat(),
        }
    )

    return {"success": True, "session_id": session_id}


@app.post("/terminal/sessions/{session_id}/input")
async def send_terminal_input(session_id: str, request: TerminalInputRequest):
    """Send input to a terminal session."""
    session = terminal_sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Terminal session not found")

    proc = session.get("process")
    if not proc or proc.poll() is not None:
        raise HTTPException(status_code=400, detail="Terminal process not running")

    try:
        await proc.stdin.write(
            request.input.encode() if isinstance(request.input, str) else request.input
        )
        await proc.stdin.drain()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to send input: {str(e)}")

    return {"success": True, "session_id": session_id}


@app.get("/terminal/sessions/{session_id}/output")
async def stream_terminal_output(session_id: str):
    """Stream terminal output via SSE."""
    session = terminal_sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Terminal session not found")

    proc = session.get("process")
    if not proc:
        raise HTTPException(status_code=400, detail="No process attached")

    async def event_generator():
        output_buffer = session.get("output_buffer", [])

        while True:
            if proc.poll() is not None:
                remaining = await proc.stdout.read()
                if remaining:
                    output_buffer.append(remaining.decode("utf-8", errors="replace"))
                break

            try:
                line = await asyncio.wait_for(proc.stdout.readline(), timeout=1.0)
                if line:
                    decoded = line.decode('utf-8', errors='replace')
                    output_buffer.append(decoded)
                    # Announce terminal output for accessibility
                    accessibility.speak(decoded.strip(), 'normal')
                    yield f"data: {json.dumps({'session_id': session_id, 'type': 'stdout', 'data': decoded})}\n\n"
            except asyncio.TimeoutError:
                pass

            stderr = await proc.stderr.read(1024)
            if stderr:
                decoded = stderr.decode('utf-8', errors='replace')
                output_buffer.append(f"[stderr] {decoded}")
                # Announce stderr for accessibility with high priority
                accessibility.speak(f"Error: {decoded.strip()}", 'high')
                yield f"data: {json.dumps({'session_id': session_id, 'type': 'stderr', 'data': decoded})}\n\n"

            if len(output_buffer) > 1000:
                output_buffer[:] = output_buffer[-500:]

            await asyncio.sleep(0.1)

        session["status"] = "ended"
        session["ended_at"] = datetime.utcnow().isoformat()
        yield f"data: {json.dumps({'session_id': session_id, 'type': 'exit', 'data': str(proc.returncode)})}\n\n"

    from fastapi.responses import StreamingResponse

    return StreamingResponse(event_generator(), media_type="text/event-stream")


# ============== ACCESSIBILITY ENDPOINTS ==============


@app.get("/terminal/sessions/{session_id}/text")
async def get_terminal_text(session_id: str, lines: int = 50):
    """Get terminal output as plain text (for accessibility/screen readers)."""
    session = terminal_sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Terminal session not found")
    
    output_buffer = session.get("output_buffer", [])
    last_lines = output_buffer[-lines:] if output_buffer else []
    text = "".join(last_lines)
    
    return {
        "session_id": session_id,
        "text": text,
        "line_count": len(last_lines),
        "total_lines": len(output_buffer)
    }


@app.post("/accessibility/announce")
async def announce_text(text: str, priority: str = "normal"):
    """Manually trigger a text-to-speech announcement."""
    accessibility.speak(text, priority)
    return {"success": True, "announced": text, "priority": priority}


@app.post("/accessibility/toggle")
async def toggle_accessibility(enabled: bool):
    """Enable or disable accessibility announcements."""
    accessibility.enabled = enabled
    return {"success": True, "accessibility_enabled": enabled}


@app.get("/accessibility/status")
async def get_accessibility_status():
    """Get current accessibility status."""
    return {
        "enabled": accessibility.enabled,
        "is_speaking": accessibility.is_speaking,
        "queue_length": len(accessibility.speech_queue)
    }


@app.post("/accessibility/stop")
async def stop_speaking():
    """Stop all current speech."""
    accessibility.stop()
    return {"success": True, "message": "Speech stopped"}


# ============== EXECUTION CONTROLLER ==============


async def _execute_runtime_switch(
    runtime: str,
    task: str,
    worker_type: Optional[str],
    payload: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """Switch execution based on runtime profile."""
    if runtime == "shared":
        return await _execute_shared_runtime(task, worker_type, payload)
    elif runtime == "sandbox":
        return await _execute_sandbox_runtime(task, worker_type, payload)
    elif runtime == "parallel_test":
        return await _execute_parallel_test_runtime(task, worker_type, payload)
    else:
        raise ValueError(f"Unknown runtime: {runtime}")


async def _execute_shared_runtime(
    task: str, worker_type: Optional[str], payload: Optional[Dict[str, Any]]
) -> Dict[str, Any]:
    """Execute in shared runtime - standard execution."""
    result = {
        "status": "completed",
        "output": f"[shared] Executed: {task[:100]}",
        "worker_type": worker_type or "shared_worker",
    }
    await asyncio.sleep(0.1)
    return result


async def _execute_sandbox_runtime(
    task: str, worker_type: Optional[str], payload: Optional[Dict[str, Any]]
) -> Dict[str, Any]:
    """Execute in sandbox runtime - isolated container."""
    result = {
        "status": "completed",
        "output": f"[sandbox] Isolated execution: {task[:100]}",
        "worker_type": worker_type or "sandbox_worker",
    }
    await asyncio.sleep(0.2)
    return result


async def _execute_parallel_test_runtime(
    task: str, worker_type: Optional[str], payload: Optional[Dict[str, Any]]
) -> Dict[str, Any]:
    """Execute in parallel test runtime - multiple replicas with output comparison."""
    import hashlib
    import json

    replicas = min(
        (payload or {}).get("replicas", 3), _RUNTIME_POLICY_PARALLEL_TEST_MAX_REPLICAS
    )
    results = []

    async def run_replica(replica_id: int):
        """Simulate replica execution with slight variations."""
        await asyncio.sleep(0.1 + (replica_id * 0.05))

        output = f"[replica-{replica_id}] Executed: {task[:50]}..."

        # Simulate output (in real implementation, this would be actual execution)
        return {
            "replica_id": replica_id,
            "status": "completed",
            "output": output,
            "output_hash": hashlib.md5(output.encode()).hexdigest(),
        }

    # Run all replicas in parallel
    replica_tasks = [run_replica(i) for i in range(replicas)]
    results = await asyncio.gather(*replica_tasks)

    # Compare outputs
    output_hashes = [r["output_hash"] for r in results]
    unique_hashes = set(output_hashes)

    comparison = {
        "total_replicas": len(results),
        "unique_outputs": len(unique_hashes),
        "consistent": len(unique_hashes) == 1,
        "replica_results": results,
    }

    if len(unique_hashes) > 1:
        comparison["inconsistencies"] = [
            f"Replica {r['replica_id']} output differs" for r in results
        ]

    return {
        "status": "completed",
        "output": f"[parallel_test] {len(results)} replicas completed, consistent={len(unique_hashes) == 1}",
        "worker_type": worker_type or "parallel_test_worker",
        "replicas": len(results),
        "comparison": comparison,
    }


@app.post("/execute", response_model=ExecutionResponse)
async def execute_task(request: ExecutionRequest):
    """Submit a task for execution with specified runtime profile."""
    import uuid

    execution_id = str(uuid.uuid4())
    runtime = request.runtime.lower()

    if runtime not in _RUNTIME_MODES:
        raise HTTPException(status_code=400, detail=f"Invalid runtime: {runtime}")

    task_id = str(uuid.uuid4())

    execution = {
        "execution_id": execution_id,
        "status": "queued",
        "created_at": datetime.utcnow().isoformat(),
        "runtime": runtime,
        "worker_type": request.worker_type,
        "task": request.task,
        "task_id": task_id,
        "payload": request.payload,
        "timeout": request.timeout,
        "progress": 0,
        "total": 100,
        "result": None,
        "error": None,
        "started_at": None,
        "completed_at": None,
    }
    executions[execution_id] = execution

    asyncio.create_task(
        _execute_task_async(
            execution_id,
            request.task,
            runtime,
            request.worker_type,
            request.payload,
            request.timeout,
        )
    )

    await _timeline_append(
        {
            "type": "execution_submitted",
            "execution_id": execution_id,
            "runtime": runtime,
            "worker_type": request.worker_type,
            "timestamp": datetime.utcnow().isoformat(),
        }
    )

    return ExecutionResponse(
        execution_id=execution_id,
        status="queued",
        created_at=execution["created_at"],
        runtime=runtime,
        task_id=task_id,
    )


async def _execute_task_async(
    execution_id: str,
    task: str,
    runtime: str,
    worker_type: Optional[str],
    payload: Optional[Dict[str, Any]],
    timeout: int,
) -> None:
    """Background task executor."""
    execution = executions.get(execution_id)
    if not execution:
        return

    execution["status"] = "running"
    execution["started_at"] = datetime.utcnow().isoformat()
    execution["progress"] = 20

    try:
        result = await asyncio.wait_for(
            _execute_runtime_switch(runtime, task, worker_type, payload),
            timeout=timeout,
        )
        execution["status"] = "completed"
        execution["result"] = result.get("output")
        execution["progress"] = 100
    except asyncio.TimeoutError:
        execution["status"] = "timeout"
        execution["error"] = f"Execution exceeded {timeout}s timeout"
    except Exception as e:
        execution["status"] = "failed"
        execution["error"] = str(e)
    finally:
        execution["completed_at"] = datetime.utcnow().isoformat()

        # Cleanup old executions to prevent memory leak
        _cleanup_old_executions()

        await _timeline_append(
            {
                "type": "execution_completed",
                "execution_id": execution_id,
                "status": execution["status"],
                "timestamp": datetime.utcnow().isoformat(),
            }
        )


@app.get("/execute/status/{execution_id}", response_model=ExecutionStatusResponse)
async def get_execution_status(execution_id: str):
    """Get execution status by ID."""
    execution = executions.get(execution_id)
    if not execution:
        raise HTTPException(status_code=404, detail="Execution not found")

    return ExecutionStatusResponse(
        execution_id=execution_id,
        status=execution["status"],
        runtime=execution["runtime"],
        worker_type=execution.get("worker_type"),
        progress=execution.get("progress", 0),
        total=execution.get("total", 100),
        result=execution.get("result"),
        error=execution.get("error"),
        started_at=execution.get("started_at", ""),
        completed_at=execution.get("completed_at"),
    )


@app.get("/execute")
async def list_executions(limit: int = 50):
    """List recent executions."""
    limit = max(1, min(limit, 200))
    items = list(executions.values())[-limit:]
    return {"executions": items, "count": len(items)}


# ============== CORE-5 AGENT ENDPOINTS ==============


@app.post("/agents/planner/plan", response_model=PlannerCreatePlanResponse)
async def planner_create_plan(request: PlannerCreatePlanRequest):
    """Create a project DAG from a goal."""
    if not CORE5_ENABLED:
        raise HTTPException(status_code=503, detail="Core-5 agents are disabled")

    import uuid

    plan_id = str(uuid.uuid4())
    created_at = datetime.utcnow().isoformat()

    # Generate DAG from goal using LLM or simple decomposition
    # For now, create a simple DAG structure
    tasks = []
    goal_lower = request.goal.lower()

    # Auto-decompose based on keywords
    if any(k in goal_lower for k in ["api", "service", "endpoint"]):
        tasks.extend(
            [
                {
                    "id": f"{plan_id}-task-1",
                    "type": "research",
                    "name": "Research API best practices",
                    "depends_on": [],
                },
                {
                    "id": f"{plan_id}-task-2",
                    "type": "build",
                    "name": "Create API endpoints",
                    "depends_on": [f"{plan_id}-task-1"],
                },
                {
                    "id": f"{plan_id}-task-3",
                    "type": "review",
                    "name": "Review API code",
                    "depends_on": [f"{plan_id}-task-2"],
                },
                {
                    "id": f"{plan_id}-task-4",
                    "type": "build",
                    "name": "Add tests",
                    "depends_on": [f"{plan_id}-task-2"],
                },
                {
                    "id": f"{plan_id}-task-5",
                    "type": "review",
                    "name": "Review tests",
                    "depends_on": [f"{plan_id}-task-4"],
                },
            ]
        )
    elif any(k in goal_lower for k in ["ui", "frontend", "web", "page"]):
        tasks.extend(
            [
                {
                    "id": f"{plan_id}-task-1",
                    "type": "research",
                    "name": "Research UI patterns",
                    "depends_on": [],
                },
                {
                    "id": f"{plan_id}-task-2",
                    "type": "build",
                    "name": "Create UI components",
                    "depends_on": [f"{plan_id}-task-1"],
                },
                {
                    "id": f"{plan_id}-task-3",
                    "type": "review",
                    "name": "Review UI code",
                    "depends_on": [f"{plan_id}-task-2"],
                },
            ]
        )
    else:
        tasks.extend(
            [
                {
                    "id": f"{plan_id}-task-1",
                    "type": "research",
                    "name": "Research",
                    "depends_on": [],
                },
                {
                    "id": f"{plan_id}-task-2",
                    "type": "build",
                    "name": "Implement",
                    "depends_on": [f"{plan_id}-task-1"],
                },
                {
                    "id": f"{plan_id}-task-3",
                    "type": "review",
                    "name": "Review",
                    "depends_on": [f"{plan_id}-task-2"],
                },
            ]
        )

    # Limit tasks
    tasks = tasks[:CORE5_MAX_PLAN_TASKS]

    # Build DAG
    dag = {
        "nodes": [{"id": t["id"], "type": t["type"], "name": t["name"]} for t in tasks],
        "edges": [
            {"from": dep, "to": t["id"]}
            for t in tasks
            for dep in t.get("depends_on", [])
        ],
    }

    plan = {
        "plan_id": plan_id,
        "goal": request.goal,
        "context": request.context,
        "constraints": request.constraints,
        "routing": request.routing,
        "status": "planning",
        "created_at": created_at,
        "dag": dag,
        "tasks": tasks,
        "progress": {"total": len(tasks), "completed": 0, "failed": 0, "blocked": 0},
        "current_phase": "planning",
    }
    core5_plans[plan_id] = plan

    # Emit event
    await _swarm_emit_event(
        event_type="agent.plan.created",
        payload={
            "plan_id": plan_id,
            "goal": request.goal,
            "dag": dag,
            "task_count": len(tasks),
            "estimated_duration": len(tasks) * 120,
        },
    )

    return PlannerCreatePlanResponse(
        plan_id=plan_id,
        dag=dag,
        tasks=tasks,
        estimated_duration=len(tasks) * 120,
    )


@app.get("/agents/planner/plan/{plan_id}", response_model=PlannerTaskStatusResponse)
async def planner_get_plan(plan_id: str):
    """Get plan status."""
    plan = core5_plans.get(plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    import time

    created = datetime.fromisoformat(plan["created_at"])
    elapsed = int((datetime.utcnow() - created).total_seconds())

    return PlannerTaskStatusResponse(
        plan_id=plan_id,
        status=plan.get("status", "unknown"),
        progress=plan.get(
            "progress", {"total": 0, "completed": 0, "failed": 0, "blocked": 0}
        ),
        current_phase=plan.get("current_phase", "planning"),
        elapsed_seconds=elapsed,
    )


@app.get("/agents/planner/dag/{plan_id}")
async def planner_get_dag(plan_id: str):
    """Get DAG visualization data."""
    plan = core5_plans.get(plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    return plan.get("dag", {})


@app.post("/agents/researcher/gather", response_model=ResearcherGatherResponse)
async def researcher_gather(request: ResearcherGatherRequest):
    """Gather evidence for a query."""
    if not CORE5_ENABLED:
        raise HTTPException(status_code=503, detail="Core-5 agents are disabled")

    import uuid

    request_id = str(uuid.uuid4())
    evidence = []
    citations = []

    # Gather from web if requested
    if "web" in request.sources:
        # Placeholder - would call websearch tool
        evidence.append(
            {
                "source": "web",
                "query": request.query,
                "findings": ["Web search placeholder - implement with websearch tool"],
                "relevance": 0.8,
            }
        )
        citations.append("web:search")

    # Gather from docs if requested
    if "docs" in request.sources:
        evidence.append(
            {
                "source": "docs",
                "query": request.query,
                "findings": ["Docs search placeholder - implement with RAG"],
                "relevance": 0.7,
            }
        )
        citations.append("docs:rag")

    # Gather from memory if requested
    if "memory" in request.sources:
        # Search memory timeline
        memory_results = [
            e for e in memory_timeline[-50:] if request.query.lower() in str(e).lower()
        ][: request.max_items]
        if memory_results:
            evidence.append(
                {
                    "source": "memory",
                    "query": request.query,
                    "findings": memory_results,
                    "relevance": 0.9,
                }
            )
            citations.append("memory:timeline")

    # Calculate confidence
    confidence = sum(e["relevance"] for e in evidence) / max(len(evidence), 1)

    result = {
        "request_id": request_id,
        "query": request.query,
        "evidence": evidence,
        "confidence": confidence,
        "citations": citations,
    }
    core5_research_results[request_id] = result

    # Emit event
    await _swarm_emit_event(
        event_type="agent.research.complete",
        payload={
            "request_id": request_id,
            "query": request.query,
            "confidence": confidence,
            "evidence_count": len(evidence),
        },
    )

    return ResearcherGatherResponse(
        request_id=request_id,
        evidence=evidence,
        confidence=confidence,
        citations=citations,
    )


@app.get("/agents/researcher/result/{request_id}")
async def researcher_get_result(request_id: str):
    """Get research result."""
    result = core5_research_results.get(request_id)
    if not result:
        raise HTTPException(status_code=404, detail="Research result not found")
    return result


@app.post("/agents/builder/create", response_model=BuilderCreateArtifactResponse)
async def builder_create_artifact(request: BuilderCreateArtifactRequest):
    """Create artifact from spec."""
    if not CORE5_ENABLED:
        raise HTTPException(status_code=503, detail="Core-5 agents are disabled")

    import uuid

    artifact_id = str(uuid.uuid4())

    # Generate artifact based on spec
    spec = request.spec
    artifact_name = spec.get("name", "unnamed")
    artifact_type = spec.get("type", "code")

    files = []
    test_files = []

    if artifact_type == "api" or "endpoint" in str(spec).lower():
        files = [
            {
                "path": f"{artifact_name}.py",
                "content": f'"""Generated API: {artifact_name}"""\n\ndef handler(event, context):\n    return {{"status": "ok", "data": event}}',
                "language": "python",
            },
            {
                "path": f"{artifact_name}_schema.py",
                "content": f'"""Schema for {artifact_name}"""\nfrom pydantic import BaseModel\n',
                "language": "python",
            },
        ]
        test_files = [
            {
                "path": f"test_{artifact_name}.py",
                "content": f'"""Tests for {artifact_name}"""\nimport pytest\n',
                "language": "python",
            },
        ]
    else:
        files = [
            {
                "path": f"{artifact_name}.txt",
                "content": f"Generated artifact: {artifact_name}\nSpec: {spec}",
                "language": "text",
            },
        ]

    artifact = {
        "artifact_id": artifact_id,
        "spec": spec,
        "files": files,
        "test_files": test_files,
        "metadata": {
            "runtime": request.runtime,
            "language": request.language,
            "created_at": datetime.utcnow().isoformat(),
        },
    }
    core5_artifacts[artifact_id] = artifact

    # Emit event
    await _swarm_emit_event(
        event_type="agent.build.complete",
        payload={
            "artifact_id": artifact_id,
            "file_count": len(files),
            "test_count": len(test_files),
        },
    )

    return BuilderCreateArtifactResponse(
        artifact_id=artifact_id,
        files=files,
        test_files=test_files,
        metadata=artifact["metadata"],
    )


@app.get("/agents/builder/artifact/{artifact_id}")
async def builder_get_artifact(artifact_id: str):
    """Get artifact details."""
    artifact = core5_artifacts.get(artifact_id)
    if not artifact:
        raise HTTPException(status_code=404, detail="Artifact not found")
    return artifact


@app.post("/agents/reviewer/validate", response_model=ReviewerValidateResponse)
async def reviewer_validate(request: ReviewerValidateRequest):
    """Run quality/security gates on artifacts."""
    if not CORE5_ENABLED:
        raise HTTPException(status_code=503, detail="Core-5 agents are disabled")

    import uuid

    review_id = str(uuid.uuid4())
    findings = []
    required_fixes = []
    severity_summary = {"critical": 0, "major": 0, "minor": 0, "info": 0}

    # Get artifacts to review
    artifacts_to_review = [
        core5_artifacts.get(aid)
        for aid in request.artifact_ids
        if aid in core5_artifacts
    ]

    # Run review gates based on request.review_focus
    for gate in request.review_focus:
        if gate == "quality":
            # Check for basic code quality
            for artifact in artifacts_to_review:
                for f in artifact.get("files", []):
                    if f.get("language") == "python":
                        if "TODO" in f.get("content", ""):
                            findings.append(
                                {
                                    "severity": "minor",
                                    "gate": "quality",
                                    "message": "TODO comments found in code",
                                    "file": f.get("path"),
                                }
                            )
                            severity_summary["minor"] += 1
        elif gate == "security":
            # Check for secrets
            for artifact in artifacts_to_review:
                for f in artifact.get("files", []):
                    content = f.get("content", "")
                    if any(
                        pat in content
                        for pat in ["password", "api_key", "secret", "token"]
                    ):
                        if "password =" in content or "api_key" in content.lower():
                            findings.append(
                                {
                                    "severity": "critical",
                                    "gate": "security",
                                    "message": "Potential hardcoded secret detected",
                                    "file": f.get("path"),
                                }
                            )
                            severity_summary["critical"] += 1
        elif gate == "cost":
            # Placeholder cost estimation
            findings.append(
                {
                    "severity": "info",
                    "gate": "cost",
                    "message": "Cost estimation not yet implemented",
                    "estimated_cost": 0.0,
                }
            )
            severity_summary["info"] += 1

    # Decision logic
    critical = severity_summary["critical"]
    major = severity_summary["major"]

    if critical > 0:
        decision = "fail"
    elif major > 0:
        decision = "conditional"
        required_fixes = [
            {"finding": f, "action": "Fix before deployment"}
            for f in findings
            if f.get("severity") in ["critical", "major"]
        ]
    else:
        decision = "pass"

    review = {
        "review_id": review_id,
        "artifact_ids": request.artifact_ids,
        "gate_type": request.gate_type,
        "decision": decision,
        "findings": findings,
        "required_fixes": required_fixes,
        "severity_summary": severity_summary,
        "block_promotion": decision == "fail",
    }
    core5_reviews[review_id] = review

    # Emit event
    await _swarm_emit_event(
        event_type="agent.review.gate",
        payload={
            "review_id": review_id,
            "artifact_ids": request.artifact_ids,
            "decision": decision,
            "findings_count": len(findings),
            "block_promotion": decision == "fail",
        },
    )

    return ReviewerValidateResponse(
        review_id=review_id,
        decision=decision,
        findings=findings,
        required_fixes=required_fixes,
        severity_summary=severity_summary,
    )


@app.get("/agents/reviewer/result/{review_id}")
async def reviewer_get_result(review_id: str):
    """Get review result."""
    review = core5_reviews.get(review_id)
    if not review:
        raise HTTPException(status_code=404, detail="Review not found")
    return review


@app.post("/agents/operator/deploy", response_model=OperatorDeployResponse)
async def operator_deploy(request: OperatorDeployRequest):
    """Deploy verified artifacts."""
    if not CORE5_ENABLED:
        raise HTTPException(status_code=503, detail="Core-5 agents are disabled")

    import uuid

    deploy_id = str(uuid.uuid4())

    # Verify artifacts exist
    artifacts = [
        core5_artifacts.get(aid)
        for aid in request.artifact_ids
        if aid in core5_artifacts
    ]
    if not artifacts:
        raise HTTPException(status_code=400, detail="No valid artifacts found")

    # Simulate deployment
    endpoints = [
        f"https://api.example.com/{a.get('metadata', {}).get('language', 'app')}/{aid[:8]}"
        for aid, a in zip(request.artifact_ids, artifacts)
    ]

    verification_results = {}
    if request.verify:
        verification_results = {
            "health_check": "passed",
            "latency_ms": 45,
            "status_code": 200,
        }

    deployment = {
        "deploy_id": deploy_id,
        "artifact_ids": request.artifact_ids,
        "runtime": request.runtime,
        "status": "deployed" if not request.verify else "verified",
        "endpoints": endpoints,
        "verification_results": verification_results,
        "deployed_at": datetime.utcnow().isoformat(),
    }
    core5_deployments[deploy_id] = deployment

    # Emit event
    await _swarm_emit_event(
        event_type="agent.deploy.complete",
        payload={
            "deploy_id": deploy_id,
            "artifact_ids": request.artifact_ids,
            "status": deployment["status"],
            "endpoint_count": len(endpoints),
        },
    )

    return OperatorDeployResponse(
        deploy_id=deploy_id,
        status=deployment["status"],
        endpoints=endpoints,
        verification_results=verification_results,
    )


@app.get("/agents/operator/deploy/{deploy_id}")
async def operator_get_deploy(deploy_id: str):
    """Get deployment status."""
    deployment = core5_deployments.get(deploy_id)
    if not deployment:
        raise HTTPException(status_code=404, detail="Deployment not found")
    return deployment


@app.get("/agents/operator/status")
async def operator_get_status():
    """Get operator status."""
    return {
        "enabled": CORE5_ENABLED,
        "active_deployments": len(core5_deployments),
        "recent_deployments": list(core5_deployments.keys())[-10:],
    }


# ============== WORKER LIFECYCLE MANAGEMENT ==============


@app.get("/swarm/workers/classes", response_model=List[WorkerClassInfo])
async def list_worker_classes():
    """List available worker classes with their capabilities."""
    return [
        WorkerClassInfo(
            worker_type=wt,
            description=info["description"],
            capabilities=info["capabilities"],
            default_timeout=info["default_timeout"],
        )
        for wt, info in _WORKER_CLASSES.items()
    ]


@app.get("/swarm/workers/{worker_id}/lifecycle", response_model=WorkerLifecycleResponse)
async def get_worker_lifecycle(worker_id: str):
    """Get worker lifecycle status."""
    worker = await _swarm_worker_get(worker_id)
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")

    now = datetime.utcnow().isoformat()
    lifecycle = "idle"

    if worker.get("claimed_at"):
        lifecycle = "claimed"
    elif worker.get("progress_at"):
        lifecycle = "progress"
    elif worker.get("completed_at"):
        lifecycle = "completed"
    elif worker.get("failed_at"):
        lifecycle = "failed"
    elif worker.get("retired_at"):
        lifecycle = "retired"

    return WorkerLifecycleResponse(
        worker_id=worker_id,
        worker_type=worker.get("worker_type", "unknown"),
        status=worker.get("status", "unknown"),
        lifecycle=lifecycle,
        runtime=worker.get("runtime", "shared"),
        created_at=worker.get("started_at", now),
        claimed_at=worker.get("claimed_at"),
        progress_at=worker.get("progress_at"),
        completed_at=worker.get("completed_at"),
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
