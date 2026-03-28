# Fix main.py properly - add helper function and fix dual route

with open("/opt/snac-v2/backend/main.py", "r") as f:
    content = f.read()

# First, remove any broken references to run_free_coding_agent
content = content.replace(
    "return await run_free_coding_agent(", "return await _free_coding_agent_exec("
)

# Find the dual route and replace it with proper version
old_dual = '''async def run_free_coding_agent_dual(
    request: Request,
    task: str = "",
    model: str = "qwen2.5:0.5b",
    provider: str | None = None,
    working_dir: str | None = None,
    no_approval: bool | None = None,
):
    """
    Run the Free Coding Agent - accepts both GET and POST.
    For POST, send JSON body: {"task": "...", "model": "..."}
    For GET, use query params: ?task=...&model=...
    """
    import uuid, json, asyncio, os
    
    # If POST body exists, prefer that.
    if request.method == "POST":
        try:
            payload = await request.json()
            task = payload.get("task", task)
            model = payload.get("model", model)
            provider = payload.get("provider", provider)
            working_dir = payload.get("working_dir", working_dir)
            no_approval = payload.get("no_approval", no_approval)
        except:
            pass

    session_id = str(uuid.uuid4())
    
    try:
        working_dir = working_dir or os.getcwd()
        model = model or "qwen2.5:0.5b"
        
        # Call Ollama
        import httpx
        ollama_url = os.getenv("OLLAMA_BASE_URL") or os.getenv("OPENAI_BASE_URL") or "http://snac_ollama:11434"
        ollama_url = ollama_url.replace("/v1", "")
        
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

new_dual = '''# Helper function with the actual logic
async def _free_coding_agent_exec(request_obj: FreeCodingAgentRequest) -> FreeCodingAgentResponse:
    import uuid, json, os, asyncio
    import httpx
    
    session_id = str(uuid.uuid4())
    
    try:
        working_dir = request_obj.working_dir or os.getcwd()
        model = request_obj.model or "qwen2.5:0.5b"
        
        # Call Ollama
        ollama_url = os.getenv("OLLAMA_BASE_URL") or os.getenv("OPENAI_BASE_URL") or "http://snac_ollama:11434"
        ollama_url = ollama_url.replace("/v1", "")
        
        async with httpx.AsyncClient(timeout=180.0) as client:
            try:
                resp = await client.post(
                    f"{ollama_url}/api/generate",
                    json={"model": model, "prompt": request_obj.task, "stream": False},
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
        )


# Dual route that handles both GET and POST
@app.api_route(
    "/free-coding-agent/run",
    methods=["GET", "POST"],
    response_model=FreeCodingAgentResponse,
)
async def run_free_coding_agent_dual(
    request: Request,
    task: str = "",
    model: str = "qwen2.5:0.5b",
):
    """
    Run the Free Coding Agent - accepts both GET and POST.
    For POST, send JSON body: {"task": "...", "model": "..."}
    For GET, use query params: ?task=...&model=...
    """
    # If POST body exists, prefer that.
    if request.method == "POST":
        try:
            payload = await request.json()
            task = payload.get("task", task)
            model = payload.get("model", model)
        except Exception:
            pass

    request_obj = FreeCodingAgentRequest(task=task, model=model)
    return await _free_coding_agent_exec(request_obj)'''

content = content.replace(old_dual, new_dual)

with open("/opt/snac-v2/backend/main.py", "w") as f:
    f.write(content)

print("Fixed with helper function")
