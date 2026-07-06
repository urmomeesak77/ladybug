# Leftbar Navigation (prototype parity) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the primary navigation from the sticky header into a prototype-style fixed left sidebar with inline SVG icons; the header keeps only the centered logo.

**Architecture:** `NavMenu.tsx` is replaced by `LeftMenu.tsx` (prototype vocabulary): the same auth-aware `<nav aria-label="Primary">`, rendered as a fixed 200px rail with 25×25 flat-polygon SVG icons copied from / drawn in the style of the prototype (`C:\projects\trash\resources\js\components\LeftMenu.jsx`). `PageLayout.tsx` gains a centered `.main-container` div wrapping `<LeftMenu />` + `<main>`. All styling lands in `theme.css` using the existing color tokens so dark mode follows automatically.

**Tech Stack:** React 18 + TypeScript, react-router-dom `NavLink`, Vitest + Testing Library, Playwright e2e. No new dependencies (Constitution Principle I).

**Spec:** `docs/superpowers/specs/2026-07-06-leftbar-nav-design.md`

## Global Constraints

- No new npm dependencies — icons are in-house inline SVGs.
- `docs/CODING_CONVENTIONS.md` is binding: 2-space indent, semicolons, functions <50 lines, comments explain *why*.
- Coverage gate: Vitest line coverage ≥90% across ALL of `src/` (CI enforces via `.github/scripts/check_coverage.py`).
- A11y (Constitution Principle IV): current page never signalled by color alone; icons `aria-hidden` with the link text as accessible name; landmarks preserved.
- Anonymous nav = combined **Login/register** link → `/login`, then **Home** (prototype order). Authenticated nav = **Home, Upload, Account, Log out**.
- Below 800px the leftbar is `display: none` with full-width content (user-accepted prototype parity trade-off).
- All frontend commands run from `frontend/`: `npm test`, `npm run lint`, `npx vitest run --coverage`.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Do NOT commit the pre-existing unrelated `frontend/src/styles/theme.css` working-copy change (`.auth-form__link` margin) as part of Task 1 or 2 — it is already in the file and belongs to other work; only stage it in Task 3 where theme.css is edited anyway (it will ride along there; that is acceptable per the user).

---

### Task 1: `LeftMenu` component (replaces `NavMenu` behaviorally)

**Files:**
- Create: `frontend/src/components/LeftMenu.tsx`
- Test: `frontend/tests/components/LeftMenu.test.tsx`

**Interfaces:**
- Consumes: `useAuth()` from `src/hooks/useAuth` (`{ status, user, logout }`, statuses `'unknown' | 'anonymous' | 'authenticated'`) — already exists.
- Produces: default export `LeftMenu(): JSX.Element` — a `<nav id="left-menu" aria-label="Primary">`; Task 2 imports it in `PageLayout`. CSS contract for Task 3: `#left-menu`, `.left-menu__logout`, `svg.left-menu-icon`, `rect.left-menu-icon-bg`.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/components/LeftMenu.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import LeftMenu from '../../src/components/LeftMenu';
import { AuthContext } from '../../src/hooks/useAuth';
import type { AuthContextValue } from '../../src/hooks/useAuth';
import type { AuthUser } from '../../src/lib/authApi';

afterEach(cleanup);

