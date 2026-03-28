#!/bin/bash
set -euo pipefail

# Copy local nginx config into place and reload nginx (run on VPS)
CONF_SRC="$(dirname "$0")/../nginx/snac_cockpit.conf"
sudo cp "$CONF_SRC" /etc/nginx/sites-available/snac_cockpit.conf
sudo ln -sf /etc/nginx/sites-available/snac_cockpit.conf /etc/nginx/sites-enabled/snac_cockpit.conf
sudo nginx -t
sudo systemctl reload nginx

echo "nginx config deployed and reloaded"
