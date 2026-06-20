# Contract: Frontend Routes & Redirect Rules

All three views are real, shareable, refresh-safe URLs inside the existing
`PageLayout` (header + nav). Guards consult `useAuth().status`; while `status` is
`unknown` (session check in flight) guards render a neutral placeholder and do **not**
redirect (prevents flash-redirect on refresh).

| Route | Guard | Anonymous | Authenticated | Notes |
|-------|-------|-----------|---------------|-------|
| `/register` | `RequireAnon` | Render RegisterPage | Redirect → `/` | FR-012 |
| `/login` | `RequireAnon` | Render LoginPage | Redirect → `/` | FR-012 |
| `/account` | `RequireAuth` | Redirect → `/login` | Render AccountPage | FR-012 |
| `/` , `/posts/:hash` | none | unchanged | unchanged | existing 005/006 |

## Behavior

- **Refresh** (`FR-013`): on load `useAuth` calls `fetchCurrentUser`; until it resolves,
  guarded routes show a placeholder. After resolve, the correct view or redirect renders
  from the URL alone — no forced re-login when a valid session exists.
- **Back/Forward**: standard router history; transitioning anon→authed (after login)
  navigates to `/` (or an intended `from` location if present); Back does not re-expose a
  protected page once logged out (guard re-evaluates on render).
- **Post-login destination**: default `/`. (Optional: preserve a `from` location captured
  by `RequireAuth` when it redirected an anonymous user to `/login`; if implemented, send
  them back there after login. MVP default is `/`.)
- **Nav reflects state** (`FR-011`): NavMenu shows Login/Register when anonymous and
  Account + Logout when authenticated; never both.

## Accessibility / responsiveness (all auth routes)
- Each input has an associated `<label>`; errors use `aria-invalid` + `aria-describedby`
  and are conveyed by text (not color alone) (FR-015).
- Theme follows `prefers-color-scheme` via the shared layout/CSS (FR-016).
- Forms reflow 320px→desktop with adequate touch targets (FR-017).
