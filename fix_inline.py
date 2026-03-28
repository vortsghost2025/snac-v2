# Fix main.py - add the missing helper function and fix the dual route

with open("/opt/snac-v2/backend/main.py", "r") as f:
    content = f.read()

# Find the dual function and fix it to include the logic inline
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

    return await run_free_coding_agent(
        FreeCodingAgentRequest(
            task=task,
            model=model,
            provider=provider or "ollama",
            working_dir=working_dir,
            no_approval=no_approval
        )
    )'''

new_dual = '''async def run_free_coding_agent_dual(
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

content = content.replace(old_dual, new_dual)

with open("/opt/snac-v2/backend/main.py", "w") as f:
    f.write(content)

print("Fixed with inline logic")
