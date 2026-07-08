# Verified-Email Upload Gate — Design

**Date:** 2026-07-08
**Status:** Approved (brainstormed with user; "hide + redirect" UX chosen)

## Problem

`POST /api/posts` (meme upload, from the upload feature) is gated by
`auth:sanctum` only: any signed-in user can post, even with an unverified
e-mail address. Spec 008 (registration e-mail verification) deliberately
deferred enforcement: *"future contribution features (uploads, comments) can
require a verified email"*. Uploads exist now, so this is that follow-up:
**a signed-in but unverified user must not be able to upload content.**

Browsing, signing in, and every read-side route stay open to unverified users
— spec 008's "unverified users are not blocked from signing in or browsing"
remains true.

## Decision summary

| Question | Decision |
| --- | --- |
| Process | Direct change on `master` (no Spec Kit 009 cycle) |
| Enforcement | Laravel's stock `verified` middleware on the store route |
| Unverified UX | Hide the Upload menu entry **and** redirect `/upload` to `/verify-email` |
| API failure shape | `403` from `EnsureEmailIsVerified`, surfaced as a specific form error |

## Backend (the real enforcement)

Add the framework's `verified` middleware alias (`EnsureEmailIsVerified`) to
the store route in `backend/routes/api.php`:

```php
Route::post('/posts', [TrashpostsApiController::class, 'store'])
    ->middleware(['auth:sanctum', 'verified', 'throttle:uploads'])
    ->name('api.posts.store');
```

`App\Models\User` already implements `MustVerifyEmail`, so the middleware
works with zero further wiring. For a JSON request an unverified user receives
**403** `{"message": "Your email address is not verified."}` before
throttling, validation, or any disk/DB work runs.

Alternatives considered and rejected:

- **`CreatePostRequest::authorize()` check** — moves an authorization concern
  into validation plumbing and runs after throttling; more code for the same
  result.
- **Custom middleware with a friendlier message** — the SPA never shows the
  raw middleware message (it maps the 403 client-side), so custom code buys
  nothing.

## Frontend (UX: hide + redirect)

1. **`RequireVerified` component** (`src/components/RequireVerified.tsx`) —
   mirror of `RequireAuth`, composed inside it, so it can assume a resolved,
   authenticated session: if `user.emailVerifiedAt === null`, render
   `<Navigate to="/verify-email" replace />`; otherwise render children. The
   `/verify-email` notice page already explains the situation and offers the
   resend button. Route in `App.tsx`:

   ```tsx
   <Route path="/upload" element={
     <RequireAuth><RequireVerified><UploadPage /></RequireVerified></RequireAuth>
   } />
   ```

2. **`LeftMenu`** — render the Upload entry only for verified users:
   `LeftMenu` computes `showUpload = user.emailVerifiedAt !== null` and passes
   it as a prop to `AuthenticatedLinks`. Home, Account, and Log out are
   unchanged. After the user verifies, `VerifyEmailPage` already refreshes the
   auth context, so the Upload entry appears without a reload.

3. **Defense in depth in the form** — a stale SPA session can still reach the
   form (e.g. verification state changed server-side after the route gate
   passed). `UploadApi.interpret` maps `403` to a new result
   `{ ok: false, kind: 'unverified' }`, and `useUploadForm` shows
   "Verify your e-mail address before posting." instead of the generic error.

## Error handling

- Unverified `POST /api/posts` → 403, no `Trashpost` row, no file writes.
- Unverified visit to `/upload` → replace-redirect to `/verify-email` (no
  history junk entry).
- `RequireVerified` renders `null` only via `RequireAuth`'s existing
  `unknown`-session handling; it never flashes the form before redirecting.

## Testing

Tests mirror source paths (Constitution Principle VII); both stacks keep their
≥90% line-coverage CI gates.

- **Backend** (`tests/Feature/Http/Controllers/CreatePostTest.php`):
  unverified user (`User::factory()->unverified()`) posting a valid payload →
  403 and no post created. Existing tests use `User::factory()->create()`
  (verified by default via `email_verified_at => now()`), so they keep passing.
- **Frontend** (Vitest):
  - `tests/components/RequireVerified.test.tsx` — verified renders children;
    unverified redirects to `/verify-email`.
  - `tests/components/LeftMenu.test.tsx` — Upload entry present for a verified
    user, absent for an unverified one.
  - `tests/lib/uploadApi.test.ts` — 403 → `kind: 'unverified'`.
  - `tests/hooks/useUploadForm.test.tsx` — unverified result → the specific
    form error message.

## Out of scope

- Comments (do not exist yet) and any other future contribution surface.
- Playwright e2e additions (unit/feature coverage is sufficient for a gate
  this small; e2e upload specs, where present, run as verified users).
- Any change to who can browse, sign in, or verify.
