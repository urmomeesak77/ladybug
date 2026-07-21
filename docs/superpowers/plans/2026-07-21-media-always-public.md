# Media Always Public — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep every meme's media on the `public` disk in all states so admins see inactive, pending, and soft-deleted images, and republish already-hidden media that the old code moved to the private disk.

**Architecture:** Remove the move-media-to-match-visibility mechanism. `MediaVisibilityService` is renamed to `MediaOwnershipService` and narrowed to its one surviving job — enumerating a post's owned disk files (`ownedPaths`) — which `ModerationService::purge` still needs. All `sync()` calls are dropped. A one-time `media:republish` artisan command moves any owned file still sitting on the private `local` disk back to `public`. The public feed still filters hidden memes at the query level, so their JSON is never served regardless of where the bytes live.

**Tech Stack:** Laravel 12 / PHP 8.2+, PHPUnit, Storage fakes. Backend tests run through the `php:8.3-cli` Docker container (no local PHP).

## Global Constraints

- **No new dependencies** (Constitution Principle I) — this plan adds none.
- **PHP style:** PSR-12, 4-space indent, `declare(strict_types=1);`, braces on single-line bodies, functions < 30 lines, comments explain *why*. Every `lib`/service is a class of methods; call through the class.
- **Public identifier is the 10-char `hash`** — never expose DB ids.
- **Tests:** ≥90% line coverage, enforced in CI (Clover ≥90% gate). Tests mirror source paths under `tests/`.
- **Tests never touch the real DB or media tree:** sqlite `:memory:` only; `Storage::fake()` for every disk a test touches.
- **Run backend commands via Docker**, e.g.:
  `docker run --rm -v "${PWD}/backend:/app" -w /app php:8.3-cli vendor/bin/phpunit`
  (use the project's existing test-run wrapper if one is configured).

---

### Task 1: Narrow the media service to ownership-only; media never leaves the public disk

Rename `MediaVisibilityService` → `MediaOwnershipService`, strip its disk-moving code, drop every `sync()` call, and flip the tests that expected media to move off/back to the public disk so they assert media *stays* public across all transitions. This is one atomic refactor — the class rename breaks every reference at once, so it lands together.

**Files:**
- Rename: `backend/app/Services/MediaVisibilityService.php` → `backend/app/Services/MediaOwnershipService.php`
- Modify: `backend/app/Services/ModerationService.php` (lines 27-31 constructor; remove `sync()` at 70, 96, 122, 146; class doc 14-22)
- Modify: `backend/app/Services/TrashpostService.php` (constructor 25-31; remove pending `sync()` block 90-95; `createPost` doc 60-68)
- Rename+rewrite test: `backend/tests/Unit/Services/MediaVisibilityServiceTest.php` → `backend/tests/Unit/Services/MediaOwnershipServiceTest.php`
- Modify test: `backend/tests/Unit/Services/ModerationServiceTest.php` (import 9; setUp comment 55-59; tests at 303-358; constructor calls 427, 481)
- Modify test: `backend/tests/Feature/Http/Controllers/CreatePostTest.php` (tests at 152-187)
- Modify test: `backend/tests/Unit/Http/Resources/AdminTrashpostResourceTest.php` (test 145-154)
- Modify test: `backend/tests/Unit/Services/TrashpostServiceTest.php` (comment 227-228)
- Modify docs: `backend/README.md` (lines 36, 75), root `CLAUDE.md` (010/011 descriptions)

**Interfaces:**
- Produces: `App\Services\MediaOwnershipService` with the single public method
  `public function ownedPaths(App\Models\Trashpost $post): array` (list of relative paths — image size variants + unshared YouTube thumbnail). No `sync()`, `moveAll()`, `move()`, or `disk()`.
- Consumes: `App\Support\MediaPath::imageSizes()`, `MediaPath::imageRelativePath($size, $code, $ext)` (unchanged).

- [ ] **Step 1: Flip the ModerationService media tests to the always-public expectation (write the failing tests first)**

In `backend/tests/Unit/Services/ModerationServiceTest.php`:

Update the `setUp()` comment (lines 55-59) to:

```php
        // Media stays on the public disk in every state now, but tests still fake both
        // disks so no test can touch the real bind-mounted media tree, and so a stray
        // write to 'local' would be caught rather than hitting disk.
        Storage::fake('public');
        Storage::fake('local');
```

Replace `test_delete_moves_the_memes_media_off_the_public_disk` (303-314) with:

```php
    public function test_delete_keeps_the_memes_media_on_the_public_disk(): void {
        $post = Trashpost::factory()->create([
            'activated_at' => now(), 'file' => 'abc.jpg', 'type' => 'image',
        ]);
        $path = MediaPath::imageRelativePath('original', 'abc', 'jpg');
        Storage::disk('public')->put($path, 'bytes');

        $this->service()->delete($post->hash);

        // Media never leaves the public disk — an admin must still see a soft-deleted
        // meme's image (design 2026-07-21).
        Storage::disk('public')->assertExists($path);
        Storage::disk('local')->assertMissing($path);
    }
```

Replace `test_restore_moves_the_memes_media_back_to_the_public_disk` (316-327) with:

```php
    public function test_restore_keeps_the_memes_media_on_the_public_disk(): void {
        $post = Trashpost::factory()->deleted()->create([
            'activated_at' => now(), 'file' => 'abc.jpg', 'type' => 'image',
        ]);
        $path = MediaPath::imageRelativePath('original', 'abc', 'jpg');
        Storage::disk('public')->put($path, 'bytes');

        $this->service()->restore($post->hash);

        Storage::disk('public')->assertExists($path);
        Storage::disk('local')->assertMissing($path);
    }
```

Replace `test_deactivate_hides_media_and_activate_re_exposes_it` (329-343) with:

```php
    public function test_deactivate_and_activate_keep_media_on_the_public_disk(): void {
        $post = Trashpost::factory()->create([
            'activated_at' => now(), 'file' => 'abc.jpg', 'type' => 'image',
        ]);
        $path = MediaPath::imageRelativePath('original', 'abc', 'jpg');
        Storage::disk('public')->put($path, 'bytes');

        $this->service()->deactivate($post->hash);
        Storage::disk('public')->assertExists($path);
        Storage::disk('local')->assertMissing($path);

        $this->service()->activate($post->hash);
        Storage::disk('public')->assertExists($path);
        Storage::disk('local')->assertMissing($path);
    }
```

Replace `test_purge_removes_files_from_both_disks` (345-358) with (media now lives on public before purge; purge still sweeps it):

```php
    public function test_purge_removes_the_memes_files_from_disk(): void {
        $post = Trashpost::factory()->deleted()->create([
            'file' => 'abc.jpg', 'type' => 'image',
        ]);
        // Media lives on the public disk in every state now (design 2026-07-21).
        $path = MediaPath::imageRelativePath('original', 'abc', 'jpg');
        Storage::disk('public')->put($path, 'bytes');

        $this->service()->purge($post->hash);

        Storage::disk('public')->assertMissing($path);
        $this->assertDatabaseMissing('trashposts', ['hash' => $post->hash]);
    }
```

- [ ] **Step 2: Run the ModerationService tests to confirm the flipped ones fail**

Run: `docker run --rm -v "${PWD}/backend:/app" -w /app php:8.3-cli vendor/bin/phpunit --filter ModerationServiceTest`
Expected: FAIL — the three transition tests fail because current code moves media to `local` (`assertMissing($path)` on public, or `assertExists` on local, no longer holds).

- [ ] **Step 3: Create `MediaOwnershipService` and delete `MediaVisibilityService`**

Create `backend/app/Services/MediaOwnershipService.php` (keep only `ownedPaths` + `thumbnailShared`; drop `sync`, `moveAll`, `move`, `disk`):

```php
<?php

declare(strict_types=1);

namespace App\Services;

use App\Models\Trashpost;
use App\Support\MediaPath;

/**
 * Enumerates the disk files a meme owns outright. Media now lives on the public disk in
 * every state (design 2026-07-21, reversing the 2026-07-10 anti-bypass move), so this
 * class no longer moves anything — its one job is telling purge which files to delete.
 */
class MediaOwnershipService {
    /**
     * Every file the meme owns outright: all image size variants of its stored file, plus
     * its YouTube thumbnail only when no other post (trashed included) shares it —
     * thumbnails are stored once per video id, and yanking a shared one would break the
     * sharing posts' rendering.
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

    private function thumbnailShared(Trashpost $post): bool {
        return Trashpost::withTrashed()
            ->where('youtube_thumbnail', $post->youtube_thumbnail)
            ->whereKeyNot($post->id)
            ->exists();
    }
}
```

Then delete the old file: `git rm backend/app/Services/MediaVisibilityService.php`

- [ ] **Step 4: Drop the `sync()` calls from `ModerationService`**

In `backend/app/Services/ModerationService.php`:

Retype the constructor dependency (lines 27-31):

```php
    public function __construct(
        private readonly MediaOwnershipService $media = new MediaOwnershipService(),
        private readonly RatingService $rating = new RatingService(),
    ) {
    }
```

Remove the four `$this->media->sync($post);` lines — one each at the end of `activate` (line 70), `deactivate` (96), `delete` (122), `restore` (146) — so each method's `try/catch` is directly followed by its `return $post;`. Example for `activate`:

```php
        catch (Throwable $e) {
            DB::rollBack();
            throw $e;
        }

        return $post;
    }
```

Leave `purge` untouched — it still calls `$this->media->ownedPaths($post)` and `deleteEverywhere`.

Rewrite the class doc (14-22) to drop the disk-syncing language:

```php
/**
 * The back-office moderation query layer plus the four state transitions and purge. The
 * paged index hides nothing — soft-deleted and never-activated memes are included
 * (withTrashed, no activation filter) so an admin can see and act on the whole corpus.
 * Media stays on the public disk in every state (design 2026-07-21), so a transition only
 * changes row state and rating; purge (hard delete) additionally removes the row's media
 * files from disk for good.
 */
```

- [ ] **Step 5: Drop the pending `sync()` from `TrashpostService`**

In `backend/app/Services/TrashpostService.php`:

Remove `MediaVisibilityService` from the constructor (lines 25-31) so it reads:

```php
    public function __construct(
        private readonly TrashpostImageProcessor $images = new TrashpostImageProcessor(),
        private readonly YoutubeThumbnailService $thumbnails = new YoutubeThumbnailService(),
        private readonly RatingService $rating = new RatingService(),
    ) {
    }
```

In `createPost`, delete the pending-media comment block and `sync()` (lines 90-95) so the pending branch ends simply:

```php
        if ($autoActivate) {
            $this->activate($post);

            return $post;
        }

        // A pending meme's media stays on the public disk like everything else; it is
        // hidden from the public API by the activation filter, not by moving its bytes
        // (design 2026-07-21). A moderator can see it in the admin console.
        return $post;
    }
```

Remove the now-unused `use App\Services\...` import only if one exists for the media service (there is none — it was `new MediaVisibilityService()` inline via constructor default, now gone).

- [ ] **Step 6: Rename + trim the media service unit test**

Rename `backend/tests/Unit/Services/MediaVisibilityServiceTest.php` → `backend/tests/Unit/Services/MediaOwnershipServiceTest.php` and replace its entire contents with the `ownedPaths`-only test (all `sync` tests removed):

```php
<?php

declare(strict_types=1);

namespace Tests\Unit\Services;

use App\Models\Trashpost;
use App\Services\MediaOwnershipService;
use App\Support\MediaPath;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * ownedPaths lists exactly the disk files a meme owns — every image size variant, plus its
 * YouTube thumbnail only when no other (trashed included) post shares that still. Used by
 * purge to know what to delete.
 */
final class MediaOwnershipServiceTest extends TestCase {
    use RefreshDatabase;

    private function service(): MediaOwnershipService {
        return new MediaOwnershipService();
    }

    public function test_owned_paths_lists_every_variant_and_the_unshared_thumbnail(): void {
        Storage::fake('public');
        $thumb = MediaPath::youtubeThumbnailRelativePath('dQw4w9WgXcQ');
        $post = Trashpost::factory()->create([
            'file' => 'abc.jpg', 'youtube_thumbnail' => $thumb,
        ]);

        $paths = $this->service()->ownedPaths($post);

        $this->assertCount(count(MediaPath::imageSizes()) + 1, $paths);
        $this->assertContains(MediaPath::imageRelativePath('100', 'abc', 'jpg'), $paths);
        $this->assertContains($thumb, $paths);
    }

    public function test_owned_paths_omits_a_thumbnail_shared_with_another_post(): void {
        $thumb = MediaPath::youtubeThumbnailRelativePath('dQw4w9WgXcQ');
        $post = Trashpost::factory()->linkOnly()->create([
            'youtube' => 'dQw4w9WgXcQ', 'youtube_thumbnail' => $thumb,
        ]);
        Trashpost::factory()->linkOnly()->create([
            'youtube' => 'dQw4w9WgXcQ', 'youtube_thumbnail' => $thumb,
        ]);

        $paths = $this->service()->ownedPaths($post);

        $this->assertNotContains($thumb, $paths);
    }

    public function test_owned_paths_is_empty_for_a_post_with_no_media(): void {
        $post = Trashpost::factory()->linkOnly()->create([
            'file' => null, 'youtube_thumbnail' => null,
        ]);

        $this->assertSame([], $this->service()->ownedPaths($post));
    }
}
```

- [ ] **Step 7: Update the remaining test references to the renamed class**

In `backend/tests/Unit/Services/ModerationServiceTest.php`:
- Change the import (line 9) `use App\Services\MediaVisibilityService;` → `use App\Services\MediaOwnershipService;`
- Change both `new ModerationService(new MediaVisibilityService(), new ThrowingRatingService())` calls (lines 427, 481) → `new ModerationService(new MediaOwnershipService(), new ThrowingRatingService())`

In `backend/tests/Feature/Http/Controllers/CreatePostTest.php`, replace the two pending-media tests (152-187) so pending media is now asserted **present on the public disk**:

```php
    public function test_a_pending_uploads_image_variants_stay_on_the_public_disk(): void {
        // Media stays public in every state (design 2026-07-21) so a moderator can see the
        // pending image in the admin console; the public API still hides the row.
        $user = $this->memberAt(RatingService::TRUST_THRESHOLD - 1);

        $response = $this->actingAs($user)->postJson('/api/posts', [
            'image' => UploadedFile::fake()->image('m.jpg', 1000, 500),
        ]);

        $post = Trashpost::where('hash', $response->json('data.hash'))->firstOrFail();
        $this->assertNotNull($post->file);
        $code = pathinfo($post->file, PATHINFO_FILENAME);
        $ext = pathinfo($post->file, PATHINFO_EXTENSION);
        foreach (MediaPath::imageSizes() as $size) {
            $path = MediaPath::imageRelativePath($size, $code, $ext);
            Storage::disk('public')->assertExists($path);
        }
    }

    public function test_a_pending_youtube_uploads_thumbnail_stays_on_the_public_disk(): void {
        $user = $this->memberAt(RatingService::TRUST_THRESHOLD - 1);

        $response = $this->actingAs($user)->postJson('/api/posts', ['youtube' => 'dQw4w9WgXcQ']);

        $response->assertCreated();
        $post = Trashpost::where('hash', $response->json('data.hash'))->firstOrFail();
        $this->assertNotNull($post->youtube_thumbnail);
        Storage::disk('public')->assertExists($post->youtube_thumbnail);
    }
```

Leave `test_a_pending_upload_is_absent_from_the_public_views` (189+) unchanged — it proves the public API still hides pending memes, which is the security guarantee we are keeping.

In `backend/tests/Unit/Http/Resources/AdminTrashpostResourceTest.php`, rewrite the comment + name of the test at 145-154 (behavior is unchanged — a file missing from the public disk still yields a null thumbnail — only the rationale changes):

```php
    public function test_thumbnail_is_null_when_the_file_is_missing_from_the_public_disk(): void {
        // The resource never points at a file that is not on the public disk — a missing
        // still yields the UI placeholder, not a 404ing URL.
        Http::fake();
        $rel = MediaPath::youtubeThumbnailRelativePath('dQw4w9WgXcQ');
        $post = Trashpost::factory()->linkOnly()->create(['youtube' => 'dQw4w9WgXcQ', 'youtube_thumbnail' => $rel]);

        $this->assertNull($this->toArray($post)['thumbnail']);
        Http::assertNothingSent();
    }
```

In `backend/tests/Unit/Services/TrashpostServiceTest.php`, update the comment at 227-228:

```php
        // A trusted uploader keeps the post activated. Media stays on the public disk in
        // every state now, so the still is public whether the post is activated or pending.
```

- [ ] **Step 8: Run the full backend suite**

Run: `docker run --rm -v "${PWD}/backend:/app" -w /app php:8.3-cli vendor/bin/phpunit`
Expected: PASS — all tests green, including the flipped ModerationService/CreatePost tests and the trimmed ownership test.

- [ ] **Step 9: Lint**

Run: `docker run --rm -v "${PWD}/backend:/app" -w /app php:8.3-cli vendor/bin/pint --test`
Expected: PASS (no style violations; no stale imports).

- [ ] **Step 10: Update docs**

In `backend/README.md`: rename `MediaVisibilityService` → `MediaOwnershipService` in the services list (line 36) and rewrite the sentence at line 75 to state that media stays on the public disk in every state and hidden memes are filtered out by the API, not by moving bytes.

In root `CLAUDE.md`, update the **010** description (drop `MediaVisibilityService` "moves a non-public meme's bytes off the `public` disk" — replace with: media stays on the public disk in every state so admins can view hidden memes; the public API filters hidden memes at the query level) and the **011** description (drop "with its media hidden until a moderator activates it" → "created **pending** — hidden from the public API but visible with its image in the admin console").

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "refactor: media always public — admins see hidden memes

Rename MediaVisibilityService to MediaOwnershipService (ownedPaths only),
drop all sync() calls; inactive/pending/soft-deleted media stays on the
public disk so it renders in the admin console. Public API still hides
hidden memes at the query level.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `media:republish` one-time reconciliation command

Add an artisan command that moves any owned media file still sitting on the private `local` disk (left there by the old move-on-hide code) back to the `public` disk, so already-hidden memes render for admins too.

**Files:**
- Create: `backend/app/Console/Commands/MediaRepublishCommand.php`
- Create test: `backend/tests/Feature/Console/MediaRepublishCommandTest.php`
- Modify docs: root `CLAUDE.md` (mention the command in 010/011 context)

**Interfaces:**
- Consumes: `App\Services\MediaOwnershipService::ownedPaths(Trashpost): array` (from Task 1).
- Produces: artisan command signature `media:republish`; returns `self::SUCCESS` (0).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/Feature/Console/MediaRepublishCommandTest.php`:

```php
<?php

declare(strict_types=1);

namespace Tests\Feature\Console;

use App\Models\Trashpost;
use App\Support\MediaPath;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * media:republish moves any owned media file still on the private 'local' disk (left by
 * the old move-on-hide code) back to 'public', so already-hidden memes render for admins.
 * Idempotent: files already on 'public' are left alone, so re-running is a no-op.
 */
final class MediaRepublishCommandTest extends TestCase {
    use RefreshDatabase;

    protected function setUp(): void {
        parent::setUp();
        Storage::fake('public');
        Storage::fake('local');
    }

    public function test_it_moves_a_hidden_memes_files_from_local_to_public(): void {
        $post = Trashpost::factory()->deleted()->create(['file' => 'abc.jpg', 'type' => 'image']);
        $path = MediaPath::imageRelativePath('original', 'abc', 'jpg');
        Storage::disk('local')->put($path, 'bytes');

        $this->artisan('media:republish')->assertSuccessful();

        Storage::disk('public')->assertExists($path);
        Storage::disk('local')->assertMissing($path);
        $this->assertSame('bytes', Storage::disk('public')->get($path));
    }

    public function test_it_leaves_files_already_on_public_untouched(): void {
        $post = Trashpost::factory()->create(['activated_at' => now(), 'file' => 'abc.jpg', 'type' => 'image']);
        $path = MediaPath::imageRelativePath('original', 'abc', 'jpg');
        Storage::disk('public')->put($path, 'public-bytes');

        $this->artisan('media:republish')->assertSuccessful();
        // Re-running is a no-op.
        $this->artisan('media:republish')->assertSuccessful();

        Storage::disk('public')->assertExists($path);
        $this->assertSame('public-bytes', Storage::disk('public')->get($path));
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `docker run --rm -v "${PWD}/backend:/app" -w /app php:8.3-cli vendor/bin/phpunit --filter MediaRepublishCommandTest`
Expected: FAIL — `The command "media:republish" does not exist.`

- [ ] **Step 3: Write the command**

Create `backend/app/Console/Commands/MediaRepublishCommand.php`:

```php
<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Models\Trashpost;
use App\Services\MediaOwnershipService;
use Illuminate\Console\Command;
use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Support\Facades\Storage;

/**
 * One-time reconciliation: media now lives on the public disk in every state (design
 * 2026-07-21), but memes hidden under the old move-on-hide code have their bytes on the
 * private 'local' disk and will not render in the admin console until moved back. This
 * moves every owned file still on 'local' to 'public'. Idempotent — files missing from
 * 'local' (already public, or never written) are skipped — so it is safe to re-run.
 */
final class MediaRepublishCommand extends Command {
    protected $signature = 'media:republish';

    protected $description = 'Move any meme media still on the private disk back to the public disk';

    public function __construct(private readonly MediaOwnershipService $media = new MediaOwnershipService()) {
        parent::__construct();
    }

    public function handle(): int {
        $local = $this->disk('local');
        $public = $this->disk('public');
        $moved = 0;
        Trashpost::withTrashed()->each(function (Trashpost $post) use ($local, $public, &$moved): void {
            foreach ($this->media->ownedPaths($post) as $path) {
                if ($this->move($local, $public, $path)) {
                    $moved++;
                }
            }
        });
        $this->info("Republished {$moved} file(s) to the public disk.");

        return self::SUCCESS;
    }

    /**
     * Streamed local→public move so a full-size original never has to fit in memory. A
     * missing source (already public) is skipped; a failed target write keeps the source
     * so the file is never lost. Returns whether a byte actually moved.
     */
    private function move(FilesystemAdapter $from, FilesystemAdapter $to, string $path): bool {
        if (!$from->exists($path)) {
            return false;
        }
        $stream = $from->readStream($path);
        if ($stream === null) {
            return false;
        }
        $copied = $to->put($path, $stream);
        if (is_resource($stream)) {
            fclose($stream);
        }
        if ($copied === false) {
            return false;
        }
        $from->delete($path);

        return true;
    }

    private function disk(string $name): FilesystemAdapter {
        /** @var FilesystemAdapter $disk */
        $disk = Storage::disk($name);

        return $disk;
    }
}
```

> Note on the closure: the codebase prefers closure-free code, but `Builder::each()` requires a callback. If a closure-free chunked loop is preferred, replace `->each(...)` with `foreach (Trashpost::withTrashed()->cursor() as $post) { ... }` and inline the body — functionally equivalent. Either is acceptable; the `cursor()` form avoids the closure.

- [ ] **Step 4: Run the test to verify it passes**

Run: `docker run --rm -v "${PWD}/backend:/app" -w /app php:8.3-cli vendor/bin/phpunit --filter MediaRepublishCommandTest`
Expected: PASS (both tests).

- [ ] **Step 5: Lint**

Run: `docker run --rm -v "${PWD}/backend:/app" -w /app php:8.3-cli vendor/bin/pint --test`
Expected: PASS.

- [ ] **Step 6: Update docs**

In root `CLAUDE.md`, add a short note where 010/011 media behavior is described: a one-time `php artisan media:republish` moves already-hidden media from the private disk back to public.

- [ ] **Step 7: Full suite + coverage gate**

Run: `docker run --rm -v "${PWD}/backend:/app" -w /app php:8.3-cli vendor/bin/phpunit --coverage-clover coverage.xml`
Then the project's coverage gate: `python .github/scripts/check_coverage.py backend/coverage.xml` (≥90%).
Expected: PASS, ≥90% line coverage.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: media:republish command to move hidden media back to public

One-time reconciliation for memes whose bytes the old move-on-hide code
left on the private disk; moves them back to public so they render in the
admin console. Idempotent.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Design §1 (media never leaves public disk) → Task 1 Steps 3-5 (strip sync, drop calls). ✓
- Design §1 (rename to MediaOwnershipService) → Task 1 Step 3. ✓
- Design §1 (no AdminTrashpostResource change) → confirmed; only its test comment updated (Task 1 Step 7). ✓
- Design §2 (one-time `media:republish` reconciliation) → Task 2. ✓
- Design §3 (purge unchanged, both-disk delete kept) → Task 1 Step 4 leaves purge/deleteEverywhere untouched; test at Step 1 keeps purge coverage. ✓
- Design §4 (tests: rename ownership test, flip moderation asserts, pending upload public, republish test, docs) → Task 1 Steps 1,6,7,10 + Task 2. ✓
- Design: public API still hides hidden memes → `test_a_pending_upload_is_absent_from_the_public_views` kept unchanged (Task 1 Step 7); `TrashpostService::visible()` untouched. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; every command shows expected output. ✓

**Type consistency:** `MediaOwnershipService::ownedPaths(Trashpost): array` is defined in Task 1 Step 3 and consumed identically in Task 2 Step 3. `ModerationService` constructor uses `MediaOwnershipService` (Task 1 Step 4) matching the class created in Step 3. Test constructor calls (Step 7) use the same renamed class. ✓
