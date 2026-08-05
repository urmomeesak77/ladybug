# Phase 0 Research: Video Upload

All items below were open questions at the start of planning; each is resolved with a
decision, rationale, and rejected alternatives before Phase 1 design proceeds.

## 1. Video formats accepted

- **Decision**: MP4 (`video/mp4`) and WebM (`video/webm`) only.
- **Rationale**: Resolved via spec clarification — both are natively web-playable in
  every major browser with no transcoding step; MOV has inconsistent native playback
  outside Safari and is explicitly excluded.
- **Alternatives considered**: Also accepting MOV/AVI/MKV (rejected — would require
  server-side transcoding, a much larger build than this feature scopes).

## 2. Frame-extraction / real-content-validation tool

- **Decision**: Add `ffmpeg` (which bundles `ffprobe`) as a new system (apt) dependency
  in `docker/php/Dockerfile` (dev), `deploy/php/Dockerfile` (prod), and
  `.github/workflows/ci.yml`. Invoked exclusively through Laravel's `Process` facade
  with argv arrays (never a shell string), mirroring the existing `App\Support\GifFile`
  pattern for gifsicle.
- **Rationale**: **Approved by the project owner on 2026-08-05.** No existing tool in
  the stack (ext-gd, gifsicle, ImageMagick) can decode MP4/WebM containers. `ffprobe`
  gives real stream inspection (codec, dimensions, decodability) — needed both to reject
  a corrupted/fake video (FR-004, Edge Cases) and to read source dimensions for the
  no-upscale poster rule (FR-006). `ffmpeg` extracts the poster frame itself. One
  dependency covers both needs.
- **Alternatives considered**: A pure-PHP MP4/WebM parser (rejected — no such capability
  exists in ext-gd or any already-approved extension; hand-rolling a container/codec
  parser is far riskier and larger than one well-audited system binary). Skipping deep
  content validation and trusting the MIME-sniffed extension only (rejected — fails
  Edge Case "file whose extension claims a supported format but isn't," FR-004).

## 3. Media-type discriminator

- **Decision**: Reuse the existing `trashposts.type` string column; add `'video'` as a
  third value alongside the already-observed `'image'` and `'youtube'`. No migration
  needed for this column — it already accepts arbitrary strings.
- **Rationale**: `TrashpostService::reserve()`/`attachImage()` already establish this
  column as the type discriminator; adding a third string value is the smallest change
  and every existing type-branch (`TrashpostResource`, `AdminTrashpostResource`, feed
  serialization) already switches on it.

## 4. Poster/preview image storage

