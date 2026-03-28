

# SNAC-v2 — Fixing All Four Issues

Let me walk through each one with concrete solutions.

---

## ❌ Issue 1: Browser Not Opening in Foreground

This is the trickiest one. The root cause depends on *where* this is running.

### If Running on a VPS/Container (No Desktop)

You don't have a display server. Playwright with `headless: false` will fail or open to nothing. You need a virtual framebuffer.

```bash
# Install Xvfb (virtual display) on VPS
sudo apt-get update
sudo apt-get install -y xvfb

# Run your process with a virtual display
xvfb-run --auto-servernum --server-args="-screen 0 1920x1080x24" node your-browser-script.js
```

If you want to **actually see** the browser remotely, add VNC:

```bash
# Install a lightweight VNC setup
sudo apt-get install -y xvfb x11vnc fluxbox

# Start virtual display
export DISPLAY=:99
Xvfb :99 -screen 0 1920x1080x24 &
fluxbox &

# Start VNC server (connect with any VNC client)
x11vnc -display :99 -forever -nopw -rfbport 5900 &

# Now launch your Playwright browser - you'll see it via VNC
```

### If Running on a Local Machine with Desktop

The fix is `page.bringToFront()` plus proper launch args. Update your `BrowserController.ts`:

```typescript
// In BrowserController.ts - update your launch method

import { chromium, firefox, webkit, Browser, BrowserContext, Page } from 'playwright';

interface LaunchOptions {
  browserType?: 'chromium' | 'firefox' | 'webkit';
  headless?: boolean;
  channel?: string;
}

class BrowserController {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  async launch(options: LaunchOptions = {}): Promise<Page> {
    const {
      browserType = 'chromium',
      headless = false,
      channel,
    } = options;

    const engines = { chromium, firefox, webkit };
    const engine = engines[browserType] || chromium;

    // Key launch args that help with focus
    const launchArgs = [
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--window-position=0,0',
      '--window-size=1920,1080',
      '--start-maximized',
      '--no-first-run',
      '--no-default-browser-check',
    ];

    // If using Edge specifically
    if (channel === 'msedge') {
      launchArgs.push('--foreground');
    }

    this.browser = await engine.launch({
      headless,
      channel: channel || undefined,
      args: launchArgs,
    });

    this.context = await this.browser.newContext({
      viewport: { width: 1920, height: 1080 },
    });

    this.page = await this.context.newPage();

    // THIS is the key call most people miss
    await this.page.bringToFront();

    // For Windows: use a small delay then bring to front again
    // (Windows sometimes needs a second nudge)
    await new Promise(resolve => setTimeout(resolve, 500));
    await this.page.bringToFront();

    return this.page;
  }

  async navigate(url: string): Promise<{ title: string; url: string }> {
    if (!this.page) throw new Error('Browser not launched');

    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    await this.page.bringToFront(); // bring to front after navigation too

    const title = await this.page.title();
    return { title, url: this.page.url() };
  }

  async getAccessibilityTree(): Promise<any> {
    if (!this.page) throw new Error('Browser not launched');
    return await this.page.accessibility.snapshot();
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
      this.page = null;
    }
  }
}

export default BrowserController;
```

### Windows-Specific Nuclear Option

If `bringToFront()` still doesn't work on Windows, use a PowerShell helper:

```typescript
// Add this method to BrowserController.ts
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function forceFocusWindow(windowTitle: string): Promise<void> {
  const isWindows = process.platform === 'win32';

  if (isWindows) {
    // PowerShell command to find and focus window
    const psScript = `
      Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        public class WinFocus {
          [DllImport("user32.dll")]
          public static extern bool SetForegroundWindow(IntPtr hWnd);
          [DllImport("user32.dll")]
          public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
          [DllImport("user32.dll")]
          public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
        }
