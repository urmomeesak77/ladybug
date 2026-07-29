# Contract — UI surface

**Feature**: `017-google-oauth-login` | **Requirements**: FR-001, FR-007, FR-026 – FR-030, US6 | **Research**: [../research.md](../research.md) D12

Three pages change. No route is added.

---

## 1. `GoogleSignInButton` — the control (FR-027)

| Property | Value | Why |
|---|---|---|
| element | `<button type="button">` | it performs an action, not a navigation to a document; a real button gets Enter **and** Space for free |
| accessible name | `Continue with Google` | FR-027 — states the action, not just the brand |
| icon | **inline SVG**, `aria-hidden="true"` | no third-party script, no remote image, no font (Principle I + VI); themable with the rest of the site |
| pending | `aria-busy="true"`, disabled, spinner beside the unchanged label | FR-027; reuses `BusyButton`'s established pattern |
| repeat activation | disabled the moment the first click fires | US4 AS5 — a double-click must not navigate twice |
| touch target | ≥44 × 44 CSS px, full-width at narrow widths | Principle VIII, SC-010 |
| `redirectTo?: string` | optional prop, forwarded to `GoogleAuth.start()` → `?redirect=` | FR-006, US1 AS4 — see below |

The pending state is set on click and never cleared — the page is navigating away. If the
navigation fails the visitor still has a browser Back and a working password form.

**The `redirectTo` prop is not optional plumbing — FR-006 depends on it.** `LoginPage` already
reads `location.state.from` (planted by `RequireAuth`) and navigates there after a *password*
login. A click on this button is a **full-page navigation** to the backend, which destroys router
state, so the intended path has to survive the round trip as `?redirect=` on the start URL
(research D10). `LoginPage` therefore passes
`redirectTo={(location.state as { from?: Location } | null)?.from?.pathname}`. Omit it and the
callback's server-side default silently takes over — every Google sign-in lands on `/`, and US1
AS4 is false while every backend test still passes.

`GoogleAuth.startUrl()` composes on **`Api.base()`** (`frontend/src/lib/api.ts`), the one existing
accessor for the API origin (`VITE_API_BASE_URL`, `http://localhost:8000` in dev). A relative path
would navigate to the Vite dev server on `:5173`, which has no such route.

**Never renders conditionally on backend configuration.** Research D12: an unconfigured backend
answers `?error=provider` and the visitor sees the retryable message. This is also what lets the
Playwright specs assert presence, label, keyboard reach and theming without a stub provider.

---

## 2. `LoginPage` and `RegisterPage` (FR-001, FR-026, FR-028)

Layout, both pages:

```
<h1>                              existing
<form class="auth-form">          existing; fields, validation and submit entirely unchanged
  [error region role="alert"]     LoginPage: existing element, now also carries ?error=
                                  RegisterPage: NEW element (see below)
  <fieldset> … </fieldset>
  <p class="auth-form__link">
</form>
<div class="auth-alt">            NEW
  <span class="auth-alt__label">or</span>      ← the separation, in TEXT
  <GoogleSignInButton redirectTo={…} />
</div>
```

**The two pages do not start from the same place.** `LoginPage.tsx` already renders
`{formError ? <p className="auth-form__error" role="alert">{formError}</p> : null}` — the `?error=`
message reuses it. `RegisterPage.tsx` has **no form-level error region at all**: it surfaces only
per-field `AuthField` errors, and `auth-form__error` appears nowhere in it (in the whole SPA that
element lives only in `LoginPage.tsx` and `UploadPage.tsx`). So the register page **gains** the
region, written to match `LoginPage`'s conditional one exactly. Everything else about that form —
`RegisterFields`, `useAuthForm`, the validation and the submit path — is untouched; this is a
sibling element, not a change to the form's behaviour.

**FR-026 is about the word "or", not the rule.** The requirement is that the two sign-in methods
be distinguished by **text**, not by colour or position alone. A styled horizontal rule alone does
not satisfy it and does not satisfy SC-010 either. The `<span>` is a real, visible, screen-reader
-reachable label; the rule (if any) is decoration around it.

Tab order: form fields → submit → the register/login link → Google button. Logical and
DOM-ordered; no `tabindex` above 0 anywhere (FR-027, US6 AS2).

### `?error=` handling (FR-007)

