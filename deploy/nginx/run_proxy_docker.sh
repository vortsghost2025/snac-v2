#!/usr/bin/env bash
# Simple helper to run the cockpit nginx proxy using Docker
# Maps host port 443 to container 443. Requires Docker installed and the
# `cockpit-proxy.conf` file to exist in the same folder.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF="$HERE/cockpit-proxy.conf"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker not found — install Docker and re-run"
  exit 1
fi

if [ ! -f "$CONF" ]; then
  echo "Missing $CONF — please place your nginx config there."
  exit 1
fi

echo "Starting nginx proxy (container: cockpit-proxy) mapping host:443 -> container:443"
echo "Note: ensure TLS certs are configured in the nginx config (or use a reverse proxy with certificates)."

docker rm -f cockpit-proxy 2>/dev/null || true
docker run -d --name cockpit-proxy \
  -p 443:443 \
  -v "$CONF":/etc/nginx/conf.d/default.conf:ro \
  --restart unless-stopped \
  nginx:stable

echo "cockpit-proxy started. Use 'docker logs -f cockpit-proxy' to follow logs."