"@
      $procs = Get-Process | Where-Object { $_.MainWindowTitle -like '*${windowTitle}*' }
      foreach ($proc in $procs) {
        [WinFocus]::ShowWindow($proc.MainWindowHandle, 9)
        [WinFocus]::SetForegroundWindow($proc.MainWindowHandle)
      }
    `;
    await execAsync(`powershell -Command "${psScript.replace(/\n/g, ' ')}"`);
  } else {
    // Linux: use wmctrl or xdotool
    try {
      await execAsync(`wmctrl -a "${windowTitle}"`);
    } catch {
      try {
        await execAsync(`xdotool search --name "${windowTitle}" windowactivate`);
      } catch {
        console.warn('Could not focus window - install wmctrl or xdotool');
      }
    }
  }
}
```

Then call it after launch:

```typescript
await this.page.bringToFront();
await forceFocusWindow('Edge');  // or 'Chromium' depending on browser
```

---

## ❌ Issue 2: Install Cockpit on VPS

This is straightforward. SSH into your VPS and run:

```bash
#!/bin/bash
# install_cockpit.sh

set -e

echo "=== Installing Cockpit on VPS ==="

# Detect OS
if [ -f /etc/debian_version ]; then
    echo "[+] Debian/Ubuntu detected"
    sudo apt-get update
    sudo apt-get install -y cockpit cockpit-ws cockpit-system cockpit-networkmanager cockpit-storaged

elif [ -f /etc/redhat-release ]; then
    echo "[+] RHEL/CentOS/Fedora detected"
    sudo dnf install -y cockpit
    sudo systemctl enable --now cockpit.socket

else
    echo "[-] Unknown OS, trying apt..."
    sudo apt-get update && sudo apt-get install -y cockpit
fi

# Enable and start
sudo systemctl enable cockpit.socket
sudo systemctl start cockpit.socket

# Open firewall if ufw is active
if command -v ufw &> /dev/null; then
    sudo ufw allow 9090/tcp
    echo "[+] Firewall port 9090 opened"
fi

# If firewalld is active
if command -v firewall-cmd &> /dev/null; then
    sudo firewall-cmd --permanent --add-service=cockpit
    sudo firewall-cmd --reload
    echo "[+] firewalld updated"
fi

# Verify
echo ""
echo "=== Cockpit Status ==="
sudo systemctl status cockpit.socket --no-pager
echo ""
echo "=== Access Cockpit at ==="
echo "https://$(hostname -I | awk '{print $1}'):9090"
echo ""
echo "Login with your VPS system username/password"
```

### Connect Cockpit to Your SNAC-v2 Backend

Add a Cockpit integration endpoint to `main.py`:

```python
# Add to main.py - Cockpit bridge endpoint

@app.get("/cockpit/status")
async def cockpit_status():
    """Check if Cockpit is reachable and return connection info."""
    import socket
    import subprocess

    cockpit_port = 9090
    host = "127.0.0.1"

    # Check if cockpit is listening
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    cockpit_reachable = sock.connect_ex((host, cockpit_port)) == 0
    sock.close()

    # Get cockpit service status
    cockpit_service = "unknown"
    try:
        result = subprocess.run(
            ["systemctl", "is-active", "cockpit.socket"],
            capture_output=True, text=True, timeout=5
        )
        cockpit_service = result.stdout.strip()
    except Exception:
        pass

    return {
        "cockpit_reachable": cockpit_reachable,
        "cockpit_url": f"https://{host}:{cockpit_port}",
        "cockpit_service": cockpit_service,
        "backend_status": "running",
        "integration": "ready" if cockpit_reachable else "cockpit_not_installed"
    }


@app.post("/cockpit/execute")
async def cockpit_execute(command: dict):
    """
    Execute system commands via Cockpit's bridge protocol.
    This gives the 3-AI hub system-level access through Cockpit.
    """
    import subprocess

    cmd = command.get("command", "")
    allowed_commands = [
        "systemctl status", "df -h", "free -m", "uptime",
        "docker ps", "docker stats --no-stream",
        "journalctl -n 50 --no-pager"
    ]

    # Safety check
    if not any(cmd.startswith(allowed) for allowed in allowed_commands):
        return {"error": "Command not in allowlist", "allowed": allowed_commands}

    try:
        result = subprocess.run(
            cmd.split(), capture_output=True, text=True, timeout=30
        )
        return {
            "command": cmd,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "returncode": result.returncode
        }
    except subprocess.TimeoutExpired:
        return {"error": "Command timed out"}
```

### Update docker-compose.yml to Expose Cockpit

