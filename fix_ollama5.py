with open("/app/main.py", "r") as f:
    content = f.read()

# Replace OPENAI_BASE_URL with OLLAMA_BASE_URL
content = content.replace(
    'os.getenv("OPENAI_BASE_URL"',
    'os.getenv("OLLAMA_BASE_URL", os.getenv("OPENAI_BASE_URL")',
)

with open("/app/main.py", "w") as f:
    f.write(content)

print("Changed to use OLLAMA_BASE_URL with OPENAI_BASE_URL fallback")
