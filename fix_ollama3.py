with open("/app/main.py", "r") as f:
    content = f.read()

# Find and replace the httpx call section to add debug logging
old_code = """        import httpx
        async with httpx.AsyncClient(timeout=180.0) as client:
            try:
                resp = await client.post(
                    f"{ollama_url}/api/generate",
                    json={"model": model, "prompt": request.task, "stream": False},
                )
                resp.raise_for_status()
                result_data = resp.json()"""

new_code = """        import httpx
        async with httpx.AsyncClient(timeout=180.0) as client:
            try:
                resp = await client.post(
                    f"{ollama_url}/api/generate",
                    json={"model": model, "prompt": request.task, "stream": False},
                )
                # Debug: log status and response text
                print(f"Ollama response status: {resp.status_code}")
                print(f"Ollama response text: {resp.text[:500]}")
                resp.raise_for_status()
                result_data = resp.json()"""

content = content.replace(old_code, new_code)

with open("/app/main.py", "w") as f:
    f.write(content)

print("Debug logging added")
