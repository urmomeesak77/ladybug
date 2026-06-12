# Ladybug Frontend

React 18 + Vite (TypeScript) SPA for the Ladybug meme-sharing site. It renders the Home
feed by consuming the backend read API (`GET /api/posts`) — an endless, newest-first feed
with infinite scroll, a 200-entry "Load more" page break, shareable/refresh-safe URLs,
system-theme support, and a responsive, accessible layout.

## Prerequisites

- **Node.js** (see `node --version`; developed against Node 24).
- **Backend running and reachable**, serving `GET /api/posts` (feature 004) with seeded,
  visible posts and their image tree. Per project convention the backend runs via the
  `php:8.3-cli` Docker setup; populated data lives in the host MySQL `trash` DB.

## Setup

```bash
cd frontend
npm install                 # installs deps, including react-router-dom
cp .env.example .env        # then edit VITE_API_BASE_URL if needed
```

`.env` configures the API origin the SPA talks to (`.env` itself is uncommitted):

```
VITE_API_BASE_URL=http://localhost:8000
```

Ensure the backend's CORS allows the dev SPA origin (Vite default `http://localhost:5173`).

## Develop

```bash
npm run dev                 # http://localhost:5173 (Vite dev server, HMR)
```

## Verify

```bash
npm run lint                # ESLint (must be clean — Principle II)
npm run test                # Vitest: pure src/lib logic
npx vitest run --coverage   # coverage report (src/lib gated at >=90%)
```

Coverage is scoped to `src/lib/**` (the branching logic); React components/hooks are thin
glue and stay outside the coverage scope. See
[`../specs/005-frontend-mainpage/quickstart.md`](../specs/005-frontend-mainpage/quickstart.md)
for the full manual verification checklist.

## Build

```bash
npm run build               # type-check (tsc -b) + production bundle to dist/
npm run preview             # serve the built bundle locally
```

## Layout

```
src/
  lib/          pure logic (api, feedModel, youtube, pagination, theme) — coverage-scoped
  hooks/        useFeed, usePost, useTheme
  components/   PageLayout, NavMenu, Feed, FeedItem, MemeMedia, states/
  pages/        HomePage, PostPage, NotFoundPage
  styles/       theme.css (light + prefers-color-scheme: dark tokens, responsive layout)
tests/lib/      Vitest unit tests mirroring src/lib
```
