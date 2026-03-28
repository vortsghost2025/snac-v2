with open("/app/main.py", "r") as f:
    content = f.read()

# Find and replace the httpx call section to add stream=False
old_code = """        import httpx
        async with httpx.AsyncClient(timeout=180.0) as client:
            try:
                resp = await client.post(
                    f"{ollama_url}/api/generate",
                    json={"model": model, "prompt": request.task},
                )"""

new_code = """        import httpx
        async with httpx.AsyncClient(timeout=180.0) as client:
            try:
                resp = await client.post(
                    f"{ollama_url}/api/generate",
                    json={"model": model, "prompt": request.task, "stream": False},
                )"""

content = content.replace(old_code, new_code)

with open("/app/main.py", "w") as f:
    f.write(content)

print("Code updated to use stream=False")
