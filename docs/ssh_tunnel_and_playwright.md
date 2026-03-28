# SSH tunnel and Playwright testing

Use an SSH tunnel to forward the remote cockpit/backend to your local machine for testing.

On your workstation (keep this shell open while testing):

```
# forward remote cockpit (host:8000) to local:8000
ssh -L 8000:localhost:8000 user@snac.deliberatefederation.cloud -N

# OR forward backend API (host:8001) to local:8001
ssh -L 8001:localhost:8001 user@snac.deliberatefederation.cloud -N
```

Then run Playwright helper locally (from `backend`):

```
TARGET_URL=http://localhost:8000 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 node try-playwright.js
```

If Playwright needs browsers and you cannot download them globally, install a local copy or run Playwright on the VPS where browsers can be installed.
