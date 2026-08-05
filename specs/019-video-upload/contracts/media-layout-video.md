# Contract: On-Disk Media Layout — Video (extends 003-media-storage)

This feature activates the video path already reserved (but unused) in
`specs/003-media-storage/contracts/media-layout.md` and adds the poster convention
that contract deferred.

## Video file path (now live)

```
video/trash/{shard}/{code}.{ext}
```

- `{ext}` ∈ `mp4 | webm` (extension derived from the validated MIME type, never the
  client-supplied filename — same rule `TrashpostImageProcessor::extensionFor()`
  already applies to images).
- No `{size}` segment — videos are never resized (unchanged from the 003 contract).
- `{shard}` = `MediaPath::shardFor("{code}.{ext}")`, identical rule to images.

Example: code `9zq-abc_de`, mp4 → `video/trash/9/9zq-abc_de.mp4`.

## Poster path (new — reuses the image tree, not a new root)

```
image/trash/{size}/{shard}/{code}.jpg
```

- Same `{code}` (the post's hash) as the video file, different extension and root.
- `{size}` ∈ `original | 800 | 500 | 300 | 100` — identical size list and
  never-upscale rule as any image post (`MediaPath::imageSizes()`,
  `TrashpostImageProcessor::missingVariants()`).
- Always `.jpg`, regardless of the source video's container.

Example: code `9zq-abc_de` → poster original at
`image/trash/original/9/9zq-abc_de.jpg`, 300-wide variant at
`image/trash/300/9/9zq-abc_de.jpg`.

## Media-extension allowlist (`MediaPath`)

Add a video allowlist alongside the existing image one:

- `VIDEO_EXTENSIONS = ['mp4', 'webm']`

`isMediaFile()` continues to answer for the image tree only; a parallel
`isVideoFile()` (or an extended `isMediaFile()` that also checks the video root) is
added for any tooling (seed/backfill commands) that needs to recognize video files —
scoped only if such tooling is touched by this feature's tasks.

## Ownership (`MediaOwnershipService::ownedPaths()`)

For a `type === 'video'` post, owned paths are:

1. The single video file: `MediaPath::videoRelativePath($code, $ext)` where `$code`/
   `$ext` come from `poster`'s sibling `file` column.
2. Every poster size variant: `MediaPath::imageRelativePath($size, $code, 'jpg')` for
   `$code` derived from the `poster` column, for each `MediaPath::imageSizes()` — the
   same loop already used for an image post's `file`, just keyed on `poster`.

No YouTube-thumbnail-style sharing check applies — a video's poster is never shared
across posts (each upload gets its own hash-derived poster).

## Version control

Unchanged — both roots stay under `backend/storage/app/public/.gitignore`'s blanket
exclusion. No video or poster file is ever committed.
