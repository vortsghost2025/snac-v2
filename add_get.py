# Add GET support to main.py

with open("/tmp/main_clean.py", "r") as f:
    content = f.read()

# Find the POST route and add GET after it
post_route = (
    '@app.post("/free-coding-agent/run", response_model=FreeCodingAgentResponse)'
)
get_addition = '''

@app.get("/free-coding-agent/run", response_model=FreeCodingAgentResponse)
async def run_free_coding_agent_get(task: str = "", model: str = "qwen2.5:0.5b"):
    """GET handler - use POST for full functionality"""
    return await run_free_coding_agent(FreeCodingAgentRequest(task=task, model=model))
'''

content = content.replace(post_route, post_route + get_addition)

with open("/tmp/main_clean.py", "w") as f:
    f.write(content)

print("Added GET route")
