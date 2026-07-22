# Uploader Byline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a "by {author} · {date}" byline below the media on both the main feed and the single-post page, resolving the author from the live account name when linked and the stored snapshot otherwise.

**Architecture:** The backend `TrashpostResource` already exposes `username` and `created_at`; we change `username` to the *resolved* display name (`user?->name ?? username`) and eager-load the `user` relation on the two read paths to avoid N+1. The frontend carries `author`/`createdAt` through `FeedModel`, formats the date with a new in-house `PostDate` class, and renders a shared `PostByline` component in `FeedItem` and `PostPage`.

**Tech Stack:** Laravel 12 / PHP 8.2+ (backend, tested via `php:8.3-cli` Docker), React 18 + Vite + TypeScript (frontend), Vitest + Testing Library, PHPUnit.

## Global Constraints

- **No new dependencies** (Constitution Principle I). `Intl.DateTimeFormat` is a platform built-in; no npm/Composer additions.
- **Conventions** (`docs/CODING_CONVENTIONS.md`): 2-space JS/TS, semicolons, PSR-12 + 4-space + `declare(strict_types=1)` PHP, braces on single-line bodies, comments explain *why*. Every `lib/` module is one class of `static` methods; call through the class.
- **≥90% line coverage** on both stacks (CI-enforced). Every new module is directly tested.
- **No local PHP** — run backend tests through the `php:8.3-cli` Docker container. Tests run on sqlite `:memory:` only.
- **Author resolution rule:** `user?->name ?? username`, then the literal `Anonymous` (frontend) when both are null. Mirrors `AdminTrashpostResource::uploaderName()`.
- **Date format:** `Jul 22, 2026` — `Intl.DateTimeFormat` with `{ year: 'numeric', month: 'short', day: 'numeric' }`.

---

### Task 1: Backend — resolve author name and eager-load the user relation

**Files:**
- Modify: `backend/app/Http/Resources/TrashpostResource.php` (line 35 `'username'` + add a private method)
- Modify: `backend/app/Services/TrashpostService.php` (`feed()` builder ~line 40; `findViewableByHash()` ~line 59)
- Test: `backend/tests/Feature/Http/Controllers/TrashpostsApiControllerTest.php` (add cases)
- Test: `backend/tests/Unit/Services/TrashpostServiceTest.php` (add eager-load case)

**Interfaces:**
- Consumes: `Trashpost::user()` BelongsTo (exists), `User` factory (exists), `Trashpost` factory `visible()` state (exists).
- Produces: feed/show JSON field `username` = resolved display name (`user?->name ?? username`), still `?string`. No shape change to any other field. Frontend Task 2 reads `username` and `created_at`.

- [ ] **Step 1: Write the failing feature tests**

Add these three methods to `backend/tests/Feature/Http/Controllers/TrashpostsApiControllerTest.php` (uses `App\Models\User`, already imported):

```php
public function test_feed_username_reflects_the_linked_accounts_current_name(): void {
    $user = User::factory()->create(['name' => 'Current Name']);
    // The snapshot column holds a stale name; the live account name must win.
    Trashpost::factory()->visible()->create([
        'user_id' => $user->id,
        'username' => 'Stale Snapshot',
    ]);

    $this->getJson('/api/posts')->assertJsonPath('data.0.username', 'Current Name');
}

public function test_feed_username_falls_back_to_the_snapshot_for_an_orphaned_post(): void {
    // No user_id (orphaned/legacy row): the stored username snapshot is shown.
    Trashpost::factory()->visible()->create([
        'user_id' => null,
        'username' => 'Legacy Author',
    ]);

    $this->getJson('/api/posts')->assertJsonPath('data.0.username', 'Legacy Author');
}

public function test_show_username_reflects_the_linked_accounts_current_name(): void {
    $user = User::factory()->create(['name' => 'Live Name']);
    $post = Trashpost::factory()->visible()->create([
        'user_id' => $user->id,
        'username' => 'Stale Snapshot',
    ]);

    $this->getJson("/api/posts/{$post->hash}")->assertJsonPath('data.username', 'Live Name');
}
```

- [ ] **Step 2: Run the feature tests to verify they fail**

