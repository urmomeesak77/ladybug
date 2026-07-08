# Verified-Email Upload Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in but unverified user cannot upload content: `POST /api/posts` rejects with 403, the Upload menu entry is hidden, and `/upload` redirects to the existing `/verify-email` notice page.

**Architecture:** Backend enforcement is Laravel's stock `verified` middleware (`EnsureEmailIsVerified`) on the store route — `User` already implements `MustVerifyEmail`. Frontend adds a `RequireVerified` route gate (composed inside `RequireAuth`), hides the Upload menu entry for unverified users, and maps an API 403 to a specific form error as defense in depth.

**Tech Stack:** Laravel 12 + Sanctum (PHPUnit), React 18 + react-router-dom (Vitest + @testing-library/react).

**Spec:** `docs/superpowers/specs/2026-07-08-verified-upload-gate-design.md`

## Global Constraints

- No new dependencies (Constitution Principle I) — everything used already ships with the stacks.
- `docs/CODING_CONVENTIONS.md` is binding: 2-space TS / 4-space PHP + `declare(strict_types=1)`, semicolons, comments explain *why*, lib logic in classes, components/hooks stay functions.
- **Backend has no local PHP:** run every backend command in the `ladybug-php` Docker image from the repo root, e.g. `docker run --rm -v "${PWD}/backend:/app" ladybug-php php artisan test`. Tests run on sqlite `:memory:` only (`Tests\TestCase` hard-aborts otherwise).
- Frontend commands run in `frontend/`.
- Coverage gates (exact CI invocations): backend `php artisan test --coverage` ≥90%; frontend `npx vitest run --coverage --coverage.thresholds.lines=90`.
- Lint gates: backend `vendor/bin/pint --test`; frontend `npm run lint`.
- Commit on the current branch (`master`); do not create branches. Push after each committed task.
- Every commit message ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Note: there is a stray untracked `backend/backend/` directory in the worktree — do NOT `git add` it; leave it alone.

---

### Task 1: Backend — `verified` middleware on the store route

**Files:**
- Modify: `backend/routes/api.php:21-23`
- Test: `backend/tests/Feature/Http/Controllers/CreatePostTest.php`

**Interfaces:**
- Produces: `POST /api/posts` returns 403 (`{"message": "Your email address is not verified."}`) for authenticated users whose `email_verified_at` is null; behavior for verified users is unchanged.
- Consumes: `User` implements `MustVerifyEmail` (already true); `User::factory()->unverified()` (exists).

- [x] **Step 1: Write the failing test**

