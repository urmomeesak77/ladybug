# Quickstart: Frontend Mainpage

Validate the Home feed end-to-end: it renders the newest memes from the live feed API,
pages correctly (infinite scroll + 200-entry "Load more"), survives Back/Forward/Refresh,
follows the system theme, and is responsive/accessible. See
[contracts/](./contracts/) and [data-model.md](./data-model.md) for shapes; implementation
detail belongs in `tasks.md`.

## Prerequisites

- Backend running and reachable, serving `GET /api/posts` (feature 004) with seeded,
  visible posts and their image tree. Per project convention, run the backend via the
  `php:8.3-cli` Docker setup; populated data lives in the host MySQL `trash` DB.
- `frontend/` deps installed, **including the newly added `react-router-dom`**:
  ```bash
  cd frontend
  npm install            # picks up react-router-dom from package.json
  ```
- `frontend/.env` with the API origin (copy from `.env.example`):
  ```bash
  cp .env.example .env    # VITE_API_BASE_URL=http://localhost:8000
  ```
  Ensure the backend's API CORS allows the dev SPA origin (Vite default
  `http://localhost:5173`).

## Automated tests (primary validation)

Run from `frontend/`:

```bash
npm run lint
npm run test            # vitest: pure src/lib logic
```

Coverage gate (CI parity): Vitest coverage is scoped to `src/lib/**` and must stay ≥90%.
New `tests/lib/*.test.ts` cover (write first — TDD):

- `api.test.ts` — `buildFeedUrl` clamps/defaults `limit`, omits/encodes `start`;
  `fetchFeed` maps `data[]` and classifies HTTP/network errors.
- `feedModel.test.ts` — media precedence (youtube→image→none), srcset assembly,
  non-empty `alt`, no fabricated URLs, null-`file` ⇒ `none`/title-only.
- `pagination.test.ts` — cursor = last `hash`; page break at exactly 200; end detection
  on short/empty batch; in-flight guard prevents duplicate loads.
- `youtube.test.ts` — valid id/URL forms → `youtube-nocookie` embed; junk → `null`.
- `theme.test.ts` — `prefersDark`/`watchScheme` over a mocked `matchMedia`.

## Manual verification (Principle: manual gate)

Run the app:

```bash
cd frontend && npm run dev      # http://localhost:5173
```

1. **Feed loads** (US1/SC-001): Home shows the newest memes with titles + media (image or
   YouTube) within ~2s.
2. **Infinite scroll** (US1/SC-002): scrolling appends the next 10 newest-first, no
   duplicates/gaps; rapid scroll triggers no duplicate requests (watch the network panel).
3. **Page break** (FR-004): after 200 entries auto-loading stops and "Load more" appears;
   clicking it advances the URL to `/?after=<hash>` and loads the next page.
4. **Deep link / refresh** (US2/SC-003): copy `/?after=<hash>` into a new tab and refresh
   — the same page is restored, not the newest.
5. **Back/Forward** (US2/SC-004): navigate pages, then Back/Forward — correct view/scroll
   restored.
6. **Permalink** (FR-007): clicking a meme navigates to `/posts/{hash}` (placeholder page
   for now).
7. **Media** (FR-008/FR-009): an image post scales to its container (right `srcset` size
   per viewport); a YouTube post plays in an embedded iframe; a broken/unparseable case
   degrades to title-only (no broken element).
8. **Theme** (US3/SC-006): toggle OS dark/light — the page follows it.
9. **Responsive** (US3/SC-005): at ~320px, tablet, and wide desktop — no horizontal
   scroll, clipping, or overlap; menu + feed reflow.
10. **Accessibility** (US3/SC-007): every image has non-empty `alt`; nav/links reachable
    and labeled by keyboard; tab order sane; status (loading/end/error) announced.
11. **States** (FR-013/SC-008): simulate an API failure (stop backend / block the
    request) mid-scroll — Error + Retry shows while loaded items remain; empty DB ⇒ empty
    state; end of data ⇒ end-of-feed message (no endless spinner).

## Expected outcome

All automated suites green with `src/lib` coverage ≥90%; all manual checks pass against
the live API. No new runtime dependency beyond `react-router-dom`.
