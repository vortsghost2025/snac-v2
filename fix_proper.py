# Completely rewrite the free-coding-agent section

with open("/opt/snac-v2/backend/main.py", "r") as f:
    content = f.read()

# Find and replace the entire broken section
import re

# Pattern to find the broken section
pattern = r"# Helper function with the actual logicasync def _free_coding_agent_exec\(request_obj: FreeCodingAgentResponse\).*?return await _free_coding_agent_exec\("

# Clean replacement
replacement = """# Helper function with the actual logic
async def _free_coding_agent_exec(request_obj):
    import uuid, json, os, httpx
    session_id = str(uuid.uuid4())
    try:
        model = request_obj.model or "qwen2.5:0.5b"
        ollama_url = os.getenv("OLLAMA_BASE_URL") or os.getenv("OPENAI_BASE_URL") or "http://snac_ollama:11434"
        ollama_url = ollama_url.replace("/v1", "")
        async with httpx.AsyncClient(timeout=180.0) as client:
            try:
                resp = await client.post(f"{ollama_url}/api/generate", json={"model": model, "prompt": request_obj.task, "stream": False})
                resp.raise_for_status()
                result_data = resp.json()
                return FreeCodingAgentResponse(success=True, result=result_data.get("response", ""), tool_calls=[], session_id=session_id)
            except Exception as e:
                return FreeCodingAgentResponse(success=False, error=f"Ollama failed: {str(e)}", session_id=session_id)
    except Exception as e:
        return FreeCodingAgentResponse(success=False, error=str(e), session_id=session_id)

return await _free_coding_agent_exec("""

content = re.sub(pattern, replacement, content, flags=re.DOTALL)

with open("/opt/snac-v2/backend/main.py", "w") as f:
    f.write(content)

print("Fixed")
