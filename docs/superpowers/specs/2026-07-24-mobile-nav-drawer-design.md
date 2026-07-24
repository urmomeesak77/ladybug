# Mobile nav drawer — a top-left toggle for the hidden left menu — design

**Date:** 2026-07-24
**Status:** approved (design)

## Goal

Below the `50rem` breakpoint the primary navigation rail (`#left-menu`) is
`display: none` and is therefore **completely unreachable** — a narrow viewport has no
way to reach Home, Upload, Account, the admin consoles, or Log out. Add a toggle button
in the **top-left corner of the sticky header** that, at those widths, opens the same
menu as an **overlay drawer** pinned under the header, and closes it again.

## Non-goals

- **No desktop change.** Above `50rem` the toggle is not rendered visibly and the rail
  behaves exactly as it does today. This is not a collapsible-desktop-sidebar feature.
- No change to the menu's *contents* — the same auth- and role-aware entries
  (`AnonymousLinks` / `AuthenticatedLinks`) render in both the rail and the drawer.
- No body scroll-lock while the drawer is open.
- No focus trap inside the drawer (focus may Tab out into the page behind it).
- No slide/fade transition.

## Behaviour

At viewports **≤ 50rem**:

- The header shows a hamburger toggle at its left edge; the drawer starts closed.
- Pressing the toggle opens the drawer: a 200px panel pinned under the header, floating
  **over** the page content with a translucent backdrop. Content does not reflow.
- The drawer closes on **all four** of:
  1. pressing the toggle again,
  2. choosing any menu entry (a `NavLink`, or the Log out button),
  3. `Escape`,
  4. a pointer-down outside the panel (including on the backdrop).
- On open, focus moves to the panel's first link. On `Escape`, focus returns to the toggle.

At viewports **> 50rem**: unchanged. The rail is always visible; the toggle is hidden.

## Approach

State lives in `PageLayout`, the common parent of the header (which owns the trigger) and
`LeftMenu` (which owns the panel). A small `useNavDrawer` hook holds the open state and the
two document-level listeners, mirroring the existing `useMenuKeyboard` hook's shape so the
codebase keeps one idiom for "open thing that dismisses four ways".

Two rejected alternatives:

- **State inside `LeftMenu`, trigger rendered from there.** The trigger belongs in
  `<header>`, but `LeftMenu` renders inside `.main-container` — this would need a portal or
  a second DOM position. Worse structure, no gain.
- **CSS-only (checkbox / `:has()` hack).** No JS, but cannot close on `Escape`, cannot close
  on navigation, and has a poor accessible-name / `aria-expanded` story.

## ARIA: disclosure, not menu-button

The panel's contents are ordinary navigation links inside a `<nav>`, so this is the
**disclosure** pattern — **not** the WAI-ARIA menu-button pattern that `ActionMenu` and
`useMenuKeyboard` implement. Concretely:

- **No** `role="menu"` / `role="menuitem"` and **no** roving `tabIndex`. The links stay links,
  so browser and assistive-tech link behaviour (open in new tab, links list) is preserved.
- The trigger carries `aria-expanded={open}` and `aria-controls="left-menu"` (the `<nav>`
  already has that id). It carries **no** `aria-haspopup`.
- The trigger's accessible name is a text `aria-label="Menu"`; its glyph is a decorative
  `aria-hidden` SVG. Shape is never the sole signal (Principle IV).

Consequently `useNavDrawer` is a **new, separate** hook — it shares the dismissal *behaviour*
with `useMenuKeyboard` but not the roving-focus keyboard model, and conflating them would drag
menu semantics into the nav.

## Components

### `hooks/useNavDrawer.ts` (new)

Returns `{ open, toggle, close, panelRef, triggerRef }`.

- `open` — boolean, starts `false`.
- `toggle` / `close` — state setters; `close` is what the four dismissal paths call.
- `panelRef` — attached to `<nav id="left-menu">`; used for outside-hit testing and to find
  the first focusable link on open.
- `triggerRef` — attached to the toggle button; focus returns here on `Escape`.

Three effects, each attached **only while `open`** and torn down on close:

1. `document` `keydown` → on `Escape`, `close()` and `triggerRef.current?.focus()`.
2. `document` `pointerdown` → if the target is inside neither `panelRef` nor `triggerRef`,
   `close()`. Excluding the trigger matters: without it the trigger's own pointerdown would
   close the drawer and the subsequent click would immediately reopen it.
3. On open, focus the panel's first `a, button`.

### `components/PageLayout.tsx`

Calls `useNavDrawer()` and renders, inside `<header>` **before** the logo:

```tsx
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
```

Then `<LeftMenu open={open} panelRef={panelRef} onNavigate={close} />`, and — only when
`open` — a `<div className="nav-backdrop" aria-hidden="true" />` sibling. The backdrop is
**purely visual**: outside-dismissal is already handled by the pointerdown listener, so it
carries no click handler and no role.

