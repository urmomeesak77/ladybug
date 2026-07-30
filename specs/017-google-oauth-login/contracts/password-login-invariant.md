# Contract — the password form after `users.password` becomes nullable

**Feature**: `017-google-oauth-login` | **Requirements**: FR-020, FR-025, SC-007, SC-008 | **Research**: [../research.md](../research.md) D6

Making `users.password` nullable is the one change in this feature that weakens an existing
structural guarantee. This contract states exactly what must remain true afterwards, and is the
checklist a reviewer runs against.

---

## 1. No passwordless account can be signed into by the password form

`POST /api/login` behaviour, for an account with `password IS NULL`:

| Request body | Response | Session |
|---|---|---|
| `{email: <google-only>, password: "anything"}` | `401` | none |
| `{email: <google-only>, password: ""}` | `422` — `LoginRequest` requires the field | none |
| `{email: <google-only>}` (field absent) | `422` | none |
| `{email: <google-only>, password: null}` | `422` | none |

Two independent guards, both required:

1. **`LoginRequest` keeps `password` `required`** — an absent or empty password is rejected at
   validation and never reaches `Auth::attempt()`.
2. **`Hash::check()` fails closed** — `AbstractHasher::check()` returns `false` when the stored
   hash is `null` or `''`, so `Auth::attempt()` cannot succeed even if guard 1 were bypassed.

Guard 2 is framework behaviour, which is why it is **asserted by a test rather than assumed**
(research D6). A framework upgrade that changed it must fail this suite loudly.

---

## 2. The form is not an oracle for which accounts are Google-only

The `401` body for a passwordless account MUST be **byte-identical** to the `401` for a wrong
password on a normal account:

```json
{"message": "These credentials do not match our records."}
```

Same status, same message, same headers. No timing branch is introduced: both paths run the same
`Auth::attempt()` call. (SC-008.)

The disabled-account `403` is unchanged and still runs **after** credentials verify — a
passwordless account never reaches it, because credentials never verify.

---

## 3. Nothing about a password account changes (FR-025, SC-007)

A password account that never touches Google must behave exactly as before:

| Flow | Expectation |
|---|---|
| `POST /api/register` | unchanged — still hashes, still sends the verification mail, still `201` |
| `POST /api/login` | unchanged — `200` / `401` / `403` as today |
| `GET /api/email/verify/{hash}` | unchanged |
| `POST /api/posts`, `POST /api/posts/{hash}/comments` | unchanged — same `verified` gate |
| every admin endpoint | unchanged |

The existing suites for features 007–015 are the regression gate; **not one of their assertions
may be edited to accommodate this feature**. If one fails, the feature is wrong, not the test.

---

## 4. Linking never touches the password (FR-015)

After a US3 auto-link onto a pre-existing password account:

| Attribute | After linking |
|---|---|
| `password` | the identical hash, byte for byte |
| `role`, `rating` | unchanged |
| `disabled_at`, `disabled_by` | unchanged |
| posts, comments | unchanged |
| `email_verified_at` | set **only if it was null** (FR-014, US3 AS4) |

The person can then sign in **either way** — the password form still works with the original
password (SC-004). This is asserted end-to-end: link via Google, then log in with the password.

---

## 5. Assertions this contract requires

| Test | Location |
|---|---|
| passwordless account → `401`, body identical to wrong-password `401` | `tests/Feature/Http/Controllers/AuthControllerTest.php` |
| passwordless account, empty-string password → `422` | `tests/Feature/Http/Controllers/AuthControllerTest.php` |
| passwordless account, absent password → `422` | `tests/Feature/Http/Controllers/AuthControllerTest.php` |
| `Hash::check('', null) === false` and `Hash::check('', '') === false` | `tests/Unit/Models/UserTest.php` |
| password survives a US3 auto-link, and still logs in afterwards | `tests/Feature/Http/Controllers/GoogleAuthControllerTest.php` |
| `users.password` is nullable; the migration reverses on an empty schema | `tests/Feature/Database/SchemaTest.php`, `MigrationReversibilityTest.php` |
