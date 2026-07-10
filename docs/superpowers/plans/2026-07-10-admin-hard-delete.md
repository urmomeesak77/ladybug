# Soft/Hard Delete Options in the Moderation Delete Confirm — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** The moderation table's delete confirmation offers three choices — soft delete, permanent (hard) delete that removes the DB row and its media files, and cancel — and soft-deleted rows gain a permanent-delete button next to Restore.

**Architecture:** A dedicated backend purge route (`DELETE /api/admin/posts/{hash}/purge` → `ModerationService::purge()`: forceDelete the row, then best-effort delete its image size variants and last-reference YouTube thumbnail). The frontend `Confirm` contract generalizes from a single confirm button to an `actions[]` list rendered by `ConfirmDialog`; `ModerationActions` raises a two-action confirm on live rows and a purge-only confirm on soft-deleted rows; purged rows leave the table in place via a new `removeRow` in `useModeration`.

**Tech Stack:** Laravel 12 / PHP 8.2+ (tests via the dev `backend` container, sqlite `:memory:`), React 18 + Vite + TypeScript, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-10-admin-hard-delete-design.md`

## Global Constraints

- No new npm or Composer dependencies (Constitution Principle I).
- `docs/CODING_CONVENTIONS.md` is binding: 2-space TS with semicolons; PHP is PSR-12, 4-space, `declare(strict_types=1)`, functions <30 lines PHP / <50 lines JS; braces on single-line bodies; comments explain *why*; logic helpers are classes of static methods, never loose exported functions.
- User-facing copy says **post**, never "meme"/"trashpost".
- Color/weight is never the sole signal (Principle IV) — the strong danger button's caption must itself say "permanently".
- ≥90% line coverage on both stacks (CI gates). Tests mirror source paths.
- The dev stack must be up: `docker compose up -d` from the repo root (`C:\projects\ladybug`).
- Backend commands run in the dev container: `docker compose exec -T backend php artisan test …`, `docker compose exec -T backend ./vendor/bin/pint --test`. There is no local PHP.
- Frontend commands: `docker compose exec frontend npm test -- <args>`, `docker compose exec frontend npm run lint`.
- The dev backend runs `opcache.validate_timestamps=0` — after PHP edits, `docker compose restart backend` before any *manual* (browser) verification. Tests are unaffected (fresh CLI process).
- Tests never touch a real DB: backend tests run on sqlite `:memory:` via `Tests\TestCase` (hard-aborts otherwise). Never add `DB_*` env to compose/CI.
- Public identifiers only: hashes in URLs, never DB ids.

Task order: Tasks 1–2 (backend) and Tasks 3–5 (frontend plumbing) are independent; Task 6 needs 2, 3, 4, and 5; Task 7 is last.

---

### Task 1: `ModerationService::purge()`

**Files:**
- Modify: `backend/app/Services/ModerationService.php`
- Test: `backend/tests/Unit/Services/ModerationServiceTest.php`

**Interfaces:**
- Consumes: `MediaPath::imageSizes()`, `MediaPath::imageRelativePath(string $size, string $code, string $ext)`, `MediaPath::youtubeThumbnailRelativePath(string $videoId)` (existing), `Trashpost` model (`file`, `youtube_thumbnail` columns; SoftDeletes).
- Produces: `ModerationService::purge(string $hash): void` — throws `ModelNotFoundException` for an unknown hash; force-deletes the row; deletes the post's image size variants and, when no other post references it, its `youtube_thumbnail` file from the `public` disk.

- [x] **Step 1: Write the failing tests**

Add to `backend/tests/Unit/Services/ModerationServiceTest.php`. New imports at the top of the file (merge with the existing `use` block, alphabetized):

```php
use App\Support\MediaPath;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Facades\Storage;
```

Add this private helper at the bottom of the class (below the existing tests), and the test methods after the existing `test_restore_finds_a_soft_deleted_meme`:

```php
    public function test_purge_removes_the_row_entirely(): void {
        Storage::fake('public');
        $post = Trashpost::factory()->create();

        $this->service()->purge($post->hash);

        $this->assertFalse(Trashpost::withTrashed()->whereKey($post->id)->exists());
    }

    public function test_purge_deletes_every_image_size_variant(): void {
        Storage::fake('public');
        $post = Trashpost::factory()->create();
        $paths = $this->seedImageVariants($post);

        $this->service()->purge($post->hash);

        foreach ($paths as $path) {
            Storage::disk('public')->assertMissing($path);
        }
    }

    public function test_purge_leaves_another_posts_files_alone(): void {
        Storage::fake('public');
        $post = Trashpost::factory()->create();
        $other = Trashpost::factory()->create();
        $otherPaths = $this->seedImageVariants($other);

        $this->service()->purge($post->hash);

        foreach ($otherPaths as $path) {
            Storage::disk('public')->assertExists($path);
        }
    }

    public function test_purge_works_on_a_soft_deleted_post(): void {
        Storage::fake('public');
        $post = Trashpost::factory()->deleted()->create();

        $this->service()->purge($post->hash);

        $this->assertFalse(Trashpost::withTrashed()->whereKey($post->id)->exists());
    }

    public function test_purge_succeeds_when_the_files_are_already_missing(): void {
        // No variants were ever seeded on the fake disk; the purge must still remove the row.
        Storage::fake('public');
        $post = Trashpost::factory()->create();

        $this->service()->purge($post->hash);

        $this->assertFalse(Trashpost::withTrashed()->whereKey($post->id)->exists());
    }

    public function test_purge_deletes_a_last_reference_youtube_thumbnail(): void {
        Storage::fake('public');
        $thumbnail = MediaPath::youtubeThumbnailRelativePath('dQw4w9WgXcQ');
        Storage::disk('public')->put($thumbnail, 'stub');
        $post = Trashpost::factory()->linkOnly()->create(['youtube_thumbnail' => $thumbnail]);

        $this->service()->purge($post->hash);

        Storage::disk('public')->assertMissing($thumbnail);
    }

    public function test_purge_keeps_a_youtube_thumbnail_shared_with_another_post(): void {
        // Thumbnails are stored once per video id; another post embedding the same video
        // must keep its image when this one is purged.
        Storage::fake('public');
        $thumbnail = MediaPath::youtubeThumbnailRelativePath('dQw4w9WgXcQ');
        Storage::disk('public')->put($thumbnail, 'stub');
        $post = Trashpost::factory()->linkOnly()->create(['youtube_thumbnail' => $thumbnail]);
        Trashpost::factory()->linkOnly()->create(['youtube_thumbnail' => $thumbnail]);

        $this->service()->purge($post->hash);

        Storage::disk('public')->assertExists($thumbnail);
    }

    public function test_purge_keeps_a_thumbnail_referenced_by_a_soft_deleted_post(): void {
        // "Referenced" includes trashed rows — a soft-deleted post may be restored later.
        Storage::fake('public');
        $thumbnail = MediaPath::youtubeThumbnailRelativePath('dQw4w9WgXcQ');
        Storage::disk('public')->put($thumbnail, 'stub');
        $post = Trashpost::factory()->linkOnly()->create(['youtube_thumbnail' => $thumbnail]);
        Trashpost::factory()->linkOnly()->deleted()->create(['youtube_thumbnail' => $thumbnail]);

        $this->service()->purge($post->hash);

        Storage::disk('public')->assertExists($thumbnail);
    }

    public function test_purge_of_an_unknown_hash_throws_model_not_found(): void {
        Storage::fake('public');

        $this->expectException(ModelNotFoundException::class);

        $this->service()->purge('Nonexist99');
    }

    /**
     * Put a stub file at every image-size variant path of the post's file.
     *
     * @return list<string> the seeded relative paths
     */
    private function seedImageVariants(Trashpost $post): array {
        $code = pathinfo($post->file, PATHINFO_FILENAME);
        $ext = pathinfo($post->file, PATHINFO_EXTENSION);
        $paths = [];
        foreach (MediaPath::imageSizes() as $size) {
            $paths[] = $path = MediaPath::imageRelativePath($size, $code, $ext);
            Storage::disk('public')->put($path, 'stub');
        }

        return $paths;
    }
