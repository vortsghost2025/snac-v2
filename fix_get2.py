# Fix the GET handler to handle empty task

with open("/tmp/main_clean.py", "r") as f:
    content = f.read()

# Fix the GET handler
old_get = '''@app.get("/free-coding-agent/run", response_model=FreeCodingAgentResponse)
async def run_free_coding_agent_get(task: str = "", model: str = "qwen2.5:0.5b"):
    """GET handler - use POST for full functionality"""
    return await run_free_coding_agent(FreeCodingAgentRequest(task=task, model=model))'''

new_get = '''@app.get("/free-coding-agent/run", response_model=FreeCodingAgentResponse)
async def run_free_coding_agent_get(task: str = "Hello", model: str = "qwen2.5:0.5b"):
    """GET handler - use POST for full functionality"""
    if not task or task.strip() == "":
        task = "Hello"
    return await run_free_coding_agent(FreeCodingAgentRequest(task=task, model=model))'''

content = content.replace(old_get, new_get)

with open("/tmp/main_clean.py", "w") as f:
    f.write(content)

print("Fixed GET handler")
