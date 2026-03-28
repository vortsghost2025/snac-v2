#!/bin/bash
# discover_endpoints.sh - Find working Kilo service endpoints
# Usage: ./discover_endpoints.sh [VPS_HOST]

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${GREEN}[DISCOVER]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Default configuration
# Prefer VPS hostname first, then CLI arg, then localhost as last-resort
VPS_HOST="${VPS_HOST:-${1:-snac.deliberatefederation.cloud}}"
COCKPIT_URL="${COCKPIT_URL:-https://$VPS_HOST:9090}"
BACKEND_URL="${BACKEND_URL:-http://$VPS_HOST:8001}"

if [[ "$BACKEND_URL" == *":8000"* ]]; then
    warn "Detected BACKEND_URL using :8000; switching to :8001 per current container binding"
    BACKEND_URL="${BACKEND_URL/8000/8001}"
fi

log "🔍 Discovering Kilo service endpoints..."
log "VPS Host: $VPS_HOST"
log "Primary Cockpit URL: $COCKPIT_URL"
log "Primary Backend URL: $BACKEND_URL"
echo

WORKING_COCKPIT=""
WORKING_BACKEND=""
WORKING_API=""

# Test Cockpit endpoints
echo -e "${BLUE}Testing Cockpit endpoints:${NC}"
cockpit_urls=(
    "$COCKPIT_URL"
    "https://$VPS_HOST:9090"
    "http://$VPS_HOST:9090"
    "http://localhost:9090"
    "https://localhost:9090"
    "http://127.0.0.1:9090"
)

for url in "${cockpit_urls[@]}"; do
    echo -n "  $url ... "
    if curl -k -s --max-time 5 --connect-timeout 3 "$url" >/dev/null 2>&1; then
        echo -e "${GREEN}✅ REACHABLE${NC}"
        WORKING_COCKPIT="$url"
        break
    else
        echo -e "${RED}❌ unreachable${NC}"
    fi
done

# Test Backend endpoints
echo
echo -e "${BLUE}Testing Backend endpoints:${NC}"
backend_urls=(
    "$BACKEND_URL/healthz"
    "$BACKEND_URL/health"
    "http://localhost:8001/healthz"
    "http://127.0.0.1:8001/healthz"
    "http://$VPS_HOST:8001/healthz"
    "http://localhost:8001/health"
    "http://$VPS_HOST:8001/health"
    "http://localhost:8000/healthz"
    "http://$VPS_HOST:8000/healthz"
    "http://localhost:8000/health"
)

for url in "${backend_urls[@]}"; do
    echo -n "  $url ... "
    if curl -s --max-time 5 --connect-timeout 3 "$url" >/dev/null 2>&1; then
        echo -e "${GREEN}✅ REACHABLE${NC}"
        WORKING_BACKEND="${url%/health*}"  # Remove /health or /healthz suffix
        break
    else
        echo -e "${RED}❌ unreachable${NC}"
    fi
done

# Test API endpoints (if backend found)
if [ -n "$WORKING_BACKEND" ]; then
    echo
    echo -e "${BLUE}Testing API endpoints:${NC}"
    api_urls=(
        "$WORKING_BACKEND/api/health"
        "$WORKING_BACKEND/api"
        "http://$VPS_HOST:8000/api"
    )

    for url in "${api_urls[@]}"; do
        echo -n "  $url ... "
        if curl -s --max-time 5 --connect-timeout 3 "$url" >/dev/null 2>&1; then
            echo -e "${GREEN}✅ REACHABLE${NC}"
            WORKING_API="$url"
            break
        else
            echo -e "${RED}❌ unreachable${NC}"
        fi
    done
fi

# Report results
echo
echo -e "${BLUE}📋 DISCOVERY RESULTS:${NC}"
echo "Working Cockpit: ${WORKING_COCKPIT:-NOT FOUND}"
echo "Working Backend: ${WORKING_BACKEND:-NOT FOUND}"
echo "Working API: ${WORKING_API:-NOT FOUND}"

if [ -z "$WORKING_COCKPIT" ] && [ -z "$WORKING_BACKEND" ]; then
    echo
    warn "No services found. Possible issues:"
    echo "  - Services not running"
    echo "  - Firewall blocking connections"
    echo "  - Wrong VPS host ($VPS_HOST)"
    echo "  - SSL certificate issues (try HTTP instead of HTTPS)"
    exit 1
fi

# Generate environment variables
echo
echo -e "${GREEN}💡 Environment variables for Kilo:${NC}"
if [ -n "$WORKING_COCKPIT" ]; then
    echo "export COCKPIT_URL=\"$WORKING_COCKPIT\""
fi
if [ -n "$WORKING_BACKEND" ]; then
    echo "export BACKEND_URL=\"$WORKING_BACKEND\""
fi
if [ -n "$WORKING_API" ]; then
    echo "export API_BASE=\"$WORKING_API\""
fi
echo "export VPS_HOST=\"$VPS_HOST\""

# Generate .env file content
echo
echo -e "${GREEN}📝 Add to your .env file:${NC}"
if [ -n "$WORKING_COCKPIT" ]; then
    echo "COCKPIT_URL=$WORKING_COCKPIT"
fi
if [ -n "$WORKING_BACKEND" ]; then
    echo "BACKEND_URL=$WORKING_BACKEND"
fi
if [ -n "$WORKING_API" ]; then
    echo "API_BASE=$WORKING_API"
fi
echo "VPS_HOST=$VPS_HOST"

log "✅ Discovery complete!"