Run:
```bash
docker run --rm -v "//c/projects/ladybug/backend:/app" -w /app php:8.3-cli \
  vendor/bin/phpunit --filter 'username_reflects_the_linked|username_falls_back_to_the_snapshot'
```
Expected: FAIL — `data.0.username` is `Stale Snapshot`, not the live account name (the resource currently returns the raw column).

- [ ] **Step 3: Resolve the author name in the resource**

In `backend/app/Http/Resources/TrashpostResource.php`, change line 35 from:
```php
            'username' => $this->username,
```
to:
```php
            'username' => $this->authorName(),
```
Then add this private method (place it directly above `hiddenStatus()`):
```php
    /**
     * The uploader's account name when the owner still resolves, else the name stored on
     * the row at upload time — an orphaned or legacy post still shows who posted it. Same
     * rule as AdminTrashpostResource::uploaderName so both surfaces agree.
     */
    private function authorName(): ?string {
        return $this->user?->name ?? $this->username;
    }
```

- [ ] **Step 4: Eager-load `user` on both read paths**

In `backend/app/Services/TrashpostService.php`, in `feed()`, change the builder chain so it eager-loads the owner (avoids an N+1 across the 10-post page now that the resource reads `user?->name`):
```php
        $builder = $this->visible()
            ->with('user')
            ->orderByDesc('activated_at')
            ->orderByDesc('id')
            ->limit($this->resolveLimit($query['limit'] ?? null));
```
In `findViewableByHash()`, change the initial load from:
```php
        $post = Trashpost::withTrashed()->where('hash', $hash)->first();
```
to:
```php
        $post = Trashpost::withTrashed()->with('user')->where('hash', $hash)->first();
```

- [ ] **Step 5: Write the failing service eager-load test**

