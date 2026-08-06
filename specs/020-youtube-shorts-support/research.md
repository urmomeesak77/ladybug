# Research: YouTube Shorts Support

All unknowns below are resolved against the current repo state (branch
`020-youtube-shorts-support`, no Shorts-specific code exists yet).

## R1 — Where a Shorts URL is currently rejected

**Decision**: The single point of failure is `App\Utils\Youtube::PATTERNS` (backend)
and its documented mirror `frontend/src/lib/youtube.ts` `URL_PATTERNS`. Neither array
has an entry for `/shorts/{id}`, so `Youtube::extractId()` returns `null` for a Shorts
link, which `CreatePostRequest::validateExclusivity()` turns into the existing
"Enter a valid YouTube link." error (`backend/app/Http/Requests/CreatePostRequest.php:68`).

**Rationale**: Confirmed by reading `backend/app/Utils/Youtube.php` — three patterns
(`?v=`, `youtu.be/`, `/embed/`) plus a bare-11-char-id fallback. No fourth pattern.

**Alternatives considered**: None — this is a factual inventory, not a choice.

## R2 — How to add Shorts recognition without duplicating logic

**Decision**: Add one more pattern, `#/shorts/([A-Za-z0-9_-]{11})#`, to the existing
`PATTERNS` array in `Youtube.php` (backend) and `URL_PATTERNS` in `youtube.ts`
(frontend), matching the exact style of the existing `/embed/` entry (unanchored
substring match, host-agnostic — so `www.`, `m.`, or no subdomain all work for free,
matching the spec's Assumptions section). Add a second static method,
`Youtube::isShort(string $raw): bool`, on the **backend only**, reusing the same
regex constant, to answer "was this specifically a Shorts URL" — needed because only
the extracted id (not the raw URL or its shape) is persisted today.

**Rationale**: `extractId()` already treats "watch/youtu.be/embed/bare-id" as
interchangeable once a valid id is found — by design, a Shorts-sourced post is stored
"exactly like any other YouTube-sourced post" (spec's Key Entities section). Only the
*orientation* needs to be remembered past the parse step, which `extractId()`'s return
type (`?string`) can't carry. A second narrow method is simpler than changing
`extractId()`'s signature/return shape, which would ripple into every existing caller
(`CreatePostRequest`, `TrashpostsApiController`, `YoutubeThumbnailService`).

**Alternatives considered**:
- *Returning `array{id, isShort}` from `extractId()`* — rejected: touches 3 existing
  call sites' return-type assumptions for one new field, larger diff, no benefit since
  only the upload path needs the flag.
- *Re-deriving orientation later from the id via a YouTube API call* — rejected by the
  spec's own Assumptions ("does not call out to YouTube to confirm... a `/shorts/{id}`
  link is trusted to be a Shorts link") and Principle I (no new dependency for an
  HTTP client we already avoid needing).
- *Adding `isShort` to the frontend `youtube.ts` too* — rejected: nothing on the
  frontend ever calls `Youtube.toEmbedUrl`/`extractId` with a raw pasted URL (see R4);
  an unused method would be dead code. Only the regex pattern itself is mirrored, to
  honor the file's explicit "keep both in sync" contract for the parsing behavior that
  *is* exercised (accepting a Shorts id when one somehow does reach `toEmbedUrl`).

## R3 — Persisting orientation so playback can render it correctly

**Decision**: Add a new non-nullable `trashposts.youtube_is_short` boolean column,
default `false`. `TrashpostsApiController::store()` computes the flag from the raw
`youtube` input *before* extraction (`Youtube::isShort((string) $request->input('youtube'))`,
mirroring how it already computes `$youtubeId`) and passes it through
`TrashpostService::createPost()` → `reserve()`, which sets it on the new row alongside
`type`/`youtube` (same non-mass-assigned pattern, same comment already justifying that
choice at `TrashpostService.php:157-159`). `TrashpostResource` exposes it as
`youtube_is_short: boolean`.

**Rationale**: The `youtube` column stores only the bare 11-char id (confirmed in
`TrashpostService::reserve()` and the `2026_06_08_000000_create_trashposts_table.php`
migration) — the original URL, and therefore the only place "was this a Shorts link"
was ever expressed, is discarded at validation time. Without a stored flag, playback
(both feed and single-post view, which only ever see the API response) has no way to
choose a vertical vs. horizontal player. A boolean column is the smallest schema change
that survives round-tripping through the JSON API, matching how `metadata` already
carries render-affecting derived facts (image width/height) for the *other* two media
kinds.

**Alternatives considered**:
- *Re-detecting orientation client-side* — impossible; the client never sees the
  original URL, only the extracted id (Principle VI: "we extract only a valid id and
  never store or embed raw user input").
- *Overloading `type` (`'youtube'` → `'youtube_shorts'`)* — rejected: `type` already
  drives `TrashpostResource::videoUrl()`'s `$this->type !== 'video'` branch and other
  `type === 'youtube'` checks throughout the codebase; adding a second value multiplies
  every one of those call sites instead of adding one boolean check at render time.
- *Deriving orientation from the fetched thumbnail's actual pixel dimensions* — rejected
  by the spec's own edge case ("A Shorts video that happens to be wide/landscape...
  still displays correctly — detection is based on the URL path, not on the video's
  actual dimensions").

## R4 — Frontend rendering path and today's aspect ratio

**Decision**: `frontend/src/components/MemeMedia.tsx`'s `YoutubeMedia` renders a single
`<iframe>` inside a `.meme-media.meme-media--video` wrapper; `frontend/src/styles/theme.css`
lines 593-597 fix that wrapper's box via the CSS `aspect-ratio` property
(`aspect-ratio: 16 / 9`, not a padding-bottom hack), and the iframe fills it via
`position: absolute; inset: 0`. Add a second modifier class,
`meme-media--video-vertical`, applied only when `media.isShort` is true, with:

```css
.meme-media--video.meme-media--video-vertical {
  aspect-ratio: 9 / 16;
  max-width: min(100%, 26rem);
  margin-inline: auto;
}
```

The combined-class selector's specificity naturally wins over the base
`.meme-media--video` rule regardless of source order. `max-width` caps how tall a
full-card-width vertical video would otherwise become (a 9:16 box at a ~80rem card
width would be over 2000px tall); `min(100%, 26rem)` still collapses to full card width
on narrow/mobile viewports (Principle VIII — no fixed single-width layout), and
`margin-inline: auto` centers the narrower box within the unchanged card width per the
spec's resolved clarification.

**Rationale**: This is the only place YouTube posts are rendered — `PostPage.tsx` reuses
the same `MemeMedia`/`YoutubeMedia` component and props, so one CSS/prop change covers
both the feed and the single-post page (FR-005).

**Threading the flag**: `FeedModel.deriveMedia()` (`frontend/src/lib/feedModel.ts:162-165`)
is the one place a `RawPost` becomes a `youtube`-kind `FeedMedia`. Add
`youtube_is_short: boolean` to the `RawPost` type and `isShort: boolean` to the
`{ kind: 'youtube' }` member of `FeedMedia`, populated from `raw.youtube_is_short`.
`MemeMedia`'s `YoutubeMedia` reads `media.isShort` to pick the modifier class.

**Alternatives considered**:
- *Detecting orientation from the embed URL's absence of `/shorts/`* — impossible, the
  embed URL is always rebuilt as `https://www.youtube-nocookie.com/embed/{id}`
  (`Youtube.toEmbedUrl`), so the id-only URL carries no shape information by the time
  it reaches `FeedModel`.

## R5 — Thumbnail generation (FR-007)

**Decision**: No code change needed. `YoutubeThumbnailService::ensure()`
(`backend/app/Services/YoutubeThumbnailService.php`) fetches
`https://img.youtube.com/vi/{id}/mqdefault.jpg` keyed only by the extracted video id —
it has no format-specific logic and doesn't inspect the original URL shape. Since
Shorts ids extract through the same `Youtube::extractId()` path (R2), the existing
thumbnail pipeline already works unchanged for Shorts-sourced posts.

**Rationale**: Verified by reading the service in full — its only external input is
`$post->youtube` (the stored id), re-validated via `Youtube::extractId()` before the
fetch. It is source-format-agnostic by construction.

**Alternatives considered**: None needed; covered by adding an integration test
(quickstart) rather than new code.

## R6 — Test surfaces to extend (Principle VII: tests mirror source)

| Source changed | Mirrored test file | New cases |
|---|---|---|
| `backend/app/Utils/Youtube.php` | `backend/tests/Unit/Utils/YoutubeTest.php` | `extractId()` on a `/shorts/{id}` URL (incl. `www.`/`m.` host, per Assumptions); `isShort()` true for a Shorts URL, false for watch/youtu.be/embed/bare-id/non-YouTube input |
| `backend/app/Http/Requests/CreatePostRequest.php` (indirect — via `Youtube`) | `backend/tests/Feature/Http/Controllers/CreatePostTest.php` | Shorts URL is accepted; a string that merely contains the word "shorts" without a real `/shorts/{id}` path is still rejected (edge case) |
| `backend/app/Services/TrashpostService.php` | `backend/tests/Unit/Services/TrashpostServiceTest.php` | `createPost(..., isShort: true)` persists `youtube_is_short = true`; the existing non-Shorts calls (unchanged, default `false`) still pass unmodified |
| `backend/app/Http/Resources/TrashpostResource.php` | (covered by `CreatePostTest.php` + `TrashpostsApiControllerTest.php`) | response includes `youtube_is_short` |
| `frontend/src/lib/youtube.ts` | `frontend/tests/lib/youtube.test.ts` | `toEmbedUrl()` accepts a `/shorts/{id}` URL |
| `frontend/src/lib/feedModel.ts` | `frontend/tests/lib/feedModel.test.ts` | `deriveMedia()` maps `raw.youtube_is_short` into `media.isShort` for both `true` and `false`/absent |
| `frontend/src/components/MemeMedia.tsx` | `frontend/tests/components/MemeMedia.test.tsx` | `YoutubeMedia` applies the vertical modifier class only when `media.isShort` |

**Rationale**: Direct application of Constitution Principle VII (tests mirror source
paths) to every file this feature touches; the table doubles as the P1/P2/P3 →
acceptance-scenario → test mapping the spec's Independent Test lines call for.

## R7 — No new dependency

**Decision**: Nothing here needs a new package. Detection is a regex addition to
existing in-house utility classes; persistence is a plain Eloquent migration; playback
is a CSS class + one boolean prop. No HTTP client, video library, or parsing package is
introduced.

**Rationale**: Principle I (Minimal Dependencies, NON-NEGOTIABLE) — the default answer
to "add a library" is no, and this feature never needed to ask.
