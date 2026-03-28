import re

with open("/app/main.py", "r") as f:
    content = f.read()

# Find and replace the ollama call section
old_code = """        # Run the agent using Ollama directly
        model = request.model or "qwen2.5:0.5b"
        ollama_url = os.getenv("OPENAI_BASE_URL", "http://127.0.0.1:11434").replace("/v1", "")
        
        process = await asyncio.create_subprocess_exec(
            "curl",
            "-s",
            f"{ollama_url}/api/generate",
            "-d", json.dumps({"model": model, "prompt": request.task}),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        
        stdout, stderr = await process.communicate()

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
                result=result.get("response", ""),
                tool_calls=[],
                session_id=session_id,
            )
        except json.JSONDecodeError:
            return FreeCodingAgentResponse(
                success=True, result=stdout.decode(), session_id=session_id
            )"""

new_code = """        # Run the agent using Ollama directly
        model = request.model or "qwen2.5:0.5b"
        ollama_url = os.getenv("OPENAI_BASE_URL", "http://snac_ollama:11434").replace("/v1", "")
        
        import httpx
        async with httpx.AsyncClient(timeout=180.0) as client:
            try:
                resp = await client.post(
                    f"{ollama_url}/api/generate",
                    json={"model": model, "prompt": request.task},
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
                )"""

content = content.replace(old_code, new_code)

with open("/app/main.py", "w") as f:
    f.write(content)

print("Code updated successfully")
