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

## D1 binding

Create a Cloudflare D1 database for Fantasy Edge and bind it to the Worker with the variable name `DB`. The Worker initializes the roster-sync schema automatically on first use, so no manual SQL migration is required for the initial sync milestone.

## Current milestone

The hosted React dashboard, extension download, RTSports sync transport, Worker API, and D1-backed roster persistence are wired together. The next milestone is validating the first live RTSports roster sync and then adding secure extension pairing plus broader league data collection.

Cloudflare production builds are connected to the `main` branch so approved repository updates automatically publish the hosted application and current extension package.
