# Authorized Post Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins view a single post in any state (pending/deactivated/soft-deleted) and let owners view their own non-deleted posts at the permalink, with a banner marking a hidden post.

**Architecture:** Authorization lives in `TrashpostService::findViewableByHash($hash, $viewer)`; the already-session-aware public `show` route passes `$request->user()`. `TrashpostResource` gains a coarse `hidden` status (`'pending' | 'deleted' | null`) that only ever populates for a gated viewer. The SPA threads `hidden` through `feedModel` and renders a `HiddenNotice` banner on `PostPage`.

**Tech Stack:** Laravel 12 / PHP 8.2 (PHPUnit, sqlite :memory:), React 18 + Vite + TypeScript (Vitest + Testing Library).

## Global Constraints

- Backend tests run only on sqlite :memory: — invoke with `docker compose exec -T backend php artisan test` (no local PHP).
- Frontend tests: `docker compose exec -T frontend npx vitest run <path>`.
- PHP: `declare(strict_types=1)`, PSR-12, 4-space indent, functions < 30 lines, braces on single-line bodies, comments explain *why*.
- JS/TS: 2-space, semicolons, functions < 50 lines.
- ≥90% line coverage on both stacks (CI-enforced).
- No DB ids in any API/URL; the `hash` is the public identifier.
- No new dependencies.
- Roles: `App\Enums\Role`; "admin+" = `$user->role->rank() >= Role::Admin->rank()`.
- Post states: `activated_at` null = pending/deactivated; `SoftDeletes` `trashed()` = deleted. Public = activated AND not trashed.

---

### Task 1: Backend — viewer-aware single-post lookup

Replace the public-only `findVisibleByHash` with `findViewableByHash($hash, $viewer)` and wire the controller to pass the caller. Service + controller change together so the build stays green; existing service unit tests are updated in the same commit.

**Files:**
- Modify: `backend/app/Services/TrashpostService.php` (replace `findVisibleByHash`, lines 49-57)
- Modify: `backend/app/Http/Controllers/TrashpostsApiController.php` (`show`, lines 26-37)
- Test: `backend/tests/Unit/Services/TrashpostServiceTest.php` (replace the four `find_visible_by_hash` tests, lines 140-163)
- Test: `backend/tests/Feature/Http/Controllers/TrashpostsApiControllerTest.php` (add authorization cases)

**Interfaces:**
- Consumes: `App\Models\Trashpost` (SoftDeletes, `activated_at`, `user_id`), `App\Models\User` (`id`, `role`), `App\Enums\Role`.
- Produces: `TrashpostService::findViewableByHash(string $hash, ?User $viewer): ?Trashpost`.

- [ ] **Step 1: Replace the failing service unit tests**

In `backend/tests/Unit/Services/TrashpostServiceTest.php`, delete the four tests at lines 140-163 (`test_find_visible_by_hash_*`) and add in their place:

