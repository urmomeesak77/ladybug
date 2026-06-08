# Feature Specification: Media Storage Location (Seed from Prototype)

**Feature Branch**: `003-media-storage`

**Created**: 2026-06-08

**Status**: Draft

**Input**: User description: "prototype has images stored in different sizes: C:\projects\trash\storage\app\public\image\trash copy them to this project to correct location. in future new images/videos will be uploaded there as well. Check the file structure above also"

## Overview

The earlier prototype ("Trashpost", at `C:\projects\trash`) already holds the full
library of uploaded meme images, stored in several rendered sizes. This feature
establishes the **canonical on-disk media location** for the Ladybug backend and
**seeds it** with the prototype's existing images, copied to that location with their
folder layout preserved. Once seeded, this same location is the single destination
where all newly uploaded images and videos are written from now on.

This is a storage-layout and data-migration feature. It does not build the upload
API, the feed, or any image-processing pipeline — it only defines *where* media
lives and gets the existing files into place.

## Clarifications

### Session 2026-06-08

- Q: Where should future video uploads live, given the `image/trash/...` mirror pattern? → A: `video/trash/{shard}/{code}.{ext}` — sibling of `image/trash`, same first-character sharding, no size variants.
- Q: How is the byte-for-byte integrity / count match confirmed in this feature? → A: The seed produces a verification report (per-size counts + checksum/byte comparison) as a completion artifact.
- Q: Does the seed run now (before `backend/` is scaffolded) or wait? → A: Seed now — create the target tree ahead of the backend scaffold; the feature does not depend on the backend scaffold.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Existing images are available at the canonical location (Priority: P1)

As the site operator, I want every image from the prototype copied into the new
project's canonical media location with its size variants and folder structure
intact, so the existing library is preserved and ready for the feed and meme pages
to serve.

**Why this priority**: Without the existing media in the right place, the new site
has nothing to show. This is the core deliverable and a prerequisite for any feature
that displays memes.

**Independent Test**: Run the copy, then verify a known public code resolves to its
files under the canonical location in every size that existed in the prototype, and
that the generated verification report shows total and per-size counts matching the
source with zero checksum mismatches.

**Acceptance Scenarios**:

1. **Given** the prototype media tree at `C:\projects\trash\storage\app\public\image\trash`, **When** the seed copy completes, **Then** the canonical media location contains the same files, organized in the same `{size}/{shard}/{filename}` structure.
2. **Given** a public code that has variants in sizes `original`, `300`, and `100` in the prototype, **When** I look it up at the canonical location, **Then** the same three variants exist and no expected variant is missing.
3. **Given** the seed copy has run once, **When** it is run again, **Then** already-present files are not duplicated or corrupted (the operation is safe to repeat).
4. **Given** the copy completes, **When** I compare source and destination, **Then** total file count and per-size file counts are identical and each copied file is byte-for-byte identical to its source.

---

### User Story 2 - A single, documented destination for future uploads (Priority: P2)

As a developer building the upload feature, I want one clearly documented canonical
media location and folder convention, so newly uploaded images and videos are
written to the same place as the seeded library and everything is served uniformly.

**Why this priority**: Establishes the contract the upload pipeline will depend on.
Valuable independently of the one-time seed, but the seed (P1) is what proves the
location works.

**Independent Test**: Confirm the canonical location and its folder convention are
documented and that a newly added file placed by the convention sits alongside the
seeded files indistinguishably.

**Acceptance Scenarios**:

1. **Given** the documented convention, **When** a new image is stored, **Then** it lands under the same `{size}/{shard}/{filename}` layout as the seeded images.
2. **Given** a new **video** upload, **When** it is stored, **Then** it lands at `video/trash/{shard}/{filename}` (sibling of `image/trash`, no size variants) under the same public storage root.
3. **Given** a filename whose first character is not alphanumeric, **When** its shard folder is derived, **Then** it is placed in the `other` shard, consistent with the seeded files.

