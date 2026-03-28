# Git Setup Instructions for SNAC v2

## Initial Setup (Run These Commands)

```bash
# 1. Initialize Git repo
cd s:\snac-v2\snac-v2\backend
git init

# 2. Add all files
git add .

# 3. Initial commit
git commit -m "Initial commit: SNAC v2 backend with MessageBus, Dashboard, and Security"

# 4. Create GitHub repo (manual step - go to github.com)
# Create new repo: github.com/new
# Name: snac-v2
# Don't initialize with README (we have one)

# 5. Add remote and push
git remote add origin https://github.com/YOURUSERNAME/snac-v2.git
git branch -M main
git push -u origin main
```

## After GitHub Repo Created

**VPS Setup (dev-copilot zone):**
```bash
ssh root@187.77.3.56
apt-get update && apt-get install -y git docker.io docker-compose
mkdir -p /opt/ai-stack
cd /opt/ai-stack
git clone https://github.com/YOURUSERNAME/snac-v2.git .
cp .env.example .env
# Edit .env for production
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

## Deployment Commands

**Update VPS:**
```bash
cd /opt/ai-stack
git pull
docker-compose up -d --build
```

## Auto-Deploy Script (Optional)

Save as `deploy.sh` on VPS:
```bash
#!/bin/bash
cd /opt/ai-stack || exit 1
git pull origin main
docker-compose up -d --build
echo "$(date): Deployed" >> /var/log/snac-deploy.log
```

Then: `chmod +x deploy.sh`

## Files in This Repo

- `src/agents/` - MessageBus for AI-to-AI chat (dev-kimi zone)
- `src/dashboard/` - WebSocket dashboard (dev-kimi zone)  
- `src/websocket/` - WebSocket infrastructure (dev-kimi zone)
- `terminal-echo-bridge.js` - Accessibility TTS
- `infra/` - Deployment configs (dev-copilot zone)
- `.agents/` - Coordination layer