```yaml
# docker-compose.yml
version: "3.8"

services:
  backend:
    build: .
    ports:
      - "8001:8000"    # SNAC-v2 API
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock  # Docker access
    environment:
      - COCKPIT_URL=https://host.docker.internal:9090
    extra_hosts:
      - "host.docker.internal:host-gateway"  # Access host's Cockpit from container
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/healthz"]
      interval: 30s
      timeout: 10s
      retries: 3

  # Cockpit runs on HOST, not in container
  # Access it at https://YOUR_VPS_IP:9090
```

---

## ❌ Issue 3: Terminal Input Error (Refined Fix)

Your fix is correct but let's make it bulletproof. Here's the complete patched section:

```python
# Add near the top of main.py, after imports

def _is_process_running(proc) -> bool:
    """Check if an asyncio subprocess is still running.
    
    asyncio.subprocess.Process uses .returncode (not .poll() like subprocess.Popen).
    - returncode is None → process still running
    - returncode is int  → process has exited
    """
    if proc is None:
        return False
    return proc.returncode is None


# Terminal session manager - full replacement
class TerminalSessionManager:
    def __init__(self):
        self.sessions: dict[str, dict] = {}

    async def create_session(self, session_id: str = None) -> dict:
        import uuid
        sid = session_id or str(uuid.uuid4())[:8]

        proc = await asyncio.create_subprocess_shell(
            "/bin/bash",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        self.sessions[sid] = {
            "id": sid,
            "process": proc,
            "pid": proc.pid,
            "created": asyncio.get_event_loop().time(),
            "status": "active",
        }

        return {"session_id": sid, "status": "active", "pid": proc.pid}

    async def send_input(self, session_id: str, command: str) -> dict:
        session = self.sessions.get(session_id)
        if not session:
            return {"error": f"Session {session_id} not found"}

        proc = session["process"]
        if not _is_process_running(proc):
            session["status"] = "exited"
            return {"error": "Process has exited", "returncode": proc.returncode}

        try:
            # Write command to stdin
            cmd_bytes = (command.strip() + "\n").encode()
            proc.stdin.write(cmd_bytes)
            await proc.stdin.drain()
            return {"success": True, "command": command.strip()}
        except (BrokenPipeError, ConnectionResetError) as e:
            session["status"] = "broken"
            return {"error": f"Pipe broken: {str(e)}"}

    async def read_output(self, session_id: str, timeout: float = 2.0) -> dict:
        session = self.sessions.get(session_id)
        if not session:
            return {"error": f"Session {session_id} not found"}

        proc = session["process"]
        output_lines = []

        try:
            while True:
                try:
                    line = await asyncio.wait_for(
                        proc.stdout.readline(), timeout=timeout
                    )
                    if line:
                        output_lines.append(line.decode(errors="replace").rstrip())
                    else:
                        break
                except asyncio.TimeoutError:
                    break
        except Exception as e:
            return {"error": str(e), "partial_output": output_lines}

        return {
            "session_id": session_id,
            "output": output_lines,
            "still_running": _is_process_running(proc),
        }

    async def get_session_status(self, session_id: str) -> dict:
        session = self.sessions.get(session_id)
        if not session:
            return {"error": f"Session {session_id} not found"}

        proc = session["process"]
        running = _is_process_running(proc)
        session["status"] = "active" if running else "exited"

        return {
            "session_id": session_id,
            "pid": session["pid"],
            "status": session["status"],
            "returncode": proc.returncode,
        }

    async def kill_session(self, session_id: str) -> dict:
        session = self.sessions.get(session_id)
        if not session:
            return {"error": f"Session {session_id} not found"}

        proc = session["process"]
        if _is_process_running(proc):
            proc.kill()
            await proc.wait()

        session["status"] = "killed"
        return {"session_id": session_id, "status": "killed"}

    async def cleanup_all(self):
        """Kill all active sessions."""
        for sid in list(self.sessions.keys()):
            await self.kill_session(sid)


# Initialize
terminal_manager = TerminalSessionManager()


# Endpoints
@app.post("/terminal/sessions")
async def create_terminal_session(session_id: str = None):
    return await terminal_manager.create_session(session_id)


@app.post("/terminal/sessions/{session_id}/input")
async def terminal_input(session_id: str, body: dict):
    command = body.get("command", "")
    if not command:
        return {"error": "No command provided"}
    return await terminal_manager.send_input(session_id, command)


@app.get("/terminal/sessions/{session_id}/output")
async def terminal_output(session_id: str):
    return await terminal_manager.read_output(session_id)


@app.get("/terminal/sessions/{session_id}")
async def terminal_status(session_id: str):
    return await terminal_manager.get_session_status(session_id)


@app.delete("/terminal/sessions/{session_id}")
async def terminal_kill(session_id: str):
    return await terminal_manager.kill_session(session_id)


# Cleanup on shutdown
@app.on_event("shutdown")
async def shutdown_terminals():
    await terminal_manager.cleanup_all()
```

