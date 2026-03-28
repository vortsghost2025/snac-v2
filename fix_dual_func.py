# Fix main.py - properly this time

with open("/opt/snac-v2/backend/main.py", "r") as f:
    content = f.read()

# Check if the original function exists
if "async def run_free_coding_agent(request: FreeCodingAgentRequest):" in content:
    print("Original function exists - good")
else:
    print("ERROR: Original function is missing! Need to restore it.")
    # The original function was removed - we need to add it back

# Let's add a proper api_route that calls the original function

# First check if the api_route is there but broken
old_dual = '''async def run_free_coding_agent_dual(
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
        except:
            pass

    return await run_free_coding_agent(
        FreeCodingAgentRequest(task=task, model=model)
    )'''

# Replace with properly calling version
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

content = content.replace(old_dual, new_dual)

with open("/opt/snac-v2/backend/main.py", "w") as f:
    f.write(content)

print("Fixed function signature")
