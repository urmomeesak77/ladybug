# Design — Upload (Images + YouTube Links)

**Date:** 2026-06-29
**Status:** Approved (design) — pending spec review
**Feature slug (proposed):** `008-upload`

## Summary

Add the **write side** of the meme site: authenticated users submit either an
image file **or** a YouTube link, with an optional title, via a new
`POST /api/posts` endpoint and a new `/upload` page. The backend validates the
submission server-side, stores the original image, generates resized variants and
intrinsic-dimension metadata, and creates a `Trashpost`. On success the SPA
redirects to the post's permalink (`/posts/{hash}`).

This is the one major capability the `C:\projects\trash` prototype had that Ladybug
does not. Ladybug already owns the **read side and path rules** — `MediaPath`
(shard + size scheme), `TrashpostImageService` (emits URLs for variants that exist),
and a feed that reads `metadata` JSON for intrinsic width/height. This feature adds
only the missing **write path**.

## Scope

**In scope**
- Image upload (`jpg`, `jpeg`, `png`, `gif`).
- YouTube link submission (URL parsed to an 11-char video id; raw input never stored).
- Optional title.
- Authentication required.

**Out of scope (deferred)**
- Uploaded **video files** (`MediaPath::videoRelativePath` exists, but `MemeMedia`
  has no `<video>` renderer yet). Revisit as a follow-up feature.
- Comments, edit/delete of posts, password reset, email verification.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Image library | **In-house GD** helper (`ext-gd`), no Composer package | Constitution Principle I ("prefer small in-house helpers over pulling packages"); avoids the dependency-approval gate. User approved 2026-06-29. |
| Processing model | **Synchronous**, in-request | No queue/worker infrastructure (no new deps); volume at this stage does not warrant async. |
| GIFs | ~~Stored as **original only**, no resized variants (any GIF)~~ **Superseded 2026-07-10:** variants are generated with the approved `gifsicle` system dependency (`App\Support\GifFile`), which preserves animation frames | GD flattens GIF animation on resize; the user later approved gifsicle so GIF posts get real size variants like every other image. The feed still falls back to `original` when a variant is absent. |
| EXIF orientation (JPEG) | **Deferred** to a follow-up | GD cannot write EXIF-tagged test fixtures, so the rotation branches would be untestable and threaten the ≥90% gate; screenshots/downloaded memes (the common case) carry no orientation tag. |
| Auth | `auth:sanctum` (SPA cookie session from 007) | Constitution security; uploads must be attributable. |
| Filename | `{hash}.{ext}` | Hash is the immutable public id; reuses `MediaPath`. |
| `type` column | `'image'` \| `'youtube'` | Drives the feed's media branch. |
| Visibility | Set **`activated_at = now()`** on create | `TrashpostService::visible()` filters `whereNotNull('activated_at')` for both the feed and single-post view — without it the post would store successfully but never appear. No moderation queue in scope. |

## Backend

### Endpoint
`POST /api/posts` — registered in `routes/api.php`, `auth:sanctum` middleware.
- Image submission: `multipart/form-data` with `image` + optional `title`.
- YouTube submission: JSON `{ "youtube": "...", "title": "..." }`.
- Response: `201` with `TrashpostResource` (existing) for the new post.
- `401` when unauthenticated; `422` on validation failure (Laravel default shape,
  consistent with 007).

### `CreatePostRequest` (new `FormRequest`)
Server-side validation (Principle VI):
- Exactly **one** of `image` | `youtube` present (`required_without` pair + a custom
  "not both" rule).
- `image`: `mimes:jpg,jpeg,png,gif`, `max:10240` (10 MB), **and** well-formedness —
  reject if `getimagesize()` on the temp file fails or returns non-positive dims.
- `youtube`: must parse to a valid id via the new `Youtube` parser (below).
- `title`: `nullable|string|max:255`.

### `App\Utils\Youtube` (new)
PHP port of `frontend/src/lib/youtube.ts`: extract the 11-char id from watch / youtu.be
/ embed forms (or accept a bare id); return `null` otherwise. Stores **only the id**.
Keeps backend and frontend parsing rules identical (single source of truth documented
in both files).