Add to `backend/tests/Unit/Services/TrashpostServiceTest.php` (it already uses `RefreshDatabase` and the `Trashpost`/`User` models — match the file's existing imports and class style):

```php
public function test_feed_eager_loads_the_owner_to_avoid_n_plus_one(): void {
    $user = User::factory()->create();
    Trashpost::factory()->visible()->create(['user_id' => $user->id]);

    $posts = (new TrashpostService())->feed([]);

    // The owner is hydrated up front, so the resource reads user->name without a
    // per-row lazy query across a page.
    $this->assertTrue($posts->first()->relationLoaded('user'));
}
```

- [ ] **Step 6: Run the full affected suites to verify they pass**

Run:
```bash
docker run --rm -v "//c/projects/ladybug/backend:/app" -w /app php:8.3-cli \
  vendor/bin/phpunit --filter 'TrashpostsApiControllerTest|TrashpostServiceTest'
```
Expected: PASS — all existing cases plus the four new ones green.

- [ ] **Step 7: Lint the backend changes**

Run:
```bash
docker run --rm -v "//c/projects/ladybug/backend:/app" -w /app php:8.3-cli \
  vendor/bin/pint --test app/Http/Resources/TrashpostResource.php app/Services/TrashpostService.php
```
Expected: PASS (no style diffs).

- [ ] **Step 8: Commit**

```bash
git add backend/app/Http/Resources/TrashpostResource.php \
        backend/app/Services/TrashpostService.php \
        backend/tests/Feature/Http/Controllers/TrashpostsApiControllerTest.php \
        backend/tests/Unit/Services/TrashpostServiceTest.php
git commit -m "feat: expose resolved uploader name in the post API (live account name, snapshot fallback)"
```

---

### Task 2: Frontend — carry author and createdAt through FeedModel

**Files:**
- Modify: `frontend/src/lib/feedModel.ts` (`RawPost` ~line 5, `FeedPost` ~line 28, `mapPost` ~line 79)
- Test: `frontend/tests/lib/feedModel.test.ts` (extend `makeRaw`, add cases)

**Interfaces:**
- Consumes: backend `username` (resolved) and `created_at` (raw ISO string) from Task 1.
- Produces: `FeedPost.author: string | null` and `FeedPost.createdAt: string | null`, consumed by `PostByline` (Task 4) via `FeedItem`/`PostPage` (Task 5). `RawPost` gains `username: string | null` and `created_at: string | null`.

- [ ] **Step 1: Write the failing model tests**

In `frontend/tests/lib/feedModel.test.ts`, extend the `makeRaw` factory object (add the two fields before the `...overrides` spread) so it stays a complete `RawPost`:
```ts
    url: '/posts/abc1234567',
    hidden: null,
    username: 'alice',
    created_at: '2026-07-22T14:30:00Z',
    ...overrides,
```
Then add a new `describe` block (place after the closing of the existing `mapPost` describe):
```ts
describe('mapPost author and date', () => {
  it('carries the resolved author name through', () => {
    expect(FeedModel.mapPost(makeRaw({ username: 'alice' })).author).toBe('alice');
  });

  it('carries the created_at timestamp through as createdAt', () => {
    expect(FeedModel.mapPost(makeRaw({ created_at: '2026-07-22T14:30:00Z' })).createdAt).toBe(
      '2026-07-22T14:30:00Z',
    );
  });

  it('passes a null author and date through unchanged', () => {
    const post = FeedModel.mapPost(makeRaw({ username: null, created_at: null }));

    expect(post.author).toBeNull();
    expect(post.createdAt).toBeNull();
  });
});
```

- [ ] **Step 2: Run the model tests to verify they fail**

Run: `cd frontend && npx vitest run tests/lib/feedModel.test.ts`
Expected: FAIL — TypeScript/assertion errors: `author`/`createdAt` do not exist on `FeedPost`, and `username`/`created_at` not on `RawPost`.

- [ ] **Step 3: Add the fields to the types and the mapper**

In `frontend/src/lib/feedModel.ts`, add to the `RawPost` type (after `hidden`):
```ts
  hidden: 'pending' | 'deleted' | null;
  username: string | null;
  created_at: string | null;
```
Add to the `FeedPost` type (after `hidden`):
```ts
  hidden: 'pending' | 'deleted' | null;
  author: string | null;
  createdAt: string | null;
```
In `mapPost`, add the two mappings to the returned object (after `hidden`):
```ts
      hidden: raw.hidden ?? null,
      author: raw.username,
      createdAt: raw.created_at,
```

- [ ] **Step 4: Run the model tests to verify they pass**

Run: `cd frontend && npx vitest run tests/lib/feedModel.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/feedModel.ts frontend/tests/lib/feedModel.test.ts
git commit -m "feat: carry uploader name and created_at through the feed model"
```

---

### Task 3: Frontend — PostDate formatter

**Files:**
- Create: `frontend/src/lib/postDate.ts`
- Test: `frontend/tests/lib/postDate.test.ts`

**Interfaces:**
- Consumes: an ISO date string (or null) — `FeedPost.createdAt` from Task 2.
- Produces: `PostDate.format(iso: string | null): string | null` — returns `Jul 22, 2026` style, or null for null/blank/unparseable input. Consumed by `PostByline` (Task 4).

- [ ] **Step 1: Write the failing formatter tests**

Create `frontend/tests/lib/postDate.test.ts`:
```ts
import { describe, expect, it } from 'vitest';

import { PostDate } from '../../src/lib/postDate';

describe('PostDate.format', () => {
  it('formats an ISO timestamp as a short absolute date', () => {
    // Pinned to a UTC noon so the calendar day is stable regardless of the test runner's
    // timezone (avoids a midnight-boundary flake).
    expect(PostDate.format('2026-07-22T12:00:00Z')).toBe('Jul 22, 2026');
  });

  it('returns null for a null, blank, or unparseable input', () => {
    expect(PostDate.format(null)).toBeNull();
    expect(PostDate.format('')).toBeNull();
    expect(PostDate.format('not a date')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the formatter tests to verify they fail**

Run: `cd frontend && npx vitest run tests/lib/postDate.test.ts`
Expected: FAIL — cannot resolve `../../src/lib/postDate`.

- [ ] **Step 3: Implement PostDate**

Create `frontend/src/lib/postDate.ts`:
```ts
// Formats a post's creation timestamp for the byline. In-house (no date library):
// Intl.DateTimeFormat is a platform built-in, so no dependency is added (Principle I).
export class PostDate {
  // Fixed 'en-US' locale so the byline reads the same 'Jul 22, 2026' for every visitor,
  // matching the design's chosen format rather than varying per browser locale.
  private static readonly formatter = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  // Returns 'Jul 22, 2026' for a valid ISO string, or null for null/blank/unparseable
  // input so the byline can omit the date rather than print 'Invalid Date'.
  static format(iso: string | null): string | null {
    if (!iso) {
      return null;
    }
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return PostDate.formatter.format(date);
  }
}
```

- [ ] **Step 4: Run the formatter tests to verify they pass**

Run: `cd frontend && npx vitest run tests/lib/postDate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/postDate.ts frontend/tests/lib/postDate.test.ts
git commit -m "feat: add PostDate byline date formatter"
```

---

### Task 4: Frontend — PostByline component and styles

**Files:**
- Create: `frontend/src/components/PostByline.tsx`
- Modify: `frontend/src/styles/theme.css` (add `.feed-item__byline` after the `.feed-item__title a:hover` rule ~line 253)
- Test: `frontend/tests/components/PostByline.test.tsx`

**Interfaces:**
- Consumes: `PostDate.format` (Task 3); `FeedPost.author` / `FeedPost.createdAt` (Task 2), passed as props.
- Produces: default export `PostByline` — `function PostByline({ author, createdAt }: { author: string | null; createdAt: string | null })`. Consumed by `FeedItem` and `PostPage` (Task 5).

- [ ] **Step 1: Write the failing component tests**

Create `frontend/tests/components/PostByline.test.tsx`:
```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import PostByline from '../../src/components/PostByline';

afterEach(cleanup);

describe('PostByline', () => {
  it('renders the author and the formatted date', () => {
    render(<PostByline author="alice" createdAt="2026-07-22T12:00:00Z" />);

    expect(screen.getByText(/by alice/i).textContent).toContain('by alice');
    expect(screen.getByText(/Jul 22, 2026/)).toBeTruthy();
  });

  it('falls back to Anonymous when there is no author', () => {
    render(<PostByline author={null} createdAt="2026-07-22T12:00:00Z" />);

    expect(screen.getByText(/by Anonymous/i)).toBeTruthy();
  });

  it('omits the date and separator when the date is unavailable', () => {
    render(<PostByline author="alice" createdAt={null} />);

    const byline = screen.getByText(/by alice/i);
    expect(byline.textContent).toBe('by alice');
  });
});
```

- [ ] **Step 2: Run the component tests to verify they fail**

Run: `cd frontend && npx vitest run tests/components/PostByline.test.tsx`
Expected: FAIL — cannot resolve `../../src/components/PostByline`.

- [ ] **Step 3: Implement PostByline**

Create `frontend/src/components/PostByline.tsx`:
```tsx
import { PostDate } from '../lib/postDate';

// The uploader byline shown below a meme's media: "by {author} · {date}". The author is
// the resolved account/snapshot name (or "Anonymous" when neither is present); the date
// clause is dropped entirely when the timestamp is missing or unparseable, so the line
// never reads "· Invalid Date". Author is rendered as text — React escapes it.
function PostByline({ author, createdAt }: { author: string | null; createdAt: string | null }) {
  const date = PostDate.format(createdAt);
  return (
    <p className="feed-item__byline">
      by {author ?? 'Anonymous'}
      {date ? ` · ${date}` : ''}
    </p>
  );
}

export default PostByline;
```

- [ ] **Step 4: Run the component tests to verify they pass**

Run: `cd frontend && npx vitest run tests/components/PostByline.test.tsx`
Expected: PASS.

- [ ] **Step 5: Add the byline styles**

In `frontend/src/styles/theme.css`, add this rule immediately after the `.feed-item__title a:hover { … }` block (~line 253). It reuses the shared card padding so the byline aligns with the title, drops the top padding so it tucks under the media, and uses the muted text token (theme-aware in both schemes):
```css
.feed-item__byline {
  margin: 0;
  padding: var(--space-sm) var(--space-md) var(--space-md);
  font-size: 0.8125rem;
  color: var(--color-text-muted);
}
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/PostByline.tsx \
        frontend/tests/components/PostByline.test.tsx \
        frontend/src/styles/theme.css
git commit -m "feat: add PostByline component and byline styles"
```

---

### Task 5: Frontend — render the byline in FeedItem and PostPage

**Files:**
- Modify: `frontend/src/components/FeedItem.tsx` (add byline after `<MemeMedia>`)
- Modify: `frontend/src/pages/PostPage.tsx` (add byline after `<MemeMedia>` in the loaded branch)
- Test: `frontend/tests/components/FeedItem.test.tsx` (extend the `post` factory, add a case)
- Test: `frontend/tests/pages/PostPage.test.tsx` (extend the `post` fixture, add a case)

**Interfaces:**
- Consumes: `PostByline` (Task 4); `FeedPost.author` / `FeedPost.createdAt` (Task 2).
- Produces: no new interface — final wiring.

- [ ] **Step 1: Write the failing wiring tests**

In `frontend/tests/components/FeedItem.test.tsx`, extend the `post` factory to supply the new fields (add before `...overrides`):
```ts
    media: { kind: 'none' },
    hidden: null,
    author: 'alice',
    createdAt: '2026-07-22T12:00:00Z',
    ...overrides,
```
Add this case inside the `describe('FeedItem', …)` block:
```tsx
  it('shows the uploader byline below the media', () => {
    render(<FeedItem post={post()} />, { wrapper: MemoryRouter });

    expect(screen.getByText(/by alice/i)).toBeTruthy();
    expect(screen.getByText(/Jul 22, 2026/)).toBeTruthy();
  });
```
In `frontend/tests/pages/PostPage.test.tsx`, extend the shared `post` fixture with the two fields (after `hidden: null,`):
```ts
  hidden: null,
  author: 'alice',
  createdAt: '2026-07-22T12:00:00Z',
```
Add this case inside `describe('PostPage', …)`:
```tsx
  it('shows the uploader byline on the loaded meme', async () => {
    vi.spyOn(Api, 'fetchPost').mockResolvedValue({ ok: true, post });

    renderPost();

    expect(await screen.findByText(/by alice/i)).toBeTruthy();
    expect(screen.getByText(/Jul 22, 2026/)).toBeTruthy();
  });
```

- [ ] **Step 2: Run the wiring tests to verify they fail**

Run: `cd frontend && npx vitest run tests/components/FeedItem.test.tsx tests/pages/PostPage.test.tsx`
Expected: FAIL — the byline text is not in the DOM yet (and the `post` fixtures now need the fields, which TypeScript will flag on any remaining `FeedPost` literal missing them — none should remain after the factory edits).

- [ ] **Step 3: Render the byline in FeedItem**

In `frontend/src/components/FeedItem.tsx`, add the import:
```tsx
import type { FeedPost } from '../lib/feedModel';
import MemeMedia from './MemeMedia';
import PostByline from './PostByline';
```
And render it after `<MemeMedia>` inside the `<article>`:
```tsx
      <MemeMedia media={post.media} linkTo={post.permalink} />
      <PostByline author={post.author} createdAt={post.createdAt} />
    </article>
```

- [ ] **Step 4: Render the byline in PostPage**

In `frontend/src/pages/PostPage.tsx`, add the import (alongside the other component imports):
```tsx
import MemeMedia from '../components/MemeMedia';
import PostByline from '../components/PostByline';
```
And render it after `<MemeMedia>` in the loaded branch:
```tsx
          <MemeMedia media={state.post.media} />
          <PostByline author={state.post.author} createdAt={state.post.createdAt} />
        </article>
```

- [ ] **Step 5: Run the wiring tests to verify they pass**

Run: `cd frontend && npx vitest run tests/components/FeedItem.test.tsx tests/pages/PostPage.test.tsx`
Expected: PASS.

- [ ] **Step 6: Run the full frontend suite with coverage and lint**

Run:
```bash
cd frontend && npx vitest run --coverage && npm run lint
```
Expected: PASS — all tests green, coverage ≥90% across `src/`, ESLint clean.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/FeedItem.tsx frontend/src/pages/PostPage.tsx \
        frontend/tests/components/FeedItem.test.tsx frontend/tests/pages/PostPage.test.tsx
git commit -m "feat: render the uploader byline on feed items and the post page"
```

---

## Notes for the implementer

- **Backend Docker mount:** the repo convention runs backend tooling in `php:8.3-cli` with the `backend/` dir bind-mounted at `/app`. If a wrapper script exists (`scripts/`), prefer it; the commands above are the direct form.
- **Frontend `created_at` is a raw ISO string** end-to-end — the backend resource does not pre-format it (unlike `AdminTrashpostResource`), so `PostDate` owns all formatting. Do not add server-side formatting.
- **`username` field name is intentionally unchanged** in the API to avoid churn in the existing `assertJsonStructure` test; it now holds the resolved display name rather than the raw column.
- After all tasks, dispatch the `commit-quality-verifier` agent before considering the branch done, per project workflow.
