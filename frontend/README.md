# Avery frontend

React + TypeScript + Vite UI for Avery, a personal schedule agent.

## Setup

```bash
npm install
```

## Run

```bash
npm run dev
```

Starts the dev server on **http://localhost:5173**. Vite proxies `/api` requests to
**`127.0.0.1:8001`** (see `vite.config.ts`), so the app itself never needs an `API_URL`
of its own — it just talks to `/api` and the proxy forwards to the backend.

The backend must already be running on port 8001 (not 8000 — see `../backend/README.md`
for why) and must be seeded before the app has anything meaningful to show:

```bash
cd ../backend
arch -arm64 .venv/bin/python -m uvicorn app.main:app --port 8001
curl -s -X POST 127.0.0.1:8001/api/seed
```

With the backend down, pages should degrade to a readable message rather than a blank
screen or a raw error.

## Test

```bash
npx vitest run
```

Covers the datetime, geometry, drag, and rules suites — the pure-logic layer the views
are built on (`src/lib/datetime.test.ts`, `src/lib/geometry.test.ts`, `src/lib/drag.test.ts`,
`src/hooks/useRules.test.ts`). These run against plain Node, no backend required.

## Build

```bash
npm run build
```

Runs `tsc -b` then `vite build`.

## Theme

The entire color palette lives in `src/theme.css` as CSS custom properties. No hex
literals are permitted in components — reach for a token (e.g. `var(--color-accent)`)
instead of a raw color value, so the palette stays swappable from one file.
