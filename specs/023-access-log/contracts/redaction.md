# Contract: The Sensitive Field List

**Feature**: `023-access-log` | Covers FR-013 – FR-017, FR-019, US2, SC-003

FR-015 requires **one** named list, applied identically everywhere, "so a rule cannot be
enforced in one place and forgotten in another". This is that list, its default contents, and
the rules that govern how it is applied. It lives in `config/access_log.php` and is consumed
only by `App\Support\AccessLogRedactor`.

This is the contract that makes the table safe to keep. Without it the history is a credential
dump with a query interface.

---

## Matching rules

1. **Name-based, never content-based.** A value is withheld because of the name it was
   submitted under, not because of what it looks like. The system never inspects a value to
   guess whether it is a secret — that would both miss weak passwords and shred legitimate
   high-entropy content such as a meme hash.
2. **Case-insensitive on the key.** `Password`, `PASSWORD` and `password` all match.
3. **Exact match against `sensitive`, prefix match against `sensitive_prefixes`.**
4. **Applied at every nesting depth.** The redactor recurses into arrays, so
   `user[password]` and a nested JSON document are covered as thoroughly as a flat field.
5. **Applied to every recorded map**: `query`, `input`, and `cookies` — the same list, the same
   pass, in `query`/`input`/`cookies` order with no per-map exceptions (FR-015).
6. **The withheld value is replaced, not removed.** The key survives with the literal string
   `[redacted]` as its value, so an operator can see that the field was present without seeing
   what it held (FR-014). A removed key would be indistinguishable from a field that was never
   submitted.
7. **Everything not on the list is recorded in full**, subject only to the size cap (FR-016).
   Meme titles, comment bodies, feed cursors, e-mail addresses and usernames are all kept —
   that is what makes the history diagnostically useful, and FR-008b depends on the submitted
   identifier being there.

### Ordering (fixed, and load-bearing)

**redact → UTF-8 coerce → truncate.**

Any other order breaks something concrete: truncating first turns a 100 KB password into a
64 KB *partial password* still sitting in the row; cutting bytes before coercion can split a
multi-byte character and produce the invalid sequence FR-019 exists to prevent.

---

## Default `sensitive` list

| Name | Why it is on the list |
|---|---|
| `password` | 007 registration/login, 022 reset — FR-013 |
| `password_confirmation` | 007 registration, 022 reset — FR-013 |
| `current_password` | 022 account-page password change — FR-013 |
| `new_password` | defensive: a plausible field name for the same secret |
| `token` | **Load-bearing today, not defensive.** 022's reset token is submitted as a form field on every reset — `ResetPasswordRequest` and `CheckResetTokenRequest` both `require` it. See the note below before ever trimming this entry. |
| `_token` | Laravel's CSRF field — FR-013 "cross-site request token" |
| `remember_token` | the `users` column 022 rotates on every password change |
| `api_token` / `access_token` / `refresh_token` / `id_token` | OAuth and bearer credentials — FR-013 "authorization credential" |
| `secret` / `client_secret` | Google OAuth client secret (017) |
| `authorization` | the header name as a field/cookie namesake |
| `signature` | 008's **signed verification links** put their signature in the query string. This is a one-time link token in FR-013's sense and US2 scenario 3 tests exactly it. |
| `code` | Google OAuth authorisation code (017) — single-use, exchangeable for a session |
| `state` | Google OAuth CSRF state (017) |
| `credential` | Google's One Tap credential (a signed ID token) |

## Default `sensitive_prefixes` list

| Prefix | Why |
|---|---|
| `remember_web_` | Laravel's own recaller cookie is `remember_web_<sha1 of guard>` — a per-deployment name that cannot be listed exactly |

## Cookies, resolved at runtime

Three cookie names are not literals — they are configured per deployment, so the redactor
resolves them from config rather than hard-coding them:

| Cookie | Resolved from | Why |
|---|---|---|
| session cookie | `config('session.cookie')` | the session id. Storing it would let anyone with read access to the table impersonate any signed-in user — the exact scenario US2 opens with, and what SC-003 searches for. |
| `XSRF-TOKEN` | literal | Laravel's CSRF cookie — FR-013 |
| remember cookie | `config('remember.cookie')` | 018's remember-me flag cookie (`online-trash-remember` by default) |

