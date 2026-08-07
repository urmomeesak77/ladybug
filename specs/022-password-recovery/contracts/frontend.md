# Contract: Frontend Surface

**Feature**: 022-password-recovery

---

## 1. Addresses

Two new SPA routes. Each must be added to **both** `frontend/src/App.tsx` and
`backend/app/Support/SpaRoutes.php` in the same commit — the mirror rule 016 established; a route
added on one side only answers 404 to every crawler and unfurler while rendering fine in a
browser.

| Address | Component | Guard | Indexable | In `disallowedPaths()` |
|---|---|---|---|---|
| `/forgot-password` | `ForgotPasswordPage` | **none** | no | yes |
| `/reset-password/{hash}` | `ResetPasswordPage` | **none** | no | yes (`/reset-password` prefix) |

`SpaRoutes` additions: `FORGOT_PASSWORD` in `STATIC_ROUTES` (`=> false`) and
`RESET_PASSWORD_HASH` in `DYNAMIC_ROUTES` with pattern `#^/reset-password/[0-9a-f]{40}$#`
(sha1 is 40 lowercase hex characters — a narrower shape than the 10-char meme pattern, so a
malformed digest never becomes a query).

**No guard on either route** (research D11): `RequireAnon` would bounce a signed-in person away
from a link the spec requires to be honoured for the account it names. `/account` keeps its
existing `RequireAuth` — the password section adds no address and no new guard (FR-025, FR-026).

---

## 2. `ForgotPasswordPage` — `/forgot-password`

Built on `useAuthForm` + `AuthField`, so it is structurally the same form as `/login` (FR-022).

| State | Rendered |
|---|---|
| **form** | H1 "Reset password", one e-mail field, submit "Send recovery link", and a link back to `/login` |
| **sent** | The confirmation, replacing the form: *"If an account exists for that address, a password recovery link is on its way. Check that inbox."* |

- Client-side validation is `AuthModel`'s existing e-mail check, for feedback only; the server
  re-validates (FR-003). An empty or malformed address is flagged inline via `AuthField`'s
  `role="alert"` text and the entered value is preserved (US1 scenario 4).
- **The confirmation is rendered for every 200**, and the page never has information to render
  anything else — `PasswordApi.requestLink` resolves to `{ ok: true }` for any 200 regardless of
  what happened server-side (FR-004).
- `429` shows the shared rate-limit sentence; a network failure shows the shared retry sentence.
  Neither mentions an account.

---

## 3. `ResetPasswordPage` — `/reset-password/:hash`

Four states, all at one address, all restored correctly by Back/Forward/Refresh (FR-024).

