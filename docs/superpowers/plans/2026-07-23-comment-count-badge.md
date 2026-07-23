# Comment Count Badge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a speech-bubble icon + public comment count at the right end of the byline row on every meme card, in both the feed (`FeedItem`) and the single-post page (`PostPage`).

**Architecture:** The backend exposes a new `comment_count` (public / non-hidden comment total) on `TrashpostResource`, loaded with a closure-free `withCount('publicComments as comment_count')` on both the feed and single-post queries. The frontend threads `commentCount` through `RawPost` → `FeedPost`, and `PostByline` (the shared bottom row of both card renderers) grows a flex layout with a new in-house `CommentCount` component pinned right.

**Tech Stack:** Laravel 12 / PHP 8.2+ (Eloquent, PHPUnit) backend; React 18 + Vite + TypeScript (Vitest + Testing Library) frontend.

## Global Constraints

- **No new dependencies** (npm or Composer) — Constitution Principle I. This feature adds none.
- **Coding conventions binding** (`docs/CODING_CONVENTIONS.md`): PHP `declare(strict_types=1)`, PSR-12, 4-space, functions <30 lines, braces on single-line bodies; JS/TS 2-space, semicolons, functions <50 lines. Comments explain *why*.
- **`lib/` modules are classes of static methods**; React components/hooks stay functions.
- **Accessibility** (Principle IV): color/icon is never the sole signal — the count carries a text `aria-label`; the SVG is `aria-hidden`.
- **≥90% line coverage** on both stacks (CI-enforced). Tests mirror source paths.
- **No local PHP** — run backend commands through the `php:8.3-cli` Docker container (project convention).
- **The count is the PUBLIC total**: `comments` rows with `hidden_at IS NULL`, matching `CommentService::list()`'s `total`. Not viewer-aware.

---

### Task 1: Backend — `publicComments` relation + `comment_count` in the API

**Files:**
- Modify: `backend/app/Models/Trashpost.php` (add relation after `comments()`)
- Modify: `backend/app/Services/TrashpostService.php` (`feed()` ~line 40, `findViewableByHash()` ~line 60)
- Modify: `backend/app/Http/Resources/TrashpostResource.php` (`toArray()` return array + docblock)
- Test: `backend/tests/Feature/Http/Controllers/TrashpostsApiControllerTest.php`

**Interfaces:**
- Produces: JSON field `comment_count` (integer) on every `TrashpostResource` (feed items and single-post show). Consumed by frontend Task 3.
- Produces: `Trashpost::publicComments(): HasMany` — `comments()` constrained to `hidden_at IS NULL`.

- [ ] **Step 1: Write the failing tests**

Add these tests to `TrashpostsApiControllerTest.php`. They use the existing `Trashpost::factory()->visible()` and `Comment::factory()` (import `use App\Models\Comment;` at the top of the file alongside the existing model imports):

```php
public function test_feed_item_exposes_the_public_comment_count(): void {
    $post = Trashpost::factory()->visible()->create();
    Comment::factory()->count(3)->create(['trashpost_id' => $post->id]);
    Comment::factory()->hidden()->count(2)->create(['trashpost_id' => $post->id]);

    // Only the 3 visible comments count; the 2 hidden ones are excluded (design "Definition of the count").
    $this->getJson('/api/posts')->assertJsonPath('data.0.comment_count', 3);
}

public function test_feed_item_reports_zero_comments_for_a_post_without_any(): void {
    Trashpost::factory()->visible()->create();

    $this->getJson('/api/posts')->assertJsonPath('data.0.comment_count', 0);
}

public function test_single_post_exposes_the_public_comment_count(): void {
    $post = Trashpost::factory()->visible()->create();
    Comment::factory()->count(4)->create(['trashpost_id' => $post->id]);
    Comment::factory()->hidden()->create(['trashpost_id' => $post->id]);

    $this->getJson("/api/posts/{$post->hash}")->assertJsonPath('data.comment_count', 4);
}

public function test_comment_count_is_the_public_total_even_for_an_admin_viewer(): void {
    $post = Trashpost::factory()->visible()->create();
    Comment::factory()->count(2)->create(['trashpost_id' => $post->id]);
    Comment::factory()->hidden()->count(3)->create(['trashpost_id' => $post->id]);
    $admin = User::factory()->create(['role' => \App\Enums\Role::Admin]);

    // An admin can see hidden comments in the list, but the byline count stays the public total (design).
    $this->actingAs($admin)
        ->getJson("/api/posts/{$post->hash}")
        ->assertJsonPath('data.comment_count', 2);
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
docker run --rm -v "$(pwd)/backend:/app" -w /app php:8.3-cli \
  vendor/bin/phpunit tests/Feature/Http/Controllers/TrashpostsApiControllerTest.php
```
Expected: FAIL — the four new tests fail because `comment_count` is missing / null (asserts a missing JSON path).