Both pages read `useSearchParams().get('error')` and render
`GoogleAuth.errorMessage(code)` into the `auth-form__error` element carrying `role="alert"` —
existing on `LoginPage`, added by this feature on `RegisterPage` (see above).

| code | message |
|---|---|
| `cancelled` | `Google sign-in was cancelled.` |
| `state` | `That sign-in attempt is no longer valid. Please try again.` |
| `unverified_email` | `Google did not confirm an e-mail address for that account. Please use e-mail and password instead.` |
| `already_linked` | `That account is already connected to a different Google account.` |
| `disabled` | `This account is disabled.` |
| `rate_limited` | `Too many sign-in attempts. Please wait a moment and try again.` |
| `provider` | `Google could not be reached. Please try again, or use e-mail and password.` |
| anything else / absent | the `provider` message / no alert |

`disabled` uses **the identical sentence** `LoginPage` already shows for a disabled password login
(SC-006: the same outcome at both front doors).

Unknown codes falling back to the retryable message is what stops a future backend code rendering
a blank alert.

The `?error=` parameter is a **display input only** — it is never used to make an auth decision,
and its value is rendered through the fixed map above, never interpolated. A hand-crafted
`/login?error=<script>` renders nothing but the generic message.

---

## 3. `AccountPage` — sign-in method (FR-029)

One row appended to the existing `<dl class="account__details">`:

```
<dt>Sign-in method</dt>
<dd>{AuthModel.signInMethod(user)}</dd>
```

| `googleLinkedAt` | `hasPassword` | Text |
|---|---|---|
| set | `false` | `Google` |
| `null` | `true` | `Email and password` |
| set | `true` | `Google and email/password` |
| `null` | `false` | `Email and password` (total fallback; unreachable) |

Words, not an icon and not colour (Principle IV). This text is the **only** disclosure that a
Google link was auto-attached to a pre-existing account — the 2026-07-29 clarification recorded
that no email is sent, and the spec's Assumptions accept this text as sufficient.

---

## 4. Theming and responsiveness (FR-028, SC-010, Principle VIII)

- `.auth-alt` and `.google-button` are styled with the existing theme custom properties in
  `frontend/src/styles/theme.css`; both light and dark are defined, neither is hard-coded.
- The Google mark's SVG uses its official fixed brand colours and is legible on both
  backgrounds — it is the one element that does not swap, by design.
- Relative units and the existing fluid auth-form width. No fixed pixel width.
- Verified at 320 px, tablet and wide desktop with no horizontal scroll, clipping or overlap.

---

## 5. Navigation (FR-030)

| Action | Result |
|---|---|
| click the button | full-page navigation to the backend start route |
| Back from Google's consent screen | returns to `/login` or `/register`; **no flow re-triggered** (the button is a click, not an auto-run effect) |
| Back after landing on `/login?error=…` | wherever the visitor was before the flow |
| Refresh `/login?error=…` | the same page, same message; nothing re-runs |
| Refresh after a successful sign-in | the destination page, signed in from the existing session — no trip to Google (FR-019, US2 AS4) |

The callback URL never becomes a history entry the visitor can return to: it is consumed by a
`302`, so the browser replaces it with the destination.

`RequireAnon` continues to send an already-signed-in visitor away from `/login` and `/register`,
which is the client-side mirror of FR-031's server-side no-op.

---

## 6. Test obligations

| Assertion | Where |
|---|---|
| `GoogleAuth.startUrl` builds on `Api.base()` (absolute, not relative) and encodes `redirect` | `frontend/tests/lib/googleAuth.test.ts` |
| `location.state.from` reaches the start URL as `?redirect=`; absent → no parameter | `frontend/tests/pages/LoginPage.test.tsx` |
| every error code maps to its sentence; unknown → generic | `frontend/tests/lib/googleAuth.test.ts` |
| accessible name; Enter and Space activate; second click while pending does not navigate | `frontend/tests/components/GoogleSignInButton.test.tsx` |
| button present on both pages; `?error=` rendered into the `role="alert"` region | `frontend/tests/pages/{LoginPage,RegisterPage}.test.tsx` |
| all four sign-in-method strings | `frontend/tests/pages/AccountPage.test.tsx` |
| presence, accessible name, keyboard reach, 320 px and desktop, light and dark | `frontend/tests/e2e/google-signin.spec.ts` |
