# Auth UI ↔ Prototype Alignment — Design

**Date:** 2026-07-06
**Scope:** `frontend/src` only. The backend auth API (007) is untouched.
**Goal:** make ladybug's login/register pages look and behave like the Trashpost
prototype (`C:\projects\trash`), within the bounds of the Ladybug Constitution
(labels/a11y and real-URL navigation win over prototype fidelity).

## Background

The 007-auth-ui slice implemented login/register with visible labels, on-submit
validation, a filled red accent button, and no cross-links. The prototype (the
source of `docs/login.png` / `docs/signup.png`) uses a neutral palette,
placeholder-styled inputs, on-blur validation with a gated submit button, a
native `<dialog>` notice modal, and cross-links between the two forms. The user
wants the current solution aligned with the prototype, including its color
scheme ("no red buttons"), site-wide.

Prototype reference files:

- `resources/js/pages/RegisterPage2.jsx` — the hand-rolled validation pattern
  (touched-field tracking, blur validation, gated submit, NoticeDialog).
  The routed `RegisterPage.jsx` uses react-hook-form; we do NOT copy that —
  a new dependency violates Constitution Principle I.
- `resources/js/pages/LoginPage.jsx` — layout/links only; its submit handler is
  an unfinished stub, so login behavior is not copied from it.
- `resources/js/components/NoticeDialog.jsx` — native `<dialog>` modal.
- `resources/css/app.css` — palette and form styling.

## 1. Color scheme (site-wide, `styles/theme.css`)

- Remove the red accent from controls. `--color-accent` / `--color-accent-text`
  are deleted.
- New `--color-error` token (prototype's `#FA202E`; a lighter variant may be
  used in dark mode if contrast requires) used ONLY for validation/error text
  and error-banner borders.
- Buttons (auth submit, account logout, feed error retry): full-width where the
  prototype's are, outlined style — transparent/surface background,
  1px `#4a5568` border (prototype uses this border in both schemes), inherited
  text color, `border-radius` per prototype (10px buttons, 4px inputs).
- Feed "Load more": the prototype's gray block (`background-color: #4a5568`,
  centered text, no red).
- Invalid inputs: `aria-invalid` stays; the visual signal is the red error text
  below the field (message text = signal, satisfies "never color alone");
  the current 2px red border flag is dropped with the accent token.
- Everything else (bg, surface, text, focus ring, spacing, layout tokens)
  stays as is.

## 2. Auth page layout (`LoginPage`, `RegisterPage`, `AuthField`)

- Centered form column, `max-width: 600px`, matching
  `#login-form / #register-form` in the prototype CSS.
- Headings: "Log in" / "Sign up" with a full-width bottom hairline
  (prototype `form h3` style). Rendered as `<h1>` for document semantics.
- Fields: sr-only `<label>` + `placeholder` (constitution's label requirement
  is met for assistive tech; visual look matches the prototype exactly).
  Placeholders: `Display name`, `E-mail`, `Password`, `Re-type password`.
  A new `.sr-only` utility class is added to `theme.css`.
- Inputs and submit button full-width with the prototype's 20px bottom rhythm.
- Submit button captions per prototype: `Login` / `Register`, static while the
  request runs (the disabled fieldset is the in-flight signal; no caption swap).
- Cross-links, centered under the form:
  - Login: `No account? Register here....` → `/register`
  - Register: `Already have an account? Login here....` → `/login`
  - NO "Forgot password?" link: password reset is not built, and dead URLs
    violate the navigation principle. It returns with that feature.

## 3. Validation UX (prototype `RegisterPage2` pattern, hand-rolled)

- Pages track a touched-field set. On blur a field is marked touched and all
  touched fields are (re)validated; errors render as red inline text under the
  field (`white-space: pre-wrap` so multiple password errors stack as lines).
- Submit button is `disabled` while client validation errors exist
  (untouched fields do not block submission attempts).
- On submit: mark all fields touched, validate everything, bail if any errors.
- While a request is in flight the whole `<fieldset>` is disabled
  (inputs + button), like the prototype.
- `AuthModel.validateLogin` / `validateRegister` gain a `touched: Set<string>`
  parameter and only report errors for touched fields; passing all field names reproduces today's validate-everything
  behavior for submit. Multiple password-policy violations are reported as
  separate messages (prototype behavior), joined with `\n` for display.
- Server 422 field errors still merge in per field (server wins) and are not
  cleared by the touched filter.
- No closures in logic code — class statics per `docs/CODING_CONVENTIONS.md`;
  React components/hooks stay functions.

## 4. NoticeDialog (`components/NoticeDialog.tsx`)

Port of the prototype's native `<dialog>` modal:

- Props: `message` (required), `title` (optional), `btnCaption`
  (default "Ok"), `onClose`.
- Opens via `showModal()` on mount; single OK button, right-aligned,
  prototype `.notice-dialog` styling.
- Deviation from prototype: Esc/cancel triggers `onClose` instead of being
  swallowed (a11y improvement).
- **Mounting:** a successful register flips auth state, which makes
  `RequireAnon` unmount `RegisterPage` immediately — a page-local dialog would
  vanish before it is seen. The dialog therefore renders from a small
  `NoticeProvider` (`components/NoticeProvider.tsx` + `hooks/useNotice.ts`,
  mirroring the AuthProvider/useAuth pattern) mounted above the routes in
  `App.tsx`. Pages trigger it via `useNotice().show({ message })`; the provider
  renders `NoticeDialog` until `clear()`.

Usage:

- Register success: "Welcome, {name}! Your account is ready." — OK navigates
  home. (NOT the prototype's "check your email" text: email verification does
  not exist in ladybug; register auto-authenticates.)
- Unexpected (non-422, non-401) errors on either form: generic
  "Failed to log in. Please try again." / "Failed to sign up. Please try
  again." replacing the current inline banner for that error class.
- Login success stays a silent navigate home (prototype login was a stub).
- Failed login (401) stays an inline, non-disclosing form-level message
  ("Email or password is incorrect.") — FR-003 behavior is kept.

## 5. Tests

- Update Vitest suites: `LoginPage`, `RegisterPage`, `AuthField`, `AuthModel`
  (touched-aware validation), plus a new `NoticeDialog` suite. Tests mirror
  `src/` paths (Principle VII).
- Playwright e2e: selectors keep using accessible names (`getByLabel` works
  with sr-only labels); assertions about button state/dialogs updated.
- Coverage gate stays ≥90% across all of `src/` (CI).

## Out of scope

- Backend changes of any kind.
- Password reset / email verification.
- AccountPage restructuring (it only inherits the new button/token styling).
