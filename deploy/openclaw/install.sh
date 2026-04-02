#!/usr/bin/env bash
# install.sh — Idempotent OpenClaw deployment script for Hostinger VPS
# Safe to re-run; skips steps already completed.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
CONFIG_SRC="${SCRIPT_DIR}/config.yaml"
CONFIG_DST="${OPENCLAW_HOME}/config.yaml"
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.openclaw.yml"
SYSTEMD_UNIT="openclaw.service"
VPS_HOST="${VPS_HOST:-187.77.3.56}"

# ── Helpers ────────────────────────────────────────────────────────────────────
log()  { echo "[openclaw-install] $*"; }
warn() { echo "[openclaw-install] WARN: $*" >&2; }

need_cmd() {
  if ! command -v "$1" &>/dev/null; then
    return 1
  fi
}

# ── Step 1: System dependencies ───────────────────────────────────────────────
log "Checking system dependencies..."

APT_UPDATED=false
ensure_pkg() {
  if ! dpkg -s "$1" &>/dev/null; then
    if [ "$APT_UPDATED" = false ]; then
      apt-get update -qq
      APT_UPDATED=true
    fi
    apt-get install -y -qq "$1"
  fi
}

if need_cmd apt-get; then
  ensure_pkg curl
  ensure_pkg git
  ensure_pkg python3
  ensure_pkg python3-pip
  ensure_pkg docker.io || true
  ensure_pkg docker-compose || true
fi

# ── Step 2: Docker & Docker Compose ───────────────────────────────────────────
log "Ensuring Docker is running..."

if ! need_cmd docker; then
  log "Installing Docker via convenience script..."
  curl -fsSL https://get.docker.com | sh
fi

systemctl enable docker 2>/dev/null || true
systemctl start docker 2>/dev/null || true

if ! need_cmd docker-compose && ! docker compose version &>/dev/null; then
  log "Installing Docker Compose plugin..."
  COMPOSE_VERSION="v2.29.1"
  mkdir -p /usr/local/lib/docker/cli-plugins
  curl -fsSL "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-linux-x86_64" \
    -o /usr/local/lib/docker/cli-plugins/docker-compose
  chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
fi

# Use 'docker compose' (v2) or fall back to 'docker-compose' (v1)
if docker compose version &>/dev/null; then
  COMPOSE_CMD="docker compose"
elif need_cmd docker-compose; then
  COMPOSE_CMD="docker-compose"
else
  echo "ERROR: Neither docker compose nor docker-compose found." >&2
  exit 1
fi

# ── Step 3: Initialize OpenClaw config directory ──────────────────────────────
log "Setting up OpenClaw config at ${OPENCLAW_HOME}..."

mkdir -p "${OPENCLAW_HOME}"

# Copy config if it doesn't exist or is different
if [ ! -f "${CONFIG_DST}" ]; then
  cp "${CONFIG_SRC}" "${CONFIG_DST}"
  log "Installed config.yaml"
else
  if ! diff -q "${CONFIG_SRC}" "${CONFIG_DST}" &>/dev/null; then
    cp "${CONFIG_DST}" "${CONFIG_DST}.bak.$(date +%s)"
    cp "${CONFIG_SRC}" "${CONFIG_DST}"
    log "Updated config.yaml (backup of old config saved)"
  else
    log "config.yaml is up to date"
  fi
fi

# ── Step 4: Install OpenClaw via pip (idempotent) ─────────────────────────────
log "Installing OpenClaw Python package..."

pip3 install --quiet --upgrade openclaw 2>/dev/null || {
  warn "pip install openclaw failed — will use Docker image instead"
}

# Run openclaw init if not already done
if [ ! -f "${OPENCLAW_HOME}/.initialized" ]; then
  if need_cmd openclaw; then
    openclaw init --config "${CONFIG_DST}" 2>/dev/null || true
    touch "${OPENCLAW_HOME}/.initialized"
    log "openclaw init completed"
  else
    log "openclaw CLI not available — skipping init (Docker will handle it)"
    touch "${OPENCLAW_HOME}/.initialized"
  fi
else
  log "openclaw already initialized"
fi

# ── Step 5: Deploy with Docker Compose ────────────────────────────────────────
log "Starting OpenClaw containers..."

# Ensure the external snac-net network exists
if ! docker network inspect snac-net &>/dev/null; then
  docker network create snac-net
  log "Created snac-net Docker network"
fi

# Pull latest images and restart
${COMPOSE_CMD} -f "${COMPOSE_FILE}" pull 2>/dev/null || true
${COMPOSE_CMD} -f "${COMPOSE_FILE}" up -d --remove-orphans

log "OpenClaw containers started"

# ── Step 6: Systemd service for auto-start ────────────────────────────────────
log "Setting up systemd service..."

SYSTEMD_PATH="/etc/systemd/system/${SYSTEMD_UNIT}"

if [ ! -f "${SYSTEMD_PATH}" ]; then
  cat > "${SYSTEMD_PATH}" <<UNIT
[Unit]
Description=OpenClaw AI Agent Framework
After=docker.service network-online.target
Requires=docker.service
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${SCRIPT_DIR}
ExecStart=${COMPOSE_CMD} -f ${COMPOSE_FILE} up -d --remove-orphans
ExecStop=${COMPOSE_CMD} -f ${COMPOSE_FILE} down
TimeoutStartSec=120
Restart=on-failure

[Install]
WantedBy=multi-user.target
UNIT

  systemctl daemon-reload
  systemctl enable "${SYSTEMD_UNIT}"
  log "Systemd service ${SYSTEMD_UNIT} installed and enabled"
else
  log "Systemd service already exists"
fi

# ── Step 7: Health verification ────────────────────────────────────────────────
log "Waiting for OpenClaw to become healthy..."

HEALTHY=false
for i in $(seq 1 12); do
  if curl -sf http://localhost:8080/health &>/dev/null; then
    HEALTHY=true
    break
  fi
  sleep 5
done

if [ "${HEALTHY}" = true ]; then
  log "OpenClaw is healthy and running on port 8080"
else
  warn "OpenClaw health check did not pass within 60s — check logs with: docker logs snac_openclaw"
fi

log "Installation complete."
echo ""
echo "  OpenClaw endpoint:  http://${VPS_HOST}:8080"
echo "  Health check:       http://${VPS_HOST}:8080/health"
echo "  Config:             ${CONFIG_DST}"
echo "  Compose file:       ${COMPOSE_FILE}"
echo "  Systemd unit:       ${SYSTEMD_UNIT}"
echo ""
echo "  Useful commands:"
echo "    docker logs snac_openclaw           # View logs"
echo "    systemctl restart openclaw          # Restart service"
echo "    ${COMPOSE_CMD} -f ${COMPOSE_FILE} down  # Stop containers"
