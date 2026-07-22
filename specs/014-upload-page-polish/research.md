# Phase 0 Research: Upload Page Polish

All NEEDS CLARIFICATION items are resolved. The spec's only deferred decision — the
animated-WebP resize tool — was decided with the project owner during this planning session.

## R1 — Animated-WebP resize tool (Principle I dependency decision)

- **Decision**: Add **ImageMagick** (`imagemagick` apt package) as a system CLI in the
  `docker/php/Dockerfile` and the CI e2e job. Animated WebP is resized frame-preserving with a
  single command: `convert in.webp -coalesce -resize {width}x -layers optimize out.webp`.
- **Rationale**: GD decodes only the first frame of an animated WebP (the same limitation that
  forced `gifsicle` for animated GIFs), so a resize tool outside GD is required — the spec's
  2026-07-22 clarification already committed to preserving animation via a new, plan-approved
  dependency. Among the candidate CLIs, ImageMagick resizes an animated WebP correctly in one
  invocation (coalesce → resize → re-layer), which is by far the most robust and the least
  in-house glue. **The project owner approved ImageMagick on 2026-07-22.**
- **Alternatives considered**:
  - *libwebp tools (`webp` pkg: `anim_dump`, `img2webp`, `cwebp`, `webpinfo`)* — smaller and
    more single-purpose (closer to the gifsicle precedent), but resizing an animated WebP is a
    multi-step pipeline (dump frames → read per-frame durations → resize each → reassemble),
    which is fiddly and error-prone for frame timing/loop count. Rejected for robustness; the
    owner chose the simpler one-command tool.
  - *No new tool — serve the original at every size for animated WebP* — zero dependencies, but
    yields no bandwidth savings and departs from the owner's "preserve via a resize tool"
    clarification. Rejected.
- **Security**: ImageMagick is invoked through a Symfony `Process` **argv array** (never a
  shell string), fed only files that already passed `CreatePostRequest` (real, bounded WebP).
  This mirrors `GifFile`'s existing hardened invocation (Principle VI).

## R2 — Static WebP in GD (`--with-webp`)

- **Decision**: Rebuild GD with `--with-webp` (add `libwebp-dev` to the image build) and extend
  `ImageFile` with WebP read (`imagecreatefromwebp`) and write (`imagewebp`) branches;
  `imagescale` already handles the resize.
- **Rationale**: The current image builds GD with `--with-jpeg --with-freetype` only, so
  `imagecreatefromwebp` is unavailable today. Enabling WebP on the **already-present** GD
  library is expressly permitted by the constitution's Technology & Architecture Constraints
  ("do not add a *second* [image library]") and adds no Composer/npm package. Static WebP then
  reuses the exact JPEG/PNG path (scale + write), so most WebP uploads never touch ImageMagick.
- **Alternatives considered**: routing *all* WebP (static too) through ImageMagick — rejected;
  it would waste the in-house GD path and enlarge the surface fed to the external tool.

## R3 — Detecting an animated WebP (dependency-free)

- **Decision**: Detect animation in-house by parsing the WebP RIFF container: a WebP is
  animated iff it is extended-format (`VP8X` chunk) with the animation flag set / an `ANIM`
  chunk present. `WebpFile::isAnimated(path)` reads the fixed-offset header bytes (RIFF magic +
  `WEBP` + `VP8X` + flag byte) — no external process, no new dependency.
- **Rationale**: We must branch static vs. animated to pick GD vs. ImageMagick; reading a few
  header bytes is trivial and avoids spawning a process just to classify. Keeps the common
  (static) path process-free.
- **Alternatives considered**: `webpinfo`/ImageMagick `identify` to detect — rejected as an
  unnecessary subprocess and (for libwebp) an extra tool.

## R4 — Required title, trimmed, server-authoritative

- **Decision**: In `CreatePostRequest` change `title` from `['nullable','string','max:255']` to
  `['required','string','max:255']` and trim before validation (Laravel's `TrimStrings`
  middleware already trims request strings, so a whitespace-only title arrives empty and fails
  `required`). Client-side, `UploadModel.validate` adds a trimmed required-title check with a
  field-level message; the server stays authoritative (FR-005).
- **Rationale**: FR-004/FR-005 + the whitespace-only edge case. `TrimStrings` makes
  "whitespace-only == missing" fall out naturally; no custom rule needed.
- **Alternatives considered**: a custom `notWhitespace` rule — unnecessary given `TrimStrings`.

## R5 — Tabs pattern (Image / YouTube)

- **Decision**: Replace the radio `fieldset` with a WAI-ARIA **tablist**: a `MediaTabs`
  component rendering `role="tablist"` with two `role="tab"` buttons (`aria-selected`,
  `aria-controls`, roving `tabIndex`), each controlling a `role="tabpanel"`
  (`aria-labelledby`). A small `useTabsKeyboard` hook implements Left/Right/Home/End roving
  focus (mirroring the shape of the existing `useMenuKeyboard`). Image tab is default; only the
  active panel's input is rendered, so only its value is submitted (FR-009).
- **Rationale**: FR-007/008/010 + Principle IV. Reusing the established in-house
  keyboard-hook + ARIA-pattern approach (as with the 013 menu) keeps it dependency-free and
  consistent. Selected state uses an underline/weight affordance plus `aria-selected`, not
  color alone.
- **Alternatives considered**: a headless tabs library — rejected (Principle I; the pattern is
  a few lines in-house). Keeping radios styled as tabs — rejected; the spec asks for real tabs
  with proper `tab`/`tabpanel` semantics.

## R6 — Making the form "read as one family" with auth

- **Decision**: Render `UploadPage` inside a `<section className="auth">` and reuse
  `.auth-form`, `AuthField`, and `BusyButton` verbatim; the title uses `AuthField`, the tabs
  and media inputs sit inside `.auth-form`. Heading text becomes exactly `Upload`. Only new CSS
  is a small `.media-tabs` block (theme-aware tokens, responsive, ≥44px touch targets).
- **Rationale**: FR-002/FR-003 explicitly mean "reuse the existing auth visual treatment," and
  the current `.auth` scope already provides the centered column, hairline heading, field
  rhythm, and full-width button. The old `.upload` / `.upload__mode` markup (which had no CSS)
  is removed.
- **Alternatives considered**: a bespoke upload stylesheet — rejected; contradicts "one family"
  and duplicates the auth styles.
