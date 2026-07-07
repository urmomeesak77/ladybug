# Data Model: Registration Email Verification

**Feature**: 008-register-email-verification | **Date**: 2026-07-07

No new tables and no migrations. The feature is a state machine over one
existing column plus an ephemeral, never-persisted link artifact.

## User account (existing `users` table — extended behaviorally)

| Field | Type | Notes |
|-------|------|-------|
| `id` | bigint PK | Appears in the verification link path (research D3). |
| `email` | string, unique | The address being proven; named on the notice page. |
| `email_verified_at` | nullable timestamp | **The verification record.** `NULL` = unverified; a timestamp = verified at that moment. Already present since the 001 migration; `datetime` cast already on the model. |

**Model change**: `User implements MustVerifyEmail` — enables
`hasVerifiedEmail()`, `markEmailAsVerified()`,
`sendEmailVerificationNotification()`. No attribute changes.

### Verification state machine

```text
              valid signed link fulfilled
 UNVERIFIED ────────────────────────────────▶ VERIFIED (email_verified_at = now)
 (email_verified_at NULL)                        │
     ▲    │                                      │ any further link use,
     │    │ resend requested (≤6/min)            │ any resend attempt
     │    ▼                                      ▼
     └── new link issued                    no-op (idempotent; resend → 409)
```

- The only transition is `UNVERIFIED → VERIFIED`, made exactly once (FR-003,
  SC-004). Expired/tampered/mismatched links cause **no transition** (FR-004,
  SC-003).
- Verification is idempotent: fulfilling an already-verified account changes
  nothing (FR-005).
- Accounts created before this feature are `NULL` and thus already in the
  correct UNVERIFIED state — no backfill.

## Verification link (ephemeral — never stored)

Materialized only inside the email message; validated cryptographically, not
against a table.

| Component | Source | Validated by |
|-----------|--------|--------------|
| `id` | user primary key | `EmailVerificationRequest`: must equal the authenticated user's key (cross-account use → 403). |
| `hash` | `sha1(user.email)` | `EmailVerificationRequest`: must match the authenticated user's current email. |
| `expires` | unix timestamp, issue-time + `auth.verification.expire` (1440 min = 24 h) | `signed:relative` middleware — past expiry → 403. |
| `signature` | HMAC-SHA256 of the **relative** URL (path + ordered query) keyed by `APP_KEY` | `signed:relative` middleware — any alteration of `id`, `hash`, `expires`, or the signature itself → 403. |

Validity = signature intact AND not expired AND belongs to the authenticated
account. Each resend mints a fresh link; older unexpired links remain valid
(spec edge case: any still-valid link verifies; later uses are no-ops).

## Frontend types (extensions in `src/lib`)

| Type | Change |
|------|--------|
| `AuthUser` | + `emailVerifiedAt: string \| null` (mapped from the API's `email_verified_at`). |
| `VerifyEmailResult` (new) | Discriminated outcome of `AuthApi.verifyEmail`: `verified` (fresh), `already-verified`, `invalid` (403 — tampered/expired/mismatched), `rate-limited` (429), `network`. |
| `ResendResult` (new) | Outcome of `AuthApi.resendVerification`: `sent`, `already-verified` (409), `rate-limited` (429), `network`. |
| View-state mapping | `AuthModel` maps results to the landing page's `verifying / confirmed / already / failed` states and the notice/account pages' resend feedback. |
