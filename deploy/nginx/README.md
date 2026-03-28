Deploy cockpit proxy (nginx)
=====================================

This folder contains a small helper to run an nginx proxy that exposes `cockpit` on
port 443 so external E2E (Playwright) tests can reach it when provider firewall
blocks other ports.

Files
- `cockpit-proxy.conf` — nginx configuration (should already be present)
- `run_proxy_docker.sh` — helper script to run nginx in Docker

Usage

1. Ensure Docker is installed and you have `cockpit-proxy.conf` in this folder.
2. Edit `cockpit-proxy.conf` to point proxy_pass to your local cockpit service (typically `http://host.docker.internal:9090` or the host's internal IP).
3. If you need TLS, configure certificates in `cockpit-proxy.conf` or terminate TLS upstream.
4. Run:

```bash
cd deploy/nginx
./run_proxy_docker.sh
```

Notes
- If running on a remote host, ensure port 443 is open in the cloud provider firewall.
- For automatic TLS (Let's Encrypt), consider using Caddy or a certbot + nginx flow instead of this simple script.
