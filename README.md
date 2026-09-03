# Fantasy Edge

Fantasy Edge is a centrally hosted fantasy-football intelligence application built around RTSports data.

## Architecture

- `extension/` — authenticated RTSports browser collector
- `shared/` — platform-neutral player models and lineup optimizer
- `web/` — React dashboard
- `worker/` — Cloudflare Worker API
- `wrangler.jsonc` — Cloudflare deployment configuration

RTSports does not provide a public API, so the browser extension acts as the authenticated sync bridge. Once data is synchronized, the hosted Fantasy Edge dashboard can be accessed from any device.

## Hosted app

```bash
npm install
npm run dev
npm run typecheck
npm run build
npm run deploy
```

The production deployment is designed for Cloudflare Workers with static assets. API routes are served from `/api/*` and React handles the application UI.

## Current milestone

The hosted React shell and Worker health API are in place. The next milestone is secure RTSports synchronization and persistent Cloudflare D1 storage.
