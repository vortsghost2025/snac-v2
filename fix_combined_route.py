# Fix main.py - Replace both GET and POST routes with a combined api_route

with open("/opt/snac-v2/backend/main.py", "r") as f:
    content = f.read()

# Find and remove both broken routes, then add the combined one
import re

# Remove the broken POST route
post_pattern = r'@app\.post\("/free-coding-agent/run", response_model=FreeCodingAgentResponse\)\nasync def run_free_coding_agent\(request: FreeCodingAgentRequest\):.*?(?=\n@app\.)'
content = re.sub(post_pattern, "", content, flags=re.DOTALL)

# Remove the broken GET route
get_pattern = r'@app\.get\("/free-coding-agent/run", response_model=FreeCodingAgentResponse\)\nasync def run_free_coding_agent_get.*?(?=\n@app\.)'
content = re.sub(get_pattern, "", content, flags=re.DOTALL)

# Now add the combined route - find a good insertion point (before @app.get("/free-coding-agent/tools"))
insert_marker = '@app.get("/free-coding-agent/tools"'

combined_route = '''from fastapi import Request

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
        except:
            pass

    return await run_free_coding_agent(
        FreeCodingAgentRequest(task=task, model=model)
    )


'''

content = content.replace(insert_marker, combined_route + insert_marker)

with open("/opt/snac-v2/backend/main.py", "w") as f:
    f.write(content)

print("Fixed with combined api_route")