Resolving these from config matters: `config/remember.php` derives its cookie name from
`APP_NAME`, so a hard-coded literal would silently stop matching on a deployment that renamed
the app — a redaction rule that fails open is worse than no rule.

---

## 022's recovery token: what the fragment does and does not protect

It is easy to read 022's design as meaning the recovery token never reaches the server. It is
worth being exact, because the `token` entry above depends on the distinction.

**What the fragment protects: URLs.** The recovery link carries its one-time token in the URL
**fragment** (`#token=…`), which browsers never transmit. That is why the token appears in
neither nginx's access log nor `laravel.log`, and why it never lands in this feature's `path` or
`query` columns — which matters, because paths are not redacted at all.

**What it does not protect: request bodies.** `ResetPasswordPage` reads the fragment in the
browser and **submits the token to the server as a form field**. `App\Http\Requests\ResetPasswordRequest`
and `App\Http\Requests\CheckResetTokenRequest` both declare `'token' => ['required', 'string']`,
so every reset and every link-validity probe posts a live one-time credential in its body — a
body this feature records as parsed fields (FR-005, FR-005a). `token` is therefore doing real work in the list **right
now**, on `POST /api/reset-password` and its check endpoint, and US2 scenario 3 plus SC-003 rest
directly on it. Removing it would put a working password-reset credential in the history in
readable form. The two live call sites are `POST /api/password/reset` and
`POST /api/password/reset/check`.

The recovery link's path component is `sha1(email)`, not a plaintext address. Paths are not
redacted, and that one needs no redaction.

**Request headers are not recorded at all**, apart from `User-Agent`, `Referer` and
`X-Forwarded-For` (FR-011, FR-002). So an `Authorization: Bearer …` header is never stored —
not because it is redacted, but because headers are outside the recorded shape. `authorization`
stays on the list to cover a field or cookie of that name.

---

## Files: not redacted, never stored (FR-017)

Uploaded file **contents are never read**. For each file in `$request->allFiles()` the entry
records only:

```
{ "field": "image", "name": "cat.gif", "mime": "image/gif", "size": 1048576 }
```

This is why an upload at the site's 20 MiB ceiling yields a small entry (SC-005) rather than a
truncated one — the upload path is bounded by *what is recorded*, not by truncation. It is also
why the raw body is not stored for multipart requests (FR-005a, research D5): the raw multipart
body **is** the file. An upload *past* that ceiling never reaches this code at all; it is
refused for its size and recorded with empty parameter and file maps (SC-005b).

The filename is visitor-supplied and is therefore truncated and UTF-8-coerced like any other
value. It is never used as a path, and nothing in this feature ever writes a file.

---

## Truncation marker (FR-018, SC-005a)

A capped value is cut on a UTF-8 character boundary at or below `value_limit` bytes and gains
the constant suffix:

```
 …[truncated]
```

Exactly: U+0020, U+2026, then the eleven ASCII characters `[truncated]` — **15 bytes** in UTF-8,
since the ellipsis is three (`E2 80 A6`) and the rest are one each. It is a single literal
constant in `AccessLogRedactor`, never assembled from parts, so no call site can spell it
differently, and every length rule below is expressed against that constant's `strlen` rather
than against the number 15 written out again.

**The marker sits outside the budget.** The value is cut to at most `value_limit` bytes *first*,
and the 15-byte suffix is appended after, so a truncated field occupies up to
`value_limit + 15` bytes. This is the only reading under which SC-005a's two clauses can both
hold — that the stored copy is "exactly the limit's worth" *and* that it is marked. It is also
why `body` is `longtext` rather than `TEXT` ([data-model.md](../data-model.md) → Field notes):
at the default limit, a marked value overflows `TEXT`'s 65535 bytes by design.

So an operator can never mistake a partial value for a complete one. SC-005a asserts the
neighbouring values in the same request are recorded in full and **unmarked**, which is what
proves the limit is per value (FR-018a) rather than shared across the entry.

---

## Verification (US2 Independent Test, SC-003)

The test that matters is end-to-end, not unit-level: run a complete authentication journey —
register, verify, sign in, change password, request a recovery link, reset the password, sign
out — then search the **entire** stored history for the plaintext passwords used and for the
browser's session identifier. Both searches must return zero matches while every surrounding
entry remains present with its path and response code intact.

[quickstart.md](../quickstart.md) scripts this. It is a hard gate on shipping, per US2's
priority note.