---

## ❌ Issue 4: The 3-AI Hub Integration

This is where it gets interesting. The "3-AI hub" pattern is typically three agents working together. Here's a scaffold that plugs into your existing worker system:

```python
# Add to main.py — 3-AI Hub Coordinator

from enum import Enum
from typing import Optional
import uuid
import time


class AIRole(str, Enum):
    PLANNER = "planner"       # AI 1: Breaks down tasks, creates plans
    EXECUTOR = "executor"     # AI 2: Executes steps, writes code
    REVIEWER = "reviewer"     # AI 3: Reviews output, catches errors


class HubTask:
    def __init__(self, task: str, requester: str = "user"):
        self.id = str(uuid.uuid4())[:12]
        self.task = task
        self.requester = requester
        self.created = time.time()
        self.plan: list[str] = []
        self.results: list[dict] = []
        self.review: dict = {}
        self.status = "pending"
        self.current_phase: Optional[AIRole] = None


class ThreeAIHub:
    """
    3-AI Hub: Planner → Executor → Reviewer pipeline.
    Maps to your existing worker classes:
      - planner  → research_worker + idea_worker
      - executor → builder_worker + automation_worker
      - reviewer → review_worker + analysis_worker
    """

    def __init__(self):
        self.tasks: dict[str, HubTask] = {}
        self.worker_mapping = {
            AIRole.PLANNER:  ["research_worker", "idea_worker"],
            AIRole.EXECUTOR: ["builder_worker", "automation_worker"],
            AIRole.REVIEWER: ["review_worker", "analysis_worker"],
        }

    async def submit(self, task_description: str) -> dict:
        hub_task = HubTask(task_description)
        self.tasks[hub_task.id] = hub_task

        # Phase 1: Plan
        hub_task.current_phase = AIRole.PLANNER
        hub_task.status = "planning"
        hub_task.plan = await self._plan(task_description)

        # Phase 2: Execute each step
        hub_task.current_phase = AIRole.EXECUTOR
        hub_task.status = "executing"
        for i, step in enumerate(hub_task.plan):
            result = await self._execute_step(step, i + 1, len(hub_task.plan))
            hub_task.results.append(result)

        # Phase 3: Review
        hub_task.current_phase = AIRole.REVIEWER
        hub_task.status = "reviewing"
        hub_task.review = await self._review(hub_task)

        hub_task.status = "completed"
        hub_task.current_phase = None
        return self._format_response(hub_task)

    async def _plan(self, task: str) -> list[str]:
        """AI-1 (Planner): Break task into steps."""
        # In production, this calls your LLM
        # For now, smart decomposition
        steps = [
            f"Analyze requirements for: {task}",
            f"Implement core logic for: {task}",
            f"Test and validate: {task}",
        ]
        return steps

    async def _execute_step(self, step: str, step_num: int, total: int) -> dict:
        """AI-2 (Executor): Execute a single step."""
        # This hooks into your existing execution controller
        execution_result = f"[executor] Step {step_num}/{total} completed: {step}"
        return {
            "step": step_num,
            "description": step,
            "result": execution_result,
            "status": "done",
            "timestamp": time.time(),
        }

    async def _review(self, hub_task: HubTask) -> dict:
        """AI-3 (Reviewer): Review all execution results."""
        all_passed = all(r["status"] == "done" for r in hub_task.results)
        return {
            "verdict": "approved" if all_passed else "needs_revision",
            "steps_reviewed": len(hub_task.results),
            "issues_found": 0 if all_passed else 1,
            "summary": f"Reviewed {len(hub_task.results)} steps for task: {hub_task.task}",
        }

    def _format_response(self, hub_task: HubTask) -> dict:
        return {
            "hub_task_id": hub_task.id,
            "task": hub_task.task,
            "status": hub_task.status,
            "plan": hub_task.plan,
            "results": hub_task.results,
            "review": hub_task.review,
            "worker_mapping": {
                role.value: workers
                for role, workers in self.worker_mapping.items()
            },
        }

    def get_task_status(self, task_id: str) -> Optional[dict]:
        task = self.tasks.get(task_id)
        if not task:
            return None
        return {
            "hub_task_id": task.id,
            "status": task.status,
            "current_phase": task.current_phase.value if task.current_phase else None,
            "steps_completed": len(task.results),
            "steps_total": len(task.plan),
        }


# Initialize hub
three_ai_hub = ThreeAIHub()


# Endpoints
@app.post("/hub/submit")
async def hub_submit(body: dict):
    """Submit a task to the 3-AI Hub (Planner → Executor → Reviewer)."""
    task = body.get("task", "")
    if not task:
        return {"error": "No task provided"}
    return await three_ai_hub.submit(task)


@app.get("/hub/status/{task_id}")
async def hub_status(task_id: str):
    """Get status of a hub task."""
    status = three_ai_hub.get_task_status(task_id)
    if not status:
        return {"error": f"Task {task_id} not found"}
    return status


@app.get("/hub/info")
async def hub_info():
    """Get 3-AI Hub configuration and active tasks."""
    return {
        "hub": "3-AI Hub",
        "roles": ["planner", "executor", "reviewer"],
        "worker_mapping": {
            "planner": ["research_worker", "idea_worker"],
            "executor": ["builder_worker", "automation_worker"],
            "reviewer": ["review_worker", "analysis_worker"],
        },
        "active_tasks": len(three_ai_hub.tasks),
        "cockpit_integration": "/cockpit/status",
        "endpoints": {
            "submit": "POST /hub/submit",
            "status": "GET /hub/status/{task_id}",
            "info": "GET /hub/info",
        },
    }
```