- **Decision**: Add one new nullable `poster` column to `trashposts` (string, parallel
  to `file`/`youtube_thumbnail`), storing the poster's own filename (`{hash}.jpg`). The
  poster frame ffmpeg extracts is then run through the **existing** image size-variant
  pipeline (`TrashpostImageProcessor`'s `generateMissingVariants`/`missingVariants`,
  keyed on the poster's own code/ext) and stored under the existing image tree
  (`image/trash/{size}/{shard}/{code}.jpg`) — not a new poster-specific storage scheme.
- **Rationale**: This lets `TrashpostImageService::imageData()` and
  `TrashpostResource`'s existing `original`/`default`/`sizes` fields work for a video
  post's poster **unchanged**, and reuses the already-correct "never upscale past
  source width" variant logic (FR-006, SC-003) instead of duplicating it. The actual
  playable video file is unrelated to this and uses `MediaPath::videoRelativePath()`
  (already implemented, currently unused, contract-documented in
  `specs/003-media-storage/contracts/media-layout.md`) — no size variants, per that
  contract.
- **Alternatives considered**: A separate `video/trash/{shard}/{code}_poster.jpg`
  scheme (rejected — would require a parallel, duplicate variant-generation code path
  instead of reusing the proven image one). Storing the poster path as JSON inside the
  existing `metadata` column instead of a new column (rejected — every other
  media-bearing field, `file`/`youtube_thumbnail`, is its own column; consistency wins,
  and `MediaOwnershipService::ownedPaths()` needs a typed column to enumerate, not a
  JSON-embedded path).

## 5. Server-side validation layering

- **Decision**: `CreatePostRequest` gains a `video` field validated by Laravel's
  built-in `mimetypes:video/mp4,video/webm` + `max:20480` (KB; matches the existing
  `image` field's `max:10240` KB-for-10MB convention) **plus** a new custom validation
  rule that shells out to `ffprobe` to confirm the file actually decodes as a video
  stream in one of the two accepted codecs. This mirrors how Laravel's built-in `image`
  rule deep-validates an image via `getimagesize` (not just its MIME) today — video gets
  the equivalent deep check, just via `ffprobe` instead of a built-in rule. Validation
  failures reject at the FormRequest layer (422, specific per-reason message) **before**
  any post row is reserved — matching FR-007 and the existing all-or-nothing upload
  behavior.
- **Rationale**: Keeps "no post created on any rejection" true without new try/discard
  plumbing in `TrashpostService` — the existing `attachImage`/discard pattern there
  exists for disk-write failures after validation already passed, not for content
  rejection, and video should follow the same split.
- **Alternatives considered**: Validating video content deep inside
  `TrashpostService::attachVideo()` after the row is reserved (rejected — would require
  new discard/cleanup code the image path doesn't need, and blurs "reject before
  creation" vs. "roll back after creation").

## 6. Trust/moderation integration

- **Decision**: No change to `RatingService`/`ModerationService`/`TRUST_THRESHOLD`
  (=15). `TrashpostService::createPost()` gains a third media branch
  (`attachVideo()`, mirroring `attachImage()`) that runs before the single existing
  `if ($autoActivate) { $this->activate($post); }` decision point.
- **Rationale**: Confirmed by reading `TrashpostService::createPost()` — activation is
  already type-agnostic (one method, called once, after any media branch). This
  directly satisfies FR-009/SC-005 with zero duplicated moderation logic.

## 7. `MediaOwnershipService::ownedPaths()` video coverage

- **Decision**: Extend `ownedPaths()` so a `type === 'video'` post's owned files are:
  the single video file (`MediaPath::videoRelativePath()`) plus every poster
  size-variant (same loop already used for `file`, just keyed on `poster`).
- **Rationale**: Closes the standing follow-up recorded when `MediaVisibilityService`
  (predecessor design) was built — today `ownedPaths()` only knows about image
  variants and the YouTube thumbnail; shipping video without this fix would leave a
  hidden/soft-deleted video's file (and poster) permanently fetchable on the public
  disk, reopening the takedown gap that service was built to close.

## 8. Frontend media representation

- **Decision**: `RawPost`/`FeedMedia` (`frontend/src/lib/feedModel.ts`) gain a `video`
  kind. The poster reuses the **exact same** `default`/`sizes`/`original` API fields
  and `FeedModel.pickImageSource()`/`buildSrcset()` methods already used for image
  posts — a video post's `raw.video` (new field, the direct video URL) is simply
  checked first in `FeedModel.deriveMedia()`, falling through to the existing image
  logic to build the poster's `src`/`srcset`.
- **Rationale**: Since the poster is stored and served exactly like an image (research
  item 4), the frontend needs almost no new data-shaping logic — only a new `video` URL
  field and a new render branch.
- **Autoplay-on-scroll**: `Feed.tsx` already has the codebase's only `IntersectionObserver`
  usage (a one-shot sentinel that triggers `load()` for infinite scroll). The new
  per-video autoplay/pause behavior (FR-008) is modeled on that same primitive but
  observes each `<video>` element individually with a mid-range threshold, toggling
  `.play()`/`.pause()` on visibility rather than firing once. No new dependency —
  `IntersectionObserver` is a browser-native API.

## 9. Test fixtures

- **Decision**: Add small (well under 20MB — a few KB to low hundreds of KB) real,
  valid `sample.mp4` and `sample.webm` fixtures under `backend/tests/fixtures/`
  (existing convention, confirmed via `WebpFileTest.php`'s
  `dirname(__DIR__, 2) . '/fixtures'`), plus a fixture with a `.mp4` extension but
  non-video bytes for the "claims format but isn't" edge case, and an oversized
  (>20MB) fixture or a synthetic large `UploadedFile::fake()` for the size-limit test
  (the size check does not need real video bytes).
- **Rationale**: Matches the exact existing pattern for animated GIF/WebP tests; no new
  fixture convention introduced.
