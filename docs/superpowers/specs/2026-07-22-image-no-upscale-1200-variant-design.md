# Image rendering: no upscaling, 1200px variant, serve original above 1200px

**Date:** 2026-07-22
**Status:** Approved (design)

## Problem

On a wide desktop viewport, a post's image is rendered blurry: the browser takes
the **800px** variant and scales it up to fill the ~1248px feed column. Observed on
`/posts/oKe7xhsPFz`, whose original is 1280px wide — the 800 file is stretched to
~1240px.

Root cause is entirely on the read side:

- `frontend/src/lib/feedModel.ts` builds `srcset` only from the numeric variants
  (`buildSrcset` over the API `sizes` array), whose widest entry is **800w**. The
  `original` is never a srcset candidate.
- The `sizes` hint is `(min-width: 80rem) 80rem, 100vw`, i.e. the slot is up to the
  80rem (1280px) layout column. `.main-container` is capped at `80rem + 210px` and
  `main` is inset by the 210px leftbar + padding, so the image column never exceeds
  ~1248px.
- With no srcset candidate ≥ the slot, the browser selects 800w and **upscales** it.

The variant *generator* is not at fault: `TrashpostImageProcessor::generateVariants`
already skips any size `>= $width`, so it never upscales when creating files.

## Goals

1. **Never upscale** a displayed image (no variant shown larger than its own pixels).
2. **Serve the `original`** when the slot is above 1200px (large viewports / the full
   feed column).
3. **Generate a `1200`px variant** for every image, including a backfill of all
   existing media.

## Non-goals

- Reworking the `sizes` hint to subtract the leftbar width (current `100vw` slightly
  over-estimates the slot below 80rem; over-estimation only ever fetches a *larger*
  image, never causing upscaling — safe, and it keeps the "original above 1200px
  viewport" behaviour the user asked for). Left unchanged.
- Video handling, YouTube handling, WebP/GIF format decisions — unchanged.
- Any new dependency.

## Design

### 1. Add the `1200` size (backend, `App\Support\MediaPath`)

```
IMAGE_SIZES = ['original', '1200', '800', '500', '300', '100']
```

Everything that iterates `MediaPath::imageSizes()` picks the new size up
automatically: the upload variant generator, the read-side `TrashpostImageService`
(so `1200` appears in the API `sizes` array when the file exists), the seed command,
and the discard/cleanup path. The generator's existing `(int) $size >= $width`
guard means a `1200` file is written **only** when the original is ≥1200px wide, so
smaller uploads never get an upscaled 1200.

### 2. Put `original` into the srcset (frontend, `feedModel.ts`)

`FeedModel.buildSrcset` gains the `original` URL + its intrinsic width (already parsed
from `metadata` via `parseDimensions`) as the widest srcset candidate:

```
srcset (widest-first): {original} {origWidth}w, {1200 url} 1200w, 800w, 500w, 300w, 100w
```

- `deriveMedia` passes `raw` (for `raw.original`) and the parsed dimensions into
  `buildSrcset`. `original` is appended only when both the URL and a finite width are
  present; otherwise the srcset is the numeric-only set exactly as today.
- The `sizes` hint is unchanged: `(min-width: 80rem) 80rem, 100vw`.

Resulting selection (slot capped at ~1248px by the layout):

| Slot (CSS px) | Chosen candidate |
|---|---|
| ≤ 100 / 300 / 500 / 800 | the smallest sufficient numeric variant |
| 801–1200 | `1200` variant |
| > 1200 (full desktop column, large viewports) | `original` |

Because a candidate ≥ the slot now always exists, the browser never upscales. The
non-srcset `src` fallback stays the API `default` (800) — only relevant for the
(effectively nonexistent) no-srcset browser.

**Large originals:** per the approved decision, the original is always the top
candidate whatever its pixel size — a future multi-thousand-px upload would be served
at full size above 1200px. Accepted trade-off; today's originals are ≈1280px.

### 3. Backfill command (backend)

New idempotent artisan command `media:backfill-variants`:

- Walks every file under `image/trash/original/` on the `public` disk.
- Derives `hash` + `ext` from the filename; reads the original's width.
- Generates any **missing** variant size (now including `1200`) by reusing
  `TrashpostImageProcessor`'s per-format resizer (GD for static images/static WebP,
  gifsicle for GIF, ImageMagick for animated WebP), skipping sizes `>= width` and any
  variant file that already exists.
- Prints a per-size written/skipped report; `--dry-run` reports without writing.

To avoid duplicating resize logic, extract the reusable core out of
`TrashpostImageProcessor::generateVariants` into a public method the command calls
(e.g. `generateMissingVariants(string $originalPath, string $hash, string $ext): array`
returning the sizes written), keeping the upload path behaviour identical.

## Testing

- `MediaPathTest` — `1200` present in `imageSizes()`, in canonical widest-first order;
  relative path for `1200`.
- `TrashpostImageServiceTest` — `1200` surfaced in `sizes` when the file exists; absent
  when it does not; `default` precedence unchanged.
- `TrashpostImageProcessorTest` — a ≥1200px original yields a `1200` variant; a
  <1200px original does not (no upscale); extracted method covered.
- `feedModel` tests — `original` appended to `srcset` with its metadata width; omitted
  when original URL or width missing; `sizes` hint unchanged; ordering widest-first.
- New `MediaBackfillVariantsCommandTest` — generates missing `1200` for a wide fixture,
  skips existing/upscale cases, idempotent re-run writes nothing, `--dry-run` writes
  nothing.
- Keep both stacks ≥90% line coverage (CI gate).

## Rollout

1. Ship code (sizes list, generator refactor, srcset, backfill command) behind tests.
2. Run `php artisan media:backfill-variants` against the mounted media tree to create
   the `1200` files for existing posts.
3. Verify `/posts/oKe7xhsPFz` renders the original (1280) at desktop width, no upscale.
