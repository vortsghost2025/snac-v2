#!/bin/bash
# SSL Certificate Setup for Hostinger VPS
# Run as: sudo bash setup-ssl.sh

set -e

DOMAIN="deliberatefederation.cloud"
EMAIL="admin@deliberatefederation.cloud"
CERT_PATH="/etc/letsencrypt/live/${DOMAIN}"
NGINX_CONTAINER="snac_nginx"

echo "=== SSL Certificate Setup for ${DOMAIN} ==="

# Check if certbot is installed
if ! command -v certbot &> /dev/null; then
    echo "Installing certbot..."
    apt-get update
    apt-get install -y certbot python3-certbot-nginx
fi

# Stop nginx to use port 80 for certbot
echo "Stopping nginx..."
docker stop ${NGINX_CONTAINER} || true

# Obtain SSL certificate
echo "Obtaining SSL certificate..."
certbot certonly --standalone \
    --domain ${DOMAIN} \
    --domain orchestrator.${DOMAIN} \
    --domain api.${DOMAIN} \
    --domain agent.${DOMAIN} \
    --email ${EMAIL} \
    --agree-tos \
    --non-interactive

# Restart nginx
echo "Starting nginx..."
docker start ${NGINX_CONTAINER} || systemctl start nginx

echo "=== Certificate obtained ==="
echo "Certificate path: ${CERT_PATH}"
echo "Full chain: ${CERT_PATH}/fullchain.pem"
echo "Private key: ${CERT_PATH}/privkey.pem"

# Setup auto-renewal
echo "Setting up auto-renewal..."
(crontab -l 2>/dev/null || echo "") | grep -v certbot > /tmp/current_cron
echo "0 0 * * * certbot renew --quiet --deploy-hook 'docker exec ${NGINX_CONTAINER} nginx -s reload'" >> /tmp/current_cron
crontab /tmp/current_cron
echo "Auto-renewal added to crontab"

echo "=== SSL Setup Complete ==="
