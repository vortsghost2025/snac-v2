# Fix to use Ollama directly instead of node CLI

with open("/tmp/main_clean.py", "r") as f:
    content = f.read()

# Replace the old function with one that calls Ollama directly
old_func = '''async def run_free_coding_agent(request: FreeCodingAgentRequest):
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
        )'''

new_func = '''async def run_free_coding_agent(request: FreeCodingAgentRequest):
    """
    Run the Free Coding Agent using Ollama.
    """
    import uuid
    import httpx
    import os

    session_id = str(uuid.uuid4())

    try:
        # Get model and task
        model = request.model or "qwen2.5:0.5b"
        task = request.task
        
        # Get Ollama URL - use OLLAMA_BASE_URL env var, fallback to snac_ollama container
        ollama_url = os.getenv("OLLAMA_BASE_URL") or os.getenv("OPENAI_BASE_URL") or "http://snac_ollama:11434"
        ollama_url = ollama_url.replace("/v1", "")
        
        # Call Ollama directly
        async with httpx.AsyncClient(timeout=180.0) as client:
            try:
                resp = await client.post(
                    f"{ollama_url}/api/generate",
                    json={"model": model, "prompt": task, "stream": False},
                )
                resp.raise_for_status()
                result_data = resp.json()
                return FreeCodingAgentResponse(
                    success=True,
                    result=result_data.get("response", ""),
                    tool_calls=[],
                    session_id=session_id,
                )
            except Exception as e:
                return FreeCodingAgentResponse(
                    success=False,
                    error=f"Ollama call failed: {str(e)}",
                    session_id=session_id,
                )
    except Exception as e:
        return FreeCodingAgentResponse(
            success=False,
            error=f"Error running free coding agent: {str(e)}",
            session_id=session_id,
        )'''

content = content.replace(old_func, new_func)

with open("/tmp/main_clean.py", "w") as f:
    f.write(content)

print("Fixed to use Ollama directly")