---

### Edge Cases

- **Missing variants**: Some public codes in the prototype do not have every size
  (e.g., only `original` and `100`). The seed copies whatever exists; it does not
  fabricate missing sizes. Counts: `original` 2,621, `800` 112, `500` 998, `300`
  2,359, `100` 2,619 — these are intentionally uneven and must be preserved as-is.
- **Mixed formats**: Files include `.jpg`, `.jpeg`, `.png`, and `.gif`. All are
  copied unchanged regardless of extension.
- **Stray non-media files**: The source contains a few `.gitignore` files. The seed
  must copy only media files and not import stray VCS/control files into the
  canonical tree.
- **`other` shard**: Each size directory has an `other` shard for filenames not
  starting with `[a-z0-9]`; it must be preserved.
- **Repeat / partial runs**: Re-running after a completed or interrupted copy must
  converge to a complete, correct tree without duplication or corruption.
- **Large volume**: ~8,709 files / ~1.3 GB total — the operation must complete
  reliably at this scale.
- **Media excluded from version control**: All media (seeded images plus future
  images and videos) is user content, not source code; it must never be committed to
  the repository — an ignore rule must cover the media tree so files are not even
  stageable.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST define a single canonical media location for the
  backend, rooted at the backend's public storage area, using the path
  `image/trash/` (mirroring the prototype layout) relative to that storage root.
- **FR-002**: Within the media location, image files MUST be organized as
  `{size}/{shard}/{filename}`, where `{size}` is one of `original`, `800`, `500`,
  `300`, `100`; `{shard}` is the lowercased first character of the filename, or
  `other` when that character is not `[a-z0-9]`; and `{filename}` is the public
  code plus its original extension.
- **FR-003**: The system MUST copy every media file from the prototype source
  (`C:\projects\trash\storage\app\public\image\trash`) into the canonical location,
  preserving the size and shard folder structure exactly.
- **FR-004**: The seed MUST copy **all** size variants that exist in the source
  (`original`, `800`, `500`, `300`, `100`) as-is, without re-rendering, resizing, or
  generating any missing variants.
- **FR-005**: Copied files MUST be byte-for-byte identical to their sources;
  total and per-size file counts at the destination MUST match the source.
- **FR-006**: The seed MUST copy only media files (`.jpg`, `.jpeg`, `.png`, `.gif`)
  and MUST NOT copy stray non-media/control files (e.g., `.gitignore`).
- **FR-007**: The seed operation MUST be safe to re-run: a second run MUST NOT
  duplicate, truncate, or corrupt already-copied files, and MUST complete the tree
  if a prior run was interrupted.
- **FR-008**: The canonical location MUST be the documented destination for all
  future image and video uploads, so seeded and newly uploaded media coexist under
  one root served uniformly.
- **FR-009**: The convention MUST place future video uploads at
  `video/trash/{shard}/{filename}` — a sibling of `image/trash` under the same
  public storage root, sharded by the same first-character rule, with no size
  variants (videos are not bucketed by size).
- **FR-011**: The seed MUST produce a verification report on completion that lists
  per-size source-vs-destination file counts, the count of checksum/byte mismatches,
  and the count of stray non-media files excluded; the report MUST show zero
  mismatches and zero stray files for the seed to be considered successful.
- **FR-012**: The seed MUST target the path the backend will use
  (`backend/storage/app/public/...`) and MUST NOT depend on the `backend/` Laravel
  app being scaffolded first; it creates the target directory tree if absent.
- **FR-010**: All media — the seeded image tree and all future uploaded images and
  videos under `image/trash/` and `video/trash/` — MUST be excluded from version
  control (user content, not source) via an ignore rule covering the media tree, so
  no media file is ever staged, committed, or tracked. The location/convention and
  the ignore rule itself MUST be documented/committed; only the media payload is
  excluded.

