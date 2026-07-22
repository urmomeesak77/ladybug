# Phase 1 Data Model: Upload Page Polish

**No database schema change.** This feature changes how an upload is *composed and validated*,
not what a meme is. No migration, no new/changed column. The entities below are the in-flight
upload shape (request-time) and the transient UI state; the persisted `Trashpost` is unchanged.

## Entity: Meme upload (request payload → `CreatePostRequest`)

The validated payload for `POST /api/posts`. One media source, now with a required title.

| Field     | Type            | Rule (after this feature)                                   | Change |
|-----------|-----------------|-------------------------------------------------------------|--------|
| `title`   | string          | **required**, string, `max:255`, trimmed (whitespace-only ⇒ empty ⇒ fails `required`) | nullable → **required** |
| `image`   | uploaded file   | `required_without:youtube`, `image`, `mimes:jpg,jpeg,png,gif,`**`webp`**, `max:10240` | **+webp** |
| `youtube` | string          | `required_without:image`, string, `max:500`, must parse to a valid id | unchanged |

Cross-field (unchanged): `image` and `youtube` are mutually exclusive; a supplied `youtube`
must parse via `Youtube::extractId`.

**Validation ordering / authority**: server is authoritative (FR-005). `TrimStrings` middleware
trims `title` before rules run, so a spaces-only title is rejected as missing. WebP joins the
existing `image` well-formedness + `max:10240` size checks — nothing else is relaxed (FR-013).

## Value object: image kind (backend processing branch)

`TrashpostImageProcessor` maps the **validated MIME** (never the filename) to a stored
extension and a resize strategy:

| Validated MIME | Stored ext | Resize strategy |
|----------------|-----------|-----------------|
| `image/jpeg`   | `jpg`     | `ImageFile` (GD `imagescale`) |
| `image/png`    | `png`     | `ImageFile` (GD `imagescale`) |
| `image/gif`    | `gif`     | `GifFile` (gifsicle) |
| `image/webp` (static)   | `webp` | `ImageFile` (GD `imagescale`, now webp-enabled) |
| `image/webp` (animated) | `webp` | **`WebpFile`** (ImageMagick `convert -coalesce -resize`) |

- **Animated vs static** is decided by `WebpFile::isAnimated($path)` (in-house RIFF/`VP8X`
  header parse — see research R3). Static WebP reuses the GD path; animated WebP is the only
  case that invokes ImageMagick.
- Size-variant set, `MediaPath` layout, "never upscale" rule, and rollback-on-failure
  (`discard`) are all unchanged; WebP variants keep the `.webp` extension.

## Transient UI state (frontend — not persisted)

| State        | Type                    | Notes |
|--------------|-------------------------|-------|
| `mode`       | `'image' \| 'youtube'`  | Active tab; defaults to `'image'`. Exactly one selected. |
| `title`      | string                  | Required; client checks trimmed non-empty before submit. |
| `file`       | `File \| null`          | Image tab; `accept` now includes `image/webp`. |
| `youtube`    | string                  | YouTube tab. |
| `errors`     | `FieldErrors`           | Field-level messages; a hidden tab's stale error is not shown/submitted. |

Only the **active** tab's input is submitted (FR-009): image mode sends multipart `image`;
youtube mode sends JSON `youtube`. Switching tabs must clear the departed tab's lingering error
(edge case in spec).

## State transitions

Upload composition (UI): `Image tab (default) ⇄ YouTube tab` — switching swaps the visible
panel/input and drops the other panel's stale error. Submit is unchanged downstream: a valid
payload creates a `Trashpost` and (for members below trust threshold) it is created pending per
feature 011 — **no change** to activation/rating here.
