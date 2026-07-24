# Mobile Nav Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give narrow viewports (≤ 50rem, where `#left-menu` is `display: none`) a top-left header toggle that opens the existing left menu as an overlay drawer and closes it four ways.

**Architecture:** A new `useNavDrawer` hook owns the open state plus its Escape / outside-pointerdown / focus effects. `PageLayout` calls the hook, renders the toggle inside `<header>`, and passes `open` / `panelRef` / `onNavigate` down to `LeftMenu`, which applies a `left-menu--open` class to the `<nav>` it already renders. All viewport-conditional behaviour is CSS: the class is only meaningful inside the existing `@media (max-width: 50rem)` block, so desktop is untouched and no resize listener is needed.

**Tech Stack:** React 18 + TypeScript, react-router-dom 7, Vitest + @testing-library/react (jsdom), plain CSS custom properties in `frontend/src/styles/theme.css`. **No new dependency.**

**Design spec:** `docs/superpowers/specs/2026-07-24-mobile-nav-drawer-design.md`

## Global Constraints

- **No new npm dependency.** Constitution Principle I is non-negotiable; everything here is in-house.
- **Style (`docs/CODING_CONVENTIONS.md`):** 2-space indent, semicolons always (ESLint `semi: ['error','always']`), braces on single-line bodies, functions under 50 lines, comments explain *why* not *what*.
- **`lib/` classes rule does not apply here.** React function components and custom hooks stay functions; the "prefer classes" convention covers logic helpers only.
- **This is the ARIA disclosure pattern, NOT the menu-button pattern.** Do **not** add `role="menu"`, `role="menuitem"`, `aria-haspopup`, or roving `tabIndex`. Do **not** reuse or extend `useMenuKeyboard` — the entries are ordinary links and must stay links.
- **All new `LeftMenu` props are optional with safe defaults**, so existing `<LeftMenu />` call sites and their tests keep passing untouched.
- **Coverage gate:** the Vitest coverage threshold is `lines: 90` across **all** of `src/` (`vite.config.ts`). Both new units must be fully exercised.
- **Working directory for every command is `frontend/`.** Node 24 / npm 11 are installed locally — no Docker needed for the frontend (unlike the backend).
- **Explicitly out of scope** (the spec rules all three out — do not add them): body scroll-lock while the drawer is open, a focus trap inside the drawer, and any slide/fade transition.
- **Do not create a branch.** Commit on the current branch (`master`).

---

### Task 1: The `useNavDrawer` hook

**Files:**
- Create: `frontend/src/hooks/useNavDrawer.ts`
- Test: `frontend/tests/hooks/useNavDrawer.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `useNavDrawer(): { open: boolean; toggle: () => void; close: () => void; panelRef: RefObject<HTMLElement>; triggerRef: RefObject<HTMLButtonElement> }` — used by Task 3.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/hooks/useNavDrawer.test.tsx`. The test renders a small harness component rather than poking `ref.current` by hand, because the hook's effects only work against real attached DOM nodes. The harness deliberately keeps the panel in the DOM at all times and varies only a class — that mirrors production, where CSS (not React) hides the panel.

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useNavDrawer } from '../../src/hooks/useNavDrawer';

afterEach(cleanup);

// Mirrors how PageLayout + LeftMenu wire the hook up: a trigger button, a <nav> panel that is
// always present (CSS hides it in production), and an unrelated node to click outside on.
function Harness() {
  const { open, toggle, close, panelRef, triggerRef } = useNavDrawer();
  return (
    <div>
      <button type="button" ref={triggerRef} onClick={toggle} aria-expanded={open}>
        Menu
      </button>
      <nav ref={panelRef} data-testid="panel" className={open ? 'left-menu--open' : undefined}>
        <a href="/home" onClick={close}>Home</a>
      </nav>
      <p data-testid="outside">outside</p>
    </div>
  );
}

function openDrawer() {
  fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
}