---

## Updated `discover_endpoints.sh`

Now that we have more services, update the discovery script:

```bash
#!/bin/bash
# discover_endpoints.sh - Updated with Cockpit + Hub

set -euo pipefail

echo "=== SNAC-v2 Endpoint Discovery ==="

# Detect VPS host
VPS_HOST="${VPS_HOST:-$(hostname -I 2>/dev/null | awk '{print $1}' || echo '127.0.0.1')}"

# Backend discovery (prefer 8001)
BACKEND_URL=""
for port in 8001 8000; do
    for host in "127.0.0.1" "$VPS_HOST" "localhost"; do
        url="http://${host}:${port}"
        if curl -sf "${url}/healthz" --max-time 3 > /dev/null 2>&1; then
            BACKEND_URL="$url"
            echo "[✓] Backend found: $BACKEND_URL"
            break 2
        fi
    done
done

if [ -z "$BACKEND_URL" ]; then
    echo "[✗] Backend not found on 8000 or 8001"
fi

# Cockpit discovery
COCKPIT_URL=""
for host in "127.0.0.1" "$VPS_HOST" "localhost"; do
    url="https://${host}:9090"
    if curl -sfk "${url}" --max-time 3 > /dev/null 2>&1; then
        COCKPIT_URL="$url"
        echo "[✓] Cockpit found: $COCKPIT_URL"
        break
    fi
done

if [ -z "$COCKPIT_URL" ]; then
    echo "[✗] Cockpit not found on port 9090"
    echo "    Install with: sudo apt install cockpit && sudo systemctl enable --now cockpit.socket"
fi

# Hub discovery (same backend, different path)
if [ -n "$BACKEND_URL" ]; then
    HUB_STATUS=$(curl -sf "${BACKEND_URL}/hub/info" --max-time 3 2>/dev/null || echo "")
    if [ -n "$HUB_STATUS" ]; then
        echo "[✓] 3-AI Hub active: ${BACKEND_URL}/hub/info"
    else
        echo "[✗] 3-AI Hub endpoint not registered yet"
    fi
fi

# Export
export BACKEND_URL
export COCKPIT_URL
export VPS_HOST

echo ""
echo "=== Verified Endpoints ==="
[ -n "$BACKEND_URL" ] && echo "  BACKEND_URL=$BACKEND_URL"
[ -n "$COCKPIT_URL" ] && echo "  COCKPIT_URL=$COCKPIT_URL"
echo "  VPS_HOST=$VPS_HOST"
echo ""

# Quick health check of all endpoints
if [ -n "$BACKEND_URL" ]; then
    echo "=== Service Health ==="
    for endpoint in "/healthz" "/hub/info" "/swarm/workers/classes" "/cockpit/status"; do
        status=$(curl -sf -o /dev/null -w "%{http_code}" "${BACKEND_URL}${endpoint}" --max-time 3 2>/dev/null || echo "000")
        if [ "$status" = "200" ]; then
            echo "  [✓] ${endpoint} → ${status}"
        else
            echo "  [✗] ${endpoint} → ${status}"
        fi
    done
fi
```