In `backend/tests/Feature/Http/Controllers/CreatePostTest.php`, add alongside the existing tests (match the file's existing payload style — reuse the same valid YouTube payload an existing happy-path test posts, so the 403 is unambiguously the verification gate and not validation):

```php
public function test_unverified_user_cannot_create_post(): void
{
    $user = User::factory()->unverified()->create();

    $response = $this->actingAs($user)->postJson('/api/posts', [
        'title' => 'Blocked post',
        'youtube' => 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    ]);

    $response->assertStatus(403);
    $this->assertDatabaseCount('trashposts', 0);
}
```

- [x] **Step 2: Run test to verify it fails**

Run: `docker run --rm -v "${PWD}/backend:/app" ladybug-php php artisan test --filter=test_unverified_user_cannot_create_post`
Expected: FAIL — 201 (or 422) received instead of 403; a post row may exist.

- [x] **Step 3: Implement**

In `backend/routes/api.php`, add `verified` to the store route's middleware and extend the comment's *why*:

```php
// Create a post (image upload or YouTube link). Authenticated only (Sanctum SPA session)
// AND verified-email only ('verified' = EnsureEmailIsVerified, 403 otherwise) — the
// enforcement spec 008 deferred to contribution features. Throttled per user: uploads
// are heavier than reads (image processing, disk writes).
Route::post('/posts', [TrashpostsApiController::class, 'store'])
    ->middleware(['auth:sanctum', 'verified', 'throttle:uploads'])
    ->name('api.posts.store');
```

- [x] **Step 4: Run tests to verify they pass**

Run: `docker run --rm -v "${PWD}/backend:/app" ladybug-php php artisan test`
Expected: PASS — the new test and the whole existing suite (existing upload tests use `User::factory()->create()`, which is verified by default).

- [x] **Step 5: Lint + commit + push**

Run: `docker run --rm -v "${PWD}/backend:/app" ladybug-php vendor/bin/pint --test` — expected exit 0.

```bash
git add backend/routes/api.php backend/tests/Feature/Http/Controllers/CreatePostTest.php
git commit -m "feat(upload): require a verified e-mail to create posts"
git push
```

---

### Task 2: Frontend — `RequireVerified` route gate

**Files:**
- Create: `frontend/src/components/RequireVerified.tsx`
- Modify: `frontend/src/App.tsx:33` (wrap UploadPage)
- Test: `frontend/tests/components/RequireVerified.test.tsx`

**Interfaces:**
- Consumes: `useAuth()` (`user.emailVerifiedAt: string | null`), `Navigate` from react-router-dom.
- Produces: `<RequireVerified>{children}</RequireVerified>` — renders children for a verified user; replace-redirects an unverified user to `/verify-email`. Must sit INSIDE `RequireAuth` (it assumes the session is resolved and authenticated).

- [x] **Step 1: Write the failing test**

Create `frontend/tests/components/RequireVerified.test.tsx`, mirroring `tests/components/RequireAuth.test.tsx`'s harness (AuthContext provider + MemoryRouter + a route for `/verify-email` asserting the redirect landed). Cases:

1. verified user (`emailVerifiedAt: '2026-07-08T00:00:00Z'`) → children render;
2. unverified user (`emailVerifiedAt: null`) → the `/verify-email` route's marker renders, children do not;
3. `user === null` (defensive: mounted outside RequireAuth) → renders nothing.

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/RequireVerified.test.tsx`
Expected: FAIL — module `../../src/components/RequireVerified` does not exist.

- [x] **Step 3: Implement**

Create `frontend/src/components/RequireVerified.tsx` in `RequireAuth`'s style:

```tsx
import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';

import { useAuth } from '../hooks/useAuth';

// Gate for verified-only routes (the upload form). Composed inside RequireAuth, so the
// session is already resolved and authenticated; the null guard only satisfies type
// narrowing. Unverified users land on the notice page, which explains the situation
// and offers the resend action — `replace` so Back does not bounce through the gate.
function RequireVerified({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!user) {
    return null;
  }
  if (user.emailVerifiedAt === null) {
    return <Navigate to="/verify-email" replace />;
  }
  return <>{children}</>;
}

export default RequireVerified;
```

In `frontend/src/App.tsx`, import it and wrap the upload route:

```tsx
<Route path="/upload" element={<RequireAuth><RequireVerified><UploadPage /></RequireVerified></RequireAuth>} />
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/components/RequireVerified.test.tsx tests/components/RequireAuth.test.tsx`
Expected: PASS.

- [x] **Step 5: Commit + push**

```bash
git add frontend/src/components/RequireVerified.tsx frontend/src/App.tsx frontend/tests/components/RequireVerified.test.tsx
git commit -m "feat(upload): redirect unverified users from /upload to the verify notice"
git push
```

---

### Task 3: Frontend — hide the Upload menu entry for unverified users

**Files:**
- Modify: `frontend/src/components/LeftMenu.tsx`
- Test: `frontend/tests/components/LeftMenu.test.tsx`

**Interfaces:**
- Produces: `AuthenticatedLinks({ showUpload, onLogout })` — the Upload `<li>` renders only when `showUpload` is true. `LeftMenu` computes `showUpload` from `user.emailVerifiedAt !== null`.

- [x] **Step 1: Write the failing test**

In `frontend/tests/components/LeftMenu.test.tsx`, the shared `user` fixture must be verified (`emailVerifiedAt` non-null) so existing assertions ("offers Home, Upload, Account and Log out") stay meaningful; adjust the fixture if it currently has `emailVerifiedAt: null`. Add:

```tsx
it('hides the Upload entry for an unverified user', () => {
  const unverified = { ...user, emailVerifiedAt: null };
  renderMenu(authValue({ status: 'authenticated', user: unverified }));

  expect(screen.queryByRole('link', { name: 'Upload' })).toBeNull();
  // The rest of the authenticated menu is untouched.
  expect(screen.getByRole('link', { name: 'Account' })).toBeTruthy();
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/LeftMenu.test.tsx`
Expected: the new test FAILS — the Upload link renders for the unverified user.

- [x] **Step 3: Implement**

In `frontend/src/components/LeftMenu.tsx`:

```tsx
// Upload is verified-only (the API rejects unverified posts with 403); hiding the
// entry keeps the menu honest about what the user can actually do right now.
function AuthenticatedLinks({ showUpload, onLogout }: { showUpload: boolean; onLogout: () => void }) {
```

Wrap the Upload `<li>` in `{showUpload ? (…) : null}`. In `LeftMenu`, pass the prop:

```tsx
<AuthenticatedLinks showUpload={user.emailVerifiedAt !== null} onLogout={() => void handleLogout()} />
```

(`isAuthenticated` already guarantees `user !== null` on this branch; if TypeScript cannot see that through the ternary, narrow with the existing `isAuthenticated && user !== null` pattern rather than `user!`.)

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/components/LeftMenu.test.tsx`
Expected: PASS (new + existing tests).

- [x] **Step 5: Commit + push**

```bash
git add frontend/src/components/LeftMenu.tsx frontend/tests/components/LeftMenu.test.tsx
git commit -m "feat(upload): show the Upload menu entry only to verified users"
git push
```

---

### Task 4: Frontend — map the API 403 to a specific form error

**Files:**
- Modify: `frontend/src/lib/uploadApi.ts` (`UploadResult` union + `interpret`)
- Modify: `frontend/src/hooks/useUploadForm.ts` (message mapping)
- Test: `frontend/tests/lib/uploadApi.test.ts`, `frontend/tests/hooks/useUploadForm.test.tsx`

**Interfaces:**
- Produces: `UploadResult` gains `{ ok: false; kind: 'unverified' }`; `UploadApi.interpret` returns it for status 403; `useUploadForm` renders it as the form error "Verify your e-mail address before posting.".

- [x] **Step 1: Write the failing tests**

In `frontend/tests/lib/uploadApi.test.ts` (match the file's existing fetch-stub style for 401/422):

```ts
it('maps 403 to an unverified result', async () => { /* stub fetch → 403; expect { ok: false, kind: 'unverified' } */ });
```

In `frontend/tests/hooks/useUploadForm.test.tsx` (match the existing 'auth' error-message test):

```tsx
it('shows the verification message when the API says unverified', async () => {
  /* mock UploadModel.submit → { ok: false, kind: 'unverified' }; submit;
     expect formError toBe 'Verify your e-mail address before posting.' */
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/uploadApi.test.ts tests/hooks/useUploadForm.test.tsx`
Expected: FAIL — 403 currently maps to `kind: 'network'`, so the message is the generic one (and TypeScript rejects the `'unverified'` literal until the union grows).

- [x] **Step 3: Implement**

`frontend/src/lib/uploadApi.ts` — extend the union and `interpret`:

```ts
export type UploadResult =
  | { ok: true; hash: string }
  | { ok: false; kind: 'validation'; errors: FieldErrors }
  | { ok: false; kind: 'auth' }
  | { ok: false; kind: 'unverified' }
  | { ok: false; kind: 'network' };
```

In `interpret`, after the 401 branch:

```ts
    if (response.status === 403) {
      // The 'verified' middleware refused: the session is fine but the e-mail is not
      // verified (possible when verification state changed after the route gate passed).
      return { ok: false, kind: 'unverified' };
    }
```

`frontend/src/hooks/useUploadForm.ts` — replace the final ternary with an explicit map so three message cases stay readable (convention: no clever nesting):

```ts
    if (result.kind === 'auth') {
      setFormError('Please log in again to post.');
      return;
    }
    if (result.kind === 'unverified') {
      setFormError('Verify your e-mail address before posting.');
      return;
    }
    setFormError('Something went wrong. Please try again.');
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/uploadApi.test.ts tests/hooks/useUploadForm.test.tsx`
Expected: PASS.

- [x] **Step 5: Commit + push**

```bash
git add frontend/src/lib/uploadApi.ts frontend/src/hooks/useUploadForm.ts frontend/tests/lib/uploadApi.test.ts frontend/tests/hooks/useUploadForm.test.tsx
git commit -m "feat(upload): surface the API's unverified-e-mail refusal as a form error"
git push
```

---

### Task 5: Full gates + live verification

**Files:** none (verification only).

- [x] **Step 1: Backend gates**

Run: `docker run --rm -v "${PWD}/backend:/app" ladybug-php vendor/bin/pint --test`
Run: `docker run --rm -v "${PWD}/backend:/app" ladybug-php php artisan test --coverage`
Expected: Pint clean; all tests PASS; line coverage ≥ 90%.

- [x] **Step 2: Frontend gates**

From `frontend/`:
Run: `npm run lint` — expected exit 0.
Run: `npx vitest run --coverage --coverage.thresholds.lines=90` — expected all PASS, lines ≥ 90%.

- [x] **Step 3: Verify in the running app**

With the compose stack up (`docker compose ps`; remember `docker compose restart backend` after PHP edits — opcache — and `docker compose restart frontend` if Vite serves stale UI):

1. Register a fresh account (lands unverified) → left menu shows NO Upload entry; navigating to `/upload` by URL redirects to `/verify-email`.
2. `curl` the API directly as that session (or temporarily re-add the menu link) → `POST /api/posts` returns 403.
   Simplest check without a session dance: `docker run --rm -v "${PWD}/backend:/app" ladybug-php php artisan route:list --path=posts` shows `verified` on the POST route.
3. Verify the account via the e-mailed link (dev mailbox) → Upload entry appears without a reload; uploading a meme succeeds end-to-end.
4. Confirm browsing/login as an unverified user is unaffected (home feed, `/account`).

- [x] **Step 4: Dispatch commit-quality-verifier**

Per project convention, dispatch the `commit-quality-verifier` agent on the latest commits; address any FAIL findings before calling the feature done.
