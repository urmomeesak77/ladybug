# Implementation Plan: Upload Page Polish

**Branch**: `014-upload-page-polish` | **Date**: 2026-07-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/014-upload-page-polish/spec.md`

## Summary

Polish the upload page so it reads as one family with the login/registration forms and
tightens what a post requires. Four changes: (1) the heading becomes exactly "Upload" and the
form adopts the shared `.auth`/`.auth-form` visual treatment; (2) the image/YouTube radio
toggle becomes a WAI-ARIA **tablist** ("Image" default, "YouTube"), showing only the active
tab's input; (3) a **title becomes required**, enforced both client-side and authoritatively
in `CreatePostRequest`; (4) **WebP images are accepted** — static WebP flows through the
existing in-house GD path (GD rebuilt `--with-webp`), and **animated** WebP is resized frame
-preserving through **ImageMagick** (`convert`), a new system CLI approved this planning
session, mirroring how animated GIFs already use `gifsicle`.

## Technical Context

**Language/Version**: PHP 8.3 (Laravel 12) backend; TypeScript 5 / React 18 (Vite) frontend.

**Primary Dependencies**: Existing stack only — Laravel, Sanctum, React, React Router,
ext-gd. **New system CLI: `imagemagick`** (apt package in `docker/php/Dockerfile` + CI backend &
e2e jobs),
approved by the project owner on 2026-07-22 for animated-WebP frame-preserving resize. **GD
rebuilt with `--with-webp`** (`libwebp-dev` build lib) to decode/encode static WebP — enabling
a format on the *already-present* image library, which the constitution's Technology &
Architecture Constraints explicitly allow ("Server-side image handling via the already-present
image library; do not add a second one"). No new npm or Composer package.

**Storage**: MySQL via Eloquent (unchanged — no schema change). Media on the `public` disk
under `LADYBUG_DATA_ROOT\ladybug-storage`, using the existing `MediaPath` size-variant tree.

**Testing**: PHPUnit (backend, sqlite `:memory:`, pcov ≥90%), Vitest (frontend, ≥90% over all
of `src/`), Playwright (e2e against the isolated `docker-compose.e2e.yml` stack).

**Target Platform**: Web (JSON API + SPA). Dev backend runs in the `php:8.3-cli` Docker image;
no local PHP.

**Project Type**: Web application — decoupled `backend/` (Laravel API) + `frontend/` (React SPA).

**Performance Goals**: N/A beyond existing feed/upload behavior; variant generation stays a
one-time per-upload cost. Animated-WebP resize adds a bounded per-variant `convert` call,
matching the existing per-variant `gifsicle` cost.

**Constraints**: No horizontal scroll / responsive across 320px→desktop (Principle VIII);
`prefers-color-scheme` theming (Principle IV); color never the sole signal; all upload input
validated server-side (Principle VI); ImageMagick invoked with an argv **array**, never a shell
string, feeding only validated WebP.

**Scale/Scope**: Small feature — one frontend page + one shared tabs component/hook, one new
backend Support class (`WebpFile`), edits to `CreatePostRequest`, `TrashpostImageProcessor`,
`ImageFile`, the Docker image, and CI; plus mirrored tests.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| # | Principle | Assessment |
|---|-----------|------------|
| I | Minimal Dependencies (NON-NEGOTIABLE) | **PASS w/ approval.** One new system CLI (`imagemagick`) — the *only* way to resize animated WebP frame-preserving (GD flattens it, exactly as with GIF/gifsicle). Explicitly approved by the owner on 2026-07-22 during this planning session; rationale recorded in `research.md` and the Dockerfile comment. GD `--with-webp` is enabling a format on the present library, not a new package. No npm/Composer dep. |
| II | Coding Conventions | **PASS.** New TS ≤50-line functions, PHP ≤30-line + `declare(strict_types=1)`, single class of static methods per `lib/` module, braces on single-line bodies, comments say *why*. |
| III | Browser-Native Navigation | **PASS.** No routing change; `/upload` unchanged. Tab state is transient in-page UI, not a URL view (it composes a single form, like a radio group). |
| IV | Theme & Accessibility | **PASS.** Reuses theme-aware `.auth`/`.auth-field` styling; tabs follow the WAI-ARIA tab pattern (`role="tablist"`/`tab`/`tabpanel`, `aria-selected`, `aria-controls`, roving tabindex, arrow-key operable); selected state carries a non-color affordance; title/media inputs keep `<label>`s. |
| V | Stable Meme Identifiers | **PASS.** Success still returns the 10-char `hash`; no DB id surfaced (FR-014). |
| VI | Security & Input Validation | **PASS.** WebP added to the server `mimes:` allow-list + size cap kept; `image` rule re-validates well-formedness; title trimmed + required server-side; ImageMagick run via argv array (no shell), fed only validated WebP; stored extension derived from validated MIME, never the filename. |
| VII | Test Coverage & Organization | **PASS.** Mirrored tests: `WebpFile` → `tests/Unit/Support/WebpFileTest.php`, updated `CreatePostTest`, `TrashpostImageProcessorTest`; frontend `MediaTabs`/hook/`UploadPage`/`useUploadForm`/`uploadModel` specs + e2e. ≥90% held. |
| VIII | Responsive, Multi-Device Layout | **PASS.** Reuses the auth form's fluid single-column layout; tabs sit within it and reflow; touch targets keep the ≥2.75rem control sizing. |

**Result: PASS** (with the recorded, owner-approved ImageMagick dependency). No Complexity
Tracking entries required.

## Project Structure

### Documentation (this feature)

```text
specs/014-upload-page-polish/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── upload.md        # POST /api/posts contract deltas + tabs UI contract
└── tasks.md             # Phase 2 (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
backend/
├── app/
│   ├── Http/Requests/
│   │   └── CreatePostRequest.php        # title nullable→required(+trim); mimes add webp
│   ├── Services/
│   │   └── TrashpostImageProcessor.php  # webp extension mapping; route animated webp to WebpFile
│   └── Support/
│       ├── ImageFile.php                # add webp read/write (imagecreatefromwebp/imagewebp)
│       └── WebpFile.php                 # NEW: animated-webp detect + ImageMagick resize
├── tests/
│   ├── Feature/Http/Controllers/CreatePostTest.php   # required-title + webp cases
│   └── Unit/
│       ├── Services/TrashpostImageProcessorTest.php  # webp dispatch
│       └── Support/WebpFileTest.php                  # NEW
docker/php/Dockerfile                    # +imagemagick, GD --with-webp (libwebp-dev)
.github/workflows/ci.yml                 # backend + e2e jobs: install imagemagick; assert GD --with-webp

