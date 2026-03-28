with open("/app/main.py", "r") as f:
    content = f.read()

# Fix the broken line - use a proper fallback chain
content = content.replace(
    'os.getenv("OLLAMA_BASE_URL", os.getenv("OPENAI_BASE_URL")',
    'os.getenv("OLLAMA_BASE_URL", os.getenv("OPENAI_BASE_URL", "http://snac_ollama:11434")',
)

with open("/app/main.py", "w") as f:
    f.write(content)

print("Fixed getenv call")
