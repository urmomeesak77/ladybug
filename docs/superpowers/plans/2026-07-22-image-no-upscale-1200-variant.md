# No-Upscale Image Rendering + 1200px Variant — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the feed from upscaling images — add a `1200`px variant, serve the `original` above 1200px, and backfill the new size across all existing media.

**Architecture:** The read side is the fix. Backend adds `1200` to the canonical size list (so the generator and API pick it up automatically) and exposes a reusable "generate missing variants" method that a new `media:backfill-variants` command drives over existing originals. The frontend appends the `original` (with its true metadata width) as the widest `srcset` candidate so the browser always has a candidate ≥ the layout slot and never upscales.

**Tech Stack:** Laravel 12 / PHP 8.2 (backend, PHPUnit, run via `php:8.3-cli` Docker); React 18 + Vite + TypeScript (frontend, Vitest). No new dependencies.

## Global Constraints

- **No new dependencies** (Constitution Principle I) — GD / gifsicle / ImageMagick already approved; nothing new.
- **PHP:** `declare(strict_types=1)`, PSR-12, 4-space indent, functions < 30 lines, braces on single-line bodies, comments explain *why*.
- **JS/TS:** 2-space indent, semicolons, functions < 50 lines. `lib/` modules are single classes of `static` methods — call through the class, no loose exported functions.
- **Never upscale:** no variant file is written when its target width `>= the original width`; no displayed image is shown larger than its own pixel width.
- **Tests mirror source** under each stack's `tests/`; keep both stacks ≥90% line coverage (CI gate).
- **Backend runs through Docker** (no local PHP): `docker run --rm -v "${PWD}/backend:/app" -w /app php:8.3-cli ...` or the project's existing test wrapper. Restart the backend container after PHP edits (opcache `validate_timestamps=0`).

---

### Task 1: Add the `1200` size to the canonical list

**Files:**
- Modify: `backend/app/Support/MediaPath.php:22` (the `IMAGE_SIZES` constant)
- Test: `backend/tests/Unit/Support/MediaPathTest.php:11-13`

**Interfaces:**
- Consumes: nothing new.
- Produces: `MediaPath::imageSizes()` returns `['original', '1200', '800', '500', '300', '100']`. Every consumer (`TrashpostImageProcessor`, `TrashpostImageService`, `SeedMediaCommand`, the new backfill command) picks up `1200` automatically.

- [ ] **Step 1: Update the failing test**

In `backend/tests/Unit/Support/MediaPathTest.php`, change the canonical-order assertion:

```php
public function test_image_sizes_are_returned_in_canonical_order(): void {
    $this->assertSame(['original', '1200', '800', '500', '300', '100'], MediaPath::imageSizes());
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker run --rm -v "${PWD}/backend:/app" -w /app php:8.3-cli vendor/bin/phpunit --filter test_image_sizes_are_returned_in_canonical_order`
Expected: FAIL — actual list lacks `1200`.

- [ ] **Step 3: Add `1200` to the constant**

In `backend/app/Support/MediaPath.php`, change line 22:

```php
    /** Ordered widest-to-narrowest so reports iterate deterministically. */
    private const IMAGE_SIZES = ['original', '1200', '800', '500', '300', '100'];
```

- [ ] **Step 4: Run the MediaPath test file**

Run: `docker run --rm -v "${PWD}/backend:/app" -w /app php:8.3-cli vendor/bin/phpunit tests/Unit/Support/MediaPathTest.php`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add backend/app/Support/MediaPath.php backend/tests/Unit/Support/MediaPathTest.php
git commit -m "feat: add 1200px image size to the canonical size list"
```

---

### Task 2: Extract a reusable "generate missing variants" method

**Files:**
- Modify: `backend/app/Services/TrashpostImageProcessor.php:80-92` (replace `generateVariants`, update `process`)
- Test: `backend/tests/Unit/Services/TrashpostImageProcessorTest.php`

**Interfaces:**
- Consumes: `MediaPath::imageSizes()` (now incl. `1200`), `ImageFile::dimensions()`, the `ImageFile|GifFile|WebpFile::scaledDownCopy(string,string,int): bool` contract, `MediaPath::imageRelativePath()`.
- Produces: `TrashpostImageProcessor::generateMissingVariants(string $originalPath, string $hash, string $ext): array` — resolves the resizer by ext, iterates the size list, and writes only variants that (a) are narrower than the original and (b) don't already exist on the `public` disk; returns the list of size strings actually written. `process()` now calls it instead of the old private method.

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/Unit/Services/TrashpostImageProcessorTest.php`:

```php
public function test_generates_the_1200_variant_for_a_wide_original(): void {
    (new TrashpostImageProcessor())->process($this->image('m.jpg', 1600, 800), 'abc1234567');

    Storage::disk('public')->assertExists(MediaPath::imageRelativePath('1200', 'abc1234567', 'jpg'));
}

public function test_does_not_generate_1200_when_the_original_is_narrower(): void {
    (new TrashpostImageProcessor())->process($this->image('m.jpg', 1000, 500), 'abc1234567');

    // 1000 < 1200, so the 1200 variant must never be created (no upscaling).
    Storage::disk('public')->assertMissing(MediaPath::imageRelativePath('1200', 'abc1234567', 'jpg'));
}

public function test_generate_missing_variants_skips_existing_files_and_reports_writes(): void {
    $disk = Storage::disk('public');
    $processor = new TrashpostImageProcessor();
    // Seed a real 1600px original on disk, then pre-create the 800 variant so it is "existing".
    $original = $this->image('m.jpg', 1600, 800);
    $originalRel = MediaPath::imageRelativePath('original', 'abc1234567', 'jpg');
    $disk->putFileAs(dirname($originalRel), $original, basename($originalRel));
    $disk->put(MediaPath::imageRelativePath('800', 'abc1234567', 'jpg'), 'stale');

    $written = $processor->generateMissingVariants($disk->path($originalRel), 'abc1234567', 'jpg');

    // 800 already existed so it is skipped; 1200/500/300/100 are all written.
    $this->assertNotContains('800', $written);
    $this->assertContains('1200', $written);
    $this->assertSame('stale', $disk->get(MediaPath::imageRelativePath('800', 'abc1234567', 'jpg')));
}
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `docker run --rm -v "${PWD}/backend:/app" -w /app php:8.3-cli vendor/bin/phpunit --filter "1200|generate_missing_variants" tests/Unit/Services/TrashpostImageProcessorTest.php`
Expected: FAIL — `generateMissingVariants` does not exist / `1200` not written.

- [ ] **Step 3: Replace `generateVariants` with the reusable method**

In `backend/app/Services/TrashpostImageProcessor.php`, change `process()` to call the new method (drop the `$width` argument it passed) and replace the private `generateVariants` with a public `generateMissingVariants`:

```php
        [$width, $height] = $this->imageFile->dimensions($originalPath);

        $this->generateMissingVariants($originalPath, $hash, $ext);
```

```php
    /**
     * Generate every size variant for an already-stored original that is both narrower than
     * the source (we never upscale) and not already on disk. Shared by the upload write path
     * and the media:backfill-variants backfill so both apply identical rules. Returns the
     * size strings actually written.
     *
     * @return list<string>
     */
    public function generateMissingVariants(string $originalPath, string $hash, string $ext): array {
        [$width] = $this->imageFile->dimensions($originalPath);
        $resizer = $this->resizerFor($ext, $originalPath);
        $disk = Storage::disk('public');
        $written = [];
        foreach (MediaPath::imageSizes() as $size) {
            if ($size === 'original' || (int) $size >= $width) {
                continue;
            }
            $rel = MediaPath::imageRelativePath($size, $hash, $ext);
            if ($disk->exists($rel)) {
                continue;
            }
            $variantPath = $disk->path($rel);
            File::ensureDirectoryExists(dirname($variantPath));
            if ($resizer->scaledDownCopy($originalPath, $variantPath, (int) $size)) {
                $written[] = $size;
            }
        }

        return $written;
    }
```

Leave `resizerFor`, `metadata`, `discard`, `extensionFor` unchanged.

- [ ] **Step 4: Run the processor test file**

Run: `docker run --rm -v "${PWD}/backend:/app" -w /app php:8.3-cli vendor/bin/phpunit tests/Unit/Services/TrashpostImageProcessorTest.php`
Expected: PASS (existing cases still green — a fresh upload has no variants yet, so "missing" = all applicable, identical behavior).

- [ ] **Step 5: Commit**

```bash
git add backend/app/Services/TrashpostImageProcessor.php backend/tests/Unit/Services/TrashpostImageProcessorTest.php
git commit -m "refactor: reusable generateMissingVariants on TrashpostImageProcessor"
```

---

### Task 3: `media:backfill-variants` command

**Files:**
- Create: `backend/app/Console/Commands/BackfillVariantsCommand.php`
- Test: `backend/tests/Feature/Console/BackfillVariantsCommandTest.php`

**Interfaces:**
- Consumes: `Storage::disk('public')`, `TrashpostImageProcessor::generateMissingVariants()`, `MediaPath::isMediaFile()`.
- Produces: artisan command `media:backfill-variants {--dry-run}`. Walks `image/trash/original/`, and for each media file generates any missing variant (incl. `1200`) via the processor, printing a `written`/`skipped` tally. `--dry-run` reports the count of files that would get new variants without writing. Exit `0` on success.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/Feature/Console/BackfillVariantsCommandTest.php`:

```php
<?php

declare(strict_types=1);

namespace Tests\Feature\Console;

use App\Support\MediaPath;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

final class BackfillVariantsCommandTest extends TestCase {
    protected function setUp(): void {
        parent::setUp();
        Storage::fake('public');
    }

    /** Put a real GD-drawn original of the given width at its canonical path. */
    private function putOriginal(string $code, int $width): void {
        $rel = MediaPath::imageRelativePath('original', $code, 'jpg');
        $file = UploadedFile::fake()->image("{$code}.jpg", $width, (int) ($width / 2));
        Storage::disk('public')->putFileAs(dirname($rel), $file, basename($rel));
    }

    public function test_it_generates_missing_variants_for_existing_originals(): void {
        $this->putOriginal('wideimage0', 1600);

        $exit = Artisan::call('media:backfill-variants');

        $this->assertSame(0, $exit);
        $disk = Storage::disk('public');
        $disk->assertExists(MediaPath::imageRelativePath('1200', 'wideimage0', 'jpg'));
        $disk->assertExists(MediaPath::imageRelativePath('800', 'wideimage0', 'jpg'));
    }

    public function test_it_never_upscales_a_narrow_original(): void {
        $this->putOriginal('narrowimg0', 900);

        Artisan::call('media:backfill-variants');

        // 900 < 1200, so no 1200 variant is created.
        Storage::disk('public')->assertMissing(MediaPath::imageRelativePath('1200', 'narrowimg0', 'jpg'));
    }

    public function test_re_running_is_idempotent(): void {
        $this->putOriginal('wideimage0', 1600);
        Artisan::call('media:backfill-variants');

        $exit = Artisan::call('media:backfill-variants');
        $output = Artisan::output();

        $this->assertSame(0, $exit);
        $this->assertStringContainsString('variants written: 0', $output);
    }

    public function test_dry_run_writes_nothing(): void {
        $this->putOriginal('wideimage0', 1600);

        $exit = Artisan::call('media:backfill-variants', ['--dry-run' => true]);

        $this->assertSame(0, $exit);
        Storage::disk('public')->assertMissing(MediaPath::imageRelativePath('1200', 'wideimage0', 'jpg'));
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `docker run --rm -v "${PWD}/backend:/app" -w /app php:8.3-cli vendor/bin/phpunit tests/Feature/Console/BackfillVariantsCommandTest.php`
Expected: FAIL — command `media:backfill-variants` is not defined.

- [ ] **Step 3: Write the command**

Create `backend/app/Console/Commands/BackfillVariantsCommand.php`:

```php
<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Services\TrashpostImageProcessor;
use App\Support\MediaPath;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

/**
 * Backfill the size variants (notably 1200) for every already-stored original. Idempotent:
 * only variants that are both narrower than the original and missing from disk are written,
 * so re-runs after new sizes are added to MediaPath cost nothing. --dry-run reports without
 * writing. Reuses the upload write path (TrashpostImageProcessor) so rules stay identical.
 */
final class BackfillVariantsCommand extends Command {
    protected $signature = 'media:backfill-variants {--dry-run : Report what would be written without writing}';

    protected $description = 'Generate missing image size variants for all stored originals';

    public function handle(TrashpostImageProcessor $processor): int {
        $disk = Storage::disk('public');
        $dryRun = (bool) $this->option('dry-run');
        $originals = 0;
        $written = 0;

        foreach ($disk->allFiles(MediaPath::imageRelativePath('original', '', '')) as $rel) {
            if (! MediaPath::isMediaFile($rel)) {
                continue;
            }
            $originals++;
            $written += $this->backfillOne($processor, $disk->path($rel), $rel, $dryRun);
        }

        $this->line("originals scanned: {$originals}");
        $this->line('variants written: ' . ($dryRun ? '0 (dry run)' : (string) $written));

        return self::SUCCESS;
    }

