# Code Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every finding from the 2026-07-10 whole-project code review (backend, frontend, infra): the media-takedown gap, weak public hashes, the `UserResource` id leak, CSRF priming, moderation-console failure states, convention breaches, and infra hygiene.

**Architecture:** Backend fixes center on a new `MediaVisibilityService` that physically moves a meme's files between the `public` and private `local` disks as its visibility changes, plus a CSPRNG rewrite of `Str::createUniqueHash`. Frontend fixes wire the Sanctum CSRF priming step into every unsafe request, give the moderation console a real error state, and refactor over-long functions. Infra fixes bind dev ports to loopback and clean up secrets-adjacent script patterns.

**Tech Stack:** Laravel 12 (PHP 8.2+, PHPUnit, Pint), React 18 + Vite + TypeScript (Vitest, Playwright), Docker Compose, PowerShell.

## Global Constraints

- **No new dependencies** without explicit human approval (Constitution Principle I). Nothing in this plan adds any.
- **Backend commands run in Docker** (no local PHP). With the dev stack up: `docker compose exec backend php artisan test --filter=<Name>` and `docker compose exec backend ./vendor/bin/pint --test`. After editing PHP that you want to *browse* (not test), run `docker compose restart backend` (opcache `validate_timestamps=0`); CLI test runs are unaffected.
- **Frontend commands:** `docker compose exec frontend npx vitest run <path>` and `docker compose exec frontend npm run lint`.
- **Tests never touch a real DB** — they run on sqlite `:memory:` only; `Tests\TestCase` hard-aborts otherwise. Never add `DB_*` env vars to compose or CI.
- **Coverage ≥90% lines on both stacks** (CI-enforced). Every new branch needs a test.
- **Conventions are binding** (`docs/CODING_CONVENTIONS.md`): PHP = PSR-12 + 4-space + `declare(strict_types=1)` + functions <30 lines + same-line braces (pint.json enforces); TS = 2-space + semicolons + functions <50 lines. Comments explain *why*.
- **Public identifiers** are 10-char `[A-Za-z0-9_-]` hashes minted by `App\Utils\Str::createUniqueHash` — never DB ids, never `Support\PublicCode`.
- **Commit after every task** on the current branch (`master`), conventional style: `fix(review): <what>` / `refactor(review): <what>` / `chore(review): <what>`. Do not create branches.
- Base commit for this plan: `6524ead`.

---

## Phase 1 — Backend content-safety cluster

### Task 1: CSPRNG public hashes (`Str::createUniqueHash`)

The current hash is base64 of `random_int(2,114) . unixtime . microseconds`. `created_at` is exposed to the second in API resources, so a hash is guessable within ~113 × 10⁶ candidates per creation-second — enough to enumerate hidden posts. Replace with 10 independent uniform draws (~60 bits).

**Files:**
- Modify: `backend/app/Utils/Str.php`
- Test: `backend/tests/Unit/Utils/StrTest.php`