- [ ] **Step 3: Add the `publicComments` relation to `Trashpost`**

In `backend/app/Models/Trashpost.php`, immediately after the `comments()` method:

```php
    /**
     * The public (non-hidden) comments only — the same set CommentService counts as the public
     * `total`. Kept as its own relation so the feed can aggregate it with withCount and no closure.
     */
    public function publicComments(): HasMany {
        return $this->comments()->whereNull('hidden_at');
    }
```

(`HasMany` is already imported.)

- [ ] **Step 4: Load the count in `TrashpostService`**

In `feed()`, add the `withCount` to the builder chain (after `->with('user')`):

```php
        $builder = $this->visible()
            ->with('user')
            ->withCount('publicComments as comment_count')
            ->orderByDesc('activated_at')
            ->orderByDesc('id')
            ->limit($this->resolveLimit($query['limit'] ?? null));
```

In `findViewableByHash()`, add it to the single-post lookup:

```php
        $post = Trashpost::withTrashed()
            ->with('user')
            ->withCount('publicComments as comment_count')
            ->where('hash', $hash)
            ->first();
```

- [ ] **Step 5: Emit `comment_count` from the resource**

In `backend/app/Http/Resources/TrashpostResource.php`, add to the `toArray()` return array (after `'activated_at' => $this->activated_at,`):

```php
            'comment_count' => (int) ($this->comment_count ?? 0),
```

Update the class docblock's "Deliberately omitted" note is unaffected; instead add one line above the return explaining the field:

```php
        // The public (non-hidden) comment total, loaded via withCount at the query layer. The
        // `?? 0` covers the freshly-created post from store(), which is serialized without withCount.
```

- [ ] **Step 6: Run the tests to verify they pass**

Run:
```bash
docker run --rm -v "$(pwd)/backend:/app" -w /app php:8.3-cli \
  vendor/bin/phpunit tests/Feature/Http/Controllers/TrashpostsApiControllerTest.php
```
Expected: PASS (all four new tests plus the pre-existing ones).

- [ ] **Step 7: Add `comment_count` to the JSON-shape assertion**

In the existing `test_feed_item_exposes_the_documented_json_shape` test, add `'comment_count'` to the `data` structure list so the documented shape stays complete:

```php
                'created_at', 'activated_at', 'comment_count',
```

- [ ] **Step 8: Run the full controller test + Pint**

Run:
```bash
docker run --rm -v "$(pwd)/backend:/app" -w /app php:8.3-cli \
  vendor/bin/phpunit tests/Feature/Http/Controllers/TrashpostsApiControllerTest.php
docker run --rm -v "$(pwd)/backend:/app" -w /app php:8.3-cli vendor/bin/pint --test
```
Expected: all green; Pint reports no style issues.

- [ ] **Step 9: Commit**

```bash
git add backend/app/Models/Trashpost.php backend/app/Services/TrashpostService.php \
        backend/app/Http/Resources/TrashpostResource.php \
        backend/tests/Feature/Http/Controllers/TrashpostsApiControllerTest.php
git commit -m "feat(comments): expose public comment_count on the post API"
```

---

### Task 2: Frontend — `CommentCount` component

**Files:**
- Create: `frontend/src/components/CommentCount.tsx`
- Test: `frontend/tests/components/CommentCount.test.tsx`

**Interfaces:**
- Produces: `default export CommentCount({ count }: { count: number })` — a `<span className="feed-item__comment-count">` with an `aria-hidden` inline SVG bubble + the number, and a pluralized `aria-label`. Consumed by `PostByline` in Task 3.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/components/CommentCount.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import CommentCount from '../../src/components/CommentCount';

