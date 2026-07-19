# Production deployment

## Recommended topology

Use one permanent HTTPS domain, for example `https://watch.example.com`, for the built web client and signaling server. The WebSocket endpoint is `wss://watch.example.com/ws`. A separate TURN service is required for reliable connectivity across strict NATs.

## Environment

Copy `.env.example` into the secret configuration of the hosting provider. Do not commit the real values.

Required for a reliable deployment:

```text
ALLOWED_ORIGINS=https://watch.example.com
TURN_URLS=turn:turn.example.com:3478,turns:turn.example.com:5349
TURN_SHARED_SECRET=<same shared secret configured in coturn>
```

Optional operational settings are documented in `.env.example`. The browser build automatically uses its own HTTPS origin. Build the desktop release with:

```powershell
$env:VITE_SIGNALING_URL='wss://watch.example.com/ws'
$env:VITE_PUBLIC_APP_URL='https://watch.example.com'
npm run desktop:package
```

## Render

`render.yaml` builds both workspaces and starts the combined server. Create a Render Blueprint from the repository, add the TURN and origin environment values, then attach the permanent custom domain. Verify:

```text
GET https://watch.example.com/healthz  -> 200
GET https://watch.example.com/readyz   -> 200
WSS wss://watch.example.com/ws         -> 101 upgrade
```

Render free instances can sleep and are not ideal for always-on realtime sessions. Use an always-on plan/provider for production.

## Docker

```bash
docker build -t watch-together .
docker run --rm -p 8787:8787 --env-file .env watch-together
```

Terminate TLS at the hosting load balancer or reverse proxy and forward WebSocket upgrades to port 8787.

## GitHub Pages alternative

The Pages workflow remains available for a split frontend/backend deployment and creates a `404.html` SPA fallback. Configure repository variables `VITE_SIGNALING_URL` and `VITE_PUBLIC_APP_URL`. The combined-origin deployment is simpler and is the documented default.

## What is still needed from the owner

1. A hosting account/project with an always-on Node.js service or container.
2. A permanent domain or provider subdomain with HTTPS/WSS.
3. A TURN service (for example coturn), its public URLs and shared secret.
4. The exact allowed production origin.
5. Optional Windows code-signing certificate if the installer must avoid unsigned-publisher warnings.

No account credentials belong in the repository. Once these values exist, code changes are not required; deployment and the desktop build use environment configuration.
