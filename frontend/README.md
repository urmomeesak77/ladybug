# Ladybug Frontend

React 18 + Vite (TypeScript) SPA for the Ladybug meme-sharing site, consuming the backend
JSON API. It covers the Home feed (endless, newest-first, infinite scroll with a 200-entry
"Load more" page break), single-meme permalinks, register/login/account with e-mail
verification, uploading, and the admin moderation console — all with shareable,
refresh-safe URLs, system-theme support, and a responsive, accessible layout.

## Prerequisites

- **Node.js** (see `node --version`; developed against Node 24).
- **Backend running and reachable**, serving the API with seeded, visible posts and their
  image tree. Per project convention the backend runs via the `php:8.3-cli` Docker setup;
  populated data lives in the host MySQL `trash` DB.

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
npm run test                # Vitest (jsdom): lib, hooks, components, pages
npx vitest run --coverage   # coverage report
```

Coverage spans **all** of `src/` — components, hooks and pages included, not just
`src/lib/` — gated at ≥90% lines (`vite.config.ts`). The one exclusion is `main.tsx`,
which mounts `<App/>` at import time and would boot the real app inside a test.

### End-to-end

Playwright specs live in `tests/e2e/` and run against an isolated, disposable stack, not
the dev one. Drive them from the repo root so the stack is booted and torn down for you:

```powershell
..\scripts\e2e.ps1                       # every spec
..\scripts\e2e.ps1 e2e/upload.spec.ts    # one spec
```

See [`../specs/005-frontend-mainpage/quickstart.md`](../specs/005-frontend-mainpage/quickstart.md)
for the full manual verification checklist.

## Build

```bash
npm run build               # type-check (tsc -b) + production bundle to dist/
npm run preview             # serve the built bundle locally
```

## Layout

```
src/
  lib/          pure logic — api, authApi, moderationApi, uploadApi, the *Model modules,
                pagination, scrollAnchor, feedCache, csrf, role, theme, youtube
  hooks/        useFeed, usePost, useAuth, useAuthForm, useUploadForm, useModeration,
                useNotice, useTheme, useScrollRestoration
  components/   PageLayout, LeftMenu, Feed, FeedItem, MemeMedia, UploadMediaField,
                AuthField, AuthProvider, NoticeProvider/NoticeDialog, ConfirmDialog,
                BusyButton, Require{Auth,Anon,Role,Verified}, moderation/, states/
  pages/        HomePage, PostPage, LoginPage, RegisterPage, AccountPage, UploadPage,
                VerifyEmailPage, VerifyEmailNoticePage, ModerationPage, NotFoundPage
  styles/       theme.css (light + prefers-color-scheme: dark tokens, responsive layout)
tests/          Vitest suites mirroring src/ (lib/, hooks/, components/, pages/)
tests/e2e/      Playwright specs + helpers, run against the isolated e2e stack
```

Every `lib/` module is a single class of `static` methods (`Api.fetchFeed`,
`Pagination.reducer`, `Csrf.token`) per `docs/CODING_CONVENTIONS.md` — call through the
class rather than re-introducing loose exported functions. React components and custom
hooks stay as functions; the rule applies to logic and helpers only.