const user: AuthUser = {
  id: 1,
  name: 'Ada',
  email: 'ada@example.com',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

function authValue(overrides: Partial<AuthContextValue>): AuthContextValue {
  return {
    status: 'anonymous',
    user: null,
    register: vi.fn(),
    login: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// Surfaces the current route so navigation side effects are observable.
function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

function renderMenu(value: AuthContextValue, initialPath = '/account') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthContext.Provider value={value}>
        <LeftMenu />
        <LocationProbe />
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

describe('LeftMenu', () => {
  it('offers a combined Login/register entry plus Home to anonymous visitors', () => {
    renderMenu(authValue({ status: 'anonymous' }));

    const login = screen.getByRole('link', { name: 'Login/register' });
    expect(login.getAttribute('href')).toBe('/login');
    expect(screen.getByRole('link', { name: 'Home' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Upload' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Account' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Log out' })).toBeNull();
  });

  it('treats an unresolved session like anonymous so authed items never flash', () => {
    renderMenu(authValue({ status: 'unknown' }));

    expect(screen.getByRole('link', { name: 'Login/register' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Account' })).toBeNull();
  });

  it('offers Home, Upload, Account and Log out to authenticated users', () => {
    renderMenu(authValue({ status: 'authenticated', user }));

    expect(screen.getByRole('link', { name: 'Home' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Upload' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Account' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Log out' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Login/register' })).toBeNull();
  });

  it('logs out and navigates home', async () => {
    const value = authValue({ status: 'authenticated', user });
    renderMenu(value, '/account');

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));

    expect(await screen.findByText('/')).toBeTruthy();
    expect(value.logout).toHaveBeenCalledTimes(1);
  });

  it('marks every icon decorative so link names stay clean', () => {
    const { container } = renderMenu(authValue({ status: 'authenticated', user }));

    const icons = container.querySelectorAll('svg.left-menu-icon');
    expect(icons.length).toBe(4);
    for (const icon of icons) {
      expect(icon.getAttribute('aria-hidden')).toBe('true');
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `frontend/`): `npx vitest run tests/components/LeftMenu.test.tsx`
Expected: FAIL — cannot resolve `../../src/components/LeftMenu`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/components/LeftMenu.tsx`:

```tsx
import type { ReactElement } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';

import { useAuth } from '../hooks/useAuth';

type MenuGlyph = 'home' | 'person' | 'upload' | 'logout';

// Prototype-style flat glyphs on a 25x25 grid. House and person are copied verbatim
// from the prototype's LeftMenu; upload (arrow into tray) and logout (door + arrow)
// are drawn in the same style so the set reads as one family.
const GLYPHS: Record<MenuGlyph, ReactElement> = {
  home: (
    <g>
      <polygon points="3,14 13,5 22,14" />
      <polygon points="17,5 18,5 18,14 17,14" />
      <polygon points="5,25 5,14 20,14 20,25 18,25 18,18 12,18 12,25" />
    </g>
  ),
  person: (
    <g>
      <circle cx="13" cy="10" r="6" />
      <ellipse cx="13" cy="25" rx="12" ry="5" />
    </g>
  ),
  upload: (
    <g>
      <polygon points="13,3 20,11 16,11 16,17 10,17 10,11 6,11" />
      <polygon points="3,16 5,16 5,21 21,21 21,16 23,16 23,23 3,23" />
    </g>
  ),
  logout: (
    <g>
      <polygon points="4,3 14,3 14,8 12,8 12,5 6,5 6,20 12,20 12,17 14,17 14,22 4,22" />
      <polygon points="15,8 22,12 15,17 15,14 9,14 9,11 15,11" />
    </g>
  ),
};

// Decorative only: the adjacent link/button text is the accessible name (Principle IV).
function MenuIcon({ glyph }: { glyph: MenuGlyph }) {
  return (
    <svg className="left-menu-icon" viewBox="0 0 25 25" aria-hidden="true" focusable="false">
      <rect x="0" y="0" rx="5" ry="5" width="25" height="25" className="left-menu-icon-bg" />
      {GLYPHS[glyph]}
    </svg>
  );
}

// Prototype order: the login entry sits above Home for anonymous visitors.
function AnonymousLinks() {
  return (
    <>
      <li>
        <NavLink to="/login">
          <MenuIcon glyph="person" />
          Login/register
        </NavLink>
      </li>
      <li>
        <NavLink to="/" end>
          <MenuIcon glyph="home" />
          Home
        </NavLink>
      </li>
    </>
  );
}

function AuthenticatedLinks({ onLogout }: { onLogout: () => void }) {
  return (
    <>
      <li>
        <NavLink to="/" end>
          <MenuIcon glyph="home" />
          Home
        </NavLink>
      </li>
      <li>
        <NavLink to="/upload">
          <MenuIcon glyph="upload" />
          Upload
        </NavLink>
      </li>
      <li>
        <NavLink to="/account">
          <MenuIcon glyph="person" />
          Account
        </NavLink>
      </li>
      <li>
        <button type="button" className="left-menu__logout" onClick={onLogout}>
          <MenuIcon glyph="logout" />
          Log out
        </button>
      </li>
    </>
  );
}

// Primary navigation as the prototype's left menu, auth-aware (FR-011): anonymous
// visitors get a combined Login/register entry; authenticated visitors get Upload,
// Account and a working Log out control. `unknown` (session check in flight) renders
// as anonymous so authed-only items never flash.
function LeftMenu() {
  const { status, user, logout } = useAuth();
  const navigate = useNavigate();
  const isAuthenticated = status === 'authenticated' && user !== null;

  async function handleLogout(): Promise<void> {
    await logout();
    navigate('/');
  }

  return (
    <nav id="left-menu" aria-label="Primary">
      <ul>
        {isAuthenticated ? (
          <AuthenticatedLinks onLogout={() => void handleLogout()} />
        ) : (
          <AnonymousLinks />
        )}
      </ul>
    </nav>
  );
}

export default LeftMenu;
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `frontend/`): `npx vitest run tests/components/LeftMenu.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Lint and commit**

Run (from `frontend/`): `npm run lint`
Expected: clean.

```bash
git add frontend/src/components/LeftMenu.tsx frontend/tests/components/LeftMenu.test.tsx
git commit -m "feat(nav): prototype-style LeftMenu with inline SVG icons

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Note: `NavMenu.tsx` still exists and is still used by `PageLayout` at this point — the build stays green; Task 2 swaps it out and deletes it.

---

### Task 2: `PageLayout` restructure + `NavMenu` removal

**Files:**
- Modify: `frontend/src/components/PageLayout.tsx`
- Delete: `frontend/src/components/NavMenu.tsx`, `frontend/tests/components/NavMenu.test.tsx`
- Test: `frontend/tests/components/PageLayout.test.tsx`

**Interfaces:**
- Consumes: `LeftMenu` default export from Task 1.
- Produces: layout DOM for Task 3's CSS — `<header>` containing only `.site-logo`, then `<div class="main-container">` wrapping `<nav id="left-menu">` and `<main>`.

- [ ] **Step 1: Extend the PageLayout test (failing first)**

In `frontend/tests/components/PageLayout.test.tsx`, add inside `describe('PageLayout', ...)` after the existing `'provides banner and navigation landmarks'` test:

```tsx
  it('keeps the header to the logo only; primary nav lives in the left menu', () => {
    renderLayout();

    const header = screen.getByRole('banner');
    expect(header.querySelectorAll('a')).toHaveLength(1);

    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(header.contains(nav)).toBe(false);
    expect(nav.closest('.main-container')).not.toBeNull();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `frontend/`): `npx vitest run tests/components/PageLayout.test.tsx`
Expected: FAIL on the new test — the header currently contains the nav (and its Login/Register links), so `querySelectorAll('a')` is 3 and `header.contains(nav)` is true.

- [ ] **Step 3: Rewrite `PageLayout.tsx`**

Replace the whole file with:

```tsx
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import LeftMenu from './LeftMenu';

// Shared shell every route mounts inside: a logo-only header (the prototype's
// top-menu), then a centered container holding the fixed left menu and the routed
// view in the <main> landmark. Landmarks (<header>/<nav>/<main>) give assistive tech
// a navigable page structure (Principle IV). The logo links home so it doubles as a
// logo-home affordance; <picture> swaps the logo art per color scheme so the wordmark
// stays legible in both themes (Principle IV); the <img> alt names the site.
function PageLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <header>
        <Link to="/" className="site-logo">
          <picture>
            <source srcSet="/logo-dark.png" media="(prefers-color-scheme: dark)" />
            <img src="/logo-light.png" alt="online-trash home" />
          </picture>
        </Link>
      </header>
      <div className="main-container">
        <LeftMenu />
        <main>{children}</main>
      </div>
    </>
  );
}

export default PageLayout;
```

- [ ] **Step 4: Delete the superseded component and its test**

```bash
git rm frontend/src/components/NavMenu.tsx frontend/tests/components/NavMenu.test.tsx
```

(If other files still import `NavMenu`, the next step's test run will fail the build — `PageLayout` was its only consumer; verify with `grep -r "NavMenu" frontend/src frontend/tests`, expected: no hits.)

- [ ] **Step 5: Run the full unit suite with coverage**

Run (from `frontend/`): `npx vitest run --coverage`
Expected: PASS, all suites; line coverage ≥90% (LeftMenu is fully covered by its own suite, NavMenu and its tests are gone).

- [ ] **Step 6: Lint and commit**

Run (from `frontend/`): `npm run lint`
Expected: clean.

```bash
git add frontend/src/components/PageLayout.tsx frontend/tests/components/PageLayout.test.tsx
git commit -m "feat(nav): move primary nav into the left menu; logo-only header

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(The `git rm` from Step 4 is already staged and lands in this commit.)

---

### Task 3: Leftbar CSS (theme.css)

**Files:**
- Modify: `frontend/src/styles/theme.css` (header block ~88–143, nav rules ~145–170, `.nav-logout` ~380–390, `:root` tokens ~4–26, dark-mode token block ~71–81)

**Interfaces:**
- Consumes: the class/id contract from Tasks 1–2: `#left-menu`, `.left-menu__logout`, `svg.left-menu-icon`, `rect.left-menu-icon-bg`, `.main-container`, logo-only `header`.
- Produces: nothing consumed by later tasks (Task 4 verifies).

- [ ] **Step 1: Add the hover token to both scheme blocks**

In `:root`, after `--color-focus: #1a73e8;` add:

```css
  /* Prototype leftbar hover wash (black-on-light, white-on-dark). */
  --color-menu-hover: rgb(0 0 0 / 10%);
```

In the `@media (prefers-color-scheme: dark)` `:root` block, after `--color-focus: #7cb0ff;` add:

```css
    --color-menu-hover: rgb(255 255 255 / 10%);
```

- [ ] **Step 2: Simplify the header block**

Replace the current header comment + rule (the block starting `/* Site header: centered logo + nav. ...` through the closing brace of `header { ... }`) with:

```css
/* Site header: just the centered logo (the prototype's top-menu). Sticky so it stays
   reachable while scrolling the feed (Principle IV). */
header {
  position: sticky;
  top: 0;
  z-index: 10;
  min-height: 70px;
  padding: var(--space-md);
  border-bottom: 1px solid var(--color-border);
  background-color: var(--color-surface);
}
```

Then DELETE the now-pointless `@media (max-width: 35rem)` block (comment starting `/* Below ~560px the absolutely-centered 250px logo and the right-aligned nav links ...` through its closing `}`) — with the nav gone nothing can collide with the logo. Keep the `.site-logo` rules unchanged.

- [ ] **Step 3: Replace the top-nav rules with the leftbar layout**

Replace everything from `nav ul {` (line ~145) through the end of the `main { ... }` rule (line ~170) — i.e. the `nav ul`, `nav a`, `nav a[aria-current='page']` and `main` rules plus their comments — with:

```css
/* Centered page container (prototype .main-container): the fixed left menu pins to
   this container's left edge; the extra 210px keeps the content column at the width
   it had before the leftbar arrived. */
.main-container {
  max-width: calc(var(--layout-max-width) + 210px);
  margin-inline: auto;
}

/* Prototype left menu: a 200px rail. position:fixed without offsets keeps the
   element at its static position (below the header, at the container's left edge)
   but stops it scrolling with the page — the prototype's trick. */
#left-menu {
  position: fixed;
  width: 200px;
  min-height: 60px;
  padding: 10px 5px 0 0;
  overflow: hidden;
}

#left-menu ul {
  list-style: none;
  margin: 0;
  padding: 0;
}

#left-menu a,
.left-menu__logout {
  display: inline-block;
  width: 90%;
  margin: 0 0 15px 0;
  padding: 0;
  border-radius: 3px;
  font-weight: 700;
  color: var(--color-text);
  text-decoration: none;
  vertical-align: middle;
}

/* The logout control is a button; strip the chrome so it reads like its link siblings. */
.left-menu__logout {
  font: inherit;
  font-weight: 700;
  text-align: left;
  background: none;
  border: 0;
  cursor: pointer;
}

#left-menu a:hover,
.left-menu__logout:hover {
  background-color: var(--color-menu-hover);
}

/* Current page: entries are already bold, so the underline carries the non-color
   signal (Principle IV / FR-011). aria-current is set by NavLink for assistive tech. */
#left-menu a[aria-current='page'] {
  text-decoration: underline;
  text-underline-offset: 0.25rem;
}

/* Prototype icon treatment: glyph and rounded backdrop both take the text color at
   different opacities, so they follow the scheme tokens with no extra dark rules. */
svg.left-menu-icon {
  width: 25px;
  height: 25px;
  margin: 0 5px 0 0;
  vertical-align: middle;
  border-radius: 5px;
}

svg.left-menu-icon g {
  fill: var(--color-text);
  stroke: var(--color-text);
  opacity: 0.5;
}

svg.left-menu-icon rect.left-menu-icon-bg {
  fill: var(--color-text);
  opacity: 0.2;
}

main {
  margin-left: 210px;
  padding: var(--space-md);
}

/* Prototype parity below 800px: the leftbar disappears and content goes full width
   (accepted trade-off — 2026-07-06 leftbar design spec). */
@media (max-width: 50rem) {
  #left-menu {
    display: none;
  }

  main {
    margin-left: 0;
  }
}
```

(Note `main` loses `max-width`/`margin-inline: auto` — `.main-container` now owns centering and width.)

- [ ] **Step 4: Delete the dead `.nav-logout` rule**

Delete the block (comment + rule):

```css
/* Nav logout is a text-style button so it sits inline with the nav links. */
.nav-logout {
  font: inherit;
  color: var(--color-text);
  background: none;
  border: 0;
  padding: 0;
  text-decoration: underline;
  text-underline-offset: 0.25rem;
  cursor: pointer;
}
```

- [ ] **Step 5: Run unit suite + lint (regression check)**

Run (from `frontend/`): `npx vitest run && npm run lint`
Expected: PASS / clean (CSS has no unit tests; this catches accidental TS/test fallout).

- [ ] **Step 6: Visual check in the running app**

The dev stack serves the frontend via Docker; after CSS/TSX edits Vite may serve stale output after merges — if the UI looks pre-change, run `docker compose restart frontend`. Load the site, confirm: leftbar with icons at desktop width (anonymous: Login/register + Home), content offset; below 800px the leftbar hides and content is full width; dark and light schemes both render icon glyphs legibly. Use the `verify` skill / `run` skill if a screenshot is wanted.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/styles/theme.css
git commit -m "feat(nav): prototype leftbar styling; logo-only header CSS

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(This commit also carries the pre-existing one-line `.auth-form__link` margin tweak already sitting in the working copy — intentional, see Global Constraints.)

---

### Task 4: Full-gate verification (unit, coverage, lint, e2e)

**Files:** none (verification only)

**Interfaces:**
- Consumes: everything above.
- Produces: green gates; evidence for completion claims.

- [ ] **Step 1: Frontend unit suite with coverage**

Run (from `frontend/`): `npx vitest run --coverage`
Expected: all tests PASS; line coverage ≥90% overall (the CI gate `.github/scripts/check_coverage.py` reads the Clover report).

- [ ] **Step 2: ESLint**

Run (from `frontend/`): `npm run lint`
Expected: clean exit.

- [ ] **Step 3: Playwright e2e against the isolated stack**

Run (from repo root): `scripts\e2e.ps1`
Expected: `auth.spec.ts`, `feed.spec.ts`, `logo-parity.spec.ts`, `upload.spec.ts` all PASS. Rationale for no spec edits: Playwright role-name matching is substring + case-insensitive, so `link { name: 'Login' }` matches the new "Login/register" link, and the 1280×720 default viewport keeps the leftbar visible. If a spec fails on a selector, fix the selector to target the leftbar equivalent — do not weaken assertions.

- [ ] **Step 4: Report**

State plainly what passed/failed with the actual output. If anything failed, stop and fix before claiming completion (superpowers:verification-before-completion).

No commit in this task unless fixes were needed (then: fix, re-run the failed gate, commit with a `fix(nav): ...` message).