afterEach(cleanup);

describe('CommentCount', () => {
  it('shows the number and a pluralized label for many comments', () => {
    render(<CommentCount count={12} />);

    const badge = screen.getByLabelText('12 comments');
    expect(badge.textContent).toContain('12');
  });

  it('uses the singular label for exactly one comment', () => {
    render(<CommentCount count={1} />);

    expect(screen.getByLabelText('1 comment')).toBeTruthy();
  });

  it('shows zero with the plural label when there are no comments', () => {
    render(<CommentCount count={0} />);

    const badge = screen.getByLabelText('0 comments');
    expect(badge.textContent).toContain('0');
  });

  it('marks the icon decorative so only the label is announced', () => {
    const { container } = render(<CommentCount count={3} />);

    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npm test -- CommentCount`
Expected: FAIL — cannot resolve `../../src/components/CommentCount`.

- [ ] **Step 3: Implement `CommentCount`**

Create `frontend/src/components/CommentCount.tsx`:

```tsx
// The at-a-glance public comment count shown at the right of a meme card's byline row. The
// number carries the meaning via the text aria-label; the speech-bubble icon is decorative
// (aria-hidden), so the badge is never icon-only (Principle IV). Display-only — no link.
function CommentCount({ count }: { count: number }) {
  const label = count === 1 ? '1 comment' : `${count} comments`;
  return (
    <span className="feed-item__comment-count" aria-label={label}>
      <svg
        className="feed-item__comment-icon"
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2z" />
      </svg>
      <span aria-hidden="true">{count}</span>
    </span>
  );
}

export default CommentCount;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npm test -- CommentCount`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/CommentCount.tsx frontend/tests/components/CommentCount.test.tsx
git commit -m "feat(comments): add CommentCount byline badge component"
```

---

### Task 3: Frontend — thread `commentCount` through the model and byline; style it

**Files:**
- Modify: `frontend/src/lib/feedModel.ts` (`RawPost`, `FeedPost`, `FeedModel.mapPost`)
- Modify: `frontend/src/components/PostByline.tsx`
- Modify: `frontend/src/components/FeedItem.tsx` (pass `commentCount`)
- Modify: `frontend/src/pages/PostPage.tsx` (pass `commentCount`)
- Modify: `frontend/src/styles/theme.css` (`.feed-item__meta`, `.feed-item__byline`, `.feed-item__comment-count`, `.feed-item__comment-icon`)
- Test: `frontend/tests/lib/feedModel.test.ts`, `frontend/tests/components/PostByline.test.tsx`

**Interfaces:**
- Consumes: `CommentCount` (Task 2), `comment_count` JSON field (Task 1).
- Produces: `FeedPost.commentCount: number`; `PostByline({ author, createdAt, commentCount })`.

- [ ] **Step 1: Write the failing tests**

In `frontend/tests/lib/feedModel.test.ts`, add `comment_count: 5,` to the `makeRaw()` default object (after `created_at`), and add this test to the `describe('mapPost', …)` block:

```tsx
  it('maps the comment count, defaulting to zero when absent', () => {
    expect(FeedModel.mapPost(makeRaw({ comment_count: 7 })).commentCount).toBe(7);
    expect(FeedModel.mapPost(makeRaw({ comment_count: undefined as unknown as number })).commentCount).toBe(0);
  });
```

In `frontend/tests/components/PostByline.test.tsx`, add:

```tsx
  it('renders the comment count alongside the byline', () => {
    render(<PostByline author="alice" createdAt="2026-07-22T12:00:00Z" commentCount={4} />);

    expect(screen.getByLabelText('4 comments')).toBeTruthy();
  });
```

Add `commentCount={0}` to the three existing `PostByline` renders in that file so they compile against the new required prop.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npm test -- feedModel PostByline`
Expected: FAIL — `commentCount` missing on `FeedPost` / `PostByline` prop type, and the byline has no comment count.

- [ ] **Step 3: Add `comment_count` / `commentCount` to the model**

In `frontend/src/lib/feedModel.ts`:

Add to `RawPost` (after `created_at: string | null;`):
```ts
  comment_count: number;
```

Add to `FeedPost` (after `createdAt: string | null;`):
```ts
  commentCount: number;
```

Add to the `FeedModel.mapPost` return object (after `createdAt: raw.created_at,`):
```ts
      commentCount: raw.comment_count ?? 0,
```

- [ ] **Step 4: Update `PostByline` to a flex row with the count**

Replace the body of `frontend/src/components/PostByline.tsx`:

```tsx
import { PostDate } from '../lib/postDate';
import CommentCount from './CommentCount';

// The meta row below a meme's media: the uploader byline on the left ("by {author} · {date}")
// and the public comment count pinned to the right (design). The author is the resolved
// account/snapshot name (or "Anonymous"); the date clause is dropped when the timestamp is
// missing or unparseable, so the line never reads "· Invalid Date". Author is rendered as text.
function PostByline(
  { author, createdAt, commentCount }: { author: string | null; createdAt: string | null; commentCount: number },
) {
  const date = PostDate.format(createdAt);
  return (
    <div className="feed-item__meta">
      <p className="feed-item__byline">
        by {author ?? 'Anonymous'}
        {date ? ` · ${date}` : ''}
      </p>
      <CommentCount count={commentCount} />
    </div>
  );
}

export default PostByline;
```

- [ ] **Step 5: Pass `commentCount` from both renderers**

In `frontend/src/components/FeedItem.tsx`, update the byline render:
```tsx
      <PostByline author={post.author} createdAt={post.createdAt} commentCount={post.commentCount} />
```

In `frontend/src/pages/PostPage.tsx`, update the byline render:
```tsx
          <PostByline author={state.post.author} createdAt={state.post.createdAt} commentCount={state.post.commentCount} />
```

- [ ] **Step 6: Style the meta row**

In `frontend/src/styles/theme.css`, replace the `.feed-item__byline` rule with the meta wrapper carrying the padding and layout, and add the count styles. Find the existing `.feed-item__byline` block (~line 272) and replace it with:

```css
.feed-item__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md) var(--space-md);
}

.feed-item__byline {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--color-text-muted);
}

.feed-item__comment-count {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  flex-shrink: 0;
  font-size: 0.8125rem;
  color: var(--color-text-muted);
}

.feed-item__comment-icon {
  width: 1rem;
  height: 1rem;
  fill: currentColor;
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd frontend && npm test -- feedModel PostByline`
Expected: PASS.

- [ ] **Step 8: Run lint + the full frontend suite with coverage**

Run:
```bash
cd frontend && npm run lint && npm test -- --coverage
```
Expected: ESLint clean; all tests pass; coverage ≥90% across `src/` (the new `CommentCount.tsx` and `PostByline.tsx` are fully exercised).

- [ ] **Step 9: Commit**

```bash
git add frontend/src/lib/feedModel.ts frontend/src/components/PostByline.tsx \
        frontend/src/components/FeedItem.tsx frontend/src/pages/PostPage.tsx \
        frontend/src/styles/theme.css \
        frontend/tests/lib/feedModel.test.ts frontend/tests/components/PostByline.test.tsx
git commit -m "feat(comments): show comment count in the card byline row"
```

---

### Task 4: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run both stacks' full gates**

Run:
```bash
# Backend: full suite + coverage gate + style
docker run --rm -v "$(pwd)/backend:/app" -w /app php:8.3-cli vendor/bin/pint --test
docker run --rm -v "$(pwd)/backend:/app" -w /app php:8.3-cli vendor/bin/phpunit
# Frontend: lint + tests + coverage
cd frontend && npm run lint && npm test -- --coverage
```
Expected: all green; both coverage gates ≥90%.

- [ ] **Step 2: Manual smoke (optional but recommended)**

With the dev stack up, load the feed (`/`) and a post page (`/posts/{hash}`): each card shows the speech-bubble icon + count at the bottom-right of the byline row; a post with hidden comments shows only the public count; a post with none shows `0`.

- [ ] **Step 3: Dispatch the commit-quality-verifier**

Dispatch the `commit-quality-verifier` agent over the branch diff; proceed only on PASS (per project convention).
