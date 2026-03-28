# Fix the corrupted GET handler

with open("/opt/snac-v2/backend/main.py", "r") as f:
    content = f.read()

# Replace the corrupted GET handler
old_get = '''@app.get("/free-coding-agent/run", response_model=FreeCodingAgentResponse)
async def run_free_coding_agent_get(task: str = "", model: str = "qwen2.5:0.5b"):
    """GET handler - use POST for full functionality"""
    return await run_free_coding_agent(FreeCodingAgentRequest(task=task, model=model))

    except Exception as e:
        return FreeCodingAgentResponse(
            success=False,
            error=f"Error running free coding agent: {str(e)}",
            session_id=session_id,
        )'''

new_get = '''@app.get("/free-coding-agent/run", response_model=FreeCodingAgentResponse)
async def run_free_coding_agent_get(task: str = "", model: str = "qwen2.5:0.5b"):
    """GET handler - use POST for full functionality"""
    return await run_free_coding_agent(FreeCodingAgentRequest(task=task, model=model))'''

content = content.replace(old_get, new_get)

with open("/opt/snac-v2/backend/main.py", "w") as f:
    f.write(content)

print("Fixed corrupted GET handler")
