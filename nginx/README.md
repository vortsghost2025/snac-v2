SNAC Cockpit Nginx
===================

Instructions to deploy the nginx configuration contained in `snac_cockpit.conf` to a VPS running the backend.

Quick deploy (on the VPS):

1. Copy `snac_cockpit.conf` to `/etc/nginx/sites-available/snac_cockpit.conf`.
2. Enable it: `sudo ln -sf /etc/nginx/sites-available/snac_cockpit.conf /etc/nginx/sites-enabled/snac_cockpit.conf`.
3. Test and reload nginx:

```
sudo nginx -t
sudo systemctl reload nginx
```

4. Open ports in firewall or provider security group: allow 80 and 443. Prefer provider SG rules over opening arbitrary high ports.

TLS / Certbot (optional):

```
sudo apt update && sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d snac.deliberatefederation.cloud
```

Notes:
- The config expects the cockpit frontend on `localhost:8000` and backend API on `localhost:8001`.
- If your docker maps different host ports, adjust the `proxy_pass` destinations accordingly.
