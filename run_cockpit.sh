#!/bin/bash
set -e

# ----- Config -----
VPS_HOST="${VPS_HOST:-snac.deliberatefederation.cloud}"
export VPS_HOST
export COCKPIT_URL="${COCKPIT_URL:-https://$VPS_HOST:9090}"
export BACKEND_URL="${BACKEND_URL:-http://$VPS_HOST:8001}"

# ----- Quick endpoint pre-check -----
echo "🧪 Validating backend/cockpit URLs..."
if ! curl -k -sS "${BACKEND_URL}/healthz" >/dev/null 2>&1; then
    echo "backend down at ${BACKEND_URL}; trying local fallback..."
    if curl -k -sS "http://localhost:8001/healthz" >/dev/null 2>&1; then
        BACKEND_URL="http://localhost:8001"
        export BACKEND_URL
        echo "fallback backend OK on localhost:8001"
    elif curl -k -sS "http://localhost:8000/healthz" >/dev/null 2>&1; then
        BACKEND_URL="http://localhost:8000"
        export BACKEND_URL
        echo "fallback backend OK on localhost:8000"
    else
        echo "backend unreachable; exit"
        exit 1
    fi
fi

if ! curl -k -sS "${COCKPIT_URL}/health" >/dev/null 2>&1; then
    echo "cockpit down at ${COCKPIT_URL}; no fallback available (cockpit is optional)"
    # continue if cockpit is not installed, only backend is required for now
else
    echo "✅ Cockpit reachable at ${COCKPIT_URL}"
fi

echo "✅ Backend checks pass: ${BACKEND_URL}"


# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Starting SNAC Cockpit Deployment...${NC}"

# Docker checks
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker is not installed. Please install Docker first.${NC}"
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}❌ Docker Compose is not installed. Please install Docker Compose first.${NC}"
    exit 1
fi

# Navigate to backend directory (script location)
cd "$(dirname "$0")" || exit 1

echo -e "${YELLOW}📦 Building and starting services...${NC}"
docker-compose up --build -d

echo -e "${GREEN}✅ Services started successfully!${NC}"

echo -e "${YELLOW}⏳ Waiting for services to be ready...${NC}"
sleep 10

echo -e "${YELLOW}🔍 Checking service status...${NC}"
docker-compose ps

echo -e "${YELLOW}🏥 Testing health endpoint...${NC}"
if curl -f "${BACKEND_URL}/healthz"; then
    echo -e "${GREEN}✅ Health check passed${NC}"
else
    echo -e "${RED}❌ Health check failed${NC}"
fi

echo -e "${YELLOW}🤖 Testing agent endpoint...${NC}"
if curl -f "${BACKEND_URL}/free-coding-agent/run" -d '{"input":"test", "mode":"code"}' -H "Content-Type: application/json"; then
    echo -e "${GREEN}✅ Agent endpoint test passed${NC}"
else
    echo -e "${RED}❌ Agent endpoint test failed${NC}"
fi

echo -e "${GREEN}🎉 Deployment complete!${NC}"
echo -e "${GREEN}🌐 Open http://localhost:8000 to access the cockpit${NC}"