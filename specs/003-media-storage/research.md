# Phase 0 Research: Media Storage Location (Seed from Prototype)

No `NEEDS CLARIFICATION` remained after `/speckit-clarify`. This document records the
technical decisions that shape the design, plus relevant facts mined from the prototype.

## Decision 1: Deliver the seed as a Laravel Artisan command

- **Decision**: Implement the seed as `php artisan media:seed` in
  `app/Console/Commands/SeedMediaCommand.php`, rather than a standalone PowerShell/Node
  script.
- **Rationale**: The `backend/` Laravel app already exists (feature 002), with PHPUnit 11
  and the ≥90% coverage gate scoped to `app/`. An Artisan command (a) reuses the baseline
  stack with zero new dependencies (Principle I), (b) is unit/feature testable so it
  counts toward the coverage gate (Principle VII), (c) follows PHP conventions
  (Principle II), and (d) writes through the `public` disk the app will actually serve
  from. The clarification "seed runs ahead of backend scaffold" is now moot because the
  backend is already scaffolded — the command runs immediately.
- **Alternatives considered**:
  - *Standalone PowerShell script*: no automated-test home in the per-stack CI coverage,
    duplicates filesystem logic the app needs anyway, and would not be reusable by the
    upload feature. Rejected.
  - *Plain `Copy-Item`/`robocopy` one-liner*: cannot enforce the media-extension allowlist,
    produces no verification report, and leaves no reusable path helper. Rejected.

## Decision 2: Factor path/shard rules into a pure `App\Support\MediaPath` helper

- **Decision**: Put all path math (size list, shard derivation, image/video relative
  paths, media-extension test) in a pure, I/O-free `App\Support\MediaPath`; keep
  filesystem I/O and reporting in the command.
- **Rationale**: Pure functions are trivially unit-testable (Principle VII), and the
  future upload feature needs the exact same path/shard rules — isolating them now
  prevents duplication later (DRY). Mirrors the established `App\Support\PublicCode`
  pattern from feature 002.
- **Alternatives considered**: Inlining path logic in the command — harder to test, not
  reusable. Rejected.

## Decision 3: No image library (copy variants as-is)

- **Decision**: Copy all five size variants byte-for-byte; do not resize, re-encode, or
  generate missing variants.
- **Rationale**: The spec (FR-004) and the user explicitly chose "copy all sizes as-is".
  The prototype used `intervention/image` for resizing; since we do not resize, that
  dependency is unnecessary here (Principle I). The resize pipeline is a separate future
  feature.
- **Alternatives considered**: Copy originals only + regenerate variants — rejected by the
  user during clarification (would require the image library and re-rendering 1.3 GB).

## Decision 4: Idempotent copy + always-on verification

- **Decision**: For each source media file, copy only if the destination is missing or its
  size differs; then verify by comparing source/destination size and content hash. Emit a
  report with per-size source vs destination counts, checksum-mismatch count, and
  destination stray-file count. Exit nonzero if any count mismatches, any checksum
  mismatch, or any destination stray file exists.
- **Rationale**: Satisfies FR-005/FR-007/FR-011 and SC-001/SC-002/SC-004/SC-007. Hashing
  ~1.3 GB once is acceptable for a one-time operational command; idempotency makes
  interrupted runs safe to resume.
- **Alternatives considered**: Size-only comparison (faster, weaker) — rejected because the
  spec requires byte-for-byte confirmation. Mtime comparison — unreliable across copies.

## Decision 5: Version-control exclusion is already satisfied

- **Decision**: Rely on the existing `backend/storage/app/public/.gitignore` (`*` plus
  `!.gitignore`) to keep all media out of version control; add no committed media.
- **Rationale**: Laravel's default ignore rule already excludes everything under the
  `public` disk, so seeded images and future videos under `image/trash/` and `video/trash/`
  are never trackable (FR-010, SC-006). The convention is documented in this plan and the
  contracts; only documentation is committed.
- **Verification**: `git status` after a seed run shows no media as tracked or stageable
  (quickstart step).

## Prototype facts (source of truth for the layout)

Derived from `C:\projects\trash` (`TrashpostPathService` / `TrashpostPicService`) and a
scan of `storage/app/public/image/trash`:

- **Disk/root**: prototype uses Laravel's `public` disk; media root is `image/trash`.
- **Sizes**: `original` (unmodified) plus widths `800, 500, 300, 100` (scaled **down**
  only; an original narrower than a target width has no file for that size — hence uneven
  per-size counts).
- **Shard**: lowercased first character of the filename; if not `[[:alnum:]]`, the shard
  is `other`. (`TrashpostPathService::getFileNameWithSubfolder`.)
- **Filename**: the public code + original extension; codes are lowercased on intake.
- **Volume scan**: ~8,709 directory entries / ~1.3 GB. Extensions: 6,180 `.jpg`, 1,049
  `.png`, 816 `.gif`, 659 `.jpeg`, **and 5 `.gitignore`** (one per size dir) which are
  *stray non-media* and MUST be excluded. Per-size raw entry counts (original 2,621; 800
  112; 500 998; 300 2,359; 100 2,619) each include one `.gitignore`; the seed's success
  gate compares **media** counts (raw minus excluded non-media), so destination per-size
  media counts are each 1 lower than the raw figures.

## Open questions

None. All decisions above are settled and consistent with the spec, the constitution,
and `docs/CODING_CONVENTIONS.md`.