```

Also update the class docblock's last sentence (it currently ends "The four state transitions land here in US3/US4.") to mention purge, e.g. append: `Purge (hard delete) removes the row and its media files for good.`

- [x] **Step 2: Run the tests to verify they fail**

Run: `docker compose exec -T backend php artisan test --filter=ModerationServiceTest`
Expected: FAIL — `Call to undefined method App\Services\ModerationService::purge()` on every new test; all pre-existing tests still PASS.

- [x] **Step 3: Implement `purge()`**

In `backend/app/Services/ModerationService.php`, add imports (merge alphabetized):

```php
use App\Support\MediaPath;
use Illuminate\Support\Facades\Storage;
```

Add after the `restore()` method, before `find()`:

```php
    /**
     * Hard-delete a meme: remove the DB row for good, then its media files. The file list
     * is computed before the row goes away; the row is removed FIRST so a failed file
     * cleanup can only leave invisible orphan files — never a live row pointing at deleted
     * media. Storage::delete() tolerates already-missing files.
     */
    public function purge(string $hash): void {
        $post = $this->find($hash);
        $paths = $this->purgeablePaths($post);
        $post->forceDelete();
        Storage::disk('public')->delete($paths);
    }

    /**
     * Every file the meme owns outright: all image size variants of its stored file, plus
     * its YouTube thumbnail only when no other post (trashed included) shares that file —
     * thumbnails are stored once per video id.
     *
     * @return list<string>
     */
    private function purgeablePaths(Trashpost $post): array {
        $paths = [];
        if ($post->file !== null) {
            $code = pathinfo($post->file, PATHINFO_FILENAME);
            $ext = pathinfo($post->file, PATHINFO_EXTENSION);
            foreach (MediaPath::imageSizes() as $size) {
                $paths[] = MediaPath::imageRelativePath($size, $code, $ext);
            }
        }
        if ($post->youtube_thumbnail !== null && !$this->thumbnailShared($post)) {
            $paths[] = $post->youtube_thumbnail;
        }

        return $paths;
    }

    private function thumbnailShared(Trashpost $post): bool {
        return Trashpost::withTrashed()
            ->where('youtube_thumbnail', $post->youtube_thumbnail)
            ->whereKeyNot($post->id)
            ->exists();
    }
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `docker compose exec -T backend php artisan test --filter=ModerationServiceTest`
Expected: PASS (all, including the pre-existing ones).

- [x] **Step 5: Lint and commit**