### Key Entities *(include if feature involves data)*

- **Media file**: A single stored asset (image now; video in future), identified by
  its public code and addressed by `{size}/{shard}/{filename}`. Images may exist in
  multiple size variants; videos exist as a single asset.
- **Size variant**: A rendered width bucket of an image — `original` (unmodified)
  plus `800`, `500`, `300`, `100` (scaled-down widths). Not every image has every
  variant.
- **Shard**: A single-character bucket directory (`a`–`z`, `0`–`9`, or `other`)
  derived from the first character of the filename, used to keep any one directory
  from holding the entire library.
- **Canonical media location**: The backend public storage root that holds all
  media — `image/trash/{size}/{shard}/...` for images (seeded and future) and
  `video/trash/{shard}/...` for future videos.
- **Verification report**: The completion artifact of a seed run — per-size
  source-vs-destination counts, checksum/byte mismatch count, and excluded
  stray-file count — used to objectively confirm a correct, complete copy.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of the prototype's media files (all sizes) are present at the
  canonical location after seeding — per-size counts match exactly (`original`
  2,621; `800` 112; `500` 998; `300` 2,359; `100` 2,619).
- **SC-002**: Every copied file is byte-for-byte identical to its source (0
  checksum mismatches).
- **SC-003**: 0 stray non-media files (e.g., `.gitignore`) are present in the
  canonical media tree.
- **SC-004**: Re-running the seed produces no duplicate or corrupted files and the
  resulting tree is identical to a single clean run.
- **SC-005**: A developer can locate the single documented destination for new
  uploads (images and videos) from project documentation without inspecting the
  prototype.
- **SC-006**: The seeded media — and all future uploaded images and videos — are
  absent from version control (not staged, committed, or tracked); a re-run of the
  copy followed by a status check shows no media files as tracked or stageable.
- **SC-007**: Every seed run emits a verification report whose per-size counts match
  the source and which reports zero checksum mismatches and zero stray files.

## Assumptions

- **Destination path**: The canonical location is the backend Laravel app's public
  storage area, i.e. `backend/storage/app/public/image/trash/` — mirroring the
  prototype's `storage/app/public/image/trash/` layout (per the user's choice to
  mirror the prototype rather than rename to project "meme" vocabulary).
- **Backend not yet scaffolded**: The `backend/` directory does not exist yet. The
  seed runs now and creates the target tree ahead of the backend scaffold (decided
  in Clarifications); the existing media sits there until the backend serves it.
  This feature does not depend on the backend scaffold feature.
- **Variants copied as-is**: All five size buckets are copied verbatim; no
  resizing, re-encoding, or backfilling of missing variants happens in this feature
  (the image pipeline is out of scope here).
- **Sharding scheme retained**: The prototype's first-character shard scheme
  (lowercased, with `other` fallback) is kept unchanged.
- **Video placement**: Future videos live at `video/trash/{shard}/{filename}` (a
  sibling of `image/trash`, no size variants); no videos exist to copy yet, so this
  is a convention, not a copy step, in this feature.
- **One-time source**: The prototype at `C:\projects\trash` is a static source for
  this seed; ongoing sync from the prototype is not required.
- **Public codes**: Filenames are treated as opaque identifiers plus extension; this
  feature does not validate or re-mint public codes (constitution Principle V is the
  authority when the backend assigns them).

## Out of Scope

- The upload API / form, validation of new uploads, and the image-resizing pipeline.
- The feed, meme page, or any code that *serves* the media over HTTP.
- Database records pointing at these files (the posts schema is feature 002).
- Renaming the path to project "meme" vocabulary or migrating public codes.
- Importing or transcoding any video content (none exists yet).

## Dependencies

- Read access to the prototype media tree at
  `C:\projects\trash\storage\app\public\image\trash`.
- A defined location for the future `backend/` Laravel app (target storage root),
  per the suggested file structure in `CLAUDE.md`.
