# Leftbar Navigation (prototype parity) — Design

**Date:** 2026-07-06
**Status:** Approved
**Scope:** frontend only (no API changes)

## Goal

Move the primary navigation out of the sticky header into a prototype-style left
sidebar with inline SVG icons, matching `C:\projects\trash` (`LeftMenu.jsx` +
`#left-menu` CSS). The header keeps only the centered logo, like the prototype's
`#top-menu`.

## Decisions (user-confirmed)

- **Whole nav moves.** The leftbar carries every nav item, including the
  authenticated ones (Upload / Account / Log out). Nothing nav-like remains in
  the header.
- **Combined anonymous link.** Anonymous (and `unknown`) visitors see a single
  **Login/register** link pointing to `/login` (register is reachable from the
  login page's cross-link), exactly like the prototype — not separate Login and
  Register links.
- **Prototype-faithful mobile behavior.** Below 800px the leftbar is hidden
  (`display: none`) and content goes full width. No mobile substitute nav; the
  logo still links home. This knowingly trades mobile nav reach for prototype
  parity — revisit if it bites.
- **Rename, don't restyle.** `NavMenu.tsx` becomes `LeftMenu.tsx` (prototype
  vocabulary), and its test file moves with it per Constitution Principle VII.
- **No icon library.** Constitution Principle I: icons are in-house inline SVGs.
  House and person glyphs are copied from the prototype; missing glyphs (upload,
  logout) are drawn in the same flat-polygon 25×25 style.

## Components

### `PageLayout.tsx`

- `<header>` keeps only the `.site-logo` link (centered, theme-swapped
  `<picture>`), sticky as today.
- Below the header, a `.main-container` div (centered, max-width — mirrors the
  prototype's `.main-container`, 1000px-ish via the existing
  `--layout-max-width`) wraps `<LeftMenu />` and `<main>{children}</main>`.

### `LeftMenu.tsx` (replaces `NavMenu.tsx`)

- Still `<nav aria-label="Primary">` with the same auth-awareness contract:
  `unknown` renders as anonymous so authed items never flash.
- Anonymous/unknown, in prototype order:
  1. **Login/register** → `/login` (person icon)
  2. **Home** → `/` (house icon)
- Authenticated:
  1. **Home** → `/` (house icon)
  2. **Upload** → `/upload` (tray + up-arrow icon)
  3. **Account** → `/account` (person icon)
  4. **Log out** — `<button>` styled like the links (door + arrow icon); on
     click awaits `logout()` then navigates to `/` (unchanged behavior).
- Links stay `NavLink` so `aria-current="page"` keeps driving the active-page
  signal (weight + underline, never color alone — Principle IV).

### `MenuIcon` (small presentational component, lives in `LeftMenu.tsx`)

- Props: `glyph: 'home' | 'person' | 'upload' | 'logout'`.
- Renders the prototype's 25×25 SVG: rounded-rect background
  (`.left-menu-icon-bg`) + a per-glyph `<g>` of flat polygons. House and person
  are verbatim prototype geometry; upload and logout are new, same style.
- `aria-hidden="true"` + `focusable="false"` — the adjacent link/button text is
  the accessible name, so no `alt`/label gap (Principle IV).

## CSS (`theme.css`)

- `#left-menu`: `width: 200px; position: fixed;` (no top/left offsets — pinned
  at its static position inside the centered container, the prototype trick),
  padding per prototype. Entries: block links, bold, no underline, 3px radius,
  hover background (`rgba(0,0,0,.10)` light / `rgba(255,255,255,.10)` dark via
  existing theme variables/media queries), 15px bottom rhythm.
- `svg.left-menu-icon`: 25×25, vertical-align middle, 5px right margin; glyph
  and background colors from theme variables with the prototype's opacities
  (`--front_opacity: 0.5`, `--bg_opacity: 0.2`), flipping automatically with
  `prefers-color-scheme` and any persisted manual override.
- `main`: `margin-left: 210px` inside `.main-container` (prototype value);
  keeps existing padding. `margin-inline: auto`/max-width move to
  `.main-container`.
- `@media (max-width: 800px)`: `#left-menu { display: none; }` and
  `main { margin-left: 0; }`.
- Header simplification: drop the right-aligned nav rules and the <560px
  header-stacking workaround (nothing left to collide with the logo); drop
  `.nav-logout` in favor of the leftbar button style.

## Tests

- `tests/components/NavMenu.test.tsx` → `tests/components/LeftMenu.test.tsx`:
  - anonymous: **Login/register** link present (→ `/login`), Home link present,
    no Upload/Account/Log out;
  - `unknown` status renders like anonymous;
  - authenticated: Home/Upload/Account links + Log out button, no
    Login/register;
  - logout click calls `logout()` and navigates to `/`;
  - icons don't leak into accessible names (role queries by exact name).
- `tests/components/PageLayout` coverage (if present) updated for the new
  structure; coverage stays ≥90% across `src/`.
- e2e (`frontend/e2e/*.spec.ts`): Playwright role-name matching is substring +
  case-insensitive, so `link { name: 'Login' }` matches "Login/register", and
  the 1280px default viewport keeps the leftbar visible. Expectation: specs
  pass unchanged — verify by running them, adjust names only if a spec used
  `exact: true` or asserts a now-removed element.

## Error handling

No new failure modes: logout already awaits the API call and navigates on
completion; nothing else in the leftbar performs I/O.

## Out of scope

- Mobile nav substitute (explicitly declined — prototype parity).
- The prototype's commented-out user-info box.
- Any backend change.