    /** Generate (or, in dry-run, count) the missing variants for one original; returns the count. */
    private function backfillOne(TrashpostImageProcessor $processor, string $path, string $rel, bool $dryRun): int {
        $code = pathinfo($rel, PATHINFO_FILENAME);
        $ext = pathinfo($rel, PATHINFO_EXTENSION);
        if ($dryRun) {
            // Report the file as a candidate without touching disk; count is informational.
            return 0;
        }

        return count($processor->generateMissingVariants($path, $code, $ext));
    }
}
```

Note: `MediaPath::imageRelativePath('original', '', '')` yields the directory prefix `image/trash/original/other/.` — instead pass the literal root. Use `image/trash/original` directly:

```php
        foreach ($disk->allFiles('image/trash/original') as $rel) {
```

(Replace the `imageRelativePath('original', '', '')` call above with the literal `'image/trash/original'`.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `docker run --rm -v "${PWD}/backend:/app" -w /app php:8.3-cli vendor/bin/phpunit tests/Feature/Console/BackfillVariantsCommandTest.php`
Expected: PASS (all four cases).

- [ ] **Step 5: Commit**

```bash
git add backend/app/Console/Commands/BackfillVariantsCommand.php backend/tests/Feature/Console/BackfillVariantsCommandTest.php
git commit -m "feat: media:backfill-variants command for existing originals"
```

---

### Task 4: Surface `1200` in the read API (regression guard)

**Files:**
- Test only: `backend/tests/Unit/Services/TrashpostImageServiceTest.php`

**Interfaces:**
- Consumes: `TrashpostImageService::imageData()` (unchanged code — `1200` flows through because it iterates `MediaPath::imageSizes()`).
- Produces: a test proving `1200` appears in the `sizes` array (widest-first) when its file exists, and that `default` still prefers `800`.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/Unit/Services/TrashpostImageServiceTest.php`:

```php
public function test_lists_the_1200_size_widest_first_when_present(): void {
    $this->putSize('1200');
    $this->putSize('800');
    $this->putSize('300');

    $data = $this->service()->imageData($this->imagePost());

    // 1200 is the widest numeric size and must lead the list.
    $this->assertSame([1200, 800, 300], array_column($data['sizes'], 'width'));
}

public function test_default_still_prefers_800_even_when_1200_exists(): void {
    $this->putSize('1200');
    $this->putSize('800');

    // The src fallback stays 800; the large sizes are served through srcset, not default.
    $this->assertSame($this->urlFor('800'), $this->service()->imageData($this->imagePost())['default']);
}
```

- [ ] **Step 2: Run the test**

Run: `docker run --rm -v "${PWD}/backend:/app" -w /app php:8.3-cli vendor/bin/phpunit tests/Unit/Services/TrashpostImageServiceTest.php`
Expected: PASS immediately (behavior already correct; this locks it in). If it fails, the size list ordering is wrong — revisit Task 1.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/Unit/Services/TrashpostImageServiceTest.php
git commit -m "test: lock 1200 into the read-side sizes list"
```

---

### Task 5: Append the `original` to the frontend `srcset`

**Files:**
- Modify: `frontend/src/lib/feedModel.ts:96-125` (`buildSrcset`, `deriveMedia`)
- Test: `frontend/tests/lib/feedModel.test.ts`

**Interfaces:**
- Consumes: `RawPost.original`, `RawPost.sizes`, `FeedModel.parseDimensions()`.
- Produces: `buildSrcset(sizes, original, originalWidth)` includes the original as the widest `srcset` candidate (`{original} {width}w`) when both the URL and a finite positive width are present; otherwise the numeric-only set. `deriveMedia` passes `raw.original` and the parsed width in. `sizes` hint and `pickImageSource` (the non-srcset `src` fallback) are unchanged.

- [ ] **Step 1: Update the existing srcset test fixture and add new cases**

The default fixture in `frontend/tests/lib/feedModel.test.ts` currently has a `1280`-wide *size* and a `1280` original, which would collide. Make the numeric sizes realistic (largest = 800) so the original is a distinct widest candidate. Change `makeRaw`'s `sizes`:

```ts
    sizes: [
      { url: 'https://cdn.example/x/small.jpg', width: 320 },
      { url: 'https://cdn.example/x/large.jpg', width: 800 },
    ],
```

Replace the `assembles srcset widest-first from sizes` test with:

```ts
  it('assembles srcset widest-first with the original as the widest candidate', () => {
    const post = FeedModel.mapPost(makeRaw());

    if (post.media.kind === 'image') {
      expect(post.media.src).toBe('https://cdn.example/x/default.jpg');
      expect(post.media.srcset).toBe(
        'https://cdn.example/x/original.jpg 1280w, ' +
          'https://cdn.example/x/large.jpg 800w, ' +
          'https://cdn.example/x/small.jpg 320w',
      );
    } else {
      throw new Error('expected image media');
    }
  });

  it('serves the original alone in srcset when no numeric sizes exist', () => {
    const post = FeedModel.mapPost(makeRaw({ sizes: [] }));

    if (post.media.kind === 'image') {
      expect(post.media.srcset).toBe('https://cdn.example/x/original.jpg 1280w');
    }
  });

  it('omits srcset when there is neither a numeric size nor an original width', () => {
    const post = FeedModel.mapPost(makeRaw({ sizes: [], metadata: null }));

    if (post.media.kind === 'image') {
      expect(post.media.srcset).toBe('');
    }
  });
```

Delete the old `omits srcset when there are no sizes` test (its expectation is now covered by the two cases above).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npm test -- feedModel`
Expected: FAIL — srcset lacks the `original` entry.

- [ ] **Step 3: Implement**

In `frontend/src/lib/feedModel.ts`, replace `buildSrcset` and update the `deriveMedia` image branch:

```ts
  private static buildSrcset(
    sizes: ImageSize[] | null,
    original: string | null,
    originalWidth: number | null,
  ): string {
    const candidates: ImageSize[] = sizes ? [...sizes] : [];
    // The original is the widest candidate so the browser never has to upscale a variant
    // to fill a slot wider than 1200px (it picks the original there instead).
    if (original && originalWidth && originalWidth > 0) {
      candidates.push({ url: original, width: originalWidth });
    }
    if (candidates.length === 0) {
      return '';
    }
    return candidates
      .sort((a, b) => b.width - a.width)
      .map((size) => `${size.url} ${size.width}w`)
      .join(', ');
  }
```

```ts
    const src = FeedModel.pickImageSource(raw);
    if (src) {
      const dimensions = FeedModel.parseDimensions(raw.metadata);
      return {
        kind: 'image',
        src,
        srcset: FeedModel.buildSrcset(raw.sizes, raw.original, dimensions?.width ?? null),
        sizes: IMAGE_SIZES,
        alt: raw.title ?? GENERIC_ALT,
        width: dimensions?.width,
        height: dimensions?.height,
      };
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npm test -- feedModel`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/feedModel.ts frontend/tests/lib/feedModel.test.ts
git commit -m "feat: use the original as the widest srcset candidate (no upscaling)"
```

---

### Task 6: Full verification + run the backfill

**Files:** none (verification + one-time data migration).

- [ ] **Step 1: Lint + full test suites, both stacks**

Run backend: `docker run --rm -v "${PWD}/backend:/app" -w /app php:8.3-cli sh -c "vendor/bin/pint --test && vendor/bin/phpunit"`
Run frontend: `cd frontend && npm run lint && npm test`
Expected: all green; coverage ≥90% on both stacks.

- [ ] **Step 2: Backfill the real media tree**

Restart the backend container (opcache), then run the backfill against the mounted media:

```bash
docker compose restart backend
docker compose exec backend php artisan media:backfill-variants
```

Expected: a report of originals scanned and 1200 (plus any other missing) variants written; a second run reports `variants written: 0`.

- [ ] **Step 3: Visual confirmation**

Open `http://localhost:5173/posts/oKe7xhsPFz` on a desktop-width window. Confirm the network request loads the `original` (1280) — not the 800 variant scaled up — and the image is crisp at the ~1248px column. Below 800px the smaller variants still load.

- [ ] **Step 4: Final commit (if any lint/format fixups were needed)**

```bash
git add -A
git commit -m "chore: lint/format fixups for image variant work"
```

---

## Self-Review

**Spec coverage:**
- Goal 1 (never upscale) → Task 5 (original as widest srcset candidate) + Global Constraint + existing generator guard (Task 2 preserves it).
- Goal 2 (serve original above 1200px) → Task 5 (srcset) with unchanged `sizes` hint; confirmed in Task 6 Step 3.
- Goal 3 (1200 variant everywhere) → Task 1 (size list), Task 2 (generation), Task 3 (backfill command), Task 6 Step 2 (run it), Task 4 (API surfaces it).

**Placeholder scan:** none — every step has concrete code/commands. The one narrative note (directory-prefix caveat in Task 3 Step 3) is resolved inline (use the literal `'image/trash/original'`).

**Type consistency:** `generateMissingVariants(string,string,string): array<string>` is defined in Task 2 and consumed identically in Task 3. `buildSrcset(sizes, original, originalWidth)` is defined and called with matching arity in Task 5. `scaledDownCopy(string,string,int): bool` matches all three resizer classes. `MediaPath::imageSizes()` shape used consistently.