**Interfaces:**
- Produces: `Str::createUniqueHash(int $length = 10): string` — same signature, same charset, now uniform-random per character. All existing callers (`UserService`, `TrashpostService`) are unaffected.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/Unit/Utils/StrTest.php` (inside the class):

```php
    public function test_single_char_hashes_cover_the_full_charmap_including_zero(): void {
        $seen = [];
        for ($i = 0; $i < 2000; $i++) {
            $seen[Str::createUniqueHash(1)] = true;
        }

        // A uniform per-character sampler hits '0' virtually surely in 2000 draws
        // (P(miss) ≈ 2e-14); the old time-seeded big-number encoding could never
        // emit '0' as its leading character, so this pins the uniformity property.
        $this->assertArrayHasKey('0', $seen);
        $this->assertGreaterThan(60, count($seen));
    }

    public function test_hashes_do_not_repeat_across_many_draws(): void {
        $draws = [];
        for ($i = 0; $i < 1000; $i++) {
            $draws[] = Str::createUniqueHash();
        }

        $this->assertSame(count($draws), count(array_unique($draws)));
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec backend php artisan test --filter=StrTest`
Expected: FAIL — `test_single_char_hashes_cover_the_full_charmap_including_zero` (missing `'0'`). The uniqueness test passes on both implementations.

- [ ] **Step 3: Write the implementation**

Replace the whole body of `backend/app/Utils/Str.php` with:

```php
<?php

declare(strict_types=1);

namespace App\Utils;

class Str {
    /**
     * Build a random public hash of the given length from the URL-safe base64
     * alphabet ([A-Za-z0-9_-]).
     *
     * Each character is an independent uniform draw via random_int (a CSPRNG),
     * so a 10-char hash carries ~60 bits of entropy and is NOT derivable from
     * the post's creation time — the API exposes created_at to the second, so a
     * time-seeded hash would leave only the salt to guess (Principle V opacity).
     *
     * Uniqueness stays probabilistic: callers needing a guaranteed-unique value
     * must enforce it at the storage layer (e.g. a unique column) — all current
     * callers do, with a retry loop on collision.
     */
    public static function createUniqueHash(int $length = 10): string {
        $hash = '';
        for ($i = 0; $i < $length; $i++) {
            $hash .= Base64::convertDecToBase64(random_int(0, 63));
        }

        return $hash;
    }
}
```

(The private `getTimeBasedUniqueNumber()` helper is deleted; nothing else used it.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `docker compose exec backend php artisan test --filter=StrTest`
Expected: PASS (6 tests). Then run the callers' suites: `docker compose exec backend php artisan test --filter='UserServiceTest|TrashpostServiceTest'` — expected PASS.

- [ ] **Step 5: Lint and commit**

```bash
docker compose exec backend ./vendor/bin/pint --test
git add backend/app/Utils/Str.php backend/tests/Unit/Utils/StrTest.php
git commit -m "fix(review): mint public hashes from a CSPRNG, not creation time"
```

---

### Task 2: Hide media when a meme leaves public view (`MediaVisibilityService`)

`ModerationService::delete`/`deactivate` only hide the DB row; all image variants stay publicly fetchable at predictable URLs — a moderation bypass for anyone who saved a permalink. Fix: move the meme's files to the private `local` disk (root `storage/app/private`, never web-served) when it becomes invisible, and back when it becomes visible. Purge cleans both disks.

**Files:**
- Create: `backend/app/Services/MediaVisibilityService.php`
- Modify: `backend/app/Services/ModerationService.php`
- Test: `backend/tests/Unit/Services/MediaVisibilityServiceTest.php` (new), `backend/tests/Unit/Services/ModerationServiceTest.php` (extend)

**Interfaces:**
- Produces: `MediaVisibilityService::sync(Trashpost $post): void` (moves files to the disk matching visibility, idempotent) and `MediaVisibilityService::ownedPaths(Trashpost $post): array` (list of relative paths the meme owns outright — image variants + unshared YouTube thumbnail). Task 6's purge logging consumes `ownedPaths`.
- Consumes: `MediaPath::imageSizes()`, `MediaPath::imageRelativePath()` (unchanged).

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/Unit/Services/MediaVisibilityServiceTest.php`:

```php
<?php

declare(strict_types=1);

namespace Tests\Unit\Services;

use App\Models\Trashpost;
use App\Services\MediaVisibilityService;
use App\Support\MediaPath;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Media must live on the disk that matches the meme's visibility: the public disk is
 * URL-addressable by anyone who ever saw the hash, so a hidden meme's files have to
 * physically leave it. sync() is idempotent — repeated transitions converge.
 */
final class MediaVisibilityServiceTest extends TestCase {
    use RefreshDatabase;

    private function service(): MediaVisibilityService {
        return new MediaVisibilityService();
    }

    private function seedVariants(string $code, string $ext): array {
        $paths = [];
        foreach (MediaPath::imageSizes() as $size) {
            $path = MediaPath::imageRelativePath($size, $code, $ext);
            Storage::disk('public')->put($path, "bytes-{$size}");
            $paths[] = $path;
        }

        return $paths;
    }

    public function test_sync_moves_a_hidden_memes_variants_off_the_public_disk(): void {
        Storage::fake('public');
        Storage::fake('local');
        $post = Trashpost::factory()->create([
            'activated_at' => now(), 'file' => 'abc.jpg', 'type' => 'image',
        ]);
        $paths = $this->seedVariants('abc', 'jpg');
        $post->delete();

        $this->service()->sync($post);

        foreach ($paths as $path) {
            Storage::disk('public')->assertMissing($path);
            Storage::disk('local')->assertExists($path);
        }
        $this->assertSame('bytes-original', Storage::disk('local')->get($paths[0]));
    }

    public function test_sync_moves_a_visible_memes_variants_back_to_the_public_disk(): void {
        Storage::fake('public');
        Storage::fake('local');
        $post = Trashpost::factory()->create([
            'activated_at' => now(), 'file' => 'abc.jpg', 'type' => 'image',
        ]);
        $path = MediaPath::imageRelativePath('original', 'abc', 'jpg');
        Storage::disk('local')->put($path, 'bytes');

        $this->service()->sync($post);

        Storage::disk('local')->assertMissing($path);
        Storage::disk('public')->assertExists($path);
    }

    public function test_sync_is_idempotent_when_files_are_already_in_place(): void {
        Storage::fake('public');
        Storage::fake('local');
        $post = Trashpost::factory()->create([
            'activated_at' => now(), 'file' => 'abc.jpg', 'type' => 'image',
        ]);
        $path = MediaPath::imageRelativePath('original', 'abc', 'jpg');
        Storage::disk('public')->put($path, 'bytes');

        $this->service()->sync($post);
        $this->service()->sync($post);

        Storage::disk('public')->assertExists($path);
        $this->assertSame('bytes', Storage::disk('public')->get($path));
    }

    public function test_a_thumbnail_shared_with_another_meme_is_not_moved(): void {
        Storage::fake('public');
        Storage::fake('local');
        $thumb = MediaPath::youtubeThumbnailRelativePath('dQw4w9WgXcQ');
        Storage::disk('public')->put($thumb, 'still');
        $hidden = Trashpost::factory()->deleted()->create([
            'type' => 'youtube', 'youtube' => 'dQw4w9WgXcQ', 'youtube_thumbnail' => $thumb,
        ]);
        Trashpost::factory()->create([
            'activated_at' => now(), 'type' => 'youtube',
            'youtube' => 'dQw4w9WgXcQ', 'youtube_thumbnail' => $thumb,
        ]);

        $this->service()->sync($hidden);

        // Yanking the shared still would break the other, live meme's thumbnail.
        Storage::disk('public')->assertExists($thumb);
    }

    public function test_owned_paths_lists_every_variant_and_the_unshared_thumbnail(): void {
        Storage::fake('public');
        Storage::fake('local');
        $thumb = MediaPath::youtubeThumbnailRelativePath('dQw4w9WgXcQ');
        $post = Trashpost::factory()->create([
            'file' => 'abc.jpg', 'youtube_thumbnail' => $thumb,
        ]);

        $paths = $this->service()->ownedPaths($post);

        $this->assertCount(count(MediaPath::imageSizes()) + 1, $paths);
        $this->assertContains(MediaPath::imageRelativePath('100', 'abc', 'jpg'), $paths);
        $this->assertContains($thumb, $paths);
    }
}
```

Append to `backend/tests/Unit/Services/ModerationServiceTest.php` (add `use App\Support\MediaPath;` if a duplicate — it is already imported):

```php
    public function test_delete_moves_the_memes_media_off_the_public_disk(): void {
        Storage::fake('public');
        Storage::fake('local');
        $post = Trashpost::factory()->create([
            'activated_at' => now(), 'file' => 'abc.jpg', 'type' => 'image',
        ]);
        $path = MediaPath::imageRelativePath('original', 'abc', 'jpg');
        Storage::disk('public')->put($path, 'bytes');

        $this->service()->delete($post->hash);

        Storage::disk('public')->assertMissing($path);
        Storage::disk('local')->assertExists($path);
    }

    public function test_restore_moves_the_memes_media_back_to_the_public_disk(): void {
        Storage::fake('public');
        Storage::fake('local');
        $post = Trashpost::factory()->deleted()->create([
            'activated_at' => now(), 'file' => 'abc.jpg', 'type' => 'image',
        ]);
        $path = MediaPath::imageRelativePath('original', 'abc', 'jpg');
        Storage::disk('local')->put($path, 'bytes');

        $this->service()->restore($post->hash);

        Storage::disk('local')->assertMissing($path);
        Storage::disk('public')->assertExists($path);
    }

    public function test_deactivate_hides_media_and_activate_re_exposes_it(): void {
        Storage::fake('public');
        Storage::fake('local');
        $post = Trashpost::factory()->create([
            'activated_at' => now(), 'file' => 'abc.jpg', 'type' => 'image',
        ]);
        $path = MediaPath::imageRelativePath('original', 'abc', 'jpg');
        Storage::disk('public')->put($path, 'bytes');

        $this->service()->deactivate($post->hash);
        Storage::disk('public')->assertMissing($path);
        Storage::disk('local')->assertExists($path);

        $this->service()->activate($post->hash);
        Storage::disk('public')->assertExists($path);
        Storage::disk('local')->assertMissing($path);
    }

    public function test_purge_removes_files_from_both_disks(): void {
        Storage::fake('public');
        Storage::fake('local');
        $post = Trashpost::factory()->deleted()->create([
            'file' => 'abc.jpg', 'type' => 'image',
        ]);
        // A soft-deleted meme's files live on the private disk by now.
        $path = MediaPath::imageRelativePath('original', 'abc', 'jpg');
        Storage::disk('local')->put($path, 'bytes');

        $this->service()->purge($post->hash);

        Storage::disk('local')->assertMissing($path);
        Storage::disk('public')->assertMissing($path);
        $this->assertDatabaseMissing('trashposts', ['hash' => $post->hash]);
    }
```

NOTE: the existing purge tests in this file already cover public-disk deletion and the shared-thumbnail guard; leave them in place. If any of them call the (about to be removed) private helpers via reflection, update them to call `MediaVisibilityService::ownedPaths` instead.

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker compose exec backend php artisan test --filter='MediaVisibilityServiceTest|ModerationServiceTest'`
Expected: FAIL — `Class "App\Services\MediaVisibilityService" not found` and the new ModerationService assertions failing (files still on public disk).

- [ ] **Step 3: Create `MediaVisibilityService`**

Create `backend/app/Services/MediaVisibilityService.php`:

```php
<?php

declare(strict_types=1);

namespace App\Services;

use App\Models\Trashpost;
use App\Support\MediaPath;
use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Support\Facades\Storage;

/**
 * Keeps a meme's files on the disk that matches its visibility. The public disk is
 * URL-addressable by anyone who ever saw the hash, so a moderated (soft-deleted or
 * deactivated) meme's media must physically leave it — hiding the JSON while still
 * serving the bytes would let saved permalinks bypass moderation (review 2026-07-10).
 * Files move to the private `local` disk under the same relative path, so restoring
 * is the mirror move.
 */
class MediaVisibilityService {
    /**
     * Move this meme's files to whichever disk matches its current visibility
     * (public ⇔ activated and not trashed). Idempotent: moves skip paths missing
     * from the source disk, so repeated transitions converge.
     */
    public function sync(Trashpost $post): void {
        if ($post->activated_at !== null && !$post->trashed()) {
            $this->moveAll($post, $this->disk('local'), $this->disk('public'));
        } else {
            $this->moveAll($post, $this->disk('public'), $this->disk('local'));
        }
    }

    /**
     * Every file the meme owns outright: all image size variants of its stored
     * file, plus its YouTube thumbnail only when no other post (trashed included)
     * shares it — thumbnails are stored once per video id, and yanking a shared
     * one would break the sharing posts' rendering.
     *
     * @return list<string>
     */
    public function ownedPaths(Trashpost $post): array {
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

    private function moveAll(Trashpost $post, FilesystemAdapter $from, FilesystemAdapter $to): void {
        foreach ($this->ownedPaths($post) as $path) {
            $this->move($from, $to, $path);
        }
    }

    /**
     * Cross-disk move, streamed so a full-size original never has to fit in
     * memory. Missing sources are skipped (already moved, or never written) —
     * that is what makes sync() idempotent.
     */
    private function move(FilesystemAdapter $from, FilesystemAdapter $to, string $path): void {
        if (!$from->exists($path)) {
            return;
        }
        $stream = $from->readStream($path);
        if ($stream === null) {
            return;
        }
        $to->put($path, $stream);
        if (is_resource($stream)) {
            fclose($stream);
        }
        $from->delete($path);
    }

    private function thumbnailShared(Trashpost $post): bool {
        return Trashpost::withTrashed()
            ->where('youtube_thumbnail', $post->youtube_thumbnail)
            ->whereKeyNot($post->id)
            ->exists();
    }

    private function disk(string $name): FilesystemAdapter {
        /** @var FilesystemAdapter $disk */
        $disk = Storage::disk($name);

        return $disk;
    }
}
```

- [ ] **Step 4: Wire it into `ModerationService`**

In `backend/app/Services/ModerationService.php`:

1. Add the constructor (below the `PER_PAGE` constant), matching the `TrashpostService` default-instance pattern:

```php
    public function __construct(private readonly MediaVisibilityService $media = new MediaVisibilityService()) {
    }
```

2. Append `$this->media->sync($post);` immediately before each `return $post;` in `activate()`, `deactivate()`, `delete()`, and `restore()` (outside the `if` guards — sync is idempotent and also self-heals a previously missed move).

3. Replace `purge()` and delete the now-moved private helpers `purgeablePaths()` and `thumbnailShared()`:

```php
    /**
     * Hard-delete a meme: remove the DB row for good, then its media files from BOTH
     * disks — a soft-deleted meme's files live on the private disk by the time purge
     * runs. The file list is computed before the row goes away; the row is removed
     * FIRST so a failed file cleanup can only leave invisible orphan files — never a
     * live row pointing at deleted media. Storage::delete() tolerates missing files.
     */
    public function purge(string $hash): void {
        $post = $this->find($hash);
        $paths = $this->media->ownedPaths($post);
        $post->forceDelete();
        Storage::disk('public')->delete($paths);
        Storage::disk('local')->delete($paths);
    }
```

4. Update the class docblock's last sentence to mention that soft-delete/deactivate also remove media from public reach. Drop the `use App\Support\MediaPath;` import if nothing in the file still references it.

- [ ] **Step 5: Run tests to verify they pass**

Run: `docker compose exec backend php artisan test --filter='MediaVisibilityServiceTest|ModerationServiceTest|ModerationControllerTest'`
Expected: PASS. If an existing `ModerationControllerTest` purge case seeded files only on `public` for a soft-deleted post, it still passes (delete on a missing path is a no-op).

- [ ] **Step 6: Record the guarantee in the 010 spec**

In `specs/010-admin-meme-moderation/spec.md`, find the FR describing soft delete (search for `soft delete`) and append one sentence to it:

> Soft-deleting or deactivating a meme also removes its media files from public reach (they move to private storage and return on restore/activation); purge removes them permanently.

- [ ] **Step 7: Lint and commit**

```bash
docker compose exec backend ./vendor/bin/pint --test
git add backend/app/Services/MediaVisibilityService.php backend/app/Services/ModerationService.php backend/tests/Unit/Services/ specs/010-admin-meme-moderation/spec.md
git commit -m "fix(review): move hidden memes' media off the public disk"
```

---

### Task 3: `UserResource` exposes `hash`, not the DB `id`

The one place the "no DB ids reach clients" rule is broken. `users.hash` already exists (minted at registration by `UserService`).

**Files:**
- Modify: `backend/app/Http/Resources/UserResource.php`, `frontend/src/lib/authApi.ts`
- Test: `backend/tests/Unit/Http/Resources/UserResourceTest.php`, frontend test fixtures (located by grep below)

**Interfaces:**
- Produces: API user payload key `hash` (string, 10 chars) replacing `id`; frontend `AuthUser.hash: string` replacing `AuthUser.id: number`.

- [ ] **Step 1: Verify the factory mints a hash**

Run: `grep -n "hash" backend/database/factories/UserFactory.php`
Expected: a `'hash' => ...` line in `definition()` (feature tests already create users, and the column is NOT NULL + unique, so it must be there). If absent, add `'hash' => Str::createUniqueHash(),` with `use App\Utils\Str;`.

- [ ] **Step 2: Update the backend test to the new contract**

In `backend/tests/Unit/Http/Resources/UserResourceTest.php` replace the key-order assertion and the id assertion:

```php
        $this->assertSame(
            ['hash', 'name', 'email', 'email_verified_at', 'role', 'created_at', 'updated_at'],
            array_keys($data),
        );
        $this->assertSame($user->hash, $data['hash']);
```

Add to the second test (never-exposes test):

```php
        $this->assertArrayNotHasKey('id', $data);
```

- [ ] **Step 3: Run to verify it fails**

Run: `docker compose exec backend php artisan test --filter=UserResourceTest`
Expected: FAIL (payload still has `id`).

- [ ] **Step 4: Change the resource**

In `backend/app/Http/Resources/UserResource.php` replace the `'id'` line:

```php
            'hash' => $this->hash,
```

Also extend the docblock's first paragraph with: `The DB id never reaches clients — the account's public handle is its 10-char hash (Principle V).`

- [ ] **Step 5: Backend green**

Run: `docker compose exec backend php artisan test --filter='UserResourceTest|AuthControllerTest|EmailVerificationControllerTest'`
Expected: PASS. If a controller test asserted an `id` key in the user envelope, update it to `hash`.

- [ ] **Step 6: Update the frontend type + mapping**

In `frontend/src/lib/authApi.ts`:

- `AuthUser`: replace `id: number;` with `hash: string;` (the 10-char public account handle).
- `RawUser`: replace `id: number;` with `hash: string;`.
- `AuthApi.mapUser`: replace `id: raw.id,` with `hash: raw.hash,`.

- [ ] **Step 7: Fix frontend fixtures and consumers**

Run: `grep -rn "id: *[0-9]" frontend/tests frontend/src | grep -iv "hash"` and `grep -rn "\.id\b" frontend/src frontend/tests`
Expected: hits only in test fixtures building `RawUser`/`AuthUser` objects (no `src/` component reads `.id`). In each fixture, replace `id: <number>` with `hash: 'usr0000001'` (any 10-char `[A-Za-z0-9_-]` literal).

- [ ] **Step 8: Frontend green, commit**

Run: `docker compose exec frontend npx vitest run` — expected PASS.

```bash
git add backend/app/Http/Resources/UserResource.php backend/tests/ frontend/src/lib/authApi.ts frontend/tests/
git commit -m "fix(review): expose the account hash instead of the DB id"
```

---

## Phase 2 — Backend hardening

### Task 4: Fetch YouTube thumbnails at upload time, never inside the admin index GET

`AdminTrashpostResource` currently calls `YoutubeThumbnailService::ensure` per row — up to 100 sequential 5-second downloads plus DB writes inside a GET. Move the fetch to upload time (the video id is known then; one post per request), and make the resource a pure reader.

**Files:**
- Modify: `backend/app/Services/TrashpostService.php`, `backend/app/Services/YoutubeThumbnailService.php`, `backend/app/Http/Resources/AdminTrashpostResource.php`
- Test: `backend/tests/Unit/Services/TrashpostServiceTest.php`, `backend/tests/Unit/Services/YoutubeThumbnailServiceTest.php`, plus whichever admin resource/controller test currently exercises the lazy fetch (find with `grep -rln "YoutubeThumbnail\|Http::fake" backend/tests/Feature backend/tests/Unit/Http`)

**Interfaces:**
- Consumes: `YoutubeThumbnailService::ensure(Trashpost $post): ?string` (unchanged signature).
- Produces: `TrashpostService::createPost` now also populates `youtube_thumbnail` for YouTube posts (best-effort); `AdminTrashpostResource` does zero remote IO.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/Unit/Services/TrashpostServiceTest.php` (imports needed: `Illuminate\Support\Facades\Http`, `Illuminate\Support\Facades\Storage`, `App\Models\User`):

```php
    public function test_creating_a_youtube_post_fetches_its_thumbnail_up_front(): void {
        Storage::fake('public');
        Http::fake(['img.youtube.com/*' => Http::response('still-bytes', 200)]);
        $user = User::factory()->create();

        $post = (new TrashpostService())->createPost($user, 'A video', null, 'dQw4w9WgXcQ');

        // Upload time is when the one-time download happens — the admin index must
        // never stack remote fetches inside a GET (review 2026-07-10).
        $this->assertNotNull($post->youtube_thumbnail);
        Storage::disk('public')->assertExists($post->youtube_thumbnail);
    }

    public function test_a_failed_thumbnail_fetch_does_not_fail_the_upload(): void {
        Storage::fake('public');
        Http::fake(['img.youtube.com/*' => Http::response('', 404)]);
        $user = User::factory()->create();

        $post = (new TrashpostService())->createPost($user, 'A video', null, 'dQw4w9WgXcQ');

        $this->assertNull($post->youtube_thumbnail);
        $this->assertTrue($post->exists);
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `docker compose exec backend php artisan test --filter=TrashpostServiceTest`
Expected: FAIL — `youtube_thumbnail` is null (nothing fetches at upload time yet).

- [ ] **Step 3: Wire the fetch into `TrashpostService`**

In `backend/app/Services/TrashpostService.php`:

1. Constructor gains the service (add `use App\Services\YoutubeThumbnailService;` — same namespace, so no import needed):

```php
    public function __construct(
        private readonly TrashpostImageProcessor $images = new TrashpostImageProcessor(),
        private readonly YoutubeThumbnailService $thumbnails = new YoutubeThumbnailService(),
    ) {
    }
```

2. In `createPost()`, after the `if ($image !== null)` block:

```php
        if ($youtubeId !== null) {
            // Fetch the still while the video id is fresh — one post, one request —
            // instead of lazily inside the admin index GET, where a page of 100 new
            // YouTube rows would stack 100 sequential 5s downloads. Best-effort:
            // ensure() reports-and-returns-null on failure, never failing the upload.
            $this->thumbnails->ensure($post);
        }
```

- [ ] **Step 4: Harden `YoutubeThumbnailService`**

In `backend/app/Services/YoutubeThumbnailService.php`:

1. Add `use Illuminate\Filesystem\FilesystemAdapter;`.
2. In `ensure()`, replace the early return:

```php
        if ($post->youtube_thumbnail !== null) {
            // A hidden meme's thumbnail has moved off the public disk: report no URL
            // rather than a URL that 404s (the admin UI shows its placeholder).
            return $disk->exists($post->youtube_thumbnail) ? $disk->url($post->youtube_thumbnail) : null;
        }
```

3. Type the parameter: `private function fetchAndStore(Trashpost $post, string $id, FilesystemAdapter $disk): ?string {`.
4. Replace the silent catch:

```php
        catch (Throwable $e) {
            // Best-effort by design, but never silent: a persistent storage or network
            // misconfiguration must surface in the log, not as an eternal placeholder.
            report($e);

            return null;
        }
```

5. Update the class docblock: the fetch now happens at upload time (TrashpostService); this service stays callable from anywhere but the admin index no longer triggers it.

- [ ] **Step 5: Make `AdminTrashpostResource` a pure reader**

In `backend/app/Http/Resources/AdminTrashpostResource.php`: remove `use App\Services\YoutubeThumbnailService;` and replace `thumbnailUrl()`'s youtube branch:

```php
    private function thumbnailUrl(): ?string {
        if ($this->type === 'youtube') {
            return $this->youtubeThumbnailUrl();
        }

        return $this->imageThumbnailUrl();
    }

    /**
     * The stored still's public URL, or null (→ UI placeholder). Fetching happens at
     * upload time (TrashpostService); the index does zero remote IO — a page of 100
     * fresh YouTube rows must not stack downloads inside a GET (review 2026-07-10).
     */
    private function youtubeThumbnailUrl(): ?string {
        if ($this->youtube_thumbnail === null) {
            return null;
        }

        /** @var \Illuminate\Filesystem\FilesystemAdapter $disk */
        $disk = Storage::disk('public');

        return $disk->exists($this->youtube_thumbnail) ? $disk->url($this->youtube_thumbnail) : null;
    }
```

- [ ] **Step 6: Update tests that assumed lazy fetching**

Run: `grep -rln "Http::fake" backend/tests` and inspect hits touching the admin index/resource. Any test asserting that *rendering the admin index* downloads a thumbnail must flip: the index now returns `null` thumbnail for a row without a stored still, and never calls `Http`. Keep `YoutubeThumbnailServiceTest` — it tests `ensure()` directly and still passes; add one case there if missing:

```php
    public function test_a_stored_thumbnail_missing_from_the_public_disk_yields_null(): void {
        Storage::fake('public');
        $post = Trashpost::factory()->create([
            'type' => 'youtube', 'youtube' => 'dQw4w9WgXcQ',
            'youtube_thumbnail' => 'image/trash/youtube/d/dQw4w9WgXcQ.jpg',
        ]);

        $this->assertNull((new YoutubeThumbnailService())->ensure($post));
    }
```

- [ ] **Step 7: Run, lint, commit**

Run: `docker compose exec backend php artisan test` — expected: full suite PASS.

```bash
docker compose exec backend ./vendor/bin/pint --test
git add backend/app backend/tests
git commit -m "fix(review): fetch YouTube thumbnails at upload, not in the admin GET"
```

---

### Task 5: Document accepted tradeoffs + production env guidance

Two review items are resolved by *documenting decisions*: registration's email-enumeration tradeoff, and `.env.example`'s missing production hardening notes.

**Files:**
- Modify: `backend/app/Http/Requests/RegisterRequest.php`, `backend/.env.example`

- [ ] **Step 1: Record the enumeration tradeoff where it lives**

In `backend/app/Http/Requests/RegisterRequest.php`, extend the `rules()` docblock with:

```php
     * `unique:users,email` means a 422 confirms an account's existence — an accepted,
     * deliberate tradeoff (unlike login's generic 401): registration cannot proceed
     * against a taken address anyway, and the 5/min/IP throttle blunts bulk probing.
     * The enumeration-free alternative (accept the submission and email "you already
     * have an account") needs mail-product buy-in; revisit alongside password reset.
```

- [ ] **Step 2: Production guidance in `.env.example`**

In `backend/.env.example`:

1. Replace lines 1–5 (the APP block) with:

```
APP_NAME=Online-Trash
APP_ENV=local
APP_KEY=
# PRODUCTION MUST set APP_ENV=production and APP_DEBUG=false -- debug mode leaks
# stack traces, env values and queries to visitors -- plus a real APP_URL and
# LOG_LEVEL=warning (or higher). Dev values below.
APP_DEBUG=true
APP_URL=http://localhost:8000
```

2. In the SESSION block (after `SESSION_DOMAIN=null`) add:

```
# PRODUCTION MUST serve over HTTPS and set SESSION_SECURE_COOKIE=true so the
# session cookie is never sent over plain HTTP.
# SESSION_SECURE_COOKIE=true
```

- [ ] **Step 3: Sanity-check the dev stack still boots with the template**

Run: `docker compose exec backend php artisan config:clear` then `curl -s http://localhost:8000/api/health`
Expected: the health probe answers 200. (The template only gained comments and a truthful dev APP_URL; `public` disk URLs derive from APP_URL — the old `online-trash.com` value was wrong for dev anyway.)

NOTE: your real `backend/.env` is untouched; if its `APP_URL` still says `online-trash.com`, fix it there too (not committed).

- [ ] **Step 4: Commit**

```bash
git add backend/app/Http/Requests/RegisterRequest.php backend/.env.example
git commit -m "docs(review): production env hardening notes + enumeration tradeoff"
```

---

### Task 6: Backend cleanup (fillable, welcome page, updated_at, purge logging, index, seed config)

Six small findings, one commit.

**Files:**
- Modify: `backend/app/Models/Trashpost.php`, `backend/app/Services/TrashpostService.php`, `backend/app/Services/ModerationService.php`, `backend/routes/web.php`, `backend/app/Http/Resources/TrashpostResource.php`, `backend/app/Console/Commands/SeedMediaCommand.php`
- Create: `backend/config/media.php`, `backend/database/migrations/<timestamp>_add_youtube_thumbnail_index_to_trashposts.php`
- Test: existing suites (behavior-preserving), `backend/tests/Unit/Http/Resources/TrashpostResourceTest.php`

- [ ] **Step 1: Explicit assignment in `TrashpostService::reserve`, then shrink `$fillable`**

In `backend/app/Services/TrashpostService.php`, replace the `new Trashpost([...])` block in `reserve()`:

```php
            // Identity and ownership are assigned explicitly, never mass-assigned —
            // $fillable stays limited to content fields so no future controller can
            // smuggle a hash/user_id through fill() (mass-assignment guard).
            $post = new Trashpost();
            $post->hash = $this->mintHash();
            $post->title = $title;
            $post->user_id = $user->id;
            $post->username = $user->name;
            $post->type = $youtubeId === null ? null : 'youtube';
            $post->youtube = $youtubeId;
```

In `backend/app/Models/Trashpost.php`, shrink `$fillable` to exactly what `fill()` still receives (`TrashpostImageProcessor::process` returns `file`/`type`/`metadata`) plus plain content fields:

```php
    protected $fillable = [
        'title',
        'file',
        'type',
        'metadata',
        'comment',
    ];
```

Run: `docker compose exec backend php artisan test` — expected PASS (factories bypass `$fillable` via `forceCreate`-style state, but verify; if `TrashpostFactory` relies on mass assignment for `hash`/`user_id`, factories call `fill` internally *unguarded*, so they are unaffected).

- [ ] **Step 2: Kill the stock welcome page**

Replace the route body in `backend/routes/web.php`:

```php
Route::get('/', static function () {
    // The API origin has no web UI; the stock welcome view would advertise
    // framework and PHP versions to anyone probing the root.
    abort(404);
});
```

- [ ] **Step 3: Drop `updated_at` from the public feed payload**

In `backend/app/Http/Resources/TrashpostResource.php`: delete the `'updated_at' => $this->updated_at,` line and add `updated_at` to the docblock's "Deliberately omitted" list (it reveals internal edit/moderation timing for no client benefit). Update `TrashpostResourceTest` key expectations accordingly. The frontend never reads it (`grep -rn "updated_at" frontend/src/lib/feedModel.ts frontend/src/lib/postModel.ts` → no hits).

- [ ] **Step 4: Log purge leftovers**

In `backend/app/Services/ModerationService.php` (as left by Task 2), add `use Illuminate\Support\Facades\Log;` and replace the two delete lines in `purge()` with `$this->deleteEverywhere($paths);`, adding:

```php
    /**
     * Best-effort file cleanup after the row is gone. A failure cannot resurrect the
     * post, but an orphaned PUBLIC file stays fetchable, so every leftover is logged
     * loudly enough to be found and swept by hand.
     *
     * @param list<string> $paths
     */
    private function deleteEverywhere(array $paths): void {
        foreach (['public', 'local'] as $diskName) {
            $disk = Storage::disk($diskName);
            $disk->delete($paths);
            foreach ($paths as $path) {
                if ($disk->exists($path)) {
                    Log::warning('moderation.purge: could not delete file', ['disk' => $diskName, 'path' => $path]);
                }
            }
        }
    }
```

- [ ] **Step 5: Index the shared-thumbnail lookup**

Run: `docker compose exec backend php artisan make:migration add_youtube_thumbnail_index_to_trashposts --table=trashposts`, then fill in:

```php
    public function up(): void {
        Schema::table('trashposts', function (Blueprint $table) {
            // thumbnailShared() runs a where(youtube_thumbnail) on every YouTube
            // purge/visibility sync; unindexed it is a full-table scan.
            $table->index('youtube_thumbnail');
        });
    }

    public function down(): void {
        Schema::table('trashposts', function (Blueprint $table) {
            $table->dropIndex(['youtube_thumbnail']);
        });
    }
```

(Ensure the file has `declare(strict_types=1);` per convention.) Run `docker compose exec backend php artisan migrate` against dev.

- [ ] **Step 6: Route the seed source through config**

Create `backend/config/media.php`:

```php
<?php

declare(strict_types=1);

// Runtime env() returns null once `config:cache` is active; anything read outside
// the config/ tree must flow through a config key to survive caching.
return [
    'seed_source' => env('MEDIA_SEED_SOURCE'),
];
```

In `backend/app/Console/Commands/SeedMediaCommand.php` line ~48, replace `env('MEDIA_SEED_SOURCE')` with `config('media.seed_source')` (and update the docblock above it: `--source → media.seed_source config (MEDIA_SEED_SOURCE env) → default`).

- [ ] **Step 7: Full backend suite, lint, commit**

Run: `docker compose exec backend php artisan test` and `docker compose exec backend ./vendor/bin/pint --test`
Expected: PASS. Fix any resource-test key lists that still expect `updated_at`.

```bash
git add backend/
git commit -m "fix(review): backend cleanup (fillable, welcome 404, updated_at, purge log, index, seed config)"
```

---

## Phase 3 — Frontend

### Task 7: Delete `publicCode.ts` and fix off-contract hash fixtures

`lib/publicCode.ts` validates an 11-char `[A-Z0-9-]` code — the wrong contract (Principle V says 10-char `[A-Za-z0-9_-]`, minted by `Str::createUniqueHash`). Dead code, referenced only by its own test, which actively asserts valid hashes are invalid. Delete both. Also fix the 11-char `'missing0000'` fixtures.

**Files:**
- Delete: `frontend/src/lib/publicCode.ts`, `frontend/tests/lib/publicCode.test.ts`
- Modify: `frontend/tests/hooks/useModeration.test.tsx:128`, `frontend/tests/hooks/usePost.test.tsx:37`, `frontend/tests/lib/moderationApi.test.ts:116,198`

- [ ] **Step 1: Confirm it is dead**

Run: `grep -rn "PublicCode\|publicCode" frontend/src frontend/tests --include="*.ts*" | grep -v "publicCode.test\|src/lib/publicCode"`
Expected: no hits. (If there are, stop and list them — the delete is then wrong.)

- [ ] **Step 2: Delete and fix fixtures**

```bash
git rm frontend/src/lib/publicCode.ts frontend/tests/lib/publicCode.test.ts
```

In the three test files, replace every `'missing0000'` (11 chars) with `'missing000'` (10 chars — the real contract).

- [ ] **Step 3: Verify, commit**

Run: `docker compose exec frontend npx vitest run` — expected PASS, and the coverage gate no longer counts the dead module.

```bash
git add frontend/tests
git commit -m "fix(review): drop the wrong-contract publicCode module and 11-char fixtures"
```

---

### Task 8: Real CSRF priming (`Csrf.ensure`) on every unsafe request

`AuthApi.csrf()` (the Sanctum priming step) is never called; mutations only work because the boot-time `GET /api/user` happens to set the XSRF cookie as a side effect. Make priming explicit and shared.

**Files:**
- Modify: `frontend/src/lib/csrf.ts`, `frontend/src/lib/authApi.ts`, `frontend/src/lib/moderationApi.ts`, `frontend/src/lib/uploadApi.ts`
- Test: `frontend/tests/lib/csrf.test.ts` (extend or create), existing `authApi`/`moderationApi`/`uploadApi` tests

**Interfaces:**
- Produces: `Csrf.ensure(): Promise<string>` — returns the cookie token, priming `/sanctum/csrf-cookie` first when absent. All three API clients consume it; `AuthApi.csrf()` is removed.

- [ ] **Step 1: Write the failing test**

In `frontend/tests/lib/csrf.test.ts` (create if missing; mirror the fetch-mocking style of `tests/lib/authApi.test.ts`):

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Csrf } from '../../src/lib/csrf';

describe('Csrf.ensure', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = 'XSRF-TOKEN=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });

  it('returns the existing token without a network call', async () => {
    document.cookie = 'XSRF-TOKEN=already-set';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await Csrf.ensure()).toBe('already-set');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('primes the sanctum cookie endpoint when no token exists', async () => {
    const fetchMock = vi.fn().mockImplementation(() => {
      document.cookie = 'XSRF-TOKEN=fresh-token';
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    expect(await Csrf.ensure()).toBe('fresh-token');
    expect(String(fetchMock.mock.calls[0][0])).toContain('/sanctum/csrf-cookie');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'include' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `docker compose exec frontend npx vitest run tests/lib/csrf.test.ts`
Expected: FAIL — `Csrf.ensure is not a function`.

- [ ] **Step 3: Implement `Csrf.ensure`**

Replace `frontend/src/lib/csrf.ts`:

```ts
import { Api } from './api';

// Reads Laravel's URL-encoded XSRF-TOKEN cookie so Sanctum's CSRF guard accepts unsafe
// requests. Shared by every authenticated client (auth + upload + moderation) so the
// read lives once. Guarded so the non-DOM test environment is safe.
export class Csrf {
  static token(): string {
    const cookies = typeof document !== 'undefined' ? document.cookie : '';
    const match = cookies.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  }

  // The Sanctum SPA priming step: when no XSRF cookie exists yet (first unsafe request
  // of a fresh session, or a boot where GET /api/user failed), ask /sanctum/csrf-cookie
  // to set it, then re-read. Callers get a usable token without depending on the boot
  // probe having set one as a side effect (review 2026-07-10).
  static async ensure(): Promise<string> {
    const existing = Csrf.token();
    if (existing !== '') {
      return existing;
    }
    await fetch(`${Api.base()}/sanctum/csrf-cookie`, { credentials: 'include' });
    return Csrf.token();
  }
}
```

(`api.ts` does not import `csrf.ts`, so no cycle.)

- [ ] **Step 4: Use it in all three clients**

- `frontend/src/lib/authApi.ts`: delete the now-redundant `static async csrf()` method; in `postJson`, change the header to `'X-XSRF-TOKEN': await Csrf.ensure(),` and make the method `private static async postJson(...)` returning `fetch(...)`'s awaited value (add `await` before `fetch` or keep returning the promise — simplest is `const token = await Csrf.ensure();` before the `return fetch(...)`).
- `frontend/src/lib/moderationApi.ts`: in `act()` and `purge()`, hoist `const token = await Csrf.ensure();` above the `fetch` and use `'X-XSRF-TOKEN': token`.
- `frontend/src/lib/uploadApi.ts`: in `send()`, replace `'X-XSRF-TOKEN': Csrf.token(),` with `'X-XSRF-TOKEN': await Csrf.ensure(),`.

- [ ] **Step 5: Keep existing client tests deterministic**

The three clients' tests mock `fetch`; without a cookie, `ensure()` now inserts a priming call that would shift `mock.calls` indexes. In each affected test file's `beforeEach`, set the cookie so `ensure()` short-circuits:

```ts
    document.cookie = 'XSRF-TOKEN=test-token';
```

(and clear it in `afterEach` as in Step 1). Update any assertion expecting the token value accordingly.

- [ ] **Step 6: Run, commit**

Run: `docker compose exec frontend npx vitest run` — expected PASS.

```bash
git add frontend/src/lib frontend/tests
git commit -m "fix(review): explicit Sanctum CSRF priming before unsafe requests"
```

---

### Task 9: Moderation console: failure is an error with Retry, never "No entries"

Any failed fetch currently renders "No entries to moderate." — in a destructive admin tool that misinforms. Surface a distinct failed state with retry, like the public feed's `ErrorState`.

**Files:**
- Modify: `frontend/src/hooks/useModeration.ts`, `frontend/src/pages/ModerationPage.tsx`
- Test: `frontend/tests/hooks/useModeration.test.tsx`, `frontend/tests/pages/ModerationPage.test.tsx` (or wherever the page's tests live — find with `grep -rln "ModerationPage" frontend/tests`)

**Interfaces:**
- Produces: `useModeration()` additionally returns `failed: boolean` and `retry(): void`.

- [ ] **Step 1: Write the failing tests**

In `frontend/tests/hooks/useModeration.test.tsx`, add (mirroring the file's existing mocking of `ModerationApi.fetchPage`):

```tsx
  it('reports a failed fetch as failed, not empty', async () => {
    fetchPageMock.mockResolvedValue({ ok: false });

    const { result } = renderHook(() => useModeration(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.failed).toBe(true);
    expect(result.current.empty).toBe(false);
  });

  it('retry refetches the current page', async () => {
    fetchPageMock.mockResolvedValueOnce({ ok: false });
    fetchPageMock.mockResolvedValueOnce({ ok: true, data: [], meta: someMeta });

    const { result } = renderHook(() => useModeration(), { wrapper });
    await waitFor(() => expect(result.current.failed).toBe(true));

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.failed).toBe(false));
    expect(fetchPageMock).toHaveBeenCalledTimes(2);
  });
```

(`fetchPageMock`, `wrapper`, `someMeta` = whatever names the existing file already uses for the mocked API, the router wrapper, and a meta fixture — reuse them.)

- [ ] **Step 2: Run to verify they fail**

Run: `docker compose exec frontend npx vitest run tests/hooks/useModeration.test.tsx`
Expected: FAIL — `failed`/`retry` undefined.

- [ ] **Step 3: Implement in the hook**

In `frontend/src/hooks/useModeration.ts`:

1. Extend the settled shape and add a retry counter:

```ts
type Loaded = { page: number; rows: ModerationRow[]; meta: ModerationMeta | null; failed: boolean };
```

2. Add `const [attempt, setAttempt] = useState(0);` next to `loaded`; make the effect depend on `[page, attempt]` and record failure:

```ts
      setLoaded({
        page,
        rows: result.ok ? result.data : [],
        meta: result.ok ? result.meta : null,
        failed: !result.ok,
      });
```

3. Add retry + derive the flags (replace the current tail of the hook):

```ts
  // Forget the failed result and bump the effect's retry key so the same page is
  // fetched again; `loading` flips true because `loaded` is null meanwhile.
  function retry(): void {
    setLoaded(null);
    setAttempt(attempt + 1);
  }

  const loading = loaded === null || loaded.page !== page;
  const failed = !loading && loaded !== null && loaded.failed;
  const rows = loading || failed ? [] : loaded.rows;
  const meta = loading || failed ? null : loaded.meta;
  const empty = !loading && !failed && rows.length === 0;
  return { rows, meta, loading, empty, failed, retry, applyRow, removeRow };
```

4. Rewrite the hook's header comment: a failed fetch now settles into an explicit `failed` state with retry; it is no longer conflated with the empty corpus.

- [ ] **Step 4: Render it on the page**

In `frontend/src/pages/ModerationPage.tsx`: import `ErrorState from '../components/states/ErrorState';`, destructure `failed, retry`, and add between the loading and empty lines:

```tsx
      {failed && <ErrorState onRetry={retry} />}
```

Also change `{empty && ...}` guard—already excludes failed via the hook. Update the page's header comment (failure ≠ empty). Add a page-level test: mock a failed fetch, assert the Retry button renders and "No entries to moderate." does not.

- [ ] **Step 5: Run, commit**

Run: `docker compose exec frontend npx vitest run` — expected PASS.

```bash
git add frontend/src frontend/tests
git commit -m "fix(review): moderation console shows an error+retry, never failure-as-empty"
```

---

### Task 10: Moderation row: client-built permalink + real link (a11y)

Drop the server-supplied `url` field (client builds `/posts/{hash}` everywhere else) and replace the `role="link"` row — which illegally nests buttons — with a real `<Link>` on the title cell.

**Files:**
- Modify: `backend/app/Http/Resources/AdminTrashpostResource.php`, `frontend/src/lib/moderationModel.ts`, `frontend/src/components/moderation/ModerationRow.tsx`, the moderation stylesheet (find with `grep -rln "moderation-title" frontend/src/styles`)
- Test: backend admin resource/controller tests, `frontend/tests/components/moderation/ModerationRow.test.tsx` (or equivalent), `frontend/tests/lib/moderationModel.test.ts`

- [ ] **Step 1: Backend — drop the `url` field**

In `AdminTrashpostResource::toArray`, delete the `'url' => "/posts/{$this->hash}",` line. Fix any backend test asserting that key. Run: `docker compose exec backend php artisan test --filter='AdminTrashpost|ModerationController'` — expected PASS after test updates.

- [ ] **Step 2: Frontend model — drop `url`**

In `frontend/src/lib/moderationModel.ts`: remove `url: string;` from both `RawModerationRow` and `ModerationRow`, and `url: raw.url,` from `mapRow`. Fix fixtures in the moderation test files (grep `url:` in `frontend/tests/lib/moderationModel.test.ts`, `moderationApi.test.ts`, component tests).

- [ ] **Step 3: Rework the row**

Replace `ModerationRow.tsx`'s row + title cell (the `TimeCell` stays):

```tsx
import { Link } from 'react-router-dom';

import { ModerationModel } from '../../lib/moderationModel';
import type { ModerationRow as Row } from '../../lib/moderationModel';
import ModerationActions from './ModerationActions';
import ModerationThumbnail from './ModerationThumbnail';

// Shown in the user column when a meme has no resolvable uploader name at all.
const NO_UPLOADER = '—';

// ... TimeCell unchanged ...

// The title cell doubles as the row's navigation: a real <Link> (FR-018), so screen
// readers get one honest link per row instead of buttons nested inside a row-wide
// role="link" (invalid ARIA nesting — review 2026-07-10). The permalink is built
// client-side from the hash, like every other permalink in the SPA; untitled posts
// fall back to the hash so the link always has text.
function TitleCell({ row }: { row: Row }) {
  const short = ModerationModel.shortTitle(row.title);
  return (
    <td className="moderation-title" title={row.title ?? undefined}>
      <Link className="moderation-title__link" to={`/posts/${row.hash}`}>
        {short ?? row.hash}
      </Link>
    </td>
  );
}

// One moderation-table row. Navigation lives on the title link; the actions cell's
// buttons are ordinary siblings, so acting never navigates. `onApply` refreshes this
// row in place after an action; `onRemove` drops it after a purge.
function ModerationRow({ row, onApply, onRemove }: {
  row: Row;
  onApply: (updated: Row) => void;
  onRemove: (hash: string) => void;
}) {
  const uploader = row.username ?? NO_UPLOADER;
  const alt = row.username !== null ? `Meme by ${row.username}` : 'Meme thumbnail';

  return (
    <tr className="moderation-row">
      <td><ModerationThumbnail src={row.thumbnail} alt={alt} /></td>
      <TitleCell row={row} />
      <td>{uploader}</td>
      <TimeCell value={row.createdAt} />
      <TimeCell value={row.activatedAt} />
      <TimeCell value={row.deletedAt} />
      <td className="moderation-row__actions">
        <ModerationActions row={row} onApply={onApply} onRemove={onRemove} />
      </td>
    </tr>
  );
}
```

(`useNavigate`, `KeyboardEvent`, `open`, `handleKey`, `role="link"`, `tabIndex`, `aria-label` all go away. The `stopPropagation` calls inside `ModerationActions` become harmless no-ops — leave them or remove them; if removed, also update the comments that reference them.)

Add to the moderation stylesheet, next to the existing `.moderation-title` rule:

```css
.moderation-title__link {
  color: inherit;
  text-decoration: underline;
}
```

- [ ] **Step 4: Update tests**

Row tests asserting `role="link"` on the `<tr>` now assert a real link: `screen.getByRole('link', { name: <title or hash> })` with `href="/posts/<hash>"`, and keyboard navigation asserts the anchor is focusable. e2e: `grep -rn "role=.link.\|moderation" frontend/e2e/moderation.spec.ts` and update selectors that clicked the row to click the title link.

- [ ] **Step 5: Run everything, commit**

Run: `docker compose exec frontend npx vitest run` and `docker compose exec backend php artisan test --filter='AdminTrashpost|ModerationController'`
Expected: PASS. (Playwright e2e runs in the final verification task.)

```bash
git add backend frontend
git commit -m "fix(review): moderation row uses a real client-built title link"
```

---

### Task 11: Function-length refactors (<50 lines)

`RegisterPage` (~130), `LoginPage` (~107), `VerifyEmailPage` (~79), `DeletionControl` (~62), `useFeed` (~61), `useModeration` (~59) breach the binding 50-line budget. Behavior-preserving refactors; existing tests are the safety net and must keep passing unchanged (except imports if any).

**Files:**
- Create: `frontend/src/hooks/useAuthForm.ts`
- Modify: `frontend/src/pages/RegisterPage.tsx`, `frontend/src/pages/LoginPage.tsx`, `frontend/src/pages/VerifyEmailPage.tsx`, `frontend/src/components/moderation/ModerationActions.tsx`, `frontend/src/hooks/useFeed.ts`, `frontend/src/hooks/useModeration.ts`, `frontend/src/lib/moderationModel.ts`
- Test: existing page/hook tests (unchanged assertions); new `frontend/tests/hooks/useAuthForm.test.ts`

**Interfaces:**
- Produces: `useAuthForm<T extends Record<string, string>>(initial: T, validate: (values: T, touched?: Set<string>) => FieldErrors)` returning `{ values, errors, hasErrors, submitting, setSubmitting, setServerErrors, handleChange, handleBlur, startSubmit }`; `ModerationModel.replaceRow(rows, updated)` and `ModerationModel.dropRow(rows, hash)`.

- [ ] **Step 1: Extract the shared auth-form state hook (write its test first)**

Create `frontend/tests/hooks/useAuthForm.test.ts`:

```ts
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useAuthForm } from '../../src/hooks/useAuthForm';
import type { FieldErrors } from '../../src/lib/authApi';

function validate(values: { email: string }, touched?: Set<string>): FieldErrors {
  const check = touched === undefined || touched.has('email');
  return check && values.email === '' ? { email: ['Required.'] } : {};
}

describe('useAuthForm', () => {
  it('validates touched fields on blur and clears a server error on change', () => {
    const { result } = renderHook(() => useAuthForm({ email: '' }, validate));

    act(() => result.current.handleBlur('email'));
    expect(result.current.errors.email).toEqual(['Required.']);

    act(() => result.current.setServerErrors({ email: ['Taken.'] }));
    act(() => result.current.handleChange('email', 'a@b.c'));
    expect(result.current.errors.email).toBeUndefined();
  });

  it('startSubmit touches everything and reports validity', () => {
    const { result } = renderHook(() => useAuthForm({ email: '' }, validate));

    let valid = true;
    act(() => { valid = result.current.startSubmit(); });
    expect(valid).toBe(false);
    expect(result.current.hasErrors).toBe(true);

    act(() => result.current.handleChange('email', 'a@b.c'));
    act(() => { valid = result.current.startSubmit(); });
    expect(valid).toBe(true);
  });
});
```

Run: `docker compose exec frontend npx vitest run tests/hooks/useAuthForm.test.ts` — expected FAIL (module missing). Then create `frontend/src/hooks/useAuthForm.ts`:

```ts
import { useState } from 'react';

import type { FieldErrors } from '../lib/authApi';
import { AuthModel } from '../lib/authModel';

// Shared client/server error bookkeeping for the auth forms (login/register): values,
// blur-driven client validation, 422 server errors, and the submit-time sweep. Client
// and server errors are tracked apart so revalidating one field on blur never wipes a
// server-reported error on another (server wins, but only the touched-aware client
// pass may replace clientErrors). Extracted so each page stays inside the 50-line
// function budget (Principle II).
export function useAuthForm<T extends Record<string, string>>(
  initial: T,
  validate: (values: T, touched?: Set<string>) => FieldErrors,
) {
  const [values, setValues] = useState<T>(initial);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  function handleChange(field: keyof T & string, value: string): void {
    setValues({ ...values, [field]: value });
    // A field's server verdict no longer applies once its value changes.
    setServerErrors(AuthModel.clearFieldError(serverErrors, field));
  }

  function handleBlur(field: string): void {
    const nextTouched = new Set(touched).add(field);
    setTouched(nextTouched);
    setClientErrors(validate(values, nextTouched));
  }

  // The submit-time sweep: touch every field, validate all of them, and report
  // whether the submit may proceed.
  function startSubmit(): boolean {
    setTouched(new Set(Object.keys(initial)));
    const validationErrors = validate(values);
    setClientErrors(validationErrors);
    return Object.keys(validationErrors).length === 0;
  }

  const errors = AuthModel.mergeServerErrors(clientErrors, serverErrors);
  // Gates on client errors only: a lingering server error must not soft-lock the
  // submit button once the user has corrected the field client-side validates.
  const hasErrors = Object.keys(clientErrors).length > 0;

  return { values, errors, hasErrors, submitting, setSubmitting, setServerErrors, handleChange, handleBlur, startSubmit };
}
```

Run the new test — expected PASS.

- [ ] **Step 2: Rewrite `RegisterPage` on top of it**

Replace `frontend/src/pages/RegisterPage.tsx`:

```tsx
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import AuthField from '../components/AuthField';
import BusyButton from '../components/BusyButton';
import { useAuth } from '../hooks/useAuth';
import { useAuthForm } from '../hooks/useAuthForm';
import { useNotice } from '../hooks/useNotice';
import { AuthModel } from '../lib/authModel';

type RegisterValues = { name: string; email: string; password: string; passwordConfirmation: string };

type RegisterForm = ReturnType<typeof useAuthForm<RegisterValues>>;

// The field roster drives rendering, so adding a field is one row here — and keeps the
// components inside the 50-line budget (Principle II).
const FIELDS = [
  { id: 'name', name: 'name', label: 'Display name', type: 'text', autoComplete: 'name' },
  { id: 'email', name: 'email', label: 'E-mail', type: 'email', autoComplete: 'email' },
  { id: 'password', name: 'password', label: 'Password', type: 'password', autoComplete: 'new-password' },
  { id: 'password-confirmation', name: 'passwordConfirmation', label: 'Re-type password', type: 'password', autoComplete: 'new-password' },
] as const;

function RegisterFields({ form }: { form: RegisterForm }) {
  return (
    <>
      {FIELDS.map((field) => (
        <AuthField
          key={field.id}
          id={field.id}
          label={field.label}
          type={field.type}
          value={form.values[field.name]}
          autoComplete={field.autoComplete}
          error={form.errors[field.name]?.join('\n')}
          onChange={(value: string) => form.handleChange(field.name, value)}
          onBlur={() => form.handleBlur(field.name)}
        />
      ))}
    </>
  );
}

// Registration form, prototype-style: fields validate on blur, the submit button is
// gated while client errors exist, and the fieldset is disabled during the request.
// The server stays authoritative (422 field errors merge in, server wins). Success
// raises the app-level welcome dialog — it must outlive this page, because the
// auth-state flip makes RequireAnon redirect immediately. Passwords are never
// repopulated (FR-018).
function RegisterPage() {
  const { register } = useAuth();
  const { show } = useNotice();
  const navigate = useNavigate();
  const form = useAuthForm<RegisterValues>(
    { name: '', email: '', password: '', passwordConfirmation: '' },
    AuthModel.validateRegister,
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!form.startSubmit()) {
      return;
    }
    form.setSubmitting(true);
    const result = await register(form.values);
    form.setSubmitting(false);
    if (result.ok) {
      // FR-007: steer the fresh registrant to the verification notice — the
      // account works, but the email must be confirmed to prove address control.
      show({ message: `Welcome, ${result.user.name}! Check your inbox to verify your e-mail.` });
      navigate('/verify-email');
      return;
    }
    if (result.kind === 'validation') {
      form.setServerErrors(result.errors);
      return;
    }
    show({ message: 'Failed to sign up. Please try again.' });
  }

  return (
    <section className="auth">
      <h1>Sign up</h1>
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <fieldset disabled={form.submitting}>
          <RegisterFields form={form} />
          <BusyButton type="submit" busy={form.submitting} disabled={form.hasErrors}>Register</BusyButton>
        </fieldset>
        <p className="auth-form__link"><Link to="/login">Already have an account? Login here....</Link></p>
      </form>
    </section>
  );
}

export default RegisterPage;
```

NOTE: `AuthModel.validateRegister` must accept `(values: RegisterValues, touched?: Set<string>)` — it already does (same call shape as before). The inline `onChange`/`onBlur` arrows are React-idiomatic prop wiring, which the conventions exempt from the classes-over-closures rule (logic stays in the hook/model).

Run: `docker compose exec frontend npx vitest run tests/pages` (or the register/login test paths) — expected PASS unchanged.

- [ ] **Step 3: Rewrite `LoginPage` the same way**

Same pattern: `type LoginValues = { email: string; password: string };`, a two-entry `FIELDS` roster (`email`/`current-password` autocompletes), `LoginFields({ form })`, and `LoginPage` keeping its extra `formError` state:

```tsx
  const [formError, setFormError] = useState('');
  // in handleSubmit, before startSubmit():
  setFormError('');
  // result handling keeps:
  if (result.kind === 'auth') {
    setFormError('Email or password is incorrect.');
    return;
  }
  // and the redirect-back logic stays verbatim:
  const from = (location.state as { from?: Location } | null)?.from;
  navigate(from ?? '/');
```

Preserve the `role="alert"` form error paragraph and all copy exactly. Run the login page tests — expected PASS unchanged.

- [ ] **Step 4: Split `VerifyEmailPage`**

In `frontend/src/pages/VerifyEmailPage.tsx`, move the status-text map and the outcome links out of the page function:

```tsx
function statusTextFor(view: VerifyViewState, failureMessage: string): string {
  return {
    verifying: 'Verifying your e-mail…',
    confirmed: 'Your e-mail is verified.',
    already: 'Your e-mail was already verified.',
    failed: failureMessage,
  }[view];
}

// The post-outcome affordances: account link on success; on failure, resend for a
// signed-in user (FR-004) or a login pointer for a signed-out one (the API refuses
// anonymous resends).
function VerifyOutcome({ view, status, resending, onResend }: {
  view: VerifyViewState;
  status: string;
  resending: boolean;
  onResend: () => void;
}) {
  if (view === 'confirmed' || view === 'already') {
    return <p><Link to="/account">Go to your account</Link></p>;
  }
  if (view !== 'failed') {
    return null;
  }
  if (status === 'authenticated') {
    return (
      <BusyButton className="verify__resend" busy={resending} onClick={onResend}>
        Resend verification e-mail
      </BusyButton>
    );
  }
  return <p><Link to="/login">Log in to request a new verification e-mail</Link></p>;
}
```

The page function keeps its state + effect and renders `<VerifyOutcome view={view} status={status} resending={resending} onResend={() => void handleResend()} />`. All copy and the `role="status"` paragraph stay identical; the effect body is unchanged. Run the page's tests — expected PASS unchanged.

- [ ] **Step 5: Split `DeletionControl`**

In `ModerationActions.tsx`, extract the deleted-branch JSX:

```tsx
// The two controls a soft-deleted meme offers: single-click restore, and a trash
// button whose confirm offers only permanent deletion (soft delete is moot).
function DeletedRowControls({ onRestore, onAskPurge }: {
  onRestore: (event: MouseEvent<HTMLButtonElement>) => void;
  onAskPurge: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <>
      <button type="button" className="moderation-actions__button" onClick={onRestore} aria-label="Restore" title="Restore">
        <ActionIcon glyph="restore" />
      </button>
      <button
        type="button"
        className="moderation-actions__button"
        onClick={onAskPurge}
        aria-label="Delete permanently"
        title="Delete permanently"
      >
        <ActionIcon glyph="delete" />
      </button>
    </>
  );
}
```

`DeletionControl` then ends with:

```tsx
  if (deleted) {
    return <DeletedRowControls onRestore={restore} onAskPurge={askPurge} />;
  }

  return (
    <button type="button" className="moderation-actions__button" onClick={askDelete} aria-label="Delete" title="Delete">
      <ActionIcon glyph="delete" />
    </button>
  );
```

Run the moderation component tests — expected PASS unchanged.

- [ ] **Step 6: Split `useFeed` and slim `useModeration`**

`useFeed.ts`: move the snapshot-persist effect into a sibling hook in the same file (above `useFeed`):

```ts
// Persist the loaded feed on every settled change, preserving the scroll anchor that
// useScrollRestoration writes separately. Its own hook keeps useFeed inside the
// 50-line budget (Principle II).
function usePersistSnapshot(state: FeedState, cacheKey: string, cursor: () => string | undefined): void {
  useEffect(() => {
    if (state.status === 'idle' || state.status === 'loading' || state.status === 'error') {
      return;
    }
    const previous = FeedCache.readSnapshot(sessionStorage, cacheKey);
    FeedCache.writeSnapshot(sessionStorage, cacheKey, {
      posts: state.posts,
      cursor: cursor(),
      status: state.status,
      anchorHash: previous?.anchorHash ?? null,
      anchorOffset: previous?.anchorOffset ?? 0,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.posts, state.status, cacheKey]);
}
```

and call it from `useFeed` as `usePersistSnapshot(state, cacheKey, readCursor);` where `function readCursor(): string | undefined { return cursorRef.current; }` is declared inside `useFeed` (a named function, not an inline closure).

`moderationModel.ts` gains two pure statics (with unit tests in `tests/lib/moderationModel.test.ts` — write them first, red then green):

```ts
  // Replace one row in place after a moderation action (FR-017); a no-op when the
  // row is not on the page.
  static replaceRow(rows: ModerationRow[], updated: ModerationRow): ModerationRow[] {
    return rows.map((row) => (row.hash === updated.hash ? updated : row));
  }

  // Drop a purged row (the server returned 204 — it no longer exists).
  static dropRow(rows: ModerationRow[], hash: string): ModerationRow[] {
    return rows.filter((row) => row.hash !== hash);
  }
```

`useModeration.ts`'s `applyRow`/`removeRow` bodies then shrink to one-line updates:

```ts
  function applyRow(updated: ModerationRow): void {
    setLoaded((current) => current === null ? current : { ...current, rows: ModerationModel.replaceRow(current.rows, updated) });
  }

  function removeRow(hash: string): void {
    setLoaded((current) => current === null ? current : { ...current, rows: ModerationModel.dropRow(current.rows, hash) });
  }
```

- [ ] **Step 7: Verify lengths, run everything, commit**

Spot-check no function body exceeds its budget (count lines between a function's opening and closing brace). Run: `docker compose exec frontend npx vitest run` and `docker compose exec frontend npm run lint` — expected PASS.

```bash
git add frontend/src frontend/tests
git commit -m "refactor(review): bring oversized functions under the 50-line budget"
```

---

### Task 12: ESLint enforces semicolons; config file follows its own rules

The binding "always use semicolons" rule is hand-reviewed today; `eslint.config.js` itself omits them.

**Files:**
- Modify: `frontend/eslint.config.js`

- [ ] **Step 1: Rewrite the config**

```js
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores(['dist', 'coverage']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // docs/CODING_CONVENTIONS.md: statements always end in semicolons. The core
      // rule is frozen-but-functional in ESLint 9 and costs no new dependency
      // (@stylistic would need a Principle I approval).
      semi: ['error', 'always'],
    },
  },
]);
```

- [ ] **Step 2: Verify and commit**

Run: `docker compose exec frontend npm run lint`
Expected: clean (the codebase already uses semicolons). Fix any stragglers it finds.

```bash
git add frontend/eslint.config.js
git commit -m "chore(review): lint-enforce the semicolon convention"
```

---

### Task 13: Frontend small fixes (iframe sandbox, dialog keys, e2e under tests/)

**Files:**
- Modify: `frontend/src/components/MemeMedia.tsx`, `frontend/src/components/ConfirmDialog.tsx`, `frontend/playwright.config.ts`
- Move: `frontend/e2e/` → `frontend/tests/e2e/`

- [ ] **Step 1: Sandbox the YouTube iframe**

In `MemeMedia.tsx`, add to the `<iframe ...>` attributes:

```tsx
          // Belt-and-braces: the src is always a rebuilt nocookie embed URL, but the
          // sandbox caps what any embedded document could ever do (Principle VI).
          sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
```

(place the comment above the `<iframe>`, JSX attributes can't carry `//` comments inline — put it on the line above the element).

- [ ] **Step 2: Stable dialog keys**

In `ConfirmDialog.tsx`, the actions list is static per dialog, so the index is a stable key while captions may repeat:

```tsx
        {actions.map((action, index) => (
          <ActionButton key={index} action={action} onChoose={onChoose} />
        ))}
```

- [ ] **Step 3: Move e2e under `tests/` (Constitution Principle VII)**

```bash
git mv frontend/e2e frontend/tests/e2e
```

In `frontend/playwright.config.ts`: `testDir: './tests/e2e',` and update the header comment's last sentence to: `Vitest unit specs use the *.test.* suffix, Playwright the *.spec.* suffix, so sharing tests/ is collision-free.` Vitest's include (`tests/**/*.test.{ts,tsx}`) does not match `*.spec.ts`, so no exclude is needed. Check CI for hardcoded paths: `grep -n "e2e" .github/workflows/ci.yml` — the Playwright invocation is directory-relative (`npx playwright test`), so only update if a literal `e2e/` path appears.

- [ ] **Step 4: Verify, commit**

Run: `docker compose exec frontend npx vitest run` and `docker compose exec frontend npm run lint` — expected PASS (unit tests unaffected; Playwright config change is exercised in the final verification task).

```bash
git add frontend
git commit -m "chore(review): iframe sandbox, stable dialog keys, e2e under tests/"
```

---

## Phase 4 — Infra

### Task 14: Bind published dev/e2e ports to loopback

Dev MySQL (root/root, real data) currently listens on 0.0.0.0 — reachable by anyone on the LAN. All dev/e2e services run debug-friendly configs; none needs LAN exposure.

**Files:**
- Modify: `docker-compose.yml`, `docker-compose.e2e.yml`

- [ ] **Step 1: Edit the port mappings**

`docker-compose.yml` (add a why-comment on the mysql one):

```yaml
    ports:
      # Loopback-only: this is a root/root dev DB holding the real media library --
      # published on 0.0.0.0 it is open to anyone on the same network.
      - "127.0.0.1:${MYSQL_HOST_PORT:-4444}:3306" # host port (default 4444) -> container 3306
```

Backend: `- "127.0.0.1:8000:8000"`. Frontend: `- "127.0.0.1:5173:5173"`.
`docker-compose.e2e.yml`: `- "127.0.0.1:8001:8000"` and `- "127.0.0.1:5174:5173"`.

- [ ] **Step 2: Verify the stack still works**

```bash
docker compose up -d
curl -s http://localhost:8000/api/health
```
Expected: 200 health JSON; the SPA loads on http://localhost:5173. (Everything in scripts/CI addresses `localhost`, so nothing else changes.)

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml docker-compose.e2e.yml
git commit -m "fix(review): publish dev/e2e ports on loopback only"
```

---

### Task 15: Remove stray junk dirs; gitignore `.superpowers/`

Two empty artifact dirs from mangled shell commands sit at the repo root; one has an embedded colon that will break checkouts if ever tracked. `.superpowers/` is only self-ignored via its own inner `.gitignore`.

**Files:**
- Delete: `backend;C/`, `C:projectsladybug.superpowerssdd/` (repo root)
- Modify: `.gitignore`

- [ ] **Step 1: Confirm they are empty and untracked, then delete (use Git Bash — the colon-named dir defeats Windows path parsing)**

```bash
ls -la 'backend;C' 'C:projectsladybug.superpowerssdd' && git ls-files 'backend;C' 'C:projectsladybug.superpowerssdd'
rm -rf 'backend;C' 'C:projectsladybug.superpowerssdd'
```

Expected: both listings empty, `git ls-files` prints nothing, deletion succeeds. **If either contains files, STOP and report instead of deleting.**

- [ ] **Step 2: Ignore `.superpowers/` at the root**

Append to `.gitignore`:

```
# Agent workflow artifacts (review diffs, progress notes)
.superpowers/
```

- [ ] **Step 3: Verify, commit**

Run: `git status` — clean apart from `.gitignore`.

```bash
git add .gitignore
git commit -m "chore(review): drop stray junk dirs, gitignore .superpowers/"
```

---

### Task 16: Script secrets hygiene (healthcheck, MYSQL_PWD, crypto RNG)

**Files:**
- Modify: `docker-compose.e2e.yml`, `scripts/backup-db.ps1`, `scripts/e2e.ps1`

- [ ] **Step 1: e2e healthcheck without an inline password**

In `docker-compose.e2e.yml`, the `-h127.0.0.1` flag alone achieves the TCP-vs-socket goal (`ping` exits 0 even on Access denied). Replace the healthcheck test line and trim the comment's last clause:

```yaml
      # Ping over TCP (-h127.0.0.1), not the default socket: while the entrypoint
      # initializes the fresh tmpfs datadir it runs a temporary, socket-only server
      # that a socket ping declares "healthy" before MySQL actually listens on 3306.
      # No -p: ping succeeds even on Access denied, and an inline password would
      # leak into `docker inspect` (same rationale as the dev compose healthcheck).
      test: ["CMD", "mysqladmin", "ping", "-h127.0.0.1"]
```

- [ ] **Step 2: `MYSQL_PWD` instead of inline `-p` in the backup script**

In `scripts/backup-db.ps1` line ~105, change the dump command (password moves from the argv — visible to `ps` in the container — into the child's env):

```powershell
    $dump = 'docker compose exec -T mysql sh -c "MYSQL_PWD=\"$MYSQL_ROOT_PASSWORD\" mysqldump -uroot --single-transaction --no-tablespaces --databases \"$MYSQL_DATABASE\""'
```

Update the long comment above it: the `-p"$VAR"` sentence becomes `MYSQL_PWD moves the password out of the process argv (visible to ps) into the client's env.`

- [ ] **Step 3: CSPRNG for the e2e `APP_KEY`**

In `scripts/e2e.ps1` (~line 37), replace the `Get-Random` line:

```powershell
        # Cryptographic RNG: the key only guards a throwaway tmpfs stack, but the
        # Get-Random pattern must not exist where it could be copied somewhere real.
        $bytes = New-Object byte[] 32
        $rng = [System.Security.Cryptography.RNGCryptoServiceProvider]::new()
        $rng.GetBytes($bytes)
        $rng.Dispose()
        $key = 'base64:' + [Convert]::ToBase64String($bytes)
```

- [ ] **Step 4: Verify the backup script end-to-end**

Run: `powershell -File scripts\backup-db.ps1`
Expected: `backup-db: wrote ...ladybug-backups\trashdb_<timestamp>.sql (N bytes)` with N > 1024.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.e2e.yml scripts/backup-db.ps1 scripts/e2e.ps1
git commit -m "chore(review): script secrets hygiene (healthcheck, MYSQL_PWD, CSPRNG)"
```

---

### Task 17 (optional): Pin third-party GitHub Actions by SHA

Low urgency (workflow has `contents: read` and no secrets); do last or defer.

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Resolve each action tag to its commit SHA at execution time**

For each `uses:` in ci.yml (`actions/checkout@v6`, `actions/cache@v5`, `actions/setup-node@v6`, `actions/upload-artifact@v4`, `shivammathur/setup-php@v2`):

```bash
gh api repos/shivammathur/setup-php/git/ref/tags/v2 --jq '.object.sha'
# (dereference annotated tags if object.type == "tag": gh api repos/<owner>/<repo>/git/tags/<sha> --jq '.object.sha')
```

- [ ] **Step 2: Replace tags with SHAs, keeping the tag as a comment**

```yaml
        uses: shivammathur/setup-php@<resolved-sha> # v2
```

- [ ] **Step 3: Commit and confirm CI still passes after push**

```bash
git add .github/workflows/ci.yml
git commit -m "chore(review): pin CI actions by commit SHA"
```

---

## Final verification (run after the last task)

- [ ] Backend: `docker compose exec backend ./vendor/bin/pint --test` → clean; `docker compose exec backend php artisan test` → full PASS; coverage gate ≥90% (run the CI coverage command if in doubt).
- [ ] Frontend: `docker compose exec frontend npm run lint` → clean; `docker compose exec frontend npx vitest run --coverage` → PASS with lines ≥90%.
- [ ] E2E: `powershell -File scripts\e2e.ps1` → all Playwright specs pass against the isolated stack (exercises the moved `tests/e2e` dir, the CSRF priming, the moderation link rework, and the loopback e2e ports).
- [ ] Manual smoke: soft-delete a meme in the moderation table, then request one of its old image URLs (`/storage/image/trash/original/...`) → 404; restore it → 200 again.
- [ ] `git status` clean; all commits pushed if the standing push grant applies.

## Explicitly deferred (documented, not fixed)

- **Registration enumeration**: accepted tradeoff, documented in `RegisterRequest` (Task 5); the mail-based alternative is a product decision.
- **419-specific user messaging**: `Csrf.ensure` (Task 8) removes the main 419 cause; a distinct "session expired" message remains a nice-to-have.
- **Tooltip-only full titles/dates in the moderation table**: full values remain hover-only; the meme page is the canonical view. Revisit if touch-device admin use materializes.
- **Type-to-confirm friction on permanent delete of a live post**: current modal wording + strong styling stays; revisit before production launch.
