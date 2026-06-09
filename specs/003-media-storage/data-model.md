# Phase 1 Data Model: Media Storage Location

This feature has **no database entities**. Its "data model" is the on-disk media layout
and the small value objects the seed reasons about. Authoritative path rules live in the
[media-layout contract](./contracts/media-layout.md).

## Entities

### Media file (on disk)

A single stored asset addressed by its location on the `public` disk.

| Attribute | Description | Rules |
|-----------|-------------|-------|
| `code` | Public identifier (filename without extension) | Opaque; preserved verbatim from the prototype; not minted or re-validated here |
| `ext` | File extension | One of the allowlist: `jpg`, `jpeg`, `png`, `gif` (images). Video extensions reserved for the future upload feature |
| `type` | `image` or `video` | Images are size-bucketed; videos are not |
| `shard` | One-character bucket dir | Lowercased first char of filename; `other` if first char ∉ `[a-z0-9]` |
| `size` | Variant bucket (images only) | One of `original`, `800`, `500`, `300`, `100` |
| `relativePath` | Path on the `public` disk | Image: `image/trash/{size}/{shard}/{code}.{ext}` · Video: `video/trash/{shard}/{code}.{ext}` |

**Relationships**: One `code` may have 1–5 image variants (not every code has every
size). A video `code` has exactly one file (no variants).

**Lifecycle**: For this feature media is **append/copy only** — seeded once from the
prototype; idempotent re-runs converge to the same tree. No update/delete logic here.

### Size variant (image only)

A rendered width bucket of an image: `original` (unmodified) plus scaled-down widths
`800`, `500`, `300`, `100`. A variant file exists only when the original is wider than the
target width, so per-size counts are intentionally uneven. The seed copies whatever exists
and never fabricates a missing variant.

### Shard

A single-character directory (`a`–`z`, `0`–`9`, or `other`) derived from the first
character of the filename, used so no single directory holds the whole library.

### Verification report (transient)

Produced by each `media:seed` run; not persisted. Shape:

| Field | Description |
|-------|-------------|
| `perSize[size]` | `{ source: int, dest: int, match: bool }` for each of the 5 sizes |
| `copied` | Count of files copied this run |
| `skipped` | Count of already-present identical files skipped (idempotency) |
| `checksumMismatches` | Count of dest files whose hash ≠ source (MUST be 0 for success) |
| `straySkipped` | Count of non-media source files excluded (informational) |
| `strayInDest` | Count of non-media files found in the destination tree (MUST be 0) |

**Success condition**: every `perSize.match` is true **and** `checksumMismatches == 0`
**and** `strayInDest == 0` → command exits `0`; otherwise nonzero.

## Configuration

| Key | Where | Default | Purpose |
|-----|-------|---------|---------|
| `--source` (option) / `MEDIA_SEED_SOURCE` (env) | command arg / `.env` | prototype path `C:\projects\trash\storage\app\public\image\trash` | Absolute path to the prototype media root to copy from. A path, not a secret; documented in `.env.example`. |

Destination is fixed: the `public` disk under `image/trash/` (images) and `video/trash/`
(videos), per the media-layout contract.
