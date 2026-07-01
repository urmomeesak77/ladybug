# Quickstart: Trashpost Page (Single Meme View)

**Feature**: 006-trashpost-page

How to run the stack and validate this feature end-to-end. Contracts:
[routes](./contracts/routes.md), [API consumption](./contracts/post-api-consumption.md),
[components](./contracts/components.md); states: [data-model](./data-model.md).

## Prerequisites

- Docker Desktop running (there is no local PHP/Node toolchain requirement — both apps
  run in containers via the repo's `docker-compose.yml`).
- Real media + storage tree bind-mounted from `C:\docker_permanent\ladybug-storage` (already configured).
- The database populated with visible posts (the imported prototype data), including at
  least one image post and one YouTube post.

## Run

```powershell
docker compose up -d
```

- Frontend (Vite dev server): http://localhost:5173
- Backend API: http://localhost:8000 (probe: `GET /api/health`)

After PHP edits, `docker compose restart backend` (opcache pins timestamps); after git
merges/checkouts, `docker compose restart frontend` (stale Vite cache).

## Automated checks

```powershell
# Frontend unit tests + coverage gate (src/lib ≥ 90%)
docker compose exec frontend npm test -- --coverage

# Frontend lint
docker compose exec frontend npm run lint
```

Expected: all Vitest suites pass, including the new `tests/lib/postModel.test.ts` and the
extended `tests/lib/api.test.ts`; coverage of `src/lib/**` stays ≥ 90%.

## Manual validation scenarios

Grab a real image-post hash and a YouTube-post hash first, e.g.:

```powershell
# newest posts, note a "hash" of an image post (sizes non-empty) and a youtube post
curl http://localhost:8000/api/posts?limit=10
```

### US1 — permalink renders the meme (P1)

1. Open `http://localhost:5173/posts/{imageHash}` in a fresh tab → title + image render
   inside the site header/menu; image scales to the column, keeps aspect ratio, and is
   **not** clickable (display-only).
2. Open `http://localhost:5173/posts/{youtubeHash}` → embedded YouTube player renders,
   scaled to the container, and plays.
3. From the home feed, click an entry → the same meme's page (no placeholder).

### US2 — not-found and failure (P2)

1. Open `/posts/AAAAAAAAAA` (unknown code) → not-found view with a working "Back to the
   feed" link; no blank page or raw error.
2. Simulate failure: stop the backend (`docker compose stop backend`), open a valid
   `/posts/{hash}` → error state with a Retry button (distinct from not-found). Start the
   backend again, click Retry → the meme loads in place (no full reload, no stale error
   text).
3. Throttle the network in DevTools and load a meme → a loading indication shows; the
   not-found view never flashes first.

### US3 — browser-native navigation (P2)

1. Scroll the feed several batches, open a meme → the meme page starts at the **top**.
2. Press Back → feed returns at the prior scroll position (005 behavior intact).
3. Press Forward → the meme page returns.
4. Refresh on the meme page → same meme re-renders from the URL alone.
5. Tab title reads `{meme title} - online-trash` (untitled meme → `online-trash`).
6. Click "Home" in the menu → home feed.

### US4 — responsive, themed, accessible (P3)

1. DevTools responsive mode at 320px, ~768px, wide desktop → no horizontal scrolling,
   clipping, or overlap; media scales within the column.
2. Toggle OS/emulated `prefers-color-scheme` light↔dark → page follows.
3. Inspect the image: non-empty `alt` (title, or "Meme image" when untitled); traverse
   with keyboard: nav links, the Retry button, and the not-found home link are reachable
   and labeled.

## Success criteria spot-checks

- SC-001: meme permalink renders title + media ≤ 2s on the dev stack.
- SC-002/004: every dead code → not-found with home link; every feed entry → correct meme.
- SC-003: Back/Forward/Refresh sequences behave per US3 above.
- SC-008: loading, error+retry, and not-found are each reachable and visibly distinct.