```php
public function test_find_viewable_returns_a_public_post_for_a_guest(): void {
    $post = Trashpost::factory()->visible()->create();

    $found = $this->service()->findViewableByHash($post->hash, null);

    $this->assertNotNull($found);
    $this->assertSame($post->id, $found->id);
}

public function test_find_viewable_hides_a_pending_post_from_a_guest(): void {
    $post = Trashpost::factory()->hidden()->create();

    $this->assertNull($this->service()->findViewableByHash($post->hash, null));
}

public function test_find_viewable_hides_a_pending_post_from_a_non_owner_member(): void {
    $post = Trashpost::factory()->hidden()->create();
    $other = User::factory()->create();

    $this->assertNull($this->service()->findViewableByHash($post->hash, $other));
}

public function test_find_viewable_shows_a_pending_post_to_its_owner(): void {
    $owner = User::factory()->create();
    $post = Trashpost::factory()->hidden()->create(['user_id' => $owner->id]);

    $found = $this->service()->findViewableByHash($post->hash, $owner);

    $this->assertNotNull($found);
    $this->assertSame($post->id, $found->id);
}

public function test_find_viewable_shows_a_pending_post_to_an_admin(): void {
    $post = Trashpost::factory()->hidden()->create();
    $admin = User::factory()->admin()->create();

    $this->assertNotNull($this->service()->findViewableByHash($post->hash, $admin));
}

public function test_find_viewable_shows_a_soft_deleted_post_to_an_admin(): void {
    $post = Trashpost::factory()->deleted()->create();
    $admin = User::factory()->admin()->create();

    $found = $this->service()->findViewableByHash($post->hash, $admin);

    $this->assertNotNull($found);
    $this->assertSame($post->id, $found->id);
}

public function test_find_viewable_hides_a_soft_deleted_post_from_its_owner(): void {
    $owner = User::factory()->create();
    $post = Trashpost::factory()->deleted()->create(['user_id' => $owner->id]);

    $this->assertNull($this->service()->findViewableByHash($post->hash, $owner));
}

public function test_find_viewable_returns_null_for_an_unknown_hash(): void {
    $this->assertNull($this->service()->findViewableByHash('__nomatch__', User::factory()->admin()->create()));
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `docker compose exec -T backend php artisan test --filter=find_viewable`
Expected: FAIL — `Call to undefined method ...::findViewableByHash()`.

- [ ] **Step 3: Replace the service method**

In `backend/app/Services/TrashpostService.php`, add the `Role` import after the existing `use App\Models\User;` (line 8):

```php
use App\Enums\Role;
```

Replace the `findVisibleByHash` method (lines 49-57) with:

```php
    /**
     * The single post this viewer may open at its permalink, or null when none matches.
     *
     * A publicly visible post (activated, not trashed) is returned to anyone. Beyond that
     * an admin+ sees a post in any state, and the uploader sees their own post unless it is
     * soft-deleted — so a member can open their still-pending upload but not a deleted one.
     * Every other case (guest or non-owner on a hidden post) resolves to null → 404.
     */
    public function findViewableByHash(string $hash, ?User $viewer): ?Trashpost {
        $post = Trashpost::withTrashed()->where('hash', $hash)->first();
        if ($post === null) {
            return null;
        }
        if ($post->activated_at !== null && !$post->trashed()) {
            return $post;
        }
        if ($viewer === null) {
            return null;
        }
        // Admins see every state; the owner sees their own post unless it is trashed.
        if ($viewer->role->rank() >= Role::Admin->rank()) {
            return $post;
        }
        if ($post->user_id === $viewer->id && !$post->trashed()) {
            return $post;
        }

        return null;
    }
```

- [ ] **Step 4: Wire the controller**

In `backend/app/Http/Controllers/TrashpostsApiController.php`, replace the `show` method (lines 26-37) with:

```php
    /**
     * GET /api/posts/{hash} — a single post the caller may view, else 404.
     *
     * Public posts are returned to anyone; a hidden post (pending, deactivated, or
     * soft-deleted) is returned only to an admin+ or, unless it is soft-deleted, to its
     * uploader. The route stays public — `$request->user()` resolves from the Sanctum
     * session when present and is null for a guest (same pattern as GET /api/user).
     */
    public function show(Request $request, string $hash): TrashpostResource {
        $post = $this->service->findViewableByHash($hash, $request->user());
        if ($post === null) {
            abort(404);
        }

        return new TrashpostResource($post);
    }
```

- [ ] **Step 5: Add the controller authorization feature tests**

In `backend/tests/Feature/Http/Controllers/TrashpostsApiControllerTest.php`, add these tests (the file already imports `User` and uses `Trashpost::factory()`; add `use App\Models\User;` at the top if it is not already imported). Add after the existing `test_show_returns_404_for_a_soft_deleted_post` (near line 135):

```php
public function test_show_shows_a_pending_post_to_an_admin(): void {
    $post = Trashpost::factory()->hidden()->create();

    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/api/posts/{$post->hash}")
        ->assertOk()
        ->assertJsonPath('data.hash', $post->hash);
}

public function test_show_shows_a_soft_deleted_post_to_an_admin(): void {
    $post = Trashpost::factory()->deleted()->create();

    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/api/posts/{$post->hash}")
        ->assertOk()
        ->assertJsonPath('data.hash', $post->hash);
}

public function test_show_shows_a_pending_post_to_its_owner(): void {
    $owner = User::factory()->create();
    $post = Trashpost::factory()->hidden()->create(['user_id' => $owner->id]);

    $this->actingAs($owner)
        ->getJson("/api/posts/{$post->hash}")
        ->assertOk()
        ->assertJsonPath('data.hash', $post->hash);
}