function isOpen(): boolean {
  return screen.getByRole('button', { name: 'Menu' }).getAttribute('aria-expanded') === 'true';
}

describe('useNavDrawer', () => {
  it('starts closed', () => {
    render(<Harness />);

    expect(isOpen()).toBe(false);
    expect(screen.getByTestId('panel').className).toBe('');
  });

  it('toggle opens the drawer and toggles it shut again', () => {
    render(<Harness />);

    openDrawer();
    expect(isOpen()).toBe(true);
    expect(screen.getByTestId('panel').className).toBe('left-menu--open');

    openDrawer();
    expect(isOpen()).toBe(false);
  });

  it('moves focus to the first entry when it opens', () => {
    render(<Harness />);

    openDrawer();

    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Home' }));
  });

  it('closes on Escape and returns focus to the trigger', () => {
    render(<Harness />);
    openDrawer();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(isOpen()).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Menu' }));
  });

  it('ignores keys other than Escape while open', () => {
    render(<Harness />);
    openDrawer();

    fireEvent.keyDown(document, { key: 'a' });

    expect(isOpen()).toBe(true);
  });

  it('closes on a pointer-down outside the panel and the trigger', () => {
    render(<Harness />);
    openDrawer();

    fireEvent.pointerDown(screen.getByTestId('outside'));

    expect(isOpen()).toBe(false);
  });

  it('stays open on a pointer-down inside the panel', () => {
    render(<Harness />);
    openDrawer();

    fireEvent.pointerDown(screen.getByRole('link', { name: 'Home' }));

    expect(isOpen()).toBe(true);
  });

  // Without the trigger exemption the trigger's own pointer-down would close the drawer and the
  // click that follows would immediately reopen it — the toggle would appear stuck open.
  it('stays open on a pointer-down on the trigger itself', () => {
    render(<Harness />);
    openDrawer();

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Menu' }));

    expect(isOpen()).toBe(true);
  });

  it('close() shuts the drawer, as a chosen menu entry does', () => {
    render(<Harness />);
    openDrawer();

    fireEvent.click(screen.getByRole('link', { name: 'Home' }));

    expect(isOpen()).toBe(false);
  });

  it('detaches its document listeners once closed', () => {
    const remove = vi.spyOn(document, 'removeEventListener');
    render(<Harness />);
    openDrawer();

    openDrawer(); // close again

    const events = remove.mock.calls.map((call) => call[0]);
    expect(events).toContain('keydown');
    expect(events).toContain('pointerdown');

    // A stray event after closing must not throw or reopen anything.
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.pointerDown(screen.getByTestId('outside'));
    expect(isOpen()).toBe(false);
    remove.mockRestore();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd frontend
npx vitest run tests/hooks/useNavDrawer.test.tsx
```

Expected: FAIL — `Failed to resolve import "../../src/hooks/useNavDrawer"`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/hooks/useNavDrawer.ts`:

```ts
import { useEffect, useRef, useState } from 'react';

// Open/close state and dismissal wiring for the narrow-viewport nav drawer (the left menu the
// `max-width: 50rem` rules hide). This is the ARIA *disclosure* pattern, not the menu-button
// pattern `useMenuKeyboard` implements: the drawer's entries are ordinary links, so there is no
// roving focus and no menu roles — only open state, Escape, and outside dismissal.
export function useNavDrawer() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Escape closes and hands focus back to the trigger; listener lives only while open.
  useEffect(() => {
    if (!open) { return; }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') { return; }
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);
  // Close on a pointer-down outside the drawer. The trigger is exempt: otherwise its own press
  // would close here and the click right after would reopen, leaving the toggle stuck open.
  useEffect(() => {
    if (!open) { return; }
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) { return; }
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);
  // Opening hands focus to the first entry so a keyboard user lands inside the drawer.
  useEffect(() => {
    if (!open) { return; }
    panelRef.current?.querySelector<HTMLElement>('a, button')?.focus();
  }, [open]);
  function close(): void { setOpen(false); }
  function toggle(): void { setOpen(!open); }
  return { open, toggle, close, panelRef, triggerRef };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd frontend
npx vitest run tests/hooks/useNavDrawer.test.tsx
```

Expected: PASS — 10 passed.

- [ ] **Step 5: Lint**

```bash
cd frontend
npm run lint
```

Expected: no errors. (If `react-hooks/exhaustive-deps` flags the effects, do **not** add the refs to the dependency arrays — refs are stable and adding them is wrong; the arrays are correct as written.)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/useNavDrawer.ts frontend/tests/hooks/useNavDrawer.test.tsx
git commit -m "feat(nav): add useNavDrawer open-state hook for the mobile menu"
```

---

### Task 2: `LeftMenu` accepts drawer props

**Files:**
- Modify: `frontend/src/components/LeftMenu.tsx` (the `AnonymousLinks`, `AuthenticatedLinks` and `LeftMenu` functions)
- Test: `frontend/tests/components/LeftMenu.test.tsx` (extend; do not rewrite the existing cases)

**Interfaces:**
- Consumes: nothing at runtime — the props are optional, so this task stands alone.
- Produces: `<LeftMenu open?: boolean; panelRef?: RefObject<HTMLElement>; onNavigate?: () => void />` — consumed by Task 3.

- [ ] **Step 1: Write the failing tests**

Append these cases inside the existing `describe('LeftMenu', ...)` block in `frontend/tests/components/LeftMenu.test.tsx`. They need a render helper that passes props, so also add this helper next to the existing `renderMenu`:

```tsx
// Renders with the drawer props Task 3's PageLayout supplies.
function renderDrawerMenu(value: AuthContextValue, props: {
  open?: boolean;
  onNavigate?: () => void;
}) {
  return render(
    <MemoryRouter initialEntries={['/account']}>
      <AuthContext.Provider value={value}>
        <LeftMenu open={props.open} onNavigate={props.onNavigate} />
        <LocationProbe />
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}
```

And the cases:

```tsx
  it('renders without the drawer class by default, so the desktop rail is untouched', () => {
    renderMenu(authValue({ status: 'anonymous' }));

    expect(screen.getByRole('navigation', { name: 'Primary' }).className).toBe('');
  });

  it('carries the open class when the drawer is open', () => {
    renderDrawerMenu(authValue({ status: 'anonymous' }), { open: true });

    expect(screen.getByRole('navigation', { name: 'Primary' }).className).toBe('left-menu--open');
  });

  it('reports navigation when a link is chosen, so the drawer can close itself', () => {
    const onNavigate = vi.fn();
    renderDrawerMenu(authValue({ status: 'anonymous' }), { open: true, onNavigate });

    fireEvent.click(screen.getByRole('link', { name: 'Home' }));

    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it('reports navigation after logging out', async () => {
    const onNavigate = vi.fn();
    const value = authValue({ status: 'authenticated', user });
    renderDrawerMenu(value, { open: true, onNavigate });

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));

    expect(await screen.findByText('/')).toBeTruthy();
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd frontend
npx vitest run tests/components/LeftMenu.test.tsx
```

Expected: the four new cases FAIL (`expected '' to be 'left-menu--open'`, and `onNavigate` never called). The 14 pre-existing cases must still PASS.

- [ ] **Step 3: Write the implementation**

In `frontend/src/components/LeftMenu.tsx`:

Extend the type import on line 1 so `RefObject` is available:

```tsx
import type { ReactElement, RefObject } from 'react';
```

Give `AnonymousLinks` an `onNavigate` prop and attach it to both links. Pass the handler **directly** as `onClick` — React calls it with the mouse event, which a zero-parameter function simply ignores, so no wrapper closure is needed:

```tsx
// Prototype order: the login entry sits above Home for anonymous visitors.
function AnonymousLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      <li>
        <NavLink to="/login" onClick={onNavigate}>
          <MenuIcon glyph="person" />
          Login/register
        </NavLink>
      </li>
      <li>
        <NavLink to="/" end onClick={onNavigate}>
          <MenuIcon glyph="home" />
          Home
        </NavLink>
      </li>
    </>
  );
}
```

Do the same for `AuthenticatedLinks` — add `onNavigate?: () => void` to its props type and put `onClick={onNavigate}` on each of the five `NavLink`s (`/`, `/upload`, `/admin/trashposts`, `/admin/users`, `/account`). Leave the logout `<button>`'s `onClick={onLogout}` alone; logout reports navigation from `handleLogout` instead.

Then update the `LeftMenu` function itself:

```tsx
// Primary navigation as the prototype's left menu, auth-aware (FR-011): anonymous
// visitors get a combined Login/register entry; authenticated visitors get Upload,
// Account and a working Log out control. `unknown` (session check in flight) renders
// as anonymous so authed-only items never flash.
//
// The drawer props are how PageLayout drives the narrow-viewport overlay: `open` adds the
// class the `max-width: 50rem` rules turn into a floating panel, `panelRef` lets the drawer
// hook hit-test pointer-downs, and `onNavigate` fires on every entry so choosing one closes
// the drawer. All three are optional and inert above the breakpoint, where `open` is never true.
function LeftMenu({ open = false, panelRef, onNavigate }: {
  open?: boolean;
  panelRef?: RefObject<HTMLElement>;
  onNavigate?: () => void;
}) {
  const { status, user, role, logout } = useAuth();
  const navigate = useNavigate();
  const isAuthenticated = status === 'authenticated' && user !== null;
  const isAdmin = Role.rank(role) >= Role.rank('admin');

  async function handleLogout(): Promise<void> {
    await logout();
    navigate('/');
    onNavigate?.();
  }

  return (
    <nav
      id="left-menu"
      aria-label="Primary"
      ref={panelRef}
      className={open ? 'left-menu--open' : undefined}
    >
      <ul>
        {isAuthenticated ? (
          <AuthenticatedLinks
            showUpload={user.emailVerifiedAt !== null}
            showModeration={isAdmin}
            showUsers={isAdmin}
            onLogout={() => void handleLogout()}
            onNavigate={onNavigate}
          />
        ) : (
          <AnonymousLinks onNavigate={onNavigate} />
        )}
      </ul>
    </nav>
  );
}
```

Every prop is optional, so the existing bare `<LeftMenu />` call sites in `PageLayout.tsx` and the tests still typecheck and behave exactly as before: `open` defaults to `false` (no class), and `panelRef` / `onNavigate` are simply absent.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd frontend
npx vitest run tests/components/LeftMenu.test.tsx
```

Expected: PASS — 18 passed (14 pre-existing + 4 new).

- [ ] **Step 5: Verify nothing else regressed**

```bash
cd frontend
npm test
```

Expected: the whole suite passes. `PageLayout.test.tsx` and `App.test.tsx` render `<LeftMenu />` with no props and must be unaffected.

- [ ] **Step 6: Lint and commit**

```bash
cd frontend
npm run lint
cd ..
git add frontend/src/components/LeftMenu.tsx frontend/tests/components/LeftMenu.test.tsx
git commit -m "feat(nav): let LeftMenu render as an open drawer and report navigation"
```

---

### Task 3: The header toggle and backdrop in `PageLayout`

**Files:**
- Modify: `frontend/src/components/PageLayout.tsx`
- Test: `frontend/tests/components/PageLayout.test.tsx` (extend)

**Interfaces:**
- Consumes: `useNavDrawer()` from Task 1; `<LeftMenu open panelRef onNavigate />` from Task 2.
- Produces: the rendered `button.nav-toggle`, `nav#left-menu.left-menu--open` and `div.nav-backdrop` that Task 4 styles.

- [ ] **Step 1: Write the failing tests**

The existing `PageLayout.test.tsx` builds its auth context without a `role` field; `LeftMenu` reads `role` through `useAuth`, so add `role: 'guest'` to the `anonymous` object at the top of the file if it is not already there — otherwise these tests exercise a different code path than production. Then append a new describe block at the end of `frontend/tests/components/PageLayout.test.tsx`:

```tsx
describe('PageLayout nav drawer', () => {
  it('puts a named toggle in the header, collapsed to start', () => {
    renderLayout();

    const toggle = screen.getByRole('button', { name: 'Menu' });
    expect(screen.getByRole('banner').contains(toggle)).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('points the toggle at the nav it controls', () => {
    renderLayout();

    const toggle = screen.getByRole('button', { name: 'Menu' });
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(toggle.getAttribute('aria-controls')).toBe(nav.getAttribute('id'));
    // Disclosure, not menu-button: the entries stay links.
    expect(toggle.getAttribute('aria-haspopup')).toBeNull();
  });

  it('marks the toggle glyph decorative so the button name stays clean', () => {
    const { container } = renderLayout();

    const glyph = container.querySelector('.nav-toggle svg');
    expect(glyph?.getAttribute('aria-hidden')).toBe('true');
  });

  it('opens and closes the drawer from the toggle', () => {
    renderLayout();
    const toggle = screen.getByRole('button', { name: 'Menu' });
    const nav = screen.getByRole('navigation', { name: 'Primary' });

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(nav.className).toBe('left-menu--open');

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(nav.className).toBe('');
  });

  it('renders the backdrop only while the drawer is open, hidden from assistive tech', () => {
    const { container } = renderLayout();
    expect(container.querySelector('.nav-backdrop')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));

    const backdrop = container.querySelector('.nav-backdrop');
    expect(backdrop).not.toBeNull();
    expect(backdrop?.getAttribute('aria-hidden')).toBe('true');
  });

  it('closes the drawer when a menu entry is chosen', () => {
    renderLayout();
    const toggle = screen.getByRole('button', { name: 'Menu' });
    fireEvent.click(toggle);

    fireEvent.click(screen.getByRole('link', { name: 'Home' }));

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes the drawer on Escape', () => {
    renderLayout();
    const toggle = screen.getByRole('button', { name: 'Menu' });
    fireEvent.click(toggle);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });
});
```

Two supporting edits in the same file: import `fireEvent` alongside `cleanup, render, screen` from `@testing-library/react`, and make `renderLayout` **return** the render result (`return render(...)`) so the `container` queries above work.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd frontend
npx vitest run tests/components/PageLayout.test.tsx
```

Expected: the new cases FAIL with `Unable to find an accessible element with the role "button" and name "Menu"`. The 4 pre-existing cases still PASS.

- [ ] **Step 3: Write the implementation**

Replace the whole of `frontend/src/components/PageLayout.tsx` with:

```tsx
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { useNavDrawer } from '../hooks/useNavDrawer';
import LeftMenu from './LeftMenu';

// Three flat bars on the same 25x25 grid as LeftMenu's glyph set, so the toggle reads as part of
// that family. Decorative only: the button's aria-label is the accessible name (Principle IV).
function NavToggleIcon() {
  return (
    <svg className="nav-toggle-icon" viewBox="0 0 25 25" aria-hidden="true" focusable="false">
      <rect x="2" y="5" width="21" height="3" rx="1" />
      <rect x="2" y="11" width="21" height="3" rx="1" />
      <rect x="2" y="17" width="21" height="3" rx="1" />
    </svg>
  );
}

// Shared shell every route mounts inside: a logo-only header (the prototype's
// top-menu), then a centered container holding the fixed left menu and the routed
// view in the <main> landmark. Landmarks (<header>/<nav>/<main>) give assistive tech
// a navigable page structure (Principle IV). The logo links home so it doubles as a
// logo-home affordance; <picture> swaps the logo art per color scheme so the wordmark
// stays legible in both themes (Principle IV); the <img> alt names the site.
//
// The toggle is the narrow-viewport escape hatch: below 50rem the CSS hides the rail entirely,
// which would leave primary navigation unreachable, so at those widths the button opens the same
// menu as an overlay drawer. It is the ARIA disclosure pattern — aria-expanded plus aria-controls
// on the trigger, and no menu roles, because the drawer's entries are ordinary links. CSS hides
// the button above the breakpoint, where the rail is visible anyway.
function PageLayout({ children }: { children: ReactNode }) {
  const { open, toggle, close, panelRef, triggerRef } = useNavDrawer();

  return (
    <>
      <header>
        <button
          type="button"
          className="nav-toggle"
          ref={triggerRef}
          onClick={toggle}
          aria-expanded={open}
          aria-controls="left-menu"
          aria-label="Menu"
        >
          <NavToggleIcon />
        </button>
        <Link to="/" className="site-logo">
          <picture>
            <source srcSet="/logo-dark.png" media="(prefers-color-scheme: dark)" />
            <img src="/logo-light.png" alt="online-trash home" />
          </picture>
        </Link>
      </header>
      <div className="main-container">
        <LeftMenu open={open} panelRef={panelRef} onNavigate={close} />
        {open ? <div className="nav-backdrop" aria-hidden="true" /> : null}
        <main>{children}</main>
      </div>
    </>
  );
}

export default PageLayout;
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd frontend
npx vitest run tests/components/PageLayout.test.tsx
```

Expected: PASS — 11 passed (4 pre-existing + 7 new).

- [ ] **Step 5: Run the full suite and the coverage gate**

```bash
cd frontend
npm test -- --coverage
```

Expected: all tests pass and the run does not fail the `lines: 90` threshold. If `src/hooks/useNavDrawer.ts` or `src/components/PageLayout.tsx` is below 90%, find the uncovered line in the coverage report and add a case for it rather than lowering the threshold.

- [ ] **Step 6: Lint and commit**

```bash
cd frontend
npm run lint
cd ..
git add frontend/src/components/PageLayout.tsx frontend/tests/components/PageLayout.test.tsx
git commit -m "feat(nav): add the header toggle that opens the mobile nav drawer"
```

---

### Task 4: Drawer styling

**Files:**
- Modify: `frontend/src/styles/theme.css` — the `:root` layout tokens (~line 25), the `header` rule (~line 93), and the `@media (max-width: 50rem)` block (~line 214)

**Interfaces:**
- Consumes: the `.nav-toggle`, `.nav-toggle-icon`, `.left-menu--open` and `.nav-backdrop` class names rendered by Tasks 2 and 3.
- Produces: nothing consumed by later tasks — this is the last task.

There is no unit test here: jsdom does not evaluate media queries or compute layout, so this task is verified in a real browser (Step 4).

- [ ] **Step 1: Add the header-height token**

In the `:root` "Layout tokens" group in `frontend/src/styles/theme.css`, change:

```css
  /* Layout tokens. */
  --layout-max-width: 80rem;
  --radius-md: 0.5rem;
```

to:

```css
  /* Layout tokens. */
  --layout-max-width: 80rem;
  /* The sticky header's height. Shared so the header rule and the drawer's top offset
     (which must clear the header) cannot drift apart. */
  --layout-header-height: 70px;
  --radius-md: 0.5rem;
```

- [ ] **Step 2: Consume the token in the header and lay the toggle out**

Change the `header` rule from `min-height: 70px;` to the token, and add the flex line:

```css
header {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  min-height: var(--layout-header-height);
  padding: var(--space-md);
  border-bottom: 1px solid var(--color-border);
  background-color: var(--color-surface);
}
```

`display: flex` is safe here precisely because `.site-logo` is `position: absolute` and therefore out of flow — the centered logo is unaffected, and the toggle is the only flex child, so it sits vertically centred at the left padding edge.

Then add, immediately after the `header` rule:

```css
/* The drawer toggle only exists below the breakpoint, where the rail is hidden; the media
   query at the bottom of this section turns it on. Sized to a comfortable 44px tap target. */
.nav-toggle {
  display: none;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-md);
  background: none;
  cursor: pointer;
}

.nav-toggle:hover {
  background-color: var(--color-menu-hover);
}

/* Same treatment as the left-menu glyphs: the bars take the text color at reduced opacity, so
   they follow the scheme tokens with no separate dark-mode rule. */
.nav-toggle-icon {
  width: 25px;
  height: 25px;
  display: block;
  margin: 0 auto;
}

.nav-toggle-icon rect {
  fill: var(--color-text);
  opacity: 0.5;
}
```

- [ ] **Step 3: Rewrite the breakpoint block**

Replace the existing block at the bottom of the responsive-layout section:

```css
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

with:

```css
/* Prototype parity below 800px: the leftbar disappears and content goes full width
   (accepted trade-off — 2026-07-06 leftbar design spec). Because that leaves primary
   navigation unreachable, the header toggle appears here and can bring the same menu back
   as an overlay drawer (2026-07-24 mobile nav drawer design). */
@media (max-width: 50rem) {
  .nav-toggle {
    display: block;
  }

  #left-menu {
    display: none;
  }

  main {
    margin-left: 0;
  }

  /* Explicit offsets are required: the rail's desktop `position: fixed` carries no offsets, so
     it would sit at its static position and scroll out of view. Pinned under the header and
     below it in the stack (header is z-index 10) so the toggle stays clickable to close. */
  #left-menu.left-menu--open {
    display: block;
    top: var(--layout-header-height);
    left: 0;
    bottom: 0;
    width: 200px;
    padding: 10px 5px 0 10px;
    overflow-y: auto;
    border-right: 1px solid var(--color-border);
    background-color: var(--color-surface);
    z-index: 9;
  }

  /* Purely visual: outside-dismissal is handled by the drawer hook's pointer-down listener,
     so this carries no handler and is hidden from assistive tech. */
  .nav-backdrop {
    position: fixed;
    inset: var(--layout-header-height) 0 0 0;
    background-color: rgb(0 0 0 / 50%);
    z-index: 8;
  }
}
```

Note `#left-menu.left-menu--open` needs no `position: fixed` — it inherits that from the base `#left-menu` rule and only adds the offsets. It overrides the base `overflow: hidden` with `overflow-y: auto` so a long admin menu can scroll on a short phone screen.

- [ ] **Step 4: Verify in a real browser**

```bash
cd frontend
npm run dev
```

Open the printed URL, then with DevTools device emulation (or by narrowing the window) check **at a width below 800px**:

1. The hamburger appears at the top-left of the header; the logo stays centred and un-shifted.
2. Pressing it slides the menu over the content with a dimmed backdrop; the feed does **not** reflow.
3. All four dismissals work: pressing the toggle again, choosing an entry, `Escape`, and clicking the backdrop.
4. Scrolling the page with the drawer open leaves the drawer pinned under the header.
5. Tab order reaches the toggle, and opening moves focus to the first entry with a visible focus ring.
6. Toggle the OS/DevTools colour scheme — the toggle glyph and drawer surface follow both themes.

Then check **above 800px**: no hamburger, the rail renders exactly as before. Finally, open the drawer at a narrow width and drag the window wide — the rail must snap back to its normal desktop position with no leftover overlay or backdrop.

- [ ] **Step 5: Confirm nothing regressed**

```bash
cd frontend
npm run lint
npm test -- --coverage
```

Expected: lint clean, all tests pass, coverage ≥ 90%.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/styles/theme.css
git commit -m "feat(nav): style the mobile nav drawer, toggle and backdrop"
```

---

## Definition of done

- Below 50rem a header toggle opens the left menu as an overlay drawer and closes it four ways (toggle, entry chosen, Escape, outside pointer-down).
- Above 50rem nothing changed: no toggle, rail as before.
- `npm run lint` clean; `npm test -- --coverage` green at ≥ 90% lines across `src/`.
- No new npm dependency.
- Four commits on `master`, one per task.