frontend/
├── src/
│   ├── pages/UploadPage.tsx             # "Upload" heading, .auth layout, tabs, required title
│   ├── components/
│   │   ├── MediaTabs.tsx                # NEW: WAI-ARIA tablist (Image/YouTube)
│   │   └── UploadMediaField.tsx         # accept webp; render inside active tabpanel
│   ├── hooks/
│   │   ├── useTabsKeyboard.ts           # NEW: roving-tabindex arrow-key handling
│   │   └── useUploadForm.ts             # client required-title check
│   ├── lib/uploadModel.ts               # validate(): title required (trim)
│   └── styles/theme.css                 # .media-tabs styling (theme-aware, responsive)
└── tests/
    ├── components/{MediaTabs,UploadMediaField}.test.tsx
    ├── hooks/{useTabsKeyboard,useUploadForm}.test.tsx
    ├── lib/uploadModel.test.ts
    ├── pages/UploadPage.test.tsx
    └── e2e/upload.spec.ts               # webp + required-title + tab-switch coverage
```

**Structure Decision**: Existing decoupled web-app layout (`backend/` Laravel API +
`frontend/` React SPA). No new top-level directories; the feature edits existing modules and
adds `WebpFile`, `MediaTabs`, and `useTabsKeyboard` beside their peers, with tests mirrored
under each stack's `tests/` (Principle VII).

## Complexity Tracking

> No Constitution Check violations. The single dependency addition (ImageMagick) is
> owner-approved under Principle I and is not a violation — no justification rows required.
