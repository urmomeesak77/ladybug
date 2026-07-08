# Data Model: Registration Email Verification

**Feature**: 008-register-email-verification | **Date**: 2026-07-07

No new tables. The feature is a state machine over one existing column plus an
ephemeral, never-persisted link artifact. *(Amended 2026-07-08: one added
column, `email_sha1`, so links verify session-free — see below.)*

## User account (existing `users` table — extended behaviorally)

| Field | Type | Notes |
|-------|------|-------|
| `id` | bigint PK | Internal only — **never appears in the verification link** (owner requirement, research D3). |
| `email` | string, unique | The address being proven; named on the notice page. |
| `email_sha1` | string(40), indexed | *(Added 2026-07-08, D3 amendment.)* `sha1(email)`, maintained by the model's email mutator + backfilled by migration. Lets a session-free link click resolve its account from the digest the link already carries. |
| `email_verified_at` | nullable timestamp | **The verification record.** `NULL` = unverified; a timestamp = verified at that moment. Already present since the 001 migration; `datetime` cast already on the model. |

**Model change**: `User implements MustVerifyEmail` — enables
`hasVerifiedEmail()`, `markEmailAsVerified()`,
`sendEmailVerificationNotification()`. *(2026-07-08: plus the
`setEmailAttribute` mutator keeping `email_sha1` in step.)*

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
| `hash` | `sha1(user.email)` | In-house `VerifyEmailRequest`: `hash_equals` against the authenticated user's current email digest — binds the link to the account without exposing any id (cross-account use → 403; research D3). |
| `expires` | unix timestamp, issue-time + `auth.verification.expire` (1440 min = 24 h) | `signed:relative` middleware — past expiry → 403. |
| `signature` | HMAC-SHA256 of the **relative** URL (path + ordered query) keyed by `APP_KEY` | `signed:relative` middleware — any alteration of `hash`, `expires`, or the signature itself → 403. |

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
