# Fix the malformed main.py - rewrite the function section

import re

with open("/opt/snac-v2/backend/main.py", "r") as f:
    content = f.read()

# Find and replace the broken section
old_section = '''@app.post("/free-coding-agent/run", response_model=FreeCodingAgentResponse)
async def run_free_coding_agent(request: FreeCodingAgentRequest):
@app.get("/free-coding-agent/run", response_model=FreeCodingAgentResponse)
async def run_free_coding_agent_get(task: str = "", model: str = "qwen2.5:0.5b"):
    """GET handler - use POST for full functionality"""
    return await run_free_coding_agent(FreeCodingAgentRequest(task=task, model=model))

    """
    Run the Free Coding Agent with Cline's MCP tools.

    This agent has access to:
    - Basic tools: file operations, commands, code search, git
    - MCP tools: GitHub, filesystem, brave-search, playwright, postgres, context7
    """'''

new_section = '''@app.post("/free-coding-agent/run", response_model=FreeCodingAgentResponse)
async def run_free_coding_agent(request: FreeCodingAgentRequest):
    """
    Run the Free Coding Agent with Cline's MCP tools.

    This agent has access to:
    - Basic tools: file operations, commands, code search, git
    - MCP tools: GitHub, filesystem, brave-search, playwright, postgres, context7
    """'''

content = content.replace(old_section, new_section)

# Now add the GET handler after the POST handler
# Find where the POST handler ends and add GET after it

# Find the end of run_free_coding_agent function - look for next @app decorator
post_handler_match = re.search(
    r'(@app\.post\("/free-coding-agent/run".*?)(?=@app\.)', content, re.DOTALL
)

if post_handler_match:
    # Find where we should insert the GET handler (right after the POST handler's function ends)
    # We'll look for the return statement and add after

    # Find the FreeCodingAgentResponse return and add GET after
    insert_pos = content.find(
        "return FreeCodingAgentResponse(\n                success=False,"
    )
    if insert_pos > 0:
        # Find the end of this return block
        end_pos = content.find("\n    except Exception as e:", insert_pos)
        if end_pos > 0:
            get_handler = '''

@app.get("/free-coding-agent/run", response_model=FreeCodingAgentResponse)
async def run_free_coding_agent_get(task: str = "", model: str = "qwen2.5:0.5b"):
    """GET handler - use POST for full functionality"""
    return await run_free_coding_agent(FreeCodingAgentRequest(task=task, model=model))
'''
            content = content[:end_pos] + get_handler + content[end_pos:]

with open("/opt/snac-v2/backend/main.py", "w") as f:
    f.write(content)

print("Fixed main.py")