### `App\Support\ImageFile` (new — pure-ish GD wrapper)
Thin wrapper over `ext-gd`, no framework deps, unit-testable against fixture files:
- `dimensions(path): {width, height}` via `getimagesize`.
- `mime(path): string`.
- `scaledDownCopy(srcPath, destPath, targetWidth): bool` — `imagescale` (proportional),
  only when source width > target; returns false when no downscale needed.

### `TrashpostImageProcessor` (new service)
Orchestrates storage using existing `MediaPath`:
1. Store original at `image/trash/original/{shard}/{hash}.{ext}`.
2. For each `MediaPath` numeric size (`800/500/300/100`): generate a variant **only if
   the original is wider** (no upscaling). **Skip entirely for GIFs.**
3. Build `metadata` JSON (`{width, height, ratio, mime}`) — the exact shape the feed's
   `parseDimensions` already consumes.
4. Return the data needed to persist the `Trashpost` (`file`, `type`, `metadata`).

### Controller
A `store` method (on `TrashpostsApiController`, or a focused `PostUploadController`):
generate `hash` via `Str::createUniqueHash` (DB unique column guards collisions),
branch on image vs youtube, persist the `Trashpost` with `user_id`/`username` from the
authenticated user and **`activated_at = now()`** (so it is immediately visible), return
the resource.

### Reused unchanged
`MediaPath`, `Str`, `Base64`, `Trashpost`, `TrashpostImageService` (read side),
`TrashpostResource`, `UserResource`.

## Frontend

- **`UploadPage`** at `/upload`, wrapped in existing `RequireAuth`; entry link added to
  `NavMenu` when authenticated.
- Accessible form reusing `AuthField` patterns and theming:
  - Title input (labeled, optional).
  - Mode toggle: **image file** vs **YouTube URL** (radio/segmented, `aria`-correct).
  - Image mode: file picker with client-side type/size pre-check and a local preview.
  - YouTube mode: URL field validated with the existing `toEmbedUrl` (reused) for
    instant feedback.
  - Inline server-side error display (same pattern as `LoginPage`/`RegisterPage`).
- **`lib/uploadApi.ts`** (new): builds the `FormData`/JSON request, sends the XSRF /
  credentials the way `authApi.ts` does, returns a typed result. On success the page
  navigates to `/posts/{hash}`.

## Error Handling

- Unauthenticated → SPA route guard redirects to `/login`; API returns `401`.
- Validation failures (`422`) → mapped to per-field inline messages.
- Oversized / malformed image → rejected at validation before any disk write.
- Disk/processing failure mid-upload → return `500`, do **not** persist a half-written
  post; clean up any partial files written for that hash.
- Network failure on the client → retryable inline error, form state preserved.

## Testing (≥90% line coverage, both stacks — CI-enforced)

**Backend (PHPUnit, sqlite `:memory:` + `Storage::fake('public')` — never the real DB/disk):**
- `CreatePostRequest`: one-of constraint, mime/size/well-formedness, youtube-parse,
  title bounds.
- Controller: `401` unauthenticated; image path produces original + expected variants +
  metadata and a `type=image` row; youtube path stores parsed id with `type=youtube`;
  rejects "both" and "neither"; created post has `activated_at` set and is returned by
  the feed/single-post query.
- `ImageFile`: dimensions/mime, downscale vs upscale-skip, animated-GIF detection,
  EXIF auto-orient (fixture images).
- `TrashpostImageProcessor`: variant set for a wide image, gif-no-resize, narrow-image
  (no variants), metadata shape.
- `Youtube`: parity cases with `youtube.ts`.

**Frontend (Vitest + Playwright):**
- `uploadApi`: request shape (multipart vs JSON), success/error mapping.
- `UploadPage`: mode toggle, client-side validation, error rendering, success redirect.
- e2e: authed user uploads an image → lands on the new permalink.

## Infrastructure

- Add `"ext-gd": "*"` to `backend/composer.json` require.
- Ensure **gd** is present in the dev backend container and CI's `php:8.3-cli`
  (`docker-php-ext-install gd`). This is an extension, not a Composer package.

## Open follow-ups (not this feature)
- EXIF orientation auto-rotate for JPEG uploads (needs a real EXIF fixture strategy).
- Partial-file cleanup when image processing fails mid-way (orphan original).
- Uploaded video files + `<video>` renderer.
- Rate limiting / abuse controls on the upload endpoint.
- Edit / delete of one's own posts.
