# Contract: On-Disk Media Layout

The canonical layout for all Ladybug media on Laravel's `public` disk
(`backend/storage/app/public/`). This is the contract the seed writes to and that the
future upload/serve features MUST follow. Implemented by `App\Support\MediaPath`.

## Roots

| Media type | Root (relative to `public` disk) |
|------------|----------------------------------|
| Image | `image/trash/` |
| Video | `video/trash/` |

> `trash` mirrors the prototype's post-collection segment (per the spec's decision to
> mirror the prototype rather than adopt "meme" vocabulary).

## Image path

```
image/trash/{size}/{shard}/{code}.{ext}
```

- `{size}` ∈ `original | 800 | 500 | 300 | 100`
- `{shard}` = `MediaPath::shardFor("{code}.{ext}")`
- `{ext}` ∈ `jpg | jpeg | png | gif`

Example: code `1dcmpenbnr`, jpg, size 300 → `image/trash/300/1/1dcmpenbnr.jpg`

## Video path (reserved; no copy in this feature)

```
video/trash/{shard}/{code}.{ext}
```

- No size buckets (videos are not resized).
- `{shard}` derived identically to images.

Example: code `9zq-abc_de`, mp4 → `video/trash/9/9zq-abc_de.mp4`

## Shard rule (`MediaPath::shardFor`)

1. Take the **first character** of the filename (the code's first char).
2. Lowercase it.
3. If it matches `[a-z0-9]` use it as the shard; otherwise use the literal `other`.

| Filename | Shard |
|----------|-------|
| `1dcmpenbnr.jpg` | `1` |
| `Abc...png` | `a` |
| `_hidden.gif` | `other` |
| `-dash.jpeg` | `other` |

## Sizes (`MediaPath::imageSizes`)

Ordered list used for iteration and reporting: `original, 800, 500, 300, 100`. `original`
is the unmodified upload; the numeric sizes are scaled-down widths. A variant exists only
when the original is wider than the target; missing variants are valid and never fabricated.

## Media-extension allowlist (`MediaPath::isMediaFile`)

Image extensions accepted by the seed (case-insensitive): `jpg, jpeg, png, gif`.
Any other file (notably `.gitignore`) is **not** media and MUST be excluded from copying
and from the destination tree.

> Video extensions are intentionally **out of scope** for this feature's allowlist; the
> upload feature will extend the allowlist for `video/trash/` when videos are introduced.

## Version control

All paths under both roots are excluded from git by
`backend/storage/app/public/.gitignore` (`*` + `!.gitignore`). No media file is ever
committed; the ignore rule and this contract are the committed artifacts.