public function test_show_hides_a_soft_deleted_post_from_its_owner(): void {
    $owner = User::factory()->create();
    $post = Trashpost::factory()->deleted()->create(['user_id' => $owner->id]);

    $this->actingAs($owner)->getJson("/api/posts/{$post->hash}")->assertNotFound();
}

public function test_show_hides_a_pending_post_from_a_non_owner_member(): void {
    $post = Trashpost::factory()->hidden()->create();

    $this->actingAs(User::factory()->create())
        ->getJson("/api/posts/{$post->hash}")
        ->assertNotFound();
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `docker compose exec -T backend php artisan test --filter=TrashpostServiceTest`
then: `docker compose exec -T backend php artisan test --filter=TrashpostsApiControllerTest`
Expected: PASS for both.

- [ ] **Step 7: Lint**

Run: `docker compose exec -T backend ./vendor/bin/pint --test`
Expected: PASS (no style errors).

- [ ] **Step 8: Commit**

```bash
git add backend/app/Services/TrashpostService.php backend/app/Http/Controllers/TrashpostsApiController.php backend/tests/Unit/Services/TrashpostServiceTest.php backend/tests/Feature/Http/Controllers/TrashpostsApiControllerTest.php
git commit -m "feat: viewer-aware single-post visibility for admins and owners"
```

---

### Task 2: Backend — coarse `hidden` status on the resource

Expose a `hidden` field so the SPA can mark a non-public post. Coarse status only — no timestamp.

**Files:**
- Modify: `backend/app/Http/Resources/TrashpostResource.php` (add field + helper)
- Test: `backend/tests/Feature/Http/Controllers/TrashpostsApiControllerTest.php` (assert the field)

**Interfaces:**
- Consumes: `App\Models\Trashpost` (`activated_at`, `trashed()`).
- Produces: response field `hidden` (string `'pending'`/`'deleted'` or null) on every `TrashpostResource`.

- [ ] **Step 1: Write the failing tests**

In `backend/tests/Feature/Http/Controllers/TrashpostsApiControllerTest.php`, add:

```php
public function test_show_reports_hidden_null_for_a_public_post(): void {
    $post = Trashpost::factory()->visible()->create();

    $this->getJson("/api/posts/{$post->hash}")
        ->assertOk()
        ->assertJsonPath('data.hidden', null);
}

public function test_show_reports_hidden_pending_for_a_deactivated_post(): void {
    $post = Trashpost::factory()->hidden()->create();

    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/api/posts/{$post->hash}")
        ->assertOk()
        ->assertJsonPath('data.hidden', 'pending');
}

public function test_show_reports_hidden_deleted_for_a_soft_deleted_post(): void {
    $post = Trashpost::factory()->deleted()->create();

    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/api/posts/{$post->hash}")
        ->assertOk()
        ->assertJsonPath('data.hidden', 'deleted');
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `docker compose exec -T backend php artisan test --filter=reports_hidden`
Expected: FAIL — `data.hidden` is missing (null path may pass; the `pending`/`deleted` assertions fail).

- [ ] **Step 3: Add the field and helper**

In `backend/app/Http/Resources/TrashpostResource.php`, add `'hidden' => $this->hiddenStatus(),` to the returned array (after the `activated_at` line, ~line 38), then add this method after `toArray`:

```php
    /**
     * A coarse visibility status for a viewer allowed to see a hidden post: 'deleted' when
     * soft-deleted, else 'pending' when not activated, else null. Deliberately coarse — no
     * deleted_at timestamp — so no internal moderation timing leaks, and on the public feed
     * (every row activated and not trashed) it is always null.
     */
    private function hiddenStatus(): ?string {
        if ($this->trashed()) {
            return 'deleted';
        }
        if ($this->activated_at === null) {
            return 'pending';
        }

        return null;
    }
```

- [ ] **Step 4: Run to verify they pass**

Run: `docker compose exec -T backend php artisan test --filter=reports_hidden`
Expected: PASS.

- [ ] **Step 5: Lint**

Run: `docker compose exec -T backend ./vendor/bin/pint --test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/Http/Resources/TrashpostResource.php backend/tests/Feature/Http/Controllers/TrashpostsApiControllerTest.php
git commit -m "feat: coarse hidden status on TrashpostResource"
```

---

### Task 3: Frontend — thread `hidden` through the model

**Files:**
- Modify: `frontend/src/lib/feedModel.ts` (`RawPost`, `FeedPost`, `mapPost`)
- Test: `frontend/tests/lib/feedModel.test.ts`

**Interfaces:**
- Consumes: raw API field `hidden`.
- Produces: `FeedPost.hidden: 'pending' | 'deleted' | null` (also on `RawPost`).

- [ ] **Step 1: Write the failing tests**

In `frontend/tests/lib/feedModel.test.ts`, add inside the `describe('mapPost', …)` block:

```ts
it('passes a pending hidden status through to the post', () => {
  expect(FeedModel.mapPost(makeRaw({ hidden: 'pending' })).hidden).toBe('pending');
});

it('passes a deleted hidden status through to the post', () => {
  expect(FeedModel.mapPost(makeRaw({ hidden: 'deleted' })).hidden).toBe('deleted');
});

it('defaults hidden to null when the field is absent', () => {
  expect(FeedModel.mapPost(makeRaw()).hidden).toBeNull();
});
```

Also add `hidden: null,` to the `makeRaw` object literal (so the default-fixture stays a valid `RawPost`).

- [ ] **Step 2: Run to verify they fail**

Run: `docker compose exec -T frontend npx vitest run tests/lib/feedModel.test.ts`
Expected: FAIL — `hidden` does not exist on the mapped post / on `RawPost`.

- [ ] **Step 3: Add the field to the types and mapper**

In `frontend/src/lib/feedModel.ts`:

Add to `RawPost` (after the `url: string;` line, ~line 13):

```ts
  hidden: 'pending' | 'deleted' | null;
```

Add to `FeedPost` (after the `media: FeedMedia;` line, ~line 31):

```ts
  hidden: 'pending' | 'deleted' | null;
```

In `mapPost` (~line 77), add the field to the returned object:

```ts
      hidden: raw.hidden ?? null,
```

- [ ] **Step 4: Run to verify they pass**

Run: `docker compose exec -T frontend npx vitest run tests/lib/feedModel.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/feedModel.ts frontend/tests/lib/feedModel.test.ts
git commit -m "feat: thread hidden status through the post model"
```

---

### Task 4: Frontend — `HiddenNotice` banner component

**Files:**
- Create: `frontend/src/components/states/HiddenNotice.tsx`
- Test: `frontend/tests/components/states/HiddenNotice.test.tsx`

**Interfaces:**
- Consumes: `status: 'pending' | 'deleted'`.
- Produces: default-exported `HiddenNotice` component rendering a `role="status"` banner.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/components/states/HiddenNotice.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import HiddenNotice from '../../../src/components/states/HiddenNotice';

afterEach(cleanup);

describe('HiddenNotice', () => {
  it('shows a pending message inside a status region', () => {
    render(<HiddenNotice status="pending" />);

    const region = screen.getByRole('status');
    expect(region.textContent).toMatch(/pending review/i);
    expect(region.textContent).toMatch(/not publicly visible/i);
  });

  it('shows a deleted message', () => {
    render(<HiddenNotice status="deleted" />);

    expect(screen.getByRole('status').textContent).toMatch(/deleted/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `docker compose exec -T frontend npx vitest run tests/components/states/HiddenNotice.test.tsx`
Expected: FAIL — cannot resolve `HiddenNotice`.

- [ ] **Step 3: Create the component**

Create `frontend/src/components/states/HiddenNotice.tsx`:

```tsx
// Banner shown on the single-post page when an admin or the owner is viewing a post that is
// not publicly visible. Text carries the meaning (color is never the sole signal — a11y);
// role="status" announces it politely alongside the page's live region.
const MESSAGES: Record<'pending' | 'deleted', string> = {
  pending: "This meme is pending review and isn't publicly visible yet.",
  deleted: "This meme has been deleted and isn't publicly visible.",
};

function HiddenNotice({ status }: { status: 'pending' | 'deleted' }) {
  return (
    <p className="hidden-notice" role="status">
      {MESSAGES[status]}
    </p>
  );
}

export default HiddenNotice;
```

- [ ] **Step 4: Run to verify it passes**

Run: `docker compose exec -T frontend npx vitest run tests/components/states/HiddenNotice.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/states/HiddenNotice.tsx frontend/tests/components/states/HiddenNotice.test.tsx
git commit -m "feat: HiddenNotice banner component"
```

---

### Task 5: Frontend — render the banner on `PostPage`

**Files:**
- Modify: `frontend/src/pages/PostPage.tsx` (import + render in the loaded branch)
- Test: `frontend/tests/pages/PostPage.test.tsx`

**Interfaces:**
- Consumes: `HiddenNotice` (Task 4), `FeedPost.hidden` (Task 3).
- Produces: banner rendered above the `<h1>` when the loaded post has `hidden` set.

- [ ] **Step 1: Write the failing tests**

In `frontend/tests/pages/PostPage.test.tsx`, add inside `describe('PostPage', …)`:

```tsx
it('shows a hidden banner when the loaded post is not publicly visible', async () => {
  vi.spyOn(Api, 'fetchPost').mockResolvedValue({ ok: true, post: { ...post, hidden: 'pending' } });

  renderPost();

  expect(await screen.findByRole('heading', { name: 'Funny cat' })).toBeTruthy();
  expect(screen.getByRole('status').textContent).toMatch(/pending review/i);
});

it('shows no hidden banner for a public post', async () => {
  vi.spyOn(Api, 'fetchPost').mockResolvedValue({ ok: true, post: { ...post, hidden: null } });

  renderPost();

  await screen.findByRole('heading', { name: 'Funny cat' });
  expect(screen.queryByRole('status')).toBeNull();
});
```

Also add `hidden: null,` to the shared `post` fixture object (near line 20) so it stays a valid `FeedPost`.

- [ ] **Step 2: Run to verify they fail**

Run: `docker compose exec -T frontend npx vitest run tests/pages/PostPage.test.tsx`
Expected: FAIL — no `status` role rendered.

- [ ] **Step 3: Render the banner**

In `frontend/src/pages/PostPage.tsx`, add the import (with the other component imports near the top):

```tsx
import HiddenNotice from '../components/states/HiddenNotice';
```

In the loaded branch, add the banner as the first child of the `<article>`, before the `<h1>`:

```tsx
        <article className="post-item feed-item">
          {state.post.hidden && <HiddenNotice status={state.post.hidden} />}
          <h1 className="feed-item__title">{state.post.title ?? 'Untitled meme'}</h1>
          <MemeMedia media={state.post.media} />
        </article>
```

- [ ] **Step 4: Run to verify they pass**

Run: `docker compose exec -T frontend npx vitest run tests/pages/PostPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Lint**

Run: `docker compose exec -T frontend npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/PostPage.tsx frontend/tests/pages/PostPage.test.tsx
git commit -m "feat: show HiddenNotice banner on the single-post page"
```

---

### Task 6: Full gates + style polish

Run the real CI gates on both stacks and add the banner style token.

**Files:**
- Modify: `frontend/src/styles/theme.css` (or the page stylesheet) — `.hidden-notice` style

- [ ] **Step 1: Add a `.hidden-notice` style**

Add a themed rule near the post/feed styles (match the existing token vocabulary in the same file — `var(--space-*)`, `var(--radius-md)`, the warning/accent color already defined). Keep it simple: padding, rounded corners, a distinct background, and full-width block above the title. Text remains the primary signal.

- [ ] **Step 2: Backend full suite + coverage**

Run: `docker compose exec -T backend php artisan test`
Expected: PASS, no regressions.

- [ ] **Step 3: Frontend full suite + coverage**

Run: `docker compose exec -T frontend npm test`
Expected: PASS with coverage ≥90% across `src/` (the gate spans all of `src/`, so the new files must be covered — Tasks 3-5 cover them).

- [ ] **Step 4: Lint both stacks**

Run: `docker compose exec -T backend ./vendor/bin/pint --test`
Run: `docker compose exec -T frontend npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit and push**

```bash
git add frontend/src/styles/theme.css
git commit -m "style: hidden-notice banner styling"
git push
```

---

## Notes

- The feed (`GET /api/posts`) is untouched; only the single-post `show` path gains elevated visibility. Feed rows always carry `hidden: null`.
- Follow-up (not in this plan): `feedModel.ts` `IMAGE_SIZES` still reads `48rem`, stale after `--layout-max-width` → `80rem`.
