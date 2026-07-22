# Contracts: Upload Page Polish

Two contracts: the `POST /api/posts` server delta and the upload-page **tabs** UI contract.
Only the deltas from feature 008 are stated; everything unlisted is unchanged.

## 1. `POST /api/posts` (JSON API)

Auth: `auth:sanctum` + `verified` (unchanged, FR-015). Success `201` with the created meme's
`hash` (unchanged, FR-006/FR-014 — no DB id). Two request encodings, as today:

- **Image**: `multipart/form-data` with `title`, `image` (file).
- **YouTube**: `application/json` with `title`, `youtube`.

### Request rule deltas

| Field | Before (008) | After (014) |
|-------|--------------|-------------|
| `title` | `nullable, string, max:255` | **`required`, string, max:255** (trimmed; whitespace-only ⇒ `422`) |
| `image` | `mimes:jpg,jpeg,png,gif, max:10240` | `mimes:jpg,jpeg,png,gif,`**`webp`**`, max:10240` |
| `youtube` | unchanged | unchanged |

### Responses

| Status | When |
|--------|------|
| `201`  | Created. Body `{ "data": { "hash": "<10-char>", ... } }` — unchanged shape. |
| `422`  | Validation failed. Body `{ "errors": { "title"?: [...], "image"?: [...], "youtube"?: [...] } }`. **New**: missing/whitespace-only `title` ⇒ `errors.title` present. A non-WebP-added unsupported/malformed image still ⇒ `errors.image`. |
| `401` / `403` | Unauthenticated / unverified — unchanged. |

### Media processing guarantees

- A valid **static WebP** ⇒ stored `.webp` original + downscaled `.webp` size variants (GD),
  renders in feed and permalink like any image (FR-012).
- A valid **animated WebP** ⇒ every size variant keeps **all frames** and still animates
  (ImageMagick `convert -coalesce -resize {w}x -layers optimize`); never flattened (FR-012a).
- Malformed / oversized WebP ⇒ `422` from the same `image` + `max:10240` checks (FR-013).

### Contract tests (backend, `tests/Feature/Http/Controllers/CreatePostTest.php`)

- `title` omitted ⇒ `422` with `errors.title`; no `Trashpost` created.
- `title` whitespace-only ⇒ `422` with `errors.title`.
- Valid static WebP + title ⇒ `201`, `.webp` original + variants exist.
- Valid animated WebP + title ⇒ `201`, each variant is animated (frame count > 1).
- Existing JPEG/PNG/GIF + YouTube happy paths still `201` (regression, FR-006/SC-006).
- Malformed "webp" ⇒ `422` (`errors.image`).

## 2. Upload-page tabs (frontend UI contract)

The media-type chooser is a WAI-ARIA **tablist** replacing the radio group.

### Structure

- `role="tablist"` with an accessible name (e.g. `aria-label="What are you posting?"`).
- Two `role="tab"` buttons: **Image** (default selected) and **YouTube**. Each has
  `aria-selected` (`true`/`false`), `aria-controls="<panel-id>"`, `id`, and roving `tabIndex`
  (`0` on the selected tab, `-1` on the other).
- One rendered `role="tabpanel"` for the active tab, `aria-labelledby="<tab-id>"`, containing
  only that tab's input (image file picker **or** YouTube link field).

### Behavior

| Requirement | Contract |
|-------------|----------|
| FR-007 | Exactly two tabs "Image"/"YouTube"; Image selected on first render. |
| FR-008 | Exactly one `aria-selected="true"`; only the active panel/input is in the DOM. |
| FR-009 | Only the active tab's value is submitted (image ⇒ multipart `image`; youtube ⇒ JSON `youtube`). |
| FR-010 | Keyboard: Left/Right move selection, Home/End jump to first/last, roving tabindex so Tab enters the tablist once; selected state exposed via `aria-selected` and a **non-color** affordance (underline/weight), never color alone. |
| Edge: switch after error | Switching tabs clears the departed tab's field error (no lingering error against a hidden input). |

### Component tests (frontend)

- `components/MediaTabs.test.tsx`: renders two tabs, Image selected by default; clicking
  YouTube flips `aria-selected` and swaps the panel; only one tabpanel present.
- `hooks/useTabsKeyboard.test.tsx`: Left/Right/Home/End move selection with correct roving
  tabindex.
- `pages/UploadPage.test.tsx`: heading is exactly "Upload"; empty/whitespace title ⇒ field
  error, no submit; switching tabs drops the other input's stale error; image `accept` includes
  `image/webp`.