`NavToggleIcon` is a three-bar hamburger drawn on the same flat 25×25 grid as `LeftMenu`'s
`GLYPHS` set, `aria-hidden="true" focusable="false"`, so it reads as one family with the menu
icons. (It is visually the same three stacked bars as the existing `moderation` glyph; it is
declared separately rather than shared, because the two are unrelated meanings that may
diverge.)

### `components/LeftMenu.tsx`

Three new **optional** props, so every existing `<LeftMenu />` usage and its current tests keep
working unchanged:

| prop | type | effect |
|---|---|---|
| `open` | `boolean` (default `false`) | adds the `left-menu--open` class to `<nav id="left-menu">` |
| `panelRef` | `RefObject<HTMLElement>` (optional) | forwarded to the `<nav>` |
| `onNavigate` | `() => void` (default no-op) | called on any link click and after logout |

`onNavigate` is threaded down to `AnonymousLinks` / `AuthenticatedLinks` and attached as
`onClick` on each `NavLink`; `handleLogout` calls it after `navigate('/')`. This is dismissal
path 2. It fires at every viewport width, but above the breakpoint `open` is never `true`, so
it is a no-op there.

## CSS (`frontend/src/styles/theme.css`)

- New token `--layout-header-height: 70px`, consumed by both `header { min-height }` and the
  drawer's `top`, so the two cannot drift apart.
- `header` gains `display: flex; align-items: center`. This is safe because `.site-logo` is
  `position: absolute` and therefore out of flow — the centered logo is unaffected, and the
  toggle lands vertically centred at the left padding edge.
- `.nav-toggle` is `display: none` at all widths by default; it is turned on only inside the
  existing `@media (max-width: 50rem)` block. Its glyph takes `var(--color-text)` at the same
  opacities as `svg.left-menu-icon`, so it follows both colour schemes with no dark-mode rule.
- Inside `@media (max-width: 50rem)`, replacing today's flat `#left-menu { display: none }`:
  - `#left-menu` stays `display: none`;
  - `#left-menu.left-menu--open` becomes `display: block; position: fixed;
    top: var(--layout-header-height); left: 0; bottom: 0; width: 200px;
    background-color: var(--color-surface); border-right: 1px solid var(--color-border);
    overflow-y: auto; z-index: 9;`
  - `.nav-backdrop` is `position: fixed; inset: var(--layout-header-height) 0 0 0;
    background-color: rgb(0 0 0 / 0.5); z-index: 8;` and is likewise only shown at this
    breakpoint.

The z-order is backdrop (8) < drawer (9) < sticky header (10), so the header — and the toggle
in it — stays above the open drawer and remains clickable to close it.

Explicit `top`/`bottom` offsets are required for the open state: today's `position: fixed`
*without* offsets leaves the rail at its static position, which scrolls out of view once the
page is scrolled.

**Why no resize listener is needed:** the `left-menu--open` class only carries meaning inside
the `max-width: 50rem` media query. Widening past the breakpoint makes the class inert and the
desktop rail rules take over automatically, so a drawer left open during a resize self-heals.
The React `open` state may stay `true`, which is harmless — and correct if the user narrows
the viewport again.

## Testing

Vitest + Testing Library. jsdom does not evaluate media queries, so these assert **DOM, class
and ARIA state**; the breakpoint itself is CSS and is verified by eye in the running app.

`tests/hooks/useNavDrawer.test.tsx` (new):

- starts closed; `toggle` opens, `toggle` again closes;
- `Escape` while open closes and returns focus to the trigger;
- `Escape` while closed is a no-op (listener detached);
- pointerdown outside both refs closes; pointerdown inside the panel does not;
- pointerdown on the trigger does not close (the click handler owns that transition);
- listeners are removed on close/unmount.

`tests/components/PageLayout.test.tsx` (extended):

- the toggle renders with an accessible name and `aria-expanded="false"`;
- clicking it flips `aria-expanded` to `"true"` and adds `left-menu--open` to the nav;
- the backdrop renders only while open;
- clicking a menu link closes the drawer;
- `aria-controls` matches the nav's `id`.

`tests/components/LeftMenu.test.tsx` (extended):

- renders unchanged with no new props (default-prop regression);
- `open` toggles the class; `onNavigate` fires on a link click and on logout.

The frontend Vitest coverage gate spans all of `src/`, so both new units must stay ≥90%.

## Constitution check

- **I — Minimal dependencies:** no new npm package. In-house hook, in-house SVG glyph.
- **II — Conventions:** 2-space TS, semicolons, functions well under 50 lines; comments explain
  *why* (`docs/CODING_CONVENTIONS.md`).
- **III — Navigation:** URLs are untouched; the drawer is transient view state, deliberately not
  reflected in the URL, and Back/Forward/Refresh behave exactly as before.
- **IV — Theming & a11y:** the toggle has a text `aria-label` plus `aria-expanded`/`aria-controls`;
  the glyph is decorative and `aria-hidden`; colours come from existing scheme tokens, so
  `prefers-color-scheme` is respected with no new dark rule; shape is never the sole signal.
- **VII — Tests:** new tests mirror source paths under `frontend/tests/`.
