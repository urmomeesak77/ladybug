# Contract: Frontend Routes & Modules

**Feature**: 008-register-email-verification

## Routes (App.tsx)

| Route | Guard | Page | Purpose |
|-------|-------|------|---------|
| `/verify-email` | `RequireAuth` | `VerifyEmailNoticePage` (new) | Post-registration notice (FR-007): "check your inbox at {email}" + resend button. |
| `/verify-email/:hash` | `RequireAuth` | `VerifyEmailPage` (new) | Link landing: forwards `:hash` (sha1 of the user's email — no ids in URLs) + `?expires&signature` to the API; renders the outcome. |

Both are real, refresh-safe URLs (FR-010): the landing page re-calls the
idempotent API on refresh and reproduces the same view; history entries behave
normally.

## Page contracts

### `VerifyEmailNoticePage` (new)

- Reads the signed-in user from auth context; states the registered address in
  text.
- If the user is **already verified**: states so and links to `/account`
  (visiting the notice URL later must not mislead).
- Resend button → `AuthApi.resendVerification()`; outcome announced via the
  existing notice dialog (`sent` / `already-verified` / rate-limited "try again
  in a minute" / network error). Button disabled while in flight.

### `VerifyEmailPage` (new)

On mount, parses `:hash` + `expires`/`signature` query params and calls
`AuthApi.verifyEmail`. View states (all at the same URL, server-derived):

| State | Trigger | Content |
|-------|---------|---------|
| `verifying` | request in flight | progress text (not color-only) |
| `confirmed` | 200, `already_verified: false` | success message + link onward (Home/account); auth context `refresh()`ed so `emailVerifiedAt` updates everywhere |
| `already` | 200, `already_verified: true` | "already verified" info, no error (FR-005) |
| `failed` | 403 / malformed params | "link invalid or expired" + resend button (FR-004); rate-limit and network failures get their own retryable message |

Anonymous visitors never reach the page: `RequireAuth` bounces to `/login`
carrying the location, and login returns here — the link survives sign-in
(spec scenario 4).

### Edits to existing pages/components

| File | Change |
|------|--------|
| `RegisterPage` | On success: `navigate('/verify-email')` instead of `/` (FR-007). Welcome notice message mentions checking email. |
| `AccountPage` | New "Email verification" row in the details list: "Verified"/"Not verified" **in text** (Principle IV); when unverified, a resend button with the same outcome handling as the notice page (FR-008, US3). |
| `RequireAuth` | `<Navigate to="/login" replace state={{ from: location }} />` — preserves the blocked destination. |
| `LoginPage` | On success: `navigate(state.from ?? '/')` (research D9). |
| `AuthProvider` / `useAuth` | Context gains `refresh(): Promise<void>` — re-runs the `/api/user` probe so `emailVerifiedAt` propagates after verification. |

## `lib/` API (coverage-gated, class-static per conventions)

### `AuthApi` additions

```ts
type VerifyEmailInput = { hash: string; expires: string; signature: string };

type VerifyEmailResult =
  | { ok: true; user: AuthUser; alreadyVerified: boolean }   // 200
  | { ok: false; kind: 'invalid' }                           // 403 (tampered/expired/mismatch)
  | { ok: false; kind: 'rate-limited' }                      // 429
  | { ok: false; kind: 'network' };                          // anything else

type ResendResult =
  | { ok: true }                                             // 200
  | { ok: false; kind: 'already-verified' }                  // 409
  | { ok: false; kind: 'rate-limited' }                      // 429
  | { ok: false; kind: 'network' };

AuthApi.verifyEmail(input: VerifyEmailInput): Promise<VerifyEmailResult>
AuthApi.resendVerification(): Promise<ResendResult>
// AuthUser gains emailVerifiedAt: string | null (from email_verified_at)
```

`verifyEmail` GETs
`/api/email/verify/{hash}?expires=…&signature=…` with
`credentials: 'include'`; `resendVerification` POSTs through the existing
CSRF-aware `postJson` path.

### `AuthModel` additions

- `parseVerifyParams(params, query)` → `VerifyEmailInput | null` (missing or
  blank components ⇒ `null` ⇒ page renders `failed` without a doomed request).
- Result→view-state mapping helpers for the landing page and resend feedback,
  keeping the pages thin declarative glue.

## E2E (Playwright, `frontend/e2e/`)

- `helpers/mailLog.ts` (new, in-house): read
  `backend/storage/logs/laravel.log`, decode quoted-printable (`=3D`, `=\n`
  soft breaks), return the newest `/verify-email/...` URL — optionally filtered
  by recipient address.
- `verify-email.spec.ts` (new): register a unique user → notice page names the
  address → extract link from the log → open it → confirmation shown →
  `/account` states "Verified". A second spec case covers the resend button and
  an anonymous-link-open → login → verified path (scenario 4).
- Requires `backend/.env.e2e`: `MAIL_MAILER=log`,
  `FRONTEND_URL=http://localhost:5174`.

## Mirrored tests (Vitest — gate spans all of `src/`)

Every touched/new module gets its mirror under `frontend/tests/`:
`lib/authApi.test.ts`, `lib/authModel.test.ts`, `hooks/useAuth.test.tsx`,
`components/AuthProvider.test.tsx`, `components/RequireAuth.test.tsx`,
`pages/LoginPage.test.tsx`, `pages/RegisterPage.test.tsx`,
`pages/AccountPage.test.tsx`, `pages/VerifyEmailNoticePage.test.tsx`,
`pages/VerifyEmailPage.test.tsx`.