| State | Entered when | Rendered |
|---|---|---|
| **checking** | on mount | the shared pending state |
| **form** | `POST /api/password/reset/check` → `204` | H1 "Choose a new password", new-password + confirmation fields, submit "Set password". **No current-password field** (FR-011). **No e-mail, name, or any other account detail anywhere on the page** (FR-011, INV-7) |
| **dead** | check → `403`, or the fragment is missing/malformed | *"This password recovery link is no longer valid."* plus a `<Link to="/forgot-password">Request a new link</Link>* (FR-015, US4 scenario 5) |
| **done** | `POST /api/password/reset` → `200` | *"Your password has been changed. Please log in."* plus a link to `/login` (FR-014, FR-021) |

- The check runs **once, on mount** — not again after a failed submit, because a policy failure
  leaves the link untouched (FR-013) and re-checking would burn the rate-limit budget (research
  D8).
- A `422` from the submit renders the server's field messages inline and **stays in the `form`
  state** — the link is still good (US2 scenarios 3 & 4).
- A `403` from the submit moves the page to `dead`.
- **The page never signs anyone in.** On success it links to `/login`; it does not call
  `useAuth().login` and does not refresh auth state (FR-021).
- Password inputs carry `autoComplete="new-password"` and are never repopulated after a
  submission (FR-024).

---

## 4. `LoginPage` — one added control

A `<Link to="/forgot-password">Forgot password?</Link>` inside `.auth-form`, beside the existing
"No account? Register here...." line and styled the same way (FR-001). Nothing else on the page
changes.

---

## 5. `AccountPasswordForm` on `/account`

Rendered by `AccountPage` directly after `<AccountNameForm />`, mirroring its markup, its
`fieldset disabled={saving}` pattern, its inline `role="alert"` error and its `role="status"`
success line (FR-022, FR-026).

**Two shapes, chosen from `user.hasPassword`** — which `UserResource` already exposes, so no extra
question is put to the user (spec, Assumptions):

| `hasPassword` | Fields | Stated in text |
|---|---|---|
| `true` | Current password · New password · Confirm new password | — |
| `false` | New password · Confirm new password | *"You sign in with Google. Setting a password adds a second way in — your Google sign-in keeps working."* (FR-031's "MUST state which case it is in, in text") |

- The current-password field is **omitted from the DOM**, not disabled or hidden, when
  `hasPassword` is false (FR-031).
- On `200`: show "Password updated.", clear all three fields, and call `useAuth().refresh()` so
  `hasPassword` and the "Sign-in method" line pick up a newly added password credential. **The
  client stays signed in** (FR-028).
- On `422` for `current_password`: flag that field inline; **neither the new password nor the
  confirmation is repopulated** (US3 scenario 3) — all three inputs are cleared on any refusal.
- On `429`: the shared rate-limit sentence (FR-030).
- On `401`: the shared "please sign in again" sentence; the `RequireAuth` guard takes over on the
  next render (spec, Edge Cases).

---

## 6. `lib/` additions — classes of statics, per the conventions

### `PasswordApi` (`src/lib/passwordApi.ts`)

Same `Csrf.ensure()` + `credentials: 'include'` fetch shape as `AuthApi`.

| Method | Calls | Resolves to |
|---|---|---|
| `requestLink(email)` | `POST /api/password/forgot` | `{ ok: true }` \| `{ ok: false, kind: 'validation', errors }` \| `'rate-limited'` \| `'network'` |
| `checkToken(hash, token)` | `POST /api/password/reset/check` | `{ ok: true }` \| `'invalid'` \| `'rate-limited'` \| `'network'` |
| `reset(input)` | `POST /api/password/reset` | `{ ok: true }` \| `'validation'` \| `'invalid'` \| `'rate-limited'` \| `'network'` |
| `changePassword(input)` | `PUT /api/user/password` | `{ ok: true, user }` \| `'validation'` \| `'auth'` \| `'rate-limited'` \| `'network'` |

`changePassword` maps its `200` through `AuthApi.mapUser`, so the refreshed `hasPassword` reaches
the account page in the shape the rest of the SPA already speaks.

### `PasswordModel` (`src/lib/passwordModel.ts`)

| Member | Purpose |
|---|---|
| `policyErrors(password)` | The client-side mirror of the server policy — **moved here** from `AuthModel`'s private `passwordPolicyErrors`, which now delegates to it, so registration, recovery, and the account page cannot drift (research D9) |
| `parseResetFragment(hash)` | `location.hash` → `token` string, or `null` when absent/malformed |
| `validateReset(values, touched?)` | `useAuthForm`-shaped validator: policy + confirmation match |
| `validateChange(values, hasPassword, touched?)` | The same, plus a required `currentPassword` only when `hasPassword` |
| `resetFailureMessage(kind)` | One sentence per failure kind, in text (Principle IV) |
| `changeFailureMessage(result)` | Server field message when there is one, else the shared fallbacks — the shape `AuthModel.nameUpdateError` already uses |

---

## 7. Accessibility and responsiveness

Both pages are the existing `.auth` / `.auth-form` shell and the section is the existing
`.account` block, so no new CSS width, breakpoint, or colour is introduced (Principles IV and
VIII). Concretely:

- every input has an associated `<label>` (`AuthField`'s visually-hidden label; a visible one in
  the account section, matching `AccountNameForm`);
- every error is text carried by `role="alert"` and tied to its input by `aria-describedby` +
  `aria-invalid`, never colour alone (FR-023);
- every outcome — sent, dead link, wrong current password, Google-only account — is a sentence,
  not an icon or a colour;
- both pages reflow from 320px up with no horizontal scrolling, inheriting the auth forms' fluid
  layout (SC-008).