```bash
docker compose exec -T backend ./vendor/bin/pint app/Services/ModerationService.php tests/Unit/Services/ModerationServiceTest.php
docker compose exec -T backend ./vendor/bin/pint --test
git add backend/app/Services/ModerationService.php backend/tests/Unit/Services/ModerationServiceTest.php
git commit -m "feat(010-admin-meme-moderation): ModerationService::purge hard delete

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Purge route + controller + API contract

**Files:**
- Modify: `backend/routes/api.php` (admin group, after the destroy line)
- Modify: `backend/app/Http/Controllers/Admin/ModerationController.php`
- Modify: `specs/010-admin-meme-moderation/contracts/admin-moderation-api.md`
- Test: `backend/tests/Feature/Http/Controllers/Admin/ModerationControllerTest.php`

**Interfaces:**
- Consumes: `ModerationService::purge(string $hash): void` (Task 1).
- Produces: `DELETE /api/admin/posts/{hash}/purge` → 204 No Content; 401 guest / 403 member / 404 unknown hash. Route name `api.admin.posts.purge`.

- [x] **Step 1: Write the failing tests**

Add to `backend/tests/Feature/Http/Controllers/Admin/ModerationControllerTest.php`. New imports (merge alphabetized):

```php
use App\Support\MediaPath;
use Illuminate\Support\Facades\Storage;
```

Add after `test_a_soft_deleted_meme_disappears_from_the_public_views`:

```php
    public function test_purge_refuses_a_guest_with_401(): void {
        $post = Trashpost::factory()->create();

        $this->deleteJson("/api/admin/posts/{$post->hash}/purge")->assertUnauthorized();
    }

    public function test_purge_refuses_a_member_with_403(): void {
        $member = User::factory()->create();
        $post = Trashpost::factory()->create();

        $this->actingAs($member)->deleteJson("/api/admin/posts/{$post->hash}/purge")->assertForbidden();
    }

    public function test_purge_returns_204_and_removes_the_row_and_files(): void {
        Storage::fake('public');
        $post = Trashpost::factory()->create();
        $code = pathinfo($post->file, PATHINFO_FILENAME);
        $ext = pathinfo($post->file, PATHINFO_EXTENSION);
        $path = MediaPath::imageRelativePath('original', $code, $ext);
        Storage::disk('public')->put($path, 'stub');

        $this->actingAs($this->admin())
            ->deleteJson("/api/admin/posts/{$post->hash}/purge")
            ->assertNoContent();

        $this->assertFalse(Trashpost::withTrashed()->whereKey($post->id)->exists());
        Storage::disk('public')->assertMissing($path);
    }

    public function test_purge_works_on_a_soft_deleted_meme(): void {
        Storage::fake('public');
        $post = Trashpost::factory()->deleted()->create();

        $this->actingAs($this->admin())
            ->deleteJson("/api/admin/posts/{$post->hash}/purge")
            ->assertNoContent();

        $this->assertFalse(Trashpost::withTrashed()->whereKey($post->id)->exists());
    }

    public function test_purge_on_an_unknown_hash_is_404(): void {
        $this->actingAs($this->admin())
            ->deleteJson('/api/admin/posts/Nonexist99/purge')
            ->assertNotFound();
    }
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `docker compose exec -T backend php artisan test --filter=ModerationControllerTest`
Expected: the five new tests FAIL. The guest test fails with 404-instead-of-401 (route doesn't exist yet → falls through); the rest fail with 404/405-style mismatches. Pre-existing tests PASS.

- [x] **Step 3: Add the route and controller method**

`backend/routes/api.php` — inside the admin group, after the `destroy` line:

```php
    Route::delete('/posts/{hash}/purge', [ModerationController::class, 'purge'])->name('api.admin.posts.purge');
```

`backend/app/Http/Controllers/Admin/ModerationController.php` — add the import `use Illuminate\Http\Response;` (merge alphabetized) and this method after `destroy()`:

```php
    /**
     * DELETE /api/admin/posts/{hash}/purge — hard-delete the meme: the row is removed for
     * good and its media files are deleted from disk. Irreversible, hence a dedicated route
     * (a client bug on the soft-delete route can never escalate). 204: there is no updated
     * row to return — the client drops the row. The client confirms first (FR-016).
     */
    public function purge(string $hash): Response {
        $this->service->purge($hash);

        return response()->noContent();
    }
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `docker compose exec -T backend php artisan test`
Expected: PASS — the full backend suite, not just this file (guards against route collisions).

- [x] **Step 5: Update the API contract**

`specs/010-admin-meme-moderation/contracts/admin-moderation-api.md`:

1. After the `## POST /api/admin/posts/{hash}/restore` section, add:

```markdown
## DELETE `/api/admin/posts/{hash}/purge` — permanent delete

Hard-deletes the meme (added 2026-07-10): the row is removed from the database and its
media files are deleted from disk — every stored image size variant, plus its YouTube
thumbnail **only when no other post (soft-deleted included) references the same file**
(thumbnails are stored once per video id). Irreversible.

- **204 No Content** — there is no updated row to return; the client removes the row
  from the table in place.
- **404** when no meme (including soft-deleted) has that `hash`.
- Requires the client's blocking modal confirmation *before* it is sent (FR-016) —
  enforced UI-side; the endpoint itself just applies.
```

2. In the route-registration snippet at the bottom, add after the destroy line:

```php
    Route::delete('/posts/{hash}/purge', [ModerationController::class, 'purge'])->name('api.admin.posts.purge');
```

- [x] **Step 6: Lint and commit**

```bash
docker compose exec -T backend ./vendor/bin/pint --test
git add backend/routes/api.php backend/app/Http/Controllers/Admin/ModerationController.php backend/tests/Feature/Http/Controllers/Admin/ModerationControllerTest.php specs/010-admin-meme-moderation/contracts/admin-moderation-api.md
git commit -m "feat(010-admin-meme-moderation): purge endpoint hard-deletes row and media

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Multi-action confirm dialog (Confirm.actions[])

**Files:**
- Modify: `frontend/src/hooks/useNotice.ts`
- Modify: `frontend/src/components/ConfirmDialog.tsx`
- Modify: `frontend/src/components/NoticeProvider.tsx`
- Modify: `frontend/src/styles/theme.css` (after the `.notice-dialog__danger` rule, ~line 555)
- Modify: `frontend/src/components/moderation/ModerationActions.tsx` (the one `ask()` caller — behavior-preserving migration)
- Test: `frontend/tests/components/ConfirmDialog.test.tsx`, `frontend/tests/components/NoticeProvider.test.tsx`

**Interfaces:**
- Produces (Tasks 6 relies on these exact shapes):

```ts
// useNotice.ts
export type ConfirmAction = { caption: string; onChoose: () => void; strong?: boolean };
export type Confirm = { message: string; title?: string; actions: ConfirmAction[] };
// ask(confirm: Confirm) unchanged otherwise; the old confirmCaption/onConfirm fields are GONE.
```

- ConfirmDialog props: `{ message: string; title?: string; actions: ConfirmAction[]; onChoose: (action: ConfirmAction) => void; onCancel: () => void }`.
- CSS: a `strong` action button carries `notice-dialog__danger notice-dialog__danger--strong`.

- [x] **Step 1: Rewrite the ConfirmDialog tests for the actions API**

Replace the whole `describe('ConfirmDialog', …)` body in `frontend/tests/components/ConfirmDialog.test.tsx` (keep the file's imports, showModal polyfill, and `afterEach(cleanup)`; add the type import):

```tsx
import ConfirmDialog from '../../src/components/ConfirmDialog';
import type { ConfirmAction } from '../../src/hooks/useNotice';
```

```tsx
describe('ConfirmDialog', () => {
  const softDelete: ConfirmAction = { caption: 'Soft delete', onChoose: () => {} };
  const hardDelete: ConfirmAction = { caption: 'Delete permanently', onChoose: () => {}, strong: true };

  it('opens as a modal showing title, message, Cancel and one button per action', () => {
    render(
      <ConfirmDialog
        title="Delete post?"
        message="Sure?"
        actions={[softDelete, hardDelete]}
        onChoose={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const dialog = document.querySelector('dialog');
    expect(dialog?.open).toBe(true);
    expect(screen.getByRole('heading', { name: 'Delete post?' })).toBeTruthy();
    expect(screen.getByText('Sure?')).toBeTruthy();
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual(['Cancel', 'Soft delete', 'Delete permanently']);
  });

  it('omits the heading when no title is given', () => {
    render(<ConfirmDialog message="Sure?" actions={[softDelete]} onChoose={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('marks a strong action with the heavier danger style', () => {
    render(<ConfirmDialog message="Sure?" actions={[softDelete, hardDelete]} onChoose={vi.fn()} onCancel={vi.fn()} />);

    const soft = screen.getByRole('button', { name: 'Soft delete' });
    const hard = screen.getByRole('button', { name: 'Delete permanently' });
    expect(soft.className).toBe('notice-dialog__danger');
    expect(hard.className).toBe('notice-dialog__danger notice-dialog__danger--strong');
  });

  it('reports a clicked action through onChoose with that action', () => {
    const onChoose = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog message="Sure?" actions={[softDelete, hardDelete]} onChoose={onChoose} onCancel={onCancel} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));

    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose).toHaveBeenCalledWith(hardDelete);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('reports the Cancel click through onCancel only', () => {
    const onChoose = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog message="Sure?" actions={[softDelete]} onChoose={onChoose} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('reports Esc (the dialog cancel event) through onCancel', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog message="Sure?" actions={[softDelete]} onChoose={vi.fn()} onCancel={onCancel} />);

    fireEvent(document.querySelector('dialog') as HTMLDialogElement, new Event('cancel'));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
```

- [x] **Step 2: Update the NoticeProvider confirm tests**

In `frontend/tests/components/NoticeProvider.test.tsx`, replace the `ConfirmRaiser` component and the `describe('NoticeProvider confirm dialogs', …)` block (the notice-side tests stay untouched):

```tsx
// Consumer for the confirm side: raises a delete-style confirm with two destructive choices.
function ConfirmRaiser({ onSoft, onHard }: { onSoft: () => void; onHard: () => void }) {
  const { ask } = useNotice();

  function raise(): void {
    ask({
      title: 'Delete post?',
      message: 'Sure?',
      actions: [
        { caption: 'Soft delete', onChoose: onSoft },
        { caption: 'Delete permanently', onChoose: onHard, strong: true },
      ],
    });
  }

  return (
    <button type="button" onClick={raise}>
      raise confirm
    </button>
  );
}
```

```tsx
describe('NoticeProvider confirm dialogs', () => {
  it('shows the confirm dialog with every offered action', () => {
    render(<NoticeProvider><ConfirmRaiser onSoft={vi.fn()} onHard={vi.fn()} /></NoticeProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'raise confirm' }));

    expect(screen.getByRole('heading', { name: 'Delete post?' })).toBeTruthy();
    expect(screen.getByText('Sure?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Soft delete' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete permanently' })).toBeTruthy();
  });

  it('cancel clears the dialog without running any action', () => {
    const onSoft = vi.fn();
    const onHard = vi.fn();
    render(<NoticeProvider><ConfirmRaiser onSoft={onSoft} onHard={onHard} /></NoticeProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'raise confirm' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onSoft).not.toHaveBeenCalled();
    expect(onHard).not.toHaveBeenCalled();
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('runs exactly the chosen action once and clears the dialog', () => {
    const onSoft = vi.fn();
    const onHard = vi.fn();
    render(<NoticeProvider><ConfirmRaiser onSoft={onSoft} onHard={onHard} /></NoticeProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'raise confirm' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));

    expect(onHard).toHaveBeenCalledTimes(1);
    expect(onSoft).not.toHaveBeenCalled();
    expect(document.querySelector('dialog')).toBeNull();
  });
});
```

- [x] **Step 3: Run both test files to verify they fail**

Run: `docker compose exec frontend npm test -- tests/components/ConfirmDialog.test.tsx tests/components/NoticeProvider.test.tsx`
Expected: FAIL — `ConfirmAction` is not exported / `actions` prop unknown / buttons missing.

- [x] **Step 4: Implement the new contract**

`frontend/src/hooks/useNotice.ts` — replace the `Confirm` type (and its comment):

```ts
// One destructive choice in a confirm dialog. `strong` marks the harsher outcome (e.g. an
// irreversible delete) for heavier visual weight; the caption itself must still carry the
// meaning — color/weight is never the sole signal (Principle IV).
export type ConfirmAction = {
  caption: string;
  onChoose: () => void;
  strong?: boolean;
};

// A pending confirmation: the message to show and the destructive choices on offer.
// Cancel (or Esc) is always available and drops the confirm with nothing run.
export type Confirm = {
  message: string;
  title?: string;
  actions: ConfirmAction[];
};
```

`frontend/src/components/ConfirmDialog.tsx` — full new content:

```tsx
import { useEffect, useRef } from 'react';

import type { ConfirmAction } from '../hooks/useNotice';

// One destructive choice: danger-styled, heavier when marked strong. A named component
// (not an inline closure in the map) keeps the click handler a plain function.
function ActionButton({ action, onChoose }: { action: ConfirmAction; onChoose: (action: ConfirmAction) => void }) {
  function handleClick(): void {
    onChoose(action);
  }

  const className = action.strong
    ? 'notice-dialog__danger notice-dialog__danger--strong'
    : 'notice-dialog__danger';

  return (
    <button type="button" className={className} onClick={handleClick}>
      {action.caption}
    </button>
  );
}

// Native <dialog> confirm modal — the multi-choice sibling of NoticeDialog. Cancel always
// leads the row; Esc (the dialog's cancel event) reports through onCancel like the Cancel
// button, so keyboard users can always back out (Principle IV). What each choice *does* is
// entirely the caller's business.
function ConfirmDialog({ message, title, actions, onChoose, onCancel }: {
  message: string;
  title?: string;
  actions: ConfirmAction[];
  onChoose: (action: ConfirmAction) => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
  }, []);

  return (
    <dialog className="notice-dialog" ref={dialogRef} onCancel={onCancel}>
      {title ? <h2>{title}</h2> : null}
      <p>{message}</p>
      <div className="notice-dialog__buttons">
        <button type="button" onClick={onCancel}>Cancel</button>
        {actions.map((action) => (
          <ActionButton key={action.caption} action={action} onChoose={onChoose} />
        ))}
      </div>
    </dialog>
  );
}

export default ConfirmDialog;
```

`frontend/src/components/NoticeProvider.tsx` — three edits:

1. Type import gains `ConfirmAction`: `import type { Confirm, ConfirmAction, Notice } from '../hooks/useNotice';`
2. Replace `runConfirm` with:

```tsx
  // Choosing an action closes the dialog first, then runs that action exactly once.
  const choose = useCallback((action: ConfirmAction) => {
    setConfirm(null);
    action.onChoose();
  }, []);
```

3. Replace the `<ConfirmDialog …/>` element:

```tsx
      {confirm ? (
        <ConfirmDialog
          message={confirm.message}
          title={confirm.title}
          actions={confirm.actions}
          onChoose={choose}
          onCancel={clear}
        />
      ) : null}
```

(`runConfirm`'s `[confirm]` dependency disappears; `choose` has no dependencies.)

`frontend/src/styles/theme.css` — insert directly after the `.notice-dialog__buttons button.notice-dialog__danger` rule (~line 555):

```css
/* The irreversible choice (e.g. permanent delete): filled with the error tone for extra
   weight next to its milder outlined sibling. The caption ("Delete permanently") still
   carries the meaning — never color/weight alone (Principle IV). */
.notice-dialog__buttons button.notice-dialog__danger--strong {
  color: #fff;
  background-color: var(--color-error);
}
```

`frontend/src/components/moderation/ModerationActions.tsx` — behavior-preserving migration of the one caller; replace the `ask({...})` object inside `askDelete`:

```tsx
    ask({
      title: 'Delete post?',
      message: ModerationModel.deleteConfirmMessage(row.title),
      actions: [{ caption: 'Confirm delete', onChoose: confirmDelete }],
    });
```

- [x] **Step 5: Run the frontend suite to verify green**

Run: `docker compose exec frontend npm test -- tests/components/ConfirmDialog.test.tsx tests/components/NoticeProvider.test.tsx tests/components/moderation/ModerationActions.test.tsx`
Expected: PASS — including the untouched ModerationActions tests (same captions and copy as before).

- [x] **Step 6: Lint and commit**

```bash
docker compose exec frontend npm run lint
git add frontend/src/hooks/useNotice.ts frontend/src/components/ConfirmDialog.tsx frontend/src/components/NoticeProvider.tsx frontend/src/styles/theme.css frontend/src/components/moderation/ModerationActions.tsx frontend/tests/components/ConfirmDialog.test.tsx frontend/tests/components/NoticeProvider.test.tsx
git commit -m "feat(010-admin-meme-moderation): confirm dialog takes a list of actions

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `ModerationApi.purge` + purge confirm copy

**Files:**
- Modify: `frontend/src/lib/moderationApi.ts`
- Modify: `frontend/src/lib/moderationModel.ts`
- Test: `frontend/tests/lib/moderationApi.test.ts`, `frontend/tests/lib/moderationModel.test.ts`

**Interfaces:**
- Produces: `ModerationApi.purge(hash: string): Promise<ModerationPurgeResult>` with `export type ModerationPurgeResult = { ok: boolean }`; `ModerationModel.purgeConfirmMessage(title: string | null): string`. (`deleteConfirmMessage` is NOT touched here — its copy changes in Task 6 together with the dialog that shows it.)

- [x] **Step 1: Write the failing tests**

Append to `frontend/tests/lib/moderationApi.test.ts`:

```ts
describe('ModerationApi.purge', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('DELETEs the purge endpoint (CSRF header) and reports ok on 204', async () => {
    const fetchMock = stubFetch(async () => ({ ok: true, status: 204 }));

    const result = await ModerationApi.purge('Ab3-_9xQ12');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/admin\/posts\/Ab3-_9xQ12\/purge$/),
      expect.objectContaining({
        method: 'DELETE',
        credentials: 'include',
        headers: expect.objectContaining({ 'X-XSRF-TOKEN': expect.anything() }),
      }),
    );
    expect(result.ok).toBe(true);
  });

  it('reports failure on a non-2xx response (e.g. 404 unknown hash)', async () => {
    stubFetch(async () => ({ ok: false, status: 404 }));

    const result = await ModerationApi.purge('missing0000');

    expect(result.ok).toBe(false);
  });

  it('reports failure when the request rejects (offline)', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch');
    });

    const result = await ModerationApi.purge('Ab3-_9xQ12');

    expect(result.ok).toBe(false);
  });
});
```

Append to `frontend/tests/lib/moderationModel.test.ts` (the existing `deleteConfirmMessage` describe stays as-is for now):

```ts
describe('ModerationModel.purgeConfirmMessage', () => {
  it('states the post is already hidden and the removal is forever, naming it by title', () => {
    expect(ModerationModel.purgeConfirmMessage('A funny meme')).toBe(
      'The post "A funny meme" is already hidden from the site. '
        + 'Permanent delete removes it and its files forever.',
    );
  });

  it('falls back to "This post" when the title is missing', () => {
    expect(ModerationModel.purgeConfirmMessage(null)).toBe(
      'This post is already hidden from the site. Permanent delete removes it and its files forever.',
    );
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `docker compose exec frontend npm test -- tests/lib/moderationApi.test.ts tests/lib/moderationModel.test.ts`
Expected: FAIL — `purge` / `purgeConfirmMessage` are not functions.

- [x] **Step 3: Implement**

`frontend/src/lib/moderationApi.ts` — add below `ModerationActionResult`:

```ts
// A purge has no row to return (204): success only says the post and its files are gone.
export type ModerationPurgeResult = { ok: boolean };
```

Add the method after `restore()` (it cannot reuse `act()`, which parses a row body a 204 does not have):

```ts
  // Hard delete: the row and its media files are removed for good. 204 carries no body,
  // so success is just `ok` — the caller drops the row from its page.
  static async purge(hash: string): Promise<ModerationPurgeResult> {
    try {
      const response = await fetch(`${Api.base()}/api/admin/posts/${encodeURIComponent(hash)}/purge`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { Accept: 'application/json', 'X-XSRF-TOKEN': Csrf.token() },
      });
      return { ok: response.ok };
    } catch {
      return { ok: false };
    }
  }
```

`frontend/src/lib/moderationModel.ts` — add after `deleteConfirmMessage`:

```ts
  // The confirm body for an already soft-deleted post, where only permanent deletion (and
  // cancel) is on offer. User-facing copy says "post" (site vocabulary).
  static purgeConfirmMessage(title: string | null): string {
    const subject = title === null ? 'This post' : `The post "${title}"`;
    return `${subject} is already hidden from the site. Permanent delete removes it and its files forever.`;
  }
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `docker compose exec frontend npm test -- tests/lib/moderationApi.test.ts tests/lib/moderationModel.test.ts`
Expected: PASS.

- [x] **Step 5: Lint and commit**

```bash
docker compose exec frontend npm run lint
git add frontend/src/lib/moderationApi.ts frontend/src/lib/moderationModel.ts frontend/tests/lib/moderationApi.test.ts frontend/tests/lib/moderationModel.test.ts
git commit -m "feat(010-admin-meme-moderation): ModerationApi.purge and purge confirm copy

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: `useModeration.removeRow`

**Files:**
- Modify: `frontend/src/hooks/useModeration.ts`
- Test: `frontend/tests/hooks/useModeration.test.tsx`

**Interfaces:**
- Produces: `removeRow(hash: string): void` in the `useModeration()` return object (now `{ rows, meta, loading, empty, applyRow, removeRow }`). Task 6 threads it to `ModerationActions`.

- [x] **Step 1: Write the failing tests**

Append inside the `describe('useModeration', …)` block of `frontend/tests/hooks/useModeration.test.tsx`:

```tsx
  it('removeRow drops just the purged row, keeping the page and skipping any refetch', async () => {
    const rowB: ModerationRow = { ...row, hash: 'Zz9-_0000A' };
    const fetchPage = vi
      .spyOn(ModerationApi, 'fetchPage')
      .mockResolvedValue({ ok: true, data: [row, rowB], meta: { ...meta, total: 2 } });

    const { result } = renderHook(() => useModeration(), { wrapper: wrapperFor('/admin/trashposts') });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.removeRow(rowB.hash));

    expect(result.current.rows).toEqual([row]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(false);
  });

  it('removeRow is a no-op for a hash not on the page', async () => {
    vi.spyOn(ModerationApi, 'fetchPage').mockResolvedValue({ ok: true, data: [row], meta });

    const { result } = renderHook(() => useModeration(), { wrapper: wrapperFor('/admin/trashposts') });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.removeRow('missing0000'));

    expect(result.current.rows).toEqual([row]);
  });
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `docker compose exec frontend npm test -- tests/hooks/useModeration.test.tsx`
Expected: FAIL — `result.current.removeRow is not a function`.

- [x] **Step 3: Implement**

`frontend/src/hooks/useModeration.ts` — add after `applyRow` and extend the return object:

```ts
  // Drop a purged row from the page (the server returned 204 — the row no longer exists).
  // No refetch: the admin stays on the current page; the meta counts stay as fetched until
  // the next page load (acceptable staleness for a back-office table).
  function removeRow(hash: string): void {
    setLoaded((current) => {
      if (current === null) {
        return current;
      }
      return {
        ...current,
        rows: current.rows.filter((row) => row.hash !== hash),
      };
    });
  }
```

```ts
  return { rows, meta, loading, empty, applyRow, removeRow };
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `docker compose exec frontend npm test -- tests/hooks/useModeration.test.tsx`
Expected: PASS.

- [x] **Step 5: Lint and commit**

```bash
docker compose exec frontend npm run lint
git add frontend/src/hooks/useModeration.ts frontend/tests/hooks/useModeration.test.tsx
git commit -m "feat(010-admin-meme-moderation): useModeration.removeRow drops a purged row

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Wire the three-option delete into the moderation table

**Files:**
- Modify: `frontend/src/lib/moderationModel.ts` (`deleteConfirmMessage` copy)
- Modify: `frontend/src/components/moderation/ModerationActions.tsx`
- Modify: `frontend/src/components/moderation/ModerationRow.tsx`, `frontend/src/components/moderation/ModerationTable.tsx` (thread `onRemove`)
- Modify: `frontend/src/pages/ModerationPage.tsx` (pass `removeRow`)
- Test: `frontend/tests/lib/moderationModel.test.ts`, `frontend/tests/components/moderation/ModerationActions.test.tsx`, `frontend/tests/components/moderation/ModerationRow.test.tsx`, `frontend/tests/components/moderation/ModerationTable.test.tsx`, `frontend/tests/pages/ModerationPage.test.tsx`

**Interfaces:**
- Consumes: `Confirm.actions` / `ConfirmAction` (Task 3), `ModerationApi.purge` + `ModerationModel.purgeConfirmMessage` (Task 4), `removeRow` (Task 5).
- Produces: `ModerationActions`, `ModerationRow`, `ModerationTable` all take `onRemove: (hash: string) => void` alongside `onApply`. Button labels: live row `Delete`; deleted row `Restore` + `Delete permanently`. Dialog captions: `Soft delete`, `Delete permanently`.

- [x] **Step 1: Update the model copy test**

In `frontend/tests/lib/moderationModel.test.ts`, replace the body of `describe('ModerationModel.deleteConfirmMessage', …)`:

```ts
describe('ModerationModel.deleteConfirmMessage', () => {
  it('explains both outcomes, naming the post by its title', () => {
    expect(ModerationModel.deleteConfirmMessage('A funny meme')).toBe(
      'Soft delete hides the post "A funny meme" from the site — you can restore it later. '
        + 'Permanent delete removes the post and its files forever.',
    );
  });

  it('falls back to "this post" when the title is missing', () => {
    expect(ModerationModel.deleteConfirmMessage(null)).toBe(
      'Soft delete hides this post from the site — you can restore it later. '
        + 'Permanent delete removes the post and its files forever.',
    );
  });
});
```

- [x] **Step 2: Rewrite the delete/restore ModerationActions tests**

In `frontend/tests/components/moderation/ModerationActions.test.tsx`:

1. Extend `renderInRow` with an `onRemove` parameter:

```tsx
function renderInRow(
  row: Row,
  onApply: (updated: Row) => void,
  onRowClick: () => void = () => {},
  onRemove: (hash: string) => void = () => {},
) {
  return render(
    <NoticeProvider>
      <table>
        <tbody>
          <tr onClick={onRowClick}>
            <td>
              <ModerationActions row={row} onApply={onApply} onRemove={onRemove} />
            </td>
          </tr>
        </tbody>
      </table>
    </NoticeProvider>,
  );
}
```

2. Replace the whole `describe('ModerationActions delete/restore control', …)` block:

```tsx
describe('ModerationActions delete/restore control', () => {
  const deletedRow: Row = { ...inactive, deletedAt: '2026-07-09 09:30:00' };

  it('offers Delete for a live meme; Restore and Delete permanently for a deleted one', () => {
    renderInRow(inactive, () => {});
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^restore$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^delete permanently$/i })).toBeNull();
    cleanup();

    renderInRow(deletedRow, () => {});
    expect(screen.getByRole('button', { name: /^restore$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^delete permanently$/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^delete$/i })).toBeNull();
  });

  it('soft-deletes through the modal and applies the updated row (FR-016)', async () => {
    const updated = { ...inactive, deletedAt: '2026-07-09 09:30:00' };
    vi.spyOn(ModerationApi, 'remove').mockResolvedValue({ ok: true, row: updated });
    vi.spyOn(ModerationApi, 'purge').mockResolvedValue({ ok: false });
    const onApply = vi.fn();

    renderInRow(inactive, onApply);
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    // Not sent yet — the modal must be answered first; the copy explains both outcomes.
    expect(ModerationApi.remove).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Delete post?' })).toBeTruthy();
    expect(
      screen.getByText(
        'Soft delete hides the post "A funny meme" from the site — you can restore it later. '
          + 'Permanent delete removes the post and its files forever.',
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Soft delete' }));

    await waitFor(() => expect(onApply).toHaveBeenCalledWith(updated));
    expect(ModerationApi.remove).toHaveBeenCalledWith('Ab3-_9xQ12');
    expect(ModerationApi.purge).not.toHaveBeenCalled();
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('hard-deletes a live meme through the modal and removes the row', async () => {
    vi.spyOn(ModerationApi, 'remove').mockResolvedValue({ ok: false });
    vi.spyOn(ModerationApi, 'purge').mockResolvedValue({ ok: true });
    const onApply = vi.fn();
    const onRemove = vi.fn();

    renderInRow(inactive, onApply, () => {}, onRemove);
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));

    await waitFor(() => expect(onRemove).toHaveBeenCalledWith('Ab3-_9xQ12'));
    expect(ModerationApi.purge).toHaveBeenCalledWith('Ab3-_9xQ12');
    expect(ModerationApi.remove).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('offers only permanent delete for an already-deleted meme', async () => {
    vi.spyOn(ModerationApi, 'purge').mockResolvedValue({ ok: true });
    const onRemove = vi.fn();

    renderInRow(deletedRow, () => {}, () => {}, onRemove);
    fireEvent.click(screen.getByRole('button', { name: /^delete permanently$/i }));

    expect(screen.getByRole('heading', { name: 'Delete post permanently?' })).toBeTruthy();
    expect(
      screen.getByText(
        'The post "A funny meme" is already hidden from the site. '
          + 'Permanent delete removes it and its files forever.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Soft delete' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));

    await waitFor(() => expect(onRemove).toHaveBeenCalledWith('Ab3-_9xQ12'));
    expect(ModerationApi.purge).toHaveBeenCalledWith('Ab3-_9xQ12');
  });

  it('cancels a pending delete without sending anything, closing the modal', () => {
    vi.spyOn(ModerationApi, 'remove').mockResolvedValue({ ok: false });
    vi.spyOn(ModerationApi, 'purge').mockResolvedValue({ ok: false });

    renderInRow(inactive, () => {});
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(ModerationApi.remove).not.toHaveBeenCalled();
    expect(ModerationApi.purge).not.toHaveBeenCalled();
    expect(document.querySelector('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeTruthy();
  });

  it('keeps the row when the purge fails', async () => {
    vi.spyOn(ModerationApi, 'purge').mockResolvedValue({ ok: false });
    const onRemove = vi.fn();

    renderInRow(inactive, () => {}, () => {}, onRemove);
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));

    // Give the settled failure a tick; the row must not be removed.
    await Promise.resolve();
    expect(onRemove).not.toHaveBeenCalled();
  });

  it('falls back to "this post" copy when the row has no title', () => {
    renderInRow({ ...inactive, title: null }, () => {});
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    expect(
      screen.getByText(
        'Soft delete hides this post from the site — you can restore it later. '
          + 'Permanent delete removes the post and its files forever.',
      ),
    ).toBeTruthy();
  });

  it('restores on a single click (no confirmation)', async () => {
    const updated = { ...inactive, deletedAt: null };
    vi.spyOn(ModerationApi, 'restore').mockResolvedValue({ ok: true, row: updated });
    const onApply = vi.fn();

    renderInRow(deletedRow, onApply);
    fireEvent.click(screen.getByRole('button', { name: /^restore$/i }));

    await waitFor(() => expect(onApply).toHaveBeenCalledWith(updated));
    expect(ModerationApi.restore).toHaveBeenCalledWith('Ab3-_9xQ12');
  });

  it('does not navigate the row when a delete choice is made (FR-018)', () => {
    vi.spyOn(ModerationApi, 'purge').mockResolvedValue({ ok: false });
    const onRowClick = vi.fn();

    renderInRow(inactive, () => {}, onRowClick);
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));

    expect(onRowClick).not.toHaveBeenCalled();
  });
});
```

- [x] **Step 3: Run the changed test files to verify they fail**

Run: `docker compose exec frontend npm test -- tests/lib/moderationModel.test.ts tests/components/moderation/ModerationActions.test.tsx`
Expected: FAIL — old copy in the model; `onRemove` prop rejected / buttons missing in ModerationActions.

- [x] **Step 4: Implement**

`frontend/src/lib/moderationModel.ts` — replace `deleteConfirmMessage` (and its comment):

```ts
  // The delete-confirm body for a live post: both outcomes explained — soft delete is
  // reversible, permanent delete is not. User-facing copy says "post" (site vocabulary),
  // never the internal "meme"/"trashpost".
  static deleteConfirmMessage(title: string | null): string {
    const subject = title === null ? 'this post' : `the post "${title}"`;
    return `Soft delete hides ${subject} from the site — you can restore it later. `
      + 'Permanent delete removes the post and its files forever.';
  }
```

`frontend/src/components/moderation/ModerationActions.tsx` — full new content:

```tsx
import type { MouseEvent, ReactElement } from 'react';

import { useNotice } from '../../hooks/useNotice';
import { ModerationApi } from '../../lib/moderationApi';
import type { ModerationActionResult, ModerationPurgeResult } from '../../lib/moderationApi';
import { ModerationModel } from '../../lib/moderationModel';
import type { ModerationRow as Row } from '../../lib/moderationModel';

type Apply = (updated: Row) => void;

type Remove = (hash: string) => void;

type ActionGlyph = 'activate' | 'deactivate' | 'delete' | 'restore';

// Flat single-path glyphs (24x24, filled with currentColor) drawn in the same spirit as the
// LeftMenu icon set: a play triangle, pause bars, a trash can, and an undo arc.
const GLYPHS: Record<ActionGlyph, string> = {
  activate: 'M8 5v14l11-7z',
  deactivate: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
  delete: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
  restore: 'M13 3a9 9 0 0 0-9 9H1l4 4 4-4H6a7 7 0 1 1 7 7 6.97 6.97 0 0 1-4.9-2L6.7 18.4A9 9 0 1 0 13 3z',
};

// Decorative only: the button's aria-label/title carries the accessible name (Principle IV).
function ActionIcon({ glyph }: { glyph: ActionGlyph }): ReactElement {
  return (
    <svg className="moderation-actions__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={GLYPHS[glyph]} />
    </svg>
  );
}

// The per-row moderation controls (US3 activation + US4 delete/restore). Every button stops
// the click from bubbling to the row so acting never navigates to the meme page (FR-018); a
// successful state change hands the server's updated row back up via `onApply` for an
// in-place refresh (FR-017), while a successful purge reports the hash via `onRemove` so the
// page drops the now-nonexistent row.
function ModerationActions({ row, onApply, onRemove }: { row: Row; onApply: Apply; onRemove: Remove }) {
  return (
    <div className="moderation-actions">
      <ActivationButton row={row} onApply={onApply} />
      <DeletionControl row={row} onApply={onApply} onRemove={onRemove} />
    </div>
  );
}

// Await a moderation action and, on success, push the updated row upward; a failed action
// (non-2xx or network) leaves the row untouched — the table simply doesn't change. A class
// (not a loose function) per docs/CODING_CONVENTIONS.md; the IO itself stays in ModerationApi.
class RowAction {
  static async apply(action: Promise<ModerationActionResult>, onApply: Apply): Promise<void> {
    const result = await action;
    if (result.ok) {
      onApply(result.row);
    }
  }
}

// The purge sibling of RowAction: a 204 means the row no longer exists, so success reports
// the hash upward for removal instead of an updated row.
class RowPurge {
  static async apply(action: Promise<ModerationPurgeResult>, hash: string, onRemove: Remove): Promise<void> {
    const result = await action;
    if (result.ok) {
      onRemove(hash);
    }
  }
}

// Exactly one activation control, reflecting the row's current state. A meme is activated
// precisely when it carries an activated_at timestamp.
function ActivationButton({ row, onApply }: { row: Row; onApply: Apply }) {
  const activated = row.activatedAt !== null;

  function toggle(event: MouseEvent<HTMLButtonElement>): void {
    event.stopPropagation();
    void RowAction.apply(activated ? ModerationApi.deactivate(row.hash) : ModerationApi.activate(row.hash), onApply);
  }

  const label = activated ? 'Deactivate' : 'Activate';

  return (
    <button type="button" className="moderation-actions__button" onClick={toggle} aria-label={label} title={label}>
      <ActionIcon glyph={activated ? 'deactivate' : 'activate'} />
    </button>
  );
}

// Deletion, guarded by a blocking modal confirm raised app-level via useNotice (FR-016).
// A live meme's trash button offers soft delete and permanent delete; a soft-deleted meme
// shows single-click Restore plus a trash button offering only permanent delete. The modal
// renders outside the row, so answering it never navigates.
function DeletionControl({ row, onApply, onRemove }: { row: Row; onApply: Apply; onRemove: Remove }) {
  const { ask } = useNotice();
  const deleted = row.deletedAt !== null;

  function restore(event: MouseEvent<HTMLButtonElement>): void {
    event.stopPropagation();
    void RowAction.apply(ModerationApi.restore(row.hash), onApply);
  }

  function confirmSoftDelete(): void {
    void RowAction.apply(ModerationApi.remove(row.hash), onApply);
  }

  function confirmPurge(): void {
    void RowPurge.apply(ModerationApi.purge(row.hash), row.hash, onRemove);
  }

  function askDelete(event: MouseEvent<HTMLButtonElement>): void {
    event.stopPropagation();
    ask({
      title: 'Delete post?',
      message: ModerationModel.deleteConfirmMessage(row.title),
      actions: [
        { caption: 'Soft delete', onChoose: confirmSoftDelete },
        { caption: 'Delete permanently', onChoose: confirmPurge, strong: true },
      ],
    });
  }

  function askPurge(event: MouseEvent<HTMLButtonElement>): void {
    event.stopPropagation();
    ask({
      title: 'Delete post permanently?',
      message: ModerationModel.purgeConfirmMessage(row.title),
      actions: [{ caption: 'Delete permanently', onChoose: confirmPurge, strong: true }],
    });
  }

  if (deleted) {
    return (
      <>
        <button type="button" className="moderation-actions__button" onClick={restore} aria-label="Restore" title="Restore">
          <ActionIcon glyph="restore" />
        </button>
        <button
          type="button"
          className="moderation-actions__button"
          onClick={askPurge}
          aria-label="Delete permanently"
          title="Delete permanently"
        >
          <ActionIcon glyph="delete" />
        </button>
      </>
    );
  }

  return (
    <button type="button" className="moderation-actions__button" onClick={askDelete} aria-label="Delete" title="Delete">
      <ActionIcon glyph="delete" />
    </button>
  );
}

export default ModerationActions;
```

`frontend/src/components/moderation/ModerationRow.tsx` — signature and actions cell (comment: extend the `onApply` sentence with "; `onRemove` drops it after a purge"):

```tsx
function ModerationRow({ row, onApply, onRemove }: {
  row: Row;
  onApply: (updated: Row) => void;
  onRemove: (hash: string) => void;
}) {
```

```tsx
      <td className="moderation-row__actions">
        <ModerationActions row={row} onApply={onApply} onRemove={onRemove} />
      </td>
```

`frontend/src/components/moderation/ModerationTable.tsx` — same threading (extend the header comment the same way):

```tsx
function ModerationTable({ rows, onApply, onRemove }: {
  rows: Row[];
  onApply: (updated: Row) => void;
  onRemove: (hash: string) => void;
}) {
```

```tsx
          {rows.map((row) => (
            <ModerationRow key={row.hash} row={row} onApply={onApply} onRemove={onRemove} />
          ))}
```

`frontend/src/pages/ModerationPage.tsx`:

```tsx
  const { rows, meta, loading, empty, applyRow, removeRow } = useModeration();
```

```tsx
          <ModerationTable rows={rows} onApply={applyRow} onRemove={removeRow} />
```

Collateral test fixes (required-prop additions only):

- `frontend/tests/components/moderation/ModerationRow.test.tsx`: `<ModerationRow row={value} onApply={() => {}} onRemove={() => {}} />`
- `frontend/tests/components/moderation/ModerationTable.test.tsx`: `<ModerationTable rows={rows} onApply={() => {}} onRemove={() => {}} />`
- `frontend/tests/pages/ModerationPage.test.tsx`: add `removeRow: vi.fn()` to each of the three `useModerationMock.mockReturnValue({ … })` objects.

- [x] **Step 5: Run the full frontend suite with coverage**

Run: `docker compose exec frontend npm test -- --coverage`
Expected: PASS, total line coverage ≥90%.

- [x] **Step 6: Lint and commit**

```bash
docker compose exec frontend npm run lint
git add frontend/src frontend/tests
git commit -m "feat(010-admin-meme-moderation): soft/hard delete choices in the delete confirm

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Spec truth-up, full gates, live verification

**Files:**
- Modify: `specs/010-admin-meme-moderation/spec.md` (FR-015/FR-016/FR-017 + the "Already-deleted meme" edge case)

**Interfaces:** none — documentation and verification only.

- [x] **Step 1: Amend the spec**

In `specs/010-admin-meme-moderation/spec.md`:

1. Edge case bullet (~line 155) — replace with:

```markdown
- **Already-deleted meme**: Its state is shown as deleted and its deletion controls offer
  Restore and permanent delete (revised 2026-07-10); its activation control still reflects
  its activated state (Activate/Deactivate) per FR-016.
```

2. FR-015 — replace with:

```markdown
- **FR-015**: Each row MUST offer a reversible activation control and a deletion control
  (reversible soft delete, plus irreversible permanent delete behind its own confirmation;
  revised 2026-07-10), presented according to the row's current state (FR-016).
```

3. FR-016's Deletion bullet — replace with:

```markdown
  - Deletion: a non-deleted meme MUST offer **Delete**, whose blocking modal confirmation
    (a dialog that suspends interaction with the rest of the page until answered; revised
    2026-07-10 from the original inline confirm) MUST offer three choices: **soft delete**
    (retain data, flag as deleted, remove from public views), **permanent delete** (remove
    the meme's database row and its media files irreversibly; added 2026-07-10), and
    **cancel**. A deleted meme MUST offer **Restore** (single click, returns it to the
    non-deleted state) and **permanent delete** behind a confirmation offering only
    permanent delete and cancel. **Activate**, **Deactivate**, and **Restore** apply on a
    single click without confirmation.
```

4. FR-017 — replace with:

```markdown
- **FR-017**: After any moderation action (Activate, Deactivate, Delete, Restore, permanent
  delete), the admin MUST remain on the same page of the table; the affected row MUST
  reflect the new state — or, after a permanent delete, disappear from the table.
```

- [x] **Step 2: Run every CI gate locally**

```bash
docker compose exec -T backend php artisan test
docker compose exec -T backend ./vendor/bin/pint --test
docker compose exec frontend npm test -- --coverage
docker compose exec frontend npm run lint
```

Expected: all PASS; frontend coverage ≥90% (CI's `check_coverage.py` gate spans all of `src/`).

- [x] **Step 3: Verify in the running app**

`docker compose restart backend` (opcache holds stale PHP otherwise), then in a browser as an admin on `/admin/trashposts`:

1. Live row → trash icon → modal shows Cancel / Soft delete / Delete permanently (the last one filled in the error tone in both light and dark themes).
2. Soft delete → row stays, Deleted column fills, controls flip to Restore + Delete permanently.
3. That row → Delete permanently → confirm → row leaves the table; its image variant files are gone from `C:\docker_permanent\ladybug-storage\...\image\trash\*\<shard>\<code>.*`; refresh — it is gone from the table and its `/posts/{hash}` page 404s.
4. Esc and Cancel both close the modal with no effect.

- [x] **Step 4: Commit**

```bash
git add specs/010-admin-meme-moderation/spec.md
git commit -m "docs(010-admin-meme-moderation): spec FRs cover permanent delete

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Notes

- The Playwright spec `frontend/e2e/moderation.spec.ts` has **no delete-flow coverage today**, so no e2e changes are required by this feature (verified by grep on 2026-07-10).
- No video-file cleanup: no current code path stores video files (`MediaPath::videoRelativePath` is unused by uploads) — out of scope per the design.