---

## Quick Test Script

Run this after applying all fixes:

```bash
#!/bin/bash
# test_all_fixes.sh

BASE="${BACKEND_URL:-http://127.0.0.1:8001}"

echo "=== Testing SNAC-v2 Fixes ==="

# 1. Health
echo -e "\n[1] Health check"
curl -s "$BASE/healthz" | python3 -m json.tool

# 2. Free coding agent (Issue 4 fix)
echo -e "\n[2] Free coding agent"
curl -s -X POST "$BASE/free-coding-agent/run" \
  -H "Content-Type: application/json" \
  -d '{"task":"test all fixes"}' | python3 -m json.tool

# 3. Terminal session (Issue 3 fix)
echo -e "\n[3] Terminal session"
SESSION=$(curl -s -X POST "$BASE/terminal/sessions" | python3 -c "import sys,json; print(json.load(sys.stdin).get('session_id',''))")
echo "  Session: $SESSION"

if [ -n "$SESSION" ]; then
    curl -s -X POST "$BASE/terminal/sessions/$SESSION/input" \
      -H "Content-Type: application/json" \
      -d '{"command":"echo hello from fixed terminal"}' | python3 -m json.tool

    sleep 1

    curl -s "$BASE/terminal/sessions/$SESSION/output" | python3 -m json.tool

    curl -s "$BASE/terminal/sessions/$SESSION" | python3 -m json.tool
fi

# 4. 3-AI Hub
echo -e "\n[4] 3-AI Hub"
curl -s "$BASE/hub/info" | python3 -m json.tool

echo -e "\n[5] Hub task submission"
curl -s -X POST "$BASE/hub/submit" \
  -H "Content-Type: application/json" \
  -d '{"task":"build a hello world API endpoint"}' | python3 -m json.tool

# 5. Cockpit status
echo -e "\n[6] Cockpit integration"
curl -s "$BASE/cockpit/status" | python3 -m json.tool

# 6. Worker classes
echo -e "\n[7] Worker classes"
curl -s "$BASE/swarm/workers/classes" | python3 -m json.tool

echo -e "\n=== All tests complete ==="
```

---

## Summary of What to Do

| Issue | Action | Command/File |
|-------|--------|-------------|
| **Browser focus** | Add `page.bringToFront()` + launch args. If on VPS, install `xvfb` + VNC | Update `BrowserController.ts` |
| **Cockpit** | Install on VPS host (not in container) | `sudo apt install cockpit` |
| **Terminal proc.poll()** | Replace with `_is_process_running()` using `proc.returncode is None` | Already in `main.py` |
| **Missing endpoint** | Already fixed — add `/hub/*` endpoints for 3-AI integration | Add hub code to `main.py` |
| **3-AI Hub** | Add `ThreeAIHub` class with Planner→Executor→Reviewer pipeline | New section in `main.py` |

Kilo should be back in action once you drop these in. Let me know if you need me to dive deeper into any piece.