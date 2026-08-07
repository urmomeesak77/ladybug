# Contract: The Recovery Link and its Email

**Feature**: 022-password-recovery

The one artefact that crosses from the server into the user's inbox and back. Its shape is the
whole of FR-011's "no page prints an account detail" and FR-018's "never appears in the site's own
logs", so it is specified here rather than left to the framework's default.

---

## Shape

```
{FRONTEND_URL}/reset-password/{sha1(email)}#token={token}
```

Example (line-wrapped for reading; it is one line in the message):

```
https://online-trash.com/reset-password/
  b3f1c0e9a2d47c5b8e6f0a1d2c3b4a5968770e1f#token=9f2c…64 hex chars…a17b
```

| Part | Value | Why |
|---|---|---|
| origin | `config('app.frontend_url')` | The link must open a site page, not a bare API response — the same wrapping 008's verification link uses |
| path | `/reset-password/{sha1(email)}` | The digest is the handle 008 already uses, resolvable without a session through the indexed `users.email_sha1`. **No plaintext address appears anywhere in the link**, so the page — and the address bar — print no account detail (FR-011) |
| fragment | `#token=…` | A fragment is never sent to any server: not to nginx's access log, not to Laravel's `ShellController` (which serves every SPA address in production), not in a `Referer` (FR-018, research D2) |

**Built by**: `ResetPassword::createUrlUsing(...)` registered in `AppServiceProvider::boot()`,
directly beside the existing `VerifyEmail::createUrlUsing(...)` call, so the two link builders sit
together and are read together.

**Token**: minted by Laravel's `DatabaseTokenRepository` (`hash_hmac('sha256', Str::random(40),
$key)` → 64 hex characters). Stored bcrypt-hashed; the plaintext exists only in the message and
in the holder's URL fragment (INV-2).

---

## The message

Laravel's stock `Illuminate\Auth\Notifications\ResetPassword`, unmodified, sent through the
project's existing mail path and sender identity (spec, Assumptions — no new delivery mechanism).

It contains **exactly one link and no password** (FR-005), and its "expire in :count minutes" line
reads `config('auth.passwords.users.expire')`, so the message and the enforcement cannot disagree.

Its wording does **not** vary by account state — a Google-only account receives the same message
as any other (spec, Edge Cases: "The wording of the recovery email does not have to differ from
any other").

No "your password was changed" message is sent by either route (spec, Out of Scope).

---

## Reading it back

`ResetPasswordPage` at `/reset-password/:hash`:

1. takes the digest from `useParams().hash`;
2. takes the token from `useLocation().hash` — parsed by `PasswordModel.parseResetFragment`, which
   returns `null` when the fragment is missing or malformed, so the page renders the refusal state
   without issuing a doomed request (the same shape as `AuthModel.parseVerifyParams`);
3. **leaves the fragment in place.** It is not stripped by `history.replaceState`, because FR-024
   requires Refresh to restore the working view — stripping would turn a live link into an
   apparently-expired one on reload (research D3).

---

## Lifetime

| Event | Effect |
|---|---|
| 60 minutes elapse (`auth.passwords.users.expire`) | Refused (FR-007) |
| A newer link is issued for the same address | The older one is refused — the token row is replaced, and the address is the primary key (FR-008, INV-1) |
| The link is used successfully | Consumed; re-opening is refused (FR-014, US2 scenario 6) |
| The password is changed from the account page | Voided (FR-008 second half) |
| The account is deleted or disabled | Refused (FR-015, INV-4) |
| The link is merely **opened** — by the user, an inbox scanner, or an email preview | **Nothing.** The check endpoint is a pure read (FR-012) |

Every refusal above produces the same message and the same status. Nothing in a refusal reveals
which condition applied, or whether the address belongs to an account at all (FR-015, INV-7).

---

## Test hook

`frontend/tests/e2e/helpers/mailLog.ts` gains `latestResetLink(email)`, alongside the existing
`latestVerificationLink(email)`. The e2e stack sets `MAIL_MAILER=log`, so the message lands in
`backend/storage/logs/laravel.log` and the helper extracts the link exactly as a person extracts
it from an inbox — including the fragment, which `page.goto()` then delivers to the SPA unchanged.